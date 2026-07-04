---
template: feature-impl
schema_version: 1
name: "Scheduler entries, job events, stats API, Jobs tab (0190 wave B)"
description: ""
status: todo
type: task
profile: standard
feature_id: A2
parent_wbs: "0190"
priority: P1
tags: ["approach-c", "server", "web", "subtask"]
dependencies: []
created_at: "2026-07-04T04:13:23.850Z"
updated_at: "2026-07-04T07:14:37.970Z"
---

## 0201. Scheduler entries, job events, stats API, Jobs tab (0190 wave B)

### Background

Wave B of parent 0190 (job queue enablement) — read the parent's Background and Design first. Depends on wave A (worker + registry running). Delivers the periphery: scheduler start/stop in the serve lifecycle with the first real entries (`system-events-prune` via enqueue — replacing/backstopping 0189's insert-time cap — plus a `smoke` kind), job lifecycle events on the bus added to the shared event-name list (tap + SSE inherit), `GET /api/jobs/stats`, and the Jobs tab appended to the observability module's tabs contract (needs 0189 wave B shipped).

### Requirements
- [ ] R1. Scheduler start/stop in serve lifecycle; `system-events-prune` (enqueue path) + `smoke` entries registered; firing tested via injected clock. (Parent R4)
- [ ] R2. `job.enqueued|started|completed|failed` events (metadata only) on the bus; names added to the shared event-name list. (Parent R5)
- [ ] R3. `jobs` server module: `GET /api/jobs/stats` riding `JobQueue.stats()`; endpoint test. (Parent R6)
- [ ] R4. Jobs tab appended to observability `tabs.ts`: stats + recent `job.*` events from the history API. (Parent R6)
- [ ] R5. Full gate green incl. `test-cf`; manual: prune/smoke activity visible in Events + Jobs tabs under `spur serve`. (Parent R8)
### Acceptance Criteria
```gherkin
Feature: Embedded job queue and scheduler

  Scenario: Scheduler fires a registered cron entry
    Given spur serve is running with the scheduler enabled
    When a registered cron entry elapses
    Then the scheduled action runs and a corresponding job event is observable on the EventBus

  Scenario: Job stats are readable over the API
    Given jobs exist in multiple statuses
    When GET /api/jobs/stats is requested
    Then counts per status are returned

  Scenario: Jobs tab shows queue activity on the board
    Given the board Observability module is open
    When the operator opens the Jobs tab
    Then job counts and recent job events render
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Parent 0190's Design owns the full approach — this slice implements the scheduler half of **Serve wiring** plus **Events + surfaces**: `scheduler().start()`/`stop()` in the serve lifecycle (`scheduler.enabled: true`, Bun only); first entries `system-events-prune` (enqueue path — exercises the queue, replaces/backstops 0198's insert-time cap) and `smoke`; `job.enqueued|started|completed|failed` events (metadata only) added to the shared event-name list from 0198 so tap + SSE inherit; `jobs` server module with `GET /api/jobs/stats` over `JobQueue.stats()`; Jobs tab appended to the observability `tabs.ts` (0199's contract) with stats + recent `job.*` history rows. Shutdown order: scheduler → worker → server. Depends on: 0200 (worker), 0198 (name list + prune target), 0199 (tabs contract). Completes parent 0190.
### Plan
- [ ] Scheduler start/stop in serve lifecycle; `system-events-prune` + `smoke` entries; injected-clock firing test (R1).
- [ ] Job lifecycle events on the bus + shared name list extension (R2).
- [ ] `jobs` module: `GET /api/jobs/stats` + endpoint test (R3).
- [ ] Jobs tab via `tabs.ts` append: stats + recent job events (R4).
- [ ] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check`; manual serve check of Events + Jobs tabs (R5).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

A2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
