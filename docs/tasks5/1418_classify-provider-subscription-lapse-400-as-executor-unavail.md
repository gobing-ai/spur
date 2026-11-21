---
schema_version: 1
name: Classify provider subscription-lapse 400 as executor unavailability so the ladder advances
status: done
template: issue
created_at: 2026-11-21T04:33:04.639Z
updated_at: "2026-11-21T06:22:47.239Z"
feature_id: B6

priority: P1
ac_altitude: task-local
estimate_hours: 3
done_forced: "false"
done_reason: unforced close
---

## 1418. Classify provider subscription-lapse 400 as executor unavailability so the ladder advances

### Background

The 2026-11-20 05:00 `history-daily-report` job failed `exited with code 3` because the elected standard-tier
executor `pi-dsv4.1-flash-volc` answered every call with a provider entitlement refusal, and nothing in the
escalation path recognised it, so the ladder never walked to the next funded rung.

**Evidence (observed 2026-11-20, re-verified 2026-11-20 refine).**

- Job `history-daily-report` (`.spur/spur.db` `queue_jobs`, 05:00) failed after 111 s; workflow `history-anatomy`
  died at state `enrich`.
- `.spur/run/db733c3c-a42c-4a6c-9c07-51be70377b10-enrich-partial.md` records `pi … --model
  volc/deepseek-v4-1-flash-261017`, `exit reason: exited with code 3`, `elapsed: 11568ms`, and the stderr body
  `400 {"error":{"code":"InvalidSubscription","message":"Your account (…) does not have a valid CodingPlan
  subscription, or your subscription has expired. …","type":"Bad Request"}}`. Reproduced live 2026-11-20 17:58 PT.
- Contrast: on 11-12 / 11-15 / 11-16 the same executor DID fail over because those responses carried 402/429-class
  evidence. The 400 subscription class is the inconsistency.
- Operator mitigation already applied: `~/.config/spur/config.yaml:110-115` marks `pi-dsv4.1-flash-volc`
  disabled (operator-owned). This task removes the need for that manual step next time; it does not re-enable it.

**Refine corrections (2026-11-20)**

- R2 claim "a fast (elapsed < 30 s) non-zero dispatch … trips the breaker" → an elapsed threshold is noise (the
  failing dispatch took 11.6 s but the job 111 s; a slow provider can return the same body after 30 s) and
  `AgentRunResult` timing is not part of the 1323 breaker contract → R2 now keys the breaker on the same narrow
  entitlement evidence as R1, independent of elapsed time.
- AC1 "returns `resource-exhaustion` for provider volc" → `FailureRule.provider` is registry metadata, not a filter
  (`failure-classification.ts:9-13`, 0687) → AC1 asserts the classification of the body, whichever provider emitted it.
- Seam premise confirmed: workflow `agent.run` dispatches through `AgentService.runTraced` → `AgentRunExecutor`
  (`packages/app/src/workflow/actions/agent-run.ts:203-211`), so the executor's escalation block
  (`agent-run-executor.ts:945-1040`) is the one place to fix; `agent-run.ts:698` reuses `classifyDispatch` for the
  receipt `failureSignal` and inherits the new rule with no edit.
- The opt-in catalog rescue (`classifyUnmatchedFailure`, 1264; `apps/cli/src/context.ts:230`) is gated on
  `workflows.executorFailureDecisionMaker` and did not run; the deterministic rule is the fix, the rescue stays
  residue-only.

### Requirements

- [x] R1. `FAILURE_RULES` (`packages/app/src/services/failure-classification.ts:26`) gains one entitlement-lapse rule
  with `signal: 'resource-exhaustion'`, NO `statusCodes`, and a two-pattern conjunction (both must match): the code
  `InvalidSubscription` AND the phrase `does not have a valid … subscription` / `subscription has expired`. A bare
  HTTP 400 never matches.
- [x] R2. `executorUnavailabilityEvidence` (`failure-classification.ts:184-190`) additionally returns evidence when
  the dispatch's stderr/stdout carries that same entitlement-lapse conjunction (non-zero exit, any elapsed time),
  so the 1323 run-scoped breaker excludes the executor for the rest of the run.
- [x] R3. The 0407 / 1260 precision bias survives: a status-only 400, or a body that mentions "subscription"
  without the code+phrase pair, stays unmatched (`classifyDispatch` → `undefined`, no breaker trip) and keeps
  today's fail-the-run behaviour.
- [x] R4. Regression tests use the verbatim 2026-11-20 `InvalidSubscription` body and prove (a) classification,
  (b) breaker trip + failover to the next eligible rung in the executor loop, (c) the negative cases.

Out of scope: re-enabling or auto-disabling `pi-dsv4.1-flash-volc` in config (operator-owned, B6 lifecycle);
the usage-source blind spot (task 1419); the catalog rescue (1264); any new public CLI surface.

