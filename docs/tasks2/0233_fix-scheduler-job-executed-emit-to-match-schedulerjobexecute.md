---
template: feature-impl
schema_version: 1
name: "Fix scheduler.job.executed emit to match SchedulerJobExecutedDetail contract"
description: ""
status: done
type: task
profile: standard
feature_id: J2
parent_wbs: null
priority: P2
tags: ["observability", "bug", "scheduler"]
dependencies: []
created_at: "2026-07-09T23:04:54.453Z"
updated_at: "2026-07-28T00:32:04.291Z"
---

## 0233. Fix scheduler.job.executed emit to match SchedulerJobExecutedDetail contract

### Background

Feature L (System Events Payload and Wiring Enrichment). The scheduler emit in apps/server/src/serve.ts registerSchedulerEntries emits { kind, cron, durationMs } for 'scheduler.job.executed', but the contract type SchedulerJobExecutedDetail (ts-infra events.ts) expects { name, durationMs, error? }. The mismatch is invisible at compile time because ServerEventMap is typed Record<string, (detail: unknown) => void> and every bus handoff uses 'as unknown as never' casts. The undeclared 'cron' field is not in the contract; the contract's optional 'error' field is never populated because the current try/finally has no catch. Design: docs/plans/2026-07-09-observability-system-events-enrichment-design.md section 3. This task lands FIRST so the tooltip task can render the corrected payload.

### Requirements
R1. In registerSchedulerEntries (apps/server/src/serve.ts), change the 'scheduler.job.executed' emit payload to use key 'name' (value = the job kind), not 'kind'.
R2. Remove the 'cron' key from the emit payload entirely — it is not in the SchedulerJobExecutedDetail contract and is static per job name.
R3. Add a catch block around the awaited job() that captures the thrown value into a local 'error' variable, then re-throws to preserve current propagation (the scheduler adapter owns retry/logging).
R4. In the finally emit, include error: String(error) only when error was captured (conditional spread), matching the contract's optional error?: string field.
R5. Extend apps/server/tests/upstream-system-events-wiring.test.ts (or the co-located wiring test) with a case that drives a scheduler entry to fire successfully and asserts the emitted payload has 'name' (not 'kind'), has 'durationMs' as a number, and does NOT have 'cron'.
R6. Add a second test case where the scheduled job throws, asserting the emitted payload includes 'error' containing the thrown message AND the error still propagates to the scheduler adapter.
R7. No change to ServerEventMap type definition or the 'as unknown as never' cast pattern (ADR-scoped, out of scope).
### Acceptance Criteria
```gherkin
Feature: Fix scheduler.job.executed emit to match SchedulerJobExecutedDetail contract

  Scenario: Scheduler job executed event populates the contract name field
    Given a scheduler entry registered with kind "system-events-prune"
    When the scheduled job executes successfully
    Then the "scheduler.job.executed" event payload contains key "name" with value "system-events-prune"
    And the payload does NOT contain key "kind"
    And the payload contains key "durationMs" as a number

  Scenario: Scheduler job executed event captures error on failure
    Given a scheduler entry whose job throws an Error "timeout"
    When the scheduled job executes
    Then the "scheduler.job.executed" event payload contains key "error" with value containing "timeout"
    And the original error continues to propagate after the event is emitted

  Scenario: Scheduler job executed event no longer carries undeclared cron field
    Given a scheduler entry registered with a cron schedule
    When the scheduled job executes
    Then the "scheduler.job.executed" event payload does NOT contain key "cron"
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
- `apps/server/src/serve.ts:78-95` — `registerSchedulerEntries`: renamed param `kind`→`name`; removed `cron` from emit payload; added `catch (err)` capturing into `error` var with re-throw; `finally` emit now sends `{ name, durationMs, ...(error !== undefined && { error: String(error) }) }` matching `SchedulerJobExecutedDetail` contract.
- `apps/server/tests/serve.test.ts` — updated scheduler wiring tests to assert `name` (not `kind`), absence of `cron`, numeric `durationMs`, and `error` propagation on thrown jobs.
### Testing
**Verify run:** 2026-07-11 — `/sp:dev-verify 0233 --auto --focus all --fix all --force` (standalone re-audit of `done` task).

**Command evidence (this run):**
```
bun test apps/server/tests/serve.test.ts
16 pass, 0 fail, 50 expect() calls
```
Focused cases:
- `registerSchedulerEntries enqueues built-in prune and smoke jobs and emits scheduler events` — pass
- `registerSchedulerEntries captures error on failure and re-throws after emitting` — pass

**Coverage:** `apps/server/src/serve.ts` under the suite above: **96.88% functions / 94.06% lines** (unrelated uncovered lines 253–264 outside `registerSchedulerEntries`). Changed path fully exercised by the two scheduler tests.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/server/src/serve.ts:90` emit uses `name`; test asserts `name: 'system-events-prune'` / `name: 'smoke'` (`serve.test.ts:435-441`) |
| R2 | MET | Emit payload has no `cron` (`serve.ts:89-93`); `expect(...).not.toHaveProperty('cron')` (`serve.test.ts:437`) |
| R3 | MET | `catch (err) { error = err; throw err; }` (`serve.ts:85-88`); re-throw proven by `rejects.toThrow('timeout')` (`serve.test.ts:469`) |
| R4 | MET | Conditional spread `...(error !== undefined && { error: String(error) })` (`serve.ts:92`); success omits `error` (`serve.test.ts:438`); failure includes it (`serve.test.ts:473`) |
| R5 | MET | Success path in co-located `apps/server/tests/serve.test.ts:400-442` (R5 allows co-located wiring test) |
| R6 | MET | Failure path `serve.test.ts:444-475` — `error` contains `timeout` and original error still propagates |
| R7 | MET | No `ServerEventMap` definition change; emit still uses untyped bus handoff; scope limited to `registerSchedulerEntries` + tests |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Scheduler job executed event populates the contract name field | MET | test | `serve.test.ts:435-439` — `name: 'system-events-prune'`, no `kind`, numeric `durationMs` |
| Scenario: Scheduler job executed event captures error on failure | MET | test | `serve.test.ts:469-474` — emit has `error` containing `timeout`; `rejects.toThrow('timeout')` |
| Scenario: Scheduler job executed event no longer carries undeclared cron field | MET | test | `serve.test.ts:437` — `not.toHaveProperty('cron')` |

