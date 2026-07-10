---
template: feature-impl
schema_version: 1
name: "Fix scheduler.job.executed emit to match SchedulerJobExecutedDetail contract"
description: ""
status: done
type: task
profile: standard
feature_id: L
parent_wbs: null
priority: P2
tags: ["observability", "bug", "scheduler"]
dependencies: []
created_at: "2026-07-09T23:04:54.453Z"
updated_at: "2026-07-10T01:04:46.176Z"
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
`bun test apps/server/tests/serve.test.ts` — 16 pass, 0 fail, 50 expect() calls.
Verifies: R1 (name key present), R2 (cron absent), R3/R4 (error captured on throw + re-propagated), R5/R6 (success + failure payload shapes).
### Review
No P1–P3 findings. R7 (no ServerEventMap type change) honored — kept `as unknown as never` cast pattern unchanged per ADR scope. The conditional spread `...(error !== undefined && { error: String(error) })` correctly omits `error` on success and includes it on failure.
### References

L

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-10T01:04:45.604Z todo → wip (system)
- 2026-07-10T01:04:45.833Z wip → testing (system)
- 2026-07-10T01:04:46.176Z testing → done (system)
