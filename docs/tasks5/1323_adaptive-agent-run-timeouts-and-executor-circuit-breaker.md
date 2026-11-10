---
schema_version: 1
name: Adaptive agent-run timeouts and executor circuit breaker
status: done
template: feature-impl
created_at: 2026-11-10T07:34:39.575Z
updated_at: "2026-11-10T22:10:45.756Z"
feature_id: D3

priority: P1
ac_altitude: task-local
estimate_hours: 12
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1323-verdict.json
---

## 1323. Adaptive agent-run timeouts and executor circuit breaker

### Background

KK history analysis since spur 0.4.30 (2026-11-10) shows workflow `agent.run` dispatches failing at
exactly their configured `timeoutMs` (600s on kk-daily-ai-voice3 plan-translate/script-write; 1200s
on kk-daily-safety review/revise) because the first-choice executor (pi-dsv4.1-flash-volc, ~100K
token prompts, 4–80s steps) cannot finish inside the budget. Retry chains in one 3-day window:
review-retry ×11 (66 min), judge-retry ×10 (45 min), revise-retry ×10 (26 min) — 33 extra dispatches
and 150+ minutes. Separately, an unavailable executor (codex-sol) returned instant exitCode 2
"dispatch result carried no usage" 6+ times and was still retried. Pairing success rates were
reviewer 40% and scribe 37.5%. Both Nov 9 kk-daily-ai-voice3 production runs failed
`failed-check` after ~2.2h each.

### Requirements

- [x] R1. Circuit breaker: an executor whose dispatch fails immediately with unavailability (exitCode 2 /
   no usage / provider unavailability) is skipped for the remainder of the run's ladder before
   another dispatch is attempted against it.
- [x] R2. Adaptive timeout: per-node `timeoutMs` may be derived from the executor's observed latency
   history (e.g. `history_board_model_stats` mean/p95 step and dispatch durations) with the YAML
   value as the hard cap, so slow executors get a workable budget instead of a guaranteed timeout.
- [x] R3. Ladder ordering may use measured latency × success rate (not price alone) when choosing the next
   executor after a timeout or unavailability failure.

### Acceptance Criteria

- [x] AC1 — (req: R1): With a dead executor first in the ladder, a run with a retry-bound node performs zero
  dispatches against the dead executor after its first unavailability failure.
- [x] AC2 — (req: R2; R3): A node whose historical executor latency exceeds the static timeout either completes under a
  derived budget or fails over to the next executor without burning the static timeout twice.
- [x] AC3 — (req: R1; R2; R3): Ladder decisions and derived budgets are recorded in the run trace for auditing.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-10T16:30:41.706Z

- Q: Why not fix the workflows instead? A: YAML budgets are operator intent; the defect is the
  executor ignoring measured latency and re-dispatching to dead executors. Fixing it in the engine
  repairs every workflow at once.
- Q: Does the breaker persist across runs? A: No — run-scoped only. Cross-run executor disabling
  already belongs to B5/B6 availability lifecycle, not this task.
- Q: Dependencies? A: Reads `history_board_model_stats` when present; degrades to static behavior
  when history is empty. No other task dependency.

### Design

**Decision: extend the existing escalation ladder in `packages/app/src/services/agent-run-executor.ts`;
do not add a parallel retry controller.** The ladder already tracks executors tried per run and
escalates on rule-matched failures. Two additions close the measured failure modes:

1. **Circuit breaker (unavailability)**: when an attempt fails immediately with executor
   unavailability — exitCode 2, "dispatch result carried no usage", provider unavailable
   classification — mark that executor unavailable for the rest of the run so subsequent attempts
   and retry-bound nodes skip it. The existing per-attempt exclusion list is the seam; the breaker
   persists the exclusion across attempts of the same run instead of relearning it per node.
2. **Adaptive timeout (latency)**: per-node `timeoutMs` may be derived from observed executor
   latency in `history_board_model_stats` (mean/p95 dispatch duration), clamped to the YAML value
   as a hard cap. When no history exists, the static YAML timeout applies unchanged.
3. **Ladder ordering**: after a timeout or unavailability failure, order remaining executors by
   measured latency × success rate (from the same stats) instead of declaration order alone.

Every breaker decision, derived budget, and ordering rationale is written to the run trace.

### Plan