### Acceptance Criteria

- [x] AC1 — Entitlement-lapse body classifies as resource exhaustion (req: R1): Given the verbatim 2026-11-20
  `InvalidSubscription` stderr with exitCode 3, `classifyDispatch` returns `resource-exhaustion`. Layer:
  `packages/app/tests/services/failure-classification.test.ts`.
- [x] AC2 — Entitlement lapse trips the run breaker and the ladder walks (req: R2; R4): Given a stage whose first
  executor returns exit 3 with that body, `AgentRunExecutor` records a `breaker-trip` ladder decision for it,
  dispatches the next eligible executor exactly once, and spends exactly one dispatch on the dead executor; a later
  dispatch in the same run id excludes it. Layer: `packages/app/tests/services/agent-run-executor-d3.test.ts`
  (fake runner — the classifier and breaker run real, only the subprocess is faked).
- [x] AC3 — Precision bias holds (req: R3): Given `status 400` alone, and given `Your subscription renews on 1 Dec`
  without the `InvalidSubscription` code, `classifyDispatch` returns `undefined` and
  `executorUnavailabilityEvidence` returns `undefined`. Layer: `failure-classification.test.ts`.
- [x] AC4 — No weakened expectations (req: R4): The new tests fail on the pre-change tree and pass after; no
  existing `failure-classification` / `agent-run-executor-d3` expectation is edited or deleted.

### Q&A

- **Closed (refine 2026-11-20):** breaker trigger is the entitlement-evidence conjunction, not an elapsed-time
  threshold — timing is not part of the 1323 contract and would misfire on slow providers.
- **Closed:** signal is `resource-exhaustion` (availability routing), not `auth`.
- **Deferred → 1419:** making the dead credential visible before any run (usage-source blind spot).

### Design

**WHAT.** One shared entitlement-lapse vocabulary consumed by both the classifier and the breaker.

**WHERE.** `packages/app/src/services/failure-classification.ts` only (plus tests). No change to
`agent-run-executor.ts`: it already calls `executorUnavailabilityEvidence(result)` with the full `AgentRunResult`
(`:953`), and a breaker trip already forces `resource-exhaustion` + the ladder walk even without a matching policy
fallback (`:966-998`).

**Frozen names.**

- `const ENTITLEMENT_LAPSE_PATTERNS: readonly RegExp[]` (module-private) =
  `[/\bInvalidSubscription\b/, /(?:does not have a valid [^.\n]{0,40}subscription|subscription has expired)/i]`.
- New `FAILURE_RULES` entry: `{ provider: 'volc', signal: 'resource-exhaustion', patterns: [...ENTITLEMENT_LAPSE_PATTERNS] }`
  with a 1418 comment; placed after the existing volc auth rule. No `statusCodes` (R3).
- `executorUnavailabilityEvidence` signature widens to
  `Pick<AgentRunResult, 'exitCode' | 'signal' | 'stdout' | 'stderr'>`; new branch, after the two existing ones:
  non-zero exit AND every `ENTITLEMENT_LAPSE_PATTERNS` matches `${stderr} ${stdout}` → return
  `'provider entitlement lapsed (InvalidSubscription)'`. Existing exit-2 / `unavailable` branches unchanged and first.

**Why `resource-exhaustion`, not `auth`.** It is the only availability signal in the objective vocabulary
(`agent-run-executor.ts:965-967`); `resource-exhaustion` walks the ladder without the per-policy fallback-count bound
(`:993-995`). `auth` would stop at stages declaring no `auth` fallback.

**Anti-patterns.** Do not add `400` to any `statusCodes`; do not key on elapsed time; do not filter rules by the
dispatch's provider; do not write config / disable the executor from the run path (B6 owns persistence); do not
touch the 1264 rescue.

**Decisions.** Closed: breaker evidence is content-based, not timing-based (see correction). Closed: a single
shared constant, not a second rule list.

### Plan

1. Add failing tests first (AC1, AC3) in `packages/app/tests/services/failure-classification.test.ts` using the
   verbatim body from the Background; add the AC2 scenario to `agent-run-executor-d3.test.ts` beside the 1323 AC1
   breaker tests. Confirm they fail: `(cd packages/app && bun test tests/services/failure-classification.test.ts tests/services/agent-run-executor-d3.test.ts)`.
2. Add `ENTITLEMENT_LAPSE_PATTERNS` and the `FAILURE_RULES` entry (R1).
3. Widen `executorUnavailabilityEvidence` and add the entitlement branch (R2); typecheck callers.
4. Re-run the focused tests (R3/R4 green, no expectation edits), then `bun run spur-check`.

### Root Cause

Two independent misses, both verified in the current tree:

