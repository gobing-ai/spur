---
template: feature-impl
schema_version: 1
name: "Add server-side filtering and cursor pagination to the event history query surface"
description: ""
status: todo
type: task
profile: standard
feature_id: J3
parent_wbs: null
priority: P1
tags: ["observability", "api", "data-plane"]
dependencies: ["0369"]
created_at: "2026-07-29T00:14:03.033Z"
updated_at: "2026-07-29T00:25:28.810Z"
---

## 0372. Add server-side filtering and cursor pagination to the event history query surface

### Background

GET /api/events/history accepts only `name`, `since`, and `limit` (apps/server/src/modules/events/index.ts:163-190), and `SystemEventDao.query` mirrors that. Consequently every Board filter — prefix pills, tier, time window, search scope in SystemEventsTab, and the queue/scheduler predicate in JobsTab — runs in the browser over whatever the newest 100 (or 50) rows happen to be. With the ledger dominated by heartbeat noise, that window rarely contains what the operator filtered for, and there is no way to page back to it. Once the correlation columns exist, these filters become cheap indexed queries; this task exposes them.

### Requirements
- [ ] R1. Add `prefix`, `names` (multi-value), `runId`, and `actor` filters to `SystemEventDao.query` and to GET /api/events/history, backed by the correlation-column indexes.
- [ ] R2. Add cursor-based pagination that is stable under concurrent writes — paging must not repeat an already-returned event nor skip one older than the cursor.
- [ ] R3. Reject an uncataloged prefix or a malformed cursor with a client error and a reason; never silently fall back to an unfiltered result set.
- [ ] R4. Preserve the existing response envelope (`events`, `count`, `catalog`) and the current `name`/`since`/`limit` behaviour for existing consumers.
- [ ] R5. Keep the endpoint's `limit` ceiling and default, and apply filters in SQL rather than post-filtering a fetched page.
- [ ] R6. Return the correlation fields on each row so clients can group without re-parsing payloads.
### Acceptance Criteria
```gherkin
Scenario: R18 — History can be filtered by prefix server-side
Scenario: R19 — History can be filtered by run and by actor
Scenario: R20 — History pagination is stable under concurrent writes
Scenario: R21 — An unknown prefix or malformed cursor is rejected cleanly
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

J3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
