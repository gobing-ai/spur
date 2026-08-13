---
template: feature-impl
schema_version: 1
name: "Snapshot-then-follow wait on the existing event ledger"
description: ""
status: todo
type: task
profile: standard
feature_id: G4
parent_wbs: null
priority: P2
tags: []
dependencies: ["0530"]
ac_numbering: task-local
created_at: "2026-08-13T04:48:31.804Z"
updated_at: "2026-08-13T05:47:51.912Z"
---

## 0531. Snapshot-then-follow wait on the existing event ledger

### Background
Implements G4 R8 (ADR-057 wave 3). Depends on 0530 wait. Wave 2 may poll. This task extracts a shared snapshot-then-follow helper over `system_events` (and in-process EventBus when the server is the caller) so wait/reconnect does not grow a second event ring. Optional `agent report-state` only if `blocked` still cannot be derived after Wave 2.

Does not implement G3 Board un-merge, Board SSE (S6/W6), live handoff, or protocol ping unless CLI/`serve` skew is demonstrated in this task’s evidence.
### Requirements
- [ ] R8. Extract `followSystemEventsAfter` (signature in Design) and switch 0530 wait onto it (no 100ms poll, no 512-event ring). Tests: gap/reconnect, pin break, empty follow-set. Update design satellite §8 to landed. Do **not** add `spur agent report-state` (deferred unless 0530 Testing contains `BLOCKED_UNREACHABLE`).
### Acceptance Criteria
```gherkin
Feature: Inter-agent control plane

  Scenario: R8 — Coordination wait snapshots then follows the existing event ledger
    Given a wait is in flight
    When it resumes after a gap
    Then it re-snapshots occupant + `system_events` sequence and follows `sequence > snapshot`
    And it does not allocate a separate in-memory event ring
```
### Q&A
- **Q: Block on Board SSE?** A: No. Closed 2026-08-12.
- **Q: Copy Herdr EventHub?** A: No. Closed 2026-08-12.
- **Q: Absorb G3?** A: No. Closed 2026-08-12.
- **Q: Land `report-state` in this task?** A: No. Only a future task if 0530 records `BLOCKED_UNREACHABLE`. Closed 2026-08-12.
### Design
WHAT: Shared ledger follow helper; switch 0530 wait onto it. No report-state verb.

WHY: Wave-2 poll is correct but not reconnect-safe. Herdr EventHub is the wrong model (`system_events.sequence` already exists — `0008` correlation columns).

WHERE:
- New `packages/app/src/services/system-event-follow.ts` + `packages/app/tests/services/system-event-follow.test.ts`.
- Change `occupant-wait.ts` follow hook only.
- `SystemEventDao` already persists `sequence` (`packages/domain` / `system_events`).

Frozen:
```
followSystemEventsAfter(getDb, { afterSequence: number, match: (row) => boolean, signal?: AbortSignal }): AsyncIterable<SystemEventRow>
```
Row fields used: `sequence`, `event_name`, `entity_id`, `run_id`, `payload_json`.

Anti-patterns: 512-event ring; Board SSE as prerequisite; `report-state` verb; G3 un-merge; new socket protocol; protocol ping.

Handoff from 0530: `waitForOccupant` already accepts a `follow` callback — replace the poll implementation.

Premise check (2026-08-12): `system_events.sequence` is in `SYSTEM_EVENTS_SCHEMA_SQL`. R8b frozen to skip.
### Plan
1. R8 — Implement `followSystemEventsAfter` + DAO tests (gap, replay after snapshot, pin break).
2. R8 — Wire 0530 `waitForOccupant` to the helper; delete ad-hoc poll.
3. R8b — Confirm 0530 Testing lacks `BLOCKED_UNREACHABLE`; do not add `report-state`.
4. R8c — Mark design satellite §8 landed.
5. Regression: 0530 wait tests still pass.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Depends on 0530 (and transitively 0529). Feature G4 R8; ADR-057.
- `packages/domain/src/migrations.ts` `SYSTEM_EVENTS_SCHEMA_SQL`; `packages/app/src/services/system-event-emitter.ts`
- Not this task: G3/0197; S6/W6 SSE; `report-state`
### History
