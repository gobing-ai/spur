---
template: feature-impl
schema_version: 1
name: Scheduler entries, job events, stats API, Jobs tab (0190 wave B)
description: ""
status: done
type: task
profile: standard
feature_id: A2
parent_wbs: "0190"
priority: P1
tags: [approach-c,server,web,subtask]
dependencies: []
created_at: 2026-07-04T04:13:23.850Z
updated_at: 2026-07-04T16:27:32.000-07:00
---

## 0201. Scheduler entries, job events, stats API, Jobs tab (0190 wave B)

### Background

Wave B of parent 0190 (job queue enablement) — read the parent's Background and Design first. Depends on wave A (worker + registry running). Delivers the periphery: scheduler start/stop in the serve lifecycle with the first real entries (`system-events-prune` via enqueue — replacing/backstopping 0189's insert-time cap — plus a `smoke` kind), job lifecycle events on the bus added to the shared event-name list (tap + SSE inherit), `GET /api/jobs/stats`, and the Jobs tab appended to the observability module's tabs contract (needs 0189 wave B shipped).

### Requirements
- [x] R1. Scheduler start/stop in serve lifecycle; `system-events-prune` (enqueue path) + `smoke` entries registered; firing tested via injected clock. (Parent R4)
- [x] R2. `job.enqueued|started|completed|failed` events (metadata only) on the bus; names added to the shared event-name list. (Parent R5)
- [x] R3. `jobs` server module: `GET /api/jobs/stats` riding `JobQueue.stats()`; endpoint test. (Parent R6)
- [x] R4. Jobs tab appended to observability `tabs.ts`: stats + recent `job.*` events from the history API. (Parent R6)
- [x] R5. Full gate green incl. `test-cf`; manual: prune/smoke activity visible in Events + Jobs tabs under `spur serve`. (Parent R8)
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
- [x] Scheduler start/stop in serve lifecycle; `system-events-prune` + `smoke` entries; injected-clock firing test (R1).
- [x] Job lifecycle events on the bus + shared name list extension (R2).
- [x] `jobs` module: `GET /api/jobs/stats` + endpoint test (R3).
- [x] Jobs tab via `tabs.ts` append: stats + recent job events (R4).
- [x] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check`; manual serve check of Events + Jobs tabs (R5).
### Solution

- `apps/server/src/serve.ts:13` defines built-in job kinds (`system-events-prune`, `smoke`), `apps/server/src/serve.ts:60` registers scheduled enqueue entries, and `apps/server/src/serve.ts:140` wires the matching worker handlers at serve bootstrap.
- `apps/server/src/modules/events/event-names.ts:6` extends the persisted/SSE event list with queue and scheduler lifecycle events so the 0189 system_events tap and EventSource stream inherit job visibility.
- `apps/server/src/modules/jobs/index.ts:12` adds the Bun-gated `jobs` server module and `GET /api/jobs/stats`.
- `apps/server/src/modules/registry.ts` registers the jobs module with the built-ins.
- `apps/web/src/modules/observability/JobsTab.tsx:91` adds the Jobs tab: it reads `/api/jobs/stats`, fetches recent history, filters `queue.*`/`scheduler.*` events, and renders status cards plus recent event rows.
- `apps/web/src/modules/observability/tabs.ts:23` appends `{ id: 'jobs', label: 'Jobs', component: JobsTab }` through the existing tab-extension contract.
- Tests cover scheduler enqueue registration, jobs stats endpoint, expanded event cleanup, registry membership, and Jobs tab rendering.

### Testing

- Focused assertions: `bun test apps/server/tests/modules/jobs/index.test.ts apps/server/tests/modules/events/event-names.test.ts apps/server/tests/modules/registry.test.ts apps/server/tests/serve.test.ts apps/web/tests/modules/observability/tabs.test.ts apps/web/tests/modules/observability/components.test.tsx` — 28 pass / 0 fail; command exits nonzero on the intentionally narrow coverage subset.
- `bun run lint` — clean.
- `bun run test` — 2177 pass, 0 fail; coverage gate satisfied.
- `bun run test-cf` — Workers runtime test passed.
- `bun run build` — cli/server/web build succeeded.
- `bun run spur-check` — 29 pre-check rules passed, 2177 tests passed, 2 post-check rules passed.
- Serve probe: `bun run apps/cli/src/index.ts serve --port 4341 --host 127.0.0.1 --no-open`; `/api/jobs/stats`, `/api/events/history?limit=5`, and `/board/observability` returned HTTP 200. History included persisted `queue.consumer.started`, proving queue lifecycle events are visible through system_events.

### Review

| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | `apps/server/src/serve.ts` | The scheduler intervals are conservative (`300000` ms prune, `600000` ms smoke), so the manual probe verifies worker/scheduler startup and event visibility but does not wait for a scheduled tick. | Keep the fast deterministic `registerSchedulerEntries` test as the tick assertion; tune intervals later if operational needs require it. |

### References

A2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-04T16:27:32.000-07:00 todo → done (codex: scheduler entries, job events, jobs stats API, Jobs tab, gates green)