**Design conformance** (from design plan §3 / Solution; task `### Design` left empty):

| Claim | Status | Evidence |
|-------|--------|----------|
| Payload key `name` (not `kind`) | DONE | `serve.ts:79,90` param renamed `name`; emit uses `name` |
| Drop undeclared `cron` from emit | DONE | `serve.ts:89-93` |
| `catch` + re-throw for error capture | DONE | `serve.ts:85-88` |
| Conditional `error?: string` in finally emit | DONE | `serve.ts:92` |
| Contract shape `{ name, durationMs, error? }` | DONE | matches `SchedulerJobExecutedDetail` in ts-infra `events.ts` |

**SECUA Review (answer-file; Review section owned by `/sp:dev-review`)**

| Sev | Dim | Finding |
|-----|-----|---------|
| — | S | No secrets/injection surface; payload is job name + duration + optional stringified error. |
| — | E | Negligible: single Date.now delta + one bus emit per tick. |
| — | C | try/catch/finally + re-throw preserves adapter ownership of retry/logging; success path omits `error`. |
| — | U | Event name + contract keys align with System Events tooltip consumers. |
| — | A | Fix stays local to `registerSchedulerEntries`; R7 honored (no `ServerEventMap` ADR churn). |

No blocker/major findings. Minor residual (corpus, not code): `spur task check --strict-core` still wants a P1–P4 table in `## Review` — owned by review/record path, not rewritten by verify mode.

**Verdict:** PASS — all core requirements and AC MET with executable test evidence; no blockers.
### Review
No P1–P3 findings. R7 (no ServerEventMap type change) honored — kept `as unknown as never` cast pattern unchanged per ADR scope. The conditional spread `...(error !== undefined && { error: String(error) })` correctly omits `error` on success and includes it on failure.
### References

L

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-10T01:04:45.604Z todo → wip (system)
- 2026-07-10T01:04:45.833Z wip → testing (system)
- 2026-07-10T01:04:46.176Z testing → done (system)