1. **Classifier.** `classifyDispatch` (`packages/app/src/services/failure-classification.ts:154-174`) matches a rule
   by `statusMatch || patternMatch`. The status extractor `HTTP_STATUS_PATTERN` (`:116`) only reads a code after
   `status` / `http` / `api error`, so the bare `400 {"error":…` prefix yields no status; and no rule's patterns
   match the body — the only volc rule (`:67-74`) needs 401 or api-key/authentication wording. Result: `undefined`,
   so `escalationSignal` stays `undefined` (`agent-run-executor.ts:968-970`) and the loop `break`s (`:986-988`) —
   the run ends with the exit-3 result.
2. **Breaker.** `executorUnavailabilityEvidence` (`failure-classification.ts:184-190`) only recognises exit 2 or a
   terminal `unavailable` signal. The pi shim exits 3 for this refusal, so the run-scoped breaker
   (`agent-run-executor.ts:953-962`, keyed by workflow run id `:416`) never trips, and a later node of the same run
   could re-elect the dead executor.

### Solution

| File:lines | Change |
| --- | --- |
| `packages/app/src/services/failure-classification.ts:21-31` | `ENTITLEMENT_LAPSE_PATTERNS` — one shared conjunction (`InvalidSubscription` AND the lapse prose) so the classifier and the breaker cannot drift apart. |
| `packages/app/src/services/failure-classification.ts:88-97` | `FAILURE_RULES` entry mapping that body to `resource-exhaustion`, with no `statusCodes` (the body's `400` prefix never reaches the status extractor, so a code list would be dead weight that could match an unrelated 400). |
| `packages/app/src/services/failure-classification.ts:207-222` | `executorUnavailabilityEvidence` widens to `stdout`/`stderr` and returns `provider entitlement lapsed (InvalidSubscription)` on the same conjunction, so the 1323 run-scoped breaker excludes the executor. Existing exit-2 / `unavailable` branches unchanged and still first. |
| `packages/app/tests/services/failure-classification.test.ts:55-86` | AC1/AC2/AC3: the 2026-11-20 body classifies and is breaker evidence; status-only 400 and a bare "subscription renews" mention stay unmatched; exit 0 never classifies. The fixture masks the account number and request id — they identify the operator, not the failure shape. |
| `packages/app/tests/services/agent-run-executor-d3.test.ts:341-372` | AC2 through the real dispatch core: one dispatch on the lapsed executor, `breaker-trip` recorded, failover to `codex-main`, and a later node in the same run id gets `breaker-skip`. |

`agent-run-executor.ts` is untouched by design: it already calls `executorUnavailabilityEvidence(result)` with the full result and already forces the ladder walk on a breaker trip.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/failure-classification.ts:28-31` shared conjunction; `packages/app/src/services/failure-classification.ts:88-97` rule (`resource-exhaustion`, no `statusCodes`); test `packages/app/tests/services/failure-classification.test.ts:64` |
| R2 | MET | `packages/app/src/services/failure-classification.ts:207-222` entitlement branch after exit-2/unavailable; test `packages/app/tests/services/failure-classification.test.ts:68` |
| R3 | MET | no `statusCodes` on the rule; `packages/app/tests/services/failure-classification.test.ts:74` and `:82` negative cases |
| R4 | MET | `packages/app/tests/services/agent-run-executor-d3.test.ts:347` and `:363`; focused run 112 pass / 0 fail (this verify) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/failure-classification.test.ts:64` |
| AC2 | MET | test | `packages/app/tests/services/agent-run-executor-d3.test.ts:347` (breaker-trip + one dispatch + failover), `:363` (breaker-skip same run id) |
| AC3 | MET | test | `packages/app/tests/services/failure-classification.test.ts:74` |
| AC4 | MET | command | `git show bd570c8b1 -- packages/app/tests/services/failure-classification.test.ts packages/app/tests/services/agent-run-executor-d3.test.ts` insertion-only; focused tests 112 pass / 0 fail |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- `packages/app/src/services/failure-classification.ts:26-104`, `:154-190`
- `packages/app/src/services/agent-run-executor.ts:416`, `:945-1040`
- `packages/app/src/workflow/actions/agent-run.ts:203-211`, `:698`
- Related: 1323 (run breaker), 1260 (precision bias), 0687 (provider is metadata), 1264 (rescue), 1419 (usage blind spot)
- Evidence: `.spur/run/db733c3c-a42c-4a6c-9c07-51be70377b10-enrich-partial.md`
- Concurrency: no other worktree, no `wip` task (checked 2026-11-20).

### History

- 2026-11-21T04:50:13.145Z todo → wip (system)
- 2026-11-21T04:51:28.264Z wip → testing (system)
- 2026-11-21T04:51:29.837Z testing → done (system)

