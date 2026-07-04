---
template: feature-impl
schema_version: 1
name: "system_events domain, server tap, history + inbox read APIs (0189 wave A)"
description: ""
status: todo
type: task
profile: standard
feature_id: J
parent_wbs: "0189"
priority: P1
tags: ["approach-c", "server", "subtask"]
dependencies: []
created_at: "2026-07-04T04:13:23.847Z"
updated_at: "2026-07-04T04:16:54.540Z"
---

## 0198. system_events domain, server tap, history + inbox read APIs (0189 wave A)

### Background

Wave A of parent 0189 (Observabilities v1) — read the parent's Background and Design first; it owns the full context and constraints. This slice delivers the data + server layers: the capped `system_events` table and DAO in `packages/domain` (new `_spur_cli_` migration), the EventBus tap registered at serve bootstrap (persisting the shared event-name list, failure-isolated), the `GET /api/events/history` endpoint on the events module, and the read-only `messages` server module (inbox + list over TeamService). Wave B (web module) consumes these APIs.

### Requirements
- [ ] R1 — `system_events` migration (`_spur_cli_` marker) + `SYSTEM_EVENTS_SCHEMA_SQL` composed into `CLI_SCHEMA_SQL` + `SystemEventDao` (insert / prune(cap) / query name-since-limit newest-first) with `:memory:` tests. (Parent R1)
- [ ] R2 — Shared event-name constant extracted from the SSE module; tap at serve bootstrap persists via the DAO, insert-time cap (constant 10000), try/catch + logger isolation — a tap failure never breaks other subscribers. (Parent R2)
- [ ] R3 — `GET /api/events/history?name=&since=&limit=` on the events module, newest first, with endpoint tests. (Parent R3)
- [ ] R4 — Read-only `messages` server module: `GET /api/messages/inbox?agent=` + `GET /api/messages?limit=` over TeamService; Bun-gated; endpoint tests. (Parent R4)
- [ ] R5 — `bun run test-cf` green (tap + messages no-op without ctx); full gate green.
### Acceptance Criteria
```gherkin
Feature: Observabilities board module

  Scenario: Bus events persist to system_events
    Given spur serve is running on Bun
    When a task.updated event fires on the EventBus
    Then a system_events row is written with the event name, payload, and occurred_at timestamp

  Scenario: The event table stays within its cap
    Given system_events holds its maximum row count
    When a new event is persisted
    Then the oldest rows are pruned so the row count stays at or below the cap

  Scenario: Event history is queryable over the API
    Given persisted events exist
    When GET /api/events/history is requested with a since filter
    Then events newer than the filter return newest first
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Parent 0189's Design owns the full approach — this slice implements its **Domain**, **Server tap**, and **Endpoints** paragraphs verbatim: migration + `SYSTEM_EVENTS_SCHEMA_SQL` + `SystemEventDao` in `packages/domain` (follow the team-inbox migration precedent; `_spur_cli_` marker mandatory); shared event-name constant extracted from `apps/server/src/modules/events/index.ts`; failure-isolated tap at serve bootstrap (Bun path only); `GET /api/events/history` on the events module; read-only `messages` module over TeamService shaped for 0193's later write endpoints. Key invariants: apps/server never imports ts-db; tap errors log and never propagate; cap is a constant (10 000) with insert-time prune (0190 wave B takes over via the scheduler). Blocks: 0199 (consumes both APIs). Depends on: nothing.
### Plan
- [ ] Migration SQL + schema constant + `SystemEventDao` (insert/prune/query) + `:memory:` tests (R1).
- [ ] Shared event-name constant; tap at bootstrap with try/catch + logger isolation; failure-isolation test (R2).
- [ ] `GET /api/events/history` with name/since/limit newest-first + endpoint tests (R3).
- [ ] Read-only `messages` module (inbox + list) + endpoint tests (R4).
- [ ] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R5).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

J

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
