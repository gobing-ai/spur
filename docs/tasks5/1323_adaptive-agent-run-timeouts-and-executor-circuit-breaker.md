---
schema_version: 1
name: Adaptive agent-run timeouts and executor circuit breaker
status: wip
template: feature-impl
created_at: 2026-11-10T07:34:39.575Z
updated_at: "2026-11-10T20:21:39.670Z"
feature_id: D3

priority: P1
ac_altitude: task-local
estimate_hours: 12
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
- [ ] R3. Ladder ordering may use measured latency × success rate (not price alone) when choosing the next
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

- `packages/app/src/services/adaptive-timeout.ts` — new: `resolveAdaptiveTimeoutMs` (R2: derived budget = max(3×mean, 1.5×p95) with a 30s floor, YAML `timeoutMs` is the hard cap — never grown, healthy budgets never shrunk; no history → static behavior), `ladderScore` (R3: latency ÷ clamped success rate, lower wins), `readExecutorLatency`/`loadExecutorLatency` (reads `history_board_model_stats`; read failure → empty, never throws).
- `packages/app/src/services/agent-run-executor.ts` — R1: run-scoped breaker (keyed by the flags' `run-id`, the id the action correlates retries with; bounded, no cross-run persistence); completed-dispatch unavailability (exit 2 / unavailable signal) trips it via `executorUnavailabilityEvidence`, a retry-bound node's next dispatch re-resolves through the stage funnel with the breaker set excluded (breaker-skip), breaker-dead run fails honestly with exitCode 2. R2: per-attempt `resolveAdaptiveTimeoutMs` → `timeoutBudget` on the traced invocation; measured latency beyond the cap fails over pre-dispatch (timeout-exhausted-skip) instead of burning the timeout. AC3: decisions (`breaker-trip`/`breaker-skip`/`timeout-exhausted-skip`/escalation/chain-exhausted) recorded on the result + `agent.invoke.ladder` events.
- `packages/app/src/services/agent-resolver.ts` — R3: `orderEligibleByMeasuredLatency` orders escalation-ladder candidates measured-first by latency × success (unmeasured keep declaration order); result carries `ordering` for the trace; empty history → static order unchanged.
- `packages/app/src/services/agent-service.ts` — types: `AgentLadderDecision`, `LadderOrderingEntry`, `AgentRunTracedResult.ladder`, `AgentRunInvocation.timeoutBudget`, `historyLatency` context seam; `runTraced` threads `ladder`.
- `packages/app/src/services/failure-classification.ts` — `executorUnavailabilityEvidence` (exit 2 / unavailable-signal evidence string).
- `packages/app/src/workflow/actions/agent-run.ts` — persists `traced.ladder` onto the action result row.
- Tests: `tests/services/adaptive-timeout.test.ts`, `tests/services/agent-run-executor-d3.test.ts` (AC1/AC2), `tests/services/agent-resolver-d3.test.ts` (R3).

### Solution

Change map (commit 6953e495c):
- `packages/app/src/services/adaptive-timeout.ts:7` (new) — R2/R3 core: `resolveAdaptiveTimeoutMs` (3×mean / 1.5×p95, 30s floor, YAML cap; no history → static), `ladderScore` (latency ÷ success, clamp ≥0.1), `readExecutorLatency`/`loadExecutorLatency` (history_board_model_stats; failure → empty, never throws).
- `packages/app/src/services/agent-run-executor.ts:174` — R1 run-scoped breaker keyed by flags run-id; unavailability evidence (exit 2 / unavailable) trips it; retry-bound re-resolution excludes tripped set (zero dead dispatches); breaker-exhausted → exitCode 2; per-attempt derived budget + pre-dispatch timeout-exhausted failover; ladder decisions + `agent.invoke.ladder` events.
- `packages/app/src/services/agent-resolver.ts:442` — measured-latency escalation ordering (`orderEligibleByMeasuredLatency`), `ordering` rows on resolve result; empty history → declaration order.
- `packages/app/src/services/agent-service.ts` — `AgentLadderDecision`, `LadderOrderingEntry`, traced `ladder`, `timeoutBudget`, `historyLatency` seam.
- `packages/app/src/services/failure-classification.ts` — `executorUnavailabilityEvidence`.
- `packages/app/src/workflow/actions/agent-run.ts` — persists `traced.ladder` on the action result row (AC3 trace evidence).
- 2026-11-10T20:21:39.670Z todo → wip (system)

### Testing

- `(cd packages/app && bunx tsc --noEmit -p tsconfig.json)` — clean.
- `bun test tests/services/adaptive-timeout.test.ts tests/services/agent-run-executor-d3.test.ts tests/services/agent-resolver-d3.test.ts` — 17 pass / 0 fail (AC1 zero repeat dispatches + breaker-exhausted exit 2; AC2 pre-dispatch failover + derived budget visible; R3 measured ordering + empty-history degradation).
- Regression: `bun test tests/services/agent-run-executor.test.ts tests/services/agent-resolver.test.ts tests/services/agent-service.test.ts tests/services/agent-routing-attribution.test.ts tests/services/failure-classification.test.ts` — 277 pass; `bun test tests/workflow/actions/agent-run*.test.ts tests/workflow/agent-run-fleet.test.ts tests/workflow/session-pinned-dispatch.test.ts tests/workflow/fleet-work-item.test.ts` — 270 pass.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-10T16:31:02.654Z backlog → todo (system)