- [x] P1. Add a run-scoped unavailability breaker to `agent-run-executor.ts`: classify instant
  unavailability failures, exclude the executor for the run, emit trace events.
- [x] P2. Implement latency-derived `timeoutMs` resolution with YAML hard cap and no-history
  fallback; record derived values in the trace.
- [x] P3. Order post-failure ladder candidates by latency × success from `history_board_model_stats`.
- [x] P4. Tests: dead-executor-first ladder performs zero repeat dispatches; slow-executor node
  derives a workable budget or fails over without burning the static timeout twice.

### Solution

- `packages/app/src/services/adaptive-timeout.ts:7` — new: `resolveAdaptiveTimeoutMs` (R2: derived budget = max(3×mean, 1.5×p95) with a 30s floor, YAML `timeoutMs` is the hard cap — never grown, healthy budgets never shrunk; no history → static behavior), `ladderScore` (R3: latency ÷ clamped success rate, lower wins), `readExecutorLatency`/`loadExecutorLatency` (reads `history_board_model_stats`; read failure → empty, never throws).
- `packages/app/src/services/agent-run-executor.ts:174` — R1: run-scoped breaker (keyed by the flags' `run-id`, the id the action correlates retries with; bounded, no cross-run persistence); completed-dispatch unavailability (exit 2 / unavailable signal) trips it via `executorUnavailabilityEvidence`, a retry-bound node's next dispatch re-resolves through the stage funnel with the breaker set excluded (breaker-skip), breaker-dead run fails honestly with exitCode 2. R2: per-attempt `resolveAdaptiveTimeoutMs` → `timeoutBudget` on the traced invocation; measured latency beyond the cap fails over pre-dispatch (timeout-exhausted-skip) instead of burning the timeout. AC3: decisions (`breaker-trip`/`breaker-skip`/`timeout-exhausted-skip`/escalation/chain-exhausted) recorded on the result + `agent.invoke.ladder` events.
- `packages/app/src/services/agent-resolver.ts:442` — R3: `orderEligibleByMeasuredLatency` orders escalation-ladder candidates measured-first by latency × success (unmeasured keep declaration order); result carries `ordering` for the trace; empty history → static order unchanged.
- `packages/app/src/services/agent-service.ts` — types: `AgentLadderDecision`, `LadderOrderingEntry`, `AgentRunTracedResult.ladder`, `AgentRunInvocation.timeoutBudget`, `historyLatency` context seam; `runTraced` threads `ladder`.
- `packages/app/src/services/failure-classification.ts` — `executorUnavailabilityEvidence` (exit 2 / unavailable-signal evidence string).
- `packages/app/src/workflow/actions/agent-run.ts` — persists `traced.ladder` onto the action result row.
- Tests: `tests/services/adaptive-timeout.test.ts`, `tests/services/agent-run-executor-d3.test.ts` (AC1/AC2), `tests/services/agent-resolver-d3.test.ts` (R3).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Run-scoped breaker map bounded at 256 with oldest-eviction `packages/app/src/services/agent-run-executor.ts:184-201`; run-id keying the action correlates retries with `packages/app/src/services/agent-run-executor.ts:416` + `packages/app/src/workflow/actions/agent-run.ts:997`; completed-dispatch exit-2/unavailable-signal trip `packages/app/src/services/agent-run-executor.ts:943-954` via `packages/app/src/services/failure-classification.ts:184-190`; pre-loop breaker-skip re-resolve so retry-bound nodes never re-dispatch the dead executor `packages/app/src/services/agent-run-executor.ts:570-613`; honest exit-2 chain exhaustion `packages/app/src/services/agent-run-executor.ts:584-593`; escalation-seam union exclusion (prior-fix verification) `packages/app/src/services/agent-run-executor.ts:1010-1019`. Tests: `packages/app/tests/services/agent-run-executor-d3.test.ts:91,112,132,227,274` — 19 pass / 0 fail fresh. |
| R2 | MET | `resolveAdaptiveTimeoutMs` with YAML hard cap (never grown, healthy budgets never shrunk), 30s floor, mean×3 / p95×1.5 headroom, no-history static fallback `packages/app/src/services/adaptive-timeout.ts:47-105`; per-attempt wiring with latency cache `packages/app/src/services/agent-run-executor.ts:625-649`; budget stamped on the traced invocation `packages/app/src/services/agent-run-executor.ts:795-801`; domain read degrading to empty on any failure `packages/domain/src/analytics/executor-latency.ts:37-66`. Tests: `packages/app/tests/services/adaptive-timeout.test.ts:18-75`, `packages/domain/tests/analytics/executor-latency.test.ts:41-85` — all pass fresh. |
| R3 | MET | `orderEligibleByMeasuredLatency` orders stage-funnel and sideways failover candidates measured-first (ladderScore = latency ÷ clamped success, lower wins), records `ordering` for the trace, degrades to declaration order with empty history `packages/app/src/services/agent-resolver.ts:442-443,549-550,598-631`; `ladderScore` `packages/app/src/services/adaptive-timeout.ts:107-114`. Tests: `packages/app/tests/services/agent-resolver-d3.test.ts:60,78` — pass fresh. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Dead-first ladder dispatches the dead executor exactly once then fails over (`packages/app/tests/services/agent-run-executor-d3.test.ts:91`), a retry-bound node in the same run performs zero further dispatches and records `breaker-skip` (`packages/app/tests/services/agent-run-executor-d3.test.ts:112`), breaker-exhausted runs fail honestly with exit 2 (`packages/app/tests/services/agent-run-executor-d3.test.ts:132`), and the escalation walk never re-selects a breaker-dead executor — zero dead re-dispatches with `chain-exhausted` instead (`packages/app/tests/services/agent-run-executor-d3.test.ts:227,274`). Fresh: 19 pass / 0 fail. |
| AC2 | MET | test | Slow-executor node with measured latency beyond the static cap is skipped pre-dispatch with zero wasted dispatches and a visible derived budget in the decision detail (`packages/app/tests/services/agent-run-executor-d3.test.ts:150`); with no alternative, the node dispatches under the operator cap with the budget visible on the traced invocation `fits:false appliedMs:1000 derivedMs:30000` (`packages/app/tests/services/agent-run-executor-d3.test.ts:170`, wiring at `packages/app/src/services/agent-run-executor.ts:795-801`); no history keeps the static budget unchanged (`packages/app/tests/services/agent-run-executor-d3.test.ts:192`). |
| AC3 | MET | test | Every adaptive decision (`breaker-trip`/`breaker-skip`/`timeout-exhausted-skip`/`escalation`/`chain-exhausted`) is recorded with a reason + timestamp and mirrored onto `agent.invoke.ladder` (`packages/app/src/services/agent-run-executor.ts:204-222`, decisions returned at `packages/app/src/services/agent-run-executor.ts:1177`) and persisted onto the action result row (`packages/app/src/workflow/actions/agent-run.ts:1634`); derived budgets ride the traced invocation `timeoutBudget` (`packages/app/src/services/agent-service.ts:210-216`). Tests assert `traced.ladder` kinds and `invocation.timeoutBudget` (`packages/app/tests/services/agent-run-executor-d3.test.ts:79-89,158-190`). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1323 (feature D3: adaptive agent-run timeouts and executor circuit breaker)
**Scope:** `git diff 54bf29d0f..HEAD`, task-1323 substance: `packages/app/src/services/adaptive-timeout.ts`, `agent-run-executor.ts`, `agent-resolver.ts`, `agent-service.ts`, `failure-classification.ts`, `packages/app/src/workflow/actions/agent-run.ts`, `packages/domain/src/analytics/executor-latency.ts` (+ tests). Diff-range files owned by sibling task 1322 (`quality-gate.ts`, `command-gate.ts`, `forensic-query.ts` loop-detection) are out of this task's scope and were not deep-reviewed here.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Prior-fix verification (independent):** the run-5d544858 finding (escalation seam re-selecting breaker-dead executors) is confirmed FIXED at HEAD — the post-failure re-resolve excludes the union `attemptedExecutors ∪ breaker.executors` and treats a breaker-dead resolve as chain exhaustion (`packages/app/src/services/agent-run-executor.ts:1010-1019`), mirroring the pre-loop breaker-skip seam (`packages/app/src/services/agent-run-executor.ts:570-613`); the two new mid-ladder tests exist and pass fresh (`packages/app/tests/services/agent-run-executor-d3.test.ts:227`, `packages/app/tests/services/agent-run-executor-d3.test.ts:274`). Verified from source, not from the commit claim.

**Fresh test evidence (run this session, HEAD 20496e62f):**
- `packages/app` `bunx tsc --noEmit -p tsconfig.json` — clean (exit 0).
- `bun test tests/services/adaptive-timeout.test.ts tests/services/agent-run-executor-d3.test.ts tests/services/agent-resolver-d3.test.ts` — 19 pass / 0 fail (17 original + 2 review-finding-1 tests).
- `packages/domain` `bun test tests/analytics/executor-latency.test.ts` — 6 pass / 0 fail.
- Regression services: 277 pass / 0 fail (agent-run-executor, agent-resolver, agent-service, agent-routing-attribution, failure-classification).
- Regression workflow: 270 pass / 0 fail (agent-run*.test, agent-run-admission/completion/receipt, agent-run-fleet, session-pinned-dispatch, fleet-work-item).

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | A `timeout-exhausted-skip` on the node's first attempt `continue`s the loop before any dispatch, so the first real dispatch runs at `attempt >= 1` and `lifecycle.start` (guarded `attempt === 0`) never executes: the run emits no `started` lifecycle event and no progress heartbeats for that entire dispatch. `finish` still emits (its guards tolerate a missing start), dispatch behavior and all recorded ladder/budget decisions are unaffected — observability-only. Suggested fix: a start-once flag instead of the `attempt === 0` guard. | `packages/app/src/services/agent-run-executor.ts:689`, `packages/app/src/services/agent-run-executor.ts:812`, `packages/app/src/observability/agent-execution.ts:291` | DEFER(follow-up task recommended; no AC impact, observability-only, narrow trigger) |
| 2 | P4 (advisory) | security | The breaker trips on ANY completed exit-2 dispatch. The rationale — "a completed dispatch can only end 2 when the shim/dispatch layer failed before any agent work; agent failures are 3" — is an external ts-ai-runner/shim contract stated in-repo at `packages/app/src/services/failure-classification.ts:180-186` and corroborated by the KK evidence at `docs/tasks5/1323_adaptive-agent-run-timeouts-and-executor-circuit-breaker.md:24`, but not verifiable from in-repo source (the runner dist passes exitCode through). If a shim ever ended agent-level failures with exit 2, the breaker would over-trip (failover instead of a possibly-successful retry). Assumption named; misfire cost is bounded to a run-scoped failover. | `packages/app/src/services/agent-run-executor.ts:943-954` | ACCEPTED |
| 3 | P4 (advisory) | correctness | Unavailability that manifests as a thrown dispatch (e.g. spawn ENOENT) returns exit 2 without tripping the breaker, so retry-bound nodes each re-pay one thrown dispatch against such an executor. Deliberate narrowness: the same throw path carries cancellation (aborted controller), which must not trip a breaker. Outside the measured KK failure shape (completed exit 2 / no usage). | `packages/app/src/services/agent-run-executor.ts:904-916` | ACCEPTED |
| 4 | P4 (advisory) | usability | The "run-scoped only" property (no cross-run breaker persistence, per Q&A) is structurally guaranteed by run-id keying (`packages/app/src/services/agent-run-executor.ts:416`, action stamping at `packages/app/src/workflow/actions/agent-run.ts:997`) but no test pins it — every D3 test shares one run id per scenario. A two-run-id test would lock the boundary. | `packages/app/tests/services/agent-run-executor-d3.test.ts:205-315` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Run-scoped breaker map bounded at 256 with oldest-eviction `packages/app/src/services/agent-run-executor.ts:184-201`; run-id keying the action correlates retries with `packages/app/src/services/agent-run-executor.ts:416` + `packages/app/src/workflow/actions/agent-run.ts:997`; completed-dispatch exit-2/unavailable-signal trip `packages/app/src/services/agent-run-executor.ts:943-954` via `packages/app/src/services/failure-classification.ts:184-190`; pre-loop breaker-skip re-resolve so retry-bound nodes never re-dispatch the dead executor `packages/app/src/services/agent-run-executor.ts:570-613`; honest exit-2 chain exhaustion `packages/app/src/services/agent-run-executor.ts:584-593`; escalation-seam union exclusion (prior-fix verification) `packages/app/src/services/agent-run-executor.ts:1010-1019`. Tests: `packages/app/tests/services/agent-run-executor-d3.test.ts:91,112,132,227,274` — 19 pass / 0 fail fresh. |
| R2 | MET | `resolveAdaptiveTimeoutMs` with YAML hard cap (never grown, healthy budgets never shrunk), 30s floor, mean×3 / p95×1.5 headroom, no-history static fallback `packages/app/src/services/adaptive-timeout.ts:47-105`; per-attempt wiring with latency cache `packages/app/src/services/agent-run-executor.ts:625-649`; budget stamped on the traced invocation `packages/app/src/services/agent-run-executor.ts:795-801`; domain read degrading to empty on any failure `packages/domain/src/analytics/executor-latency.ts:37-66`. Tests: `packages/app/tests/services/adaptive-timeout.test.ts:18-75`, `packages/domain/tests/analytics/executor-latency.test.ts:41-85` — all pass fresh. |
| R3 | MET | `orderEligibleByMeasuredLatency` orders stage-funnel and sideways failover candidates measured-first (ladderScore = latency ÷ clamped success, lower wins), records `ordering` for the trace, degrades to declaration order with empty history `packages/app/src/services/agent-resolver.ts:442-443,549-550,598-631`; `ladderScore` `packages/app/src/services/adaptive-timeout.ts:107-114`. Tests: `packages/app/tests/services/agent-resolver-d3.test.ts:60,78` — pass fresh. |

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| AC1 | MET | test | Dead-first ladder dispatches the dead executor exactly once then fails over (`packages/app/tests/services/agent-run-executor-d3.test.ts:91`), a retry-bound node in the same run performs zero further dispatches and records `breaker-skip` (`packages/app/tests/services/agent-run-executor-d3.test.ts:112`), breaker-exhausted runs fail honestly with exit 2 (`packages/app/tests/services/agent-run-executor-d3.test.ts:132`), and the escalation walk never re-selects a breaker-dead executor — zero dead re-dispatches with `chain-exhausted` instead (`packages/app/tests/services/agent-run-executor-d3.test.ts:227,274`). Fresh: 19 pass / 0 fail. |
| AC2 | MET | test | Slow-executor node with measured latency beyond the static cap is skipped pre-dispatch with zero wasted dispatches and a visible derived budget in the decision detail (`packages/app/tests/services/agent-run-executor-d3.test.ts:150`); with no alternative, the node dispatches under the operator cap with the budget visible on the traced invocation `fits:false appliedMs:1000 derivedMs:30000` (`packages/app/tests/services/agent-run-executor-d3.test.ts:170`, wiring at `packages/app/src/services/agent-run-executor.ts:795-801`); no history keeps the static budget unchanged (`packages/app/tests/services/agent-run-executor-d3.test.ts:192`). |
| AC3 | MET | test | Every adaptive decision (`breaker-trip`/`breaker-skip`/`timeout-exhausted-skip`/`escalation`/`chain-exhausted`) is recorded with a reason + timestamp and mirrored onto `agent.invoke.ladder` (`packages/app/src/services/agent-run-executor.ts:204-222`, decisions returned at `packages/app/src/services/agent-run-executor.ts:1177`) and persisted onto the action result row (`packages/app/src/workflow/actions/agent-run.ts:1634`); derived budgets ride the traced invocation `timeoutBudget` (`packages/app/src/services/agent-service.ts:210-216`). Tests assert `traced.ladder` kinds and `invocation.timeoutBudget` (`packages/app/tests/services/agent-run-executor-d3.test.ts:79-89,158-190`). |

Confidence: MEDIUM

Architecture note: the feature extends the existing escalation ladder rather than adding a parallel retry controller (per Design), keeps the breaker run-scoped and bounded, and degrades to static behavior on any history-read failure (`packages/app/src/services/adaptive-timeout.ts:130-152`, `packages/domain/src/analytics/executor-latency.ts:43-66`) — deep-module shape with one shared policy seam (`adaptive-timeout.ts`) consumed by both the executor (R2) and the resolver (R3). Residual risks: finding 1's observability gap will fire in the KK target scenario (history exceeding static cap with an alternative executor present) once history accumulates — cosmetic but worth the follow-up; the exit-2 trip breadth rests on the named external shim contract (finding 2).

**Next:** file the follow-up task for finding 1 (lifecycle start-once on the timeout-exhausted-skip path); optionally pin run-scoped isolation with a two-run-id test.

Verdict: PASS


### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-10T16:31:02.654Z backlog → todo (system)
- 2026-11-10T22:10:41.499Z wip → testing (system)
- 2026-11-10T22:10:45.746Z testing → done (system)

