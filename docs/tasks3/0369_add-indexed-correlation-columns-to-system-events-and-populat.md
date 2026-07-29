---
template: feature-impl
schema_version: 1
name: "Add indexed correlation columns to system_events and populate them from the event envelope"
description: ""
status: todo
type: task
profile: standard
feature_id: J3
parent_wbs: null
priority: P1
tags: ["observability", "schema", "migration", "data-plane"]
dependencies: ["0367"]
created_at: "2026-07-29T00:14:03.009Z"
updated_at: "2026-07-29T00:25:21.508Z"
---

## 0369. Add indexed correlation columns to system_events and populate them from the event envelope

### Background

`system_events` is `(id, event_name, occurred_at, actor, payload_json)` with indexes only on `occurred_at` and `event_name` (packages/domain/src/migrations.ts:78-87). There is no run, entity, or sequence column, so `SystemEventDao.query` can only filter on exact `event_name` plus `since` plus `limit` (system-event-dao.ts). Every richer filter the Board wants — this run, this task, this member — must therefore be done client-side over a fixed newest-N window, which is exactly why JobsTab slices the newest 50 in the browser (JobsTab.tsx:114). The 0365 envelopes now carry runId, actionId, and sequence, and planning events carry entity identity; making those queryable columns is what turns every J4 tabview into one indexed round trip.

### Requirements
- [ ] R1. Add `run_id`, `entity_kind`, `entity_id`, and `sequence` columns to `system_events` through a new top-level `drizzle/*.sql` migration carrying the `_spur_cli_` marker, wired into `CLI_SCHEMA_SQL`.
- [ ] R2. Add indexes supporting the query patterns J3's read API needs (at minimum `run_id` and the `entity_kind`/`entity_id` pair).
- [ ] R3. Populate the columns in both write paths — the server `SystemEventTap` and the CLI `SystemEventEmitter` — deriving them from the 0365 envelope and from planning event payloads.
- [ ] R4. Keep the columns nullable: pre-migration rows and events with no correlation must persist and read back cleanly with nulls.
- [ ] R5. The migration must be idempotent and must not rewrite or backfill existing payloads.
- [ ] R6. Surface the new fields on the history endpoint's row projection without breaking the current response shape for existing consumers.
### Acceptance Criteria
```gherkin
Scenario: R5 — Correlated events persist their identity in queryable columns
Scenario: R6 — Planning events persist their entity identity
Scenario: R7 — Pre-migration rows remain readable
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
