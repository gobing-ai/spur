---
template: feature-impl
schema_version: 1
name: "Enable embedded job queue and scheduler in spur serve (worker loop + handler registry)"
description: ""
status: wip
type: task
profile: standard
feature_id: A2
parent_wbs: null
priority: P1
tags: ["approach-c", "server", "infra"]
dependencies: []
created_at: "2026-07-03T23:35:28.254Z"
updated_at: "2026-07-04T07:16:09.369Z"
---

## 0190. Enable embedded job queue and scheduler in spur serve (worker loop + handler registry)

### Background

Cycle position P2 (decision D6, docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md). The queue infrastructure is HALF-wired today: `ServerContext.jobQueue()` returns a real `DBJobQueue` over `QueueJobDao` (`queue_jobs` table, created via `createJobQueue` in `@gobing-ai/spur-domain`) and `scheduler()` returns a `NodeSchedulerAdapter` — but `jobQueueEnabled` defaults to false (`apps/server/src/context.ts:138`), bootstrap ships `scheduler: { enabled: false }` (`apps/server/src/bootstrap.ts:36`), and the ts-infra `JobQueue` interface exposed is PRODUCER-ONLY (enqueue/enqueueBatch/stats). No consumer loop, no handler registry, and no scheduled job exists anywhere in the repo.

Decision D6: in-process worker inside `spur serve`, Bun path only — Cloudflare keeps the `NotConfiguredError` stance. Deliver: flip the enables on the Bun serve path, add a polling consumer loop with graceful shutdown, a typed handler registry in `packages/app`, scheduler start/stop in the serve lifecycle, and the first real consumers — the `system_events` retention-pruning job (hand-off from the P1 Observabilities task, which ships insert-time pruning) plus a no-op smoke job kind for tests. Emit job lifecycle events on the EventBus so the Observability module shows them, add `GET /api/jobs/stats`, and add the Jobs tab into the observability module via its tab-extension contract.

Dependency: P1 Observabilities task (tab contract + system_events pruning hand-off + event visibility). Check ts-infra's `JobQueue`/`QueueJobDao` consumer surface first — if a claim/complete API is missing upstream, prefer the smallest ts-libs enhancement over a Spur-side workaround (AGENTS.md shared-library evolution rule).

### Requirements
- [ ] R1. Worker loop in `packages/app` (e.g. `JobWorkerService`): polls `queue_jobs` for pending jobs, claims atomically, dispatches to the handler registry, records terminal status; poll interval configurable with a sane default; graceful shutdown completes or releases the in-flight job (never orphans a claimed row).
- [ ] R2. Typed handler registry: job kind → handler mapping registered at serve bootstrap; a claimed job with an unregistered kind is marked failed with an error naming the kind (fail loud, no silent drop).
- [ ] R3. Enable on Bun serve path only: `jobQueueEnabled: true` + `scheduler.enabled: true` wired through `apps/server/src/serve.ts`/`bootstrap.ts`; Cloudflare entrypoint (`worker.ts`) boots with neither and still serves health + OpenAPI (covered by `bun run test-cf`).
- [ ] R4. Scheduler lifecycle: `NodeSchedulerAdapter.start()` on serve boot, `stop()` on shutdown; first registered entry = `system_events` retention pruning (replacing/backstopping the P1 insert-time cap); second = smoke job for tests.
- [ ] R5. Job lifecycle events (enqueued/started/completed/failed) emitted on the EventBus; visible in the Observability Events tab without further work.
- [ ] R6. `GET /api/jobs/stats` returning counts by status (rides the existing `JobQueue.stats`); Jobs tab added to the `observability` web module via its tab-extension contract showing stats + recent job events.
- [ ] R7. Tests: worker loop against in-memory SQLite (execute, unknown-kind failure, shutdown release), scheduler registration, stats endpoint, CF no-op; no test sleeps longer than necessary (inject clock/interval where possible).
- [ ] R8. Full gate green: `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`.
### Acceptance Criteria
```gherkin
Feature: Embedded job queue and scheduler

  Scenario: Worker executes an enqueued job
    Given spur serve is running on Bun with the queue enabled
    When a job with a registered handler kind is enqueued
    Then the handler executes and the queue_jobs row reaches a terminal completed status

  Scenario: Unknown job kind fails loud
    Given a job whose kind has no registered handler
    When the worker claims it
    Then the job is marked failed with an error message naming the unknown kind

  Scenario: Scheduler fires a registered cron entry
    Given spur serve is running with the scheduler enabled
    When a registered cron entry elapses
    Then the scheduled action runs and a corresponding job event is observable on the EventBus

  Scenario: Graceful shutdown never orphans a claimed job
    Given a worker with a job in flight
    When the server receives a shutdown signal
    Then the worker loop stops and the in-flight job is completed or released back to pending

  Scenario: Cloudflare entrypoint is unaffected
    Given the Cloudflare Workers entrypoint
    When the worker boots
    Then no queue or scheduler starts and health plus OpenAPI endpoints still serve

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
**Approach.** Add the missing HALF of the queue: a consumer. Producer wiring exists (`ServerContext.jobQueue()` → `createJobQueue(db, eventBus)` in `@gobing-ai/spur-domain` → `DBJobQueue` over ts-db `QueueJobDao`/`queue_jobs`; `scheduler()` → `NodeSchedulerAdapter`) but is disabled (`jobQueueEnabled ?? false` at `apps/server/src/context.ts:138`; `scheduler: { enabled: false }` at `bootstrap.ts:36`) and nothing consumes. Deliver a polling `JobWorkerService` in `packages/app`, a typed handler registry, serve-lifecycle wiring (Bun only), scheduler startup with the first real entries, job lifecycle events, a stats endpoint, and the Jobs tab.

**Upstream check FIRST.** Before writing the worker, read the resolved `.d.ts` of ts-db's `QueueJobDao` and ts-infra's `JobQueue`/`DBJobQueue` (resolve from inside `packages/domain`, not the store dir name — versions lag). The worker needs claim-pending (atomic status flip), complete, fail, release. If the consumer surface is missing/insufficient upstream, make the smallest ts-libs enhancement (AGENTS.md shared-library rule) and consume by semver — do NOT hand-roll SQL against `queue_jobs` in Spur (`packages/domain` is the sole ts-db consumer; any raw fallback lives there, flagged as temporary). Record the found surface + decision here.

**Worker (R1, R2).** `packages/app/src/services/job-worker-service.ts` (or `workflow/`-sibling placement consistent with existing service layout): constructor takes `{ dao|queue, registry, eventBus, logger, pollMs (default ~1000), clock? }`. Loop: claim next pending → emit `job.started` → dispatch `registry.get(kind)` → complete + `job.completed` | fail + `job.failed` (unknown kind → fail with message naming the kind). `start()` begins the loop; `stop()` (awaited by serve shutdown) finishes the in-flight job or releases the claim — a claimed row must never be left stranded. Inject the poll interval/clock so tests never sleep.

**Registry (R2).** `JobHandlerRegistry`: `register(kind, handler)` / `get(kind)`; `JobHandler = (payload, ctx) => Promise<void>`. Registered at serve bootstrap. Keep typing pragmatic — a `Record<string, unknown>` payload with per-handler parse (zod where a payload shape exists) beats a generic type-map contraption (R2/simplicity).

**Serve wiring (R3, R4).** Bun path (`serve.ts`): pass `jobQueueEnabled: true`, build registry, start worker after context ready, `scheduler().start()` with entries: (1) `system-events-prune` — replaces/backstops 0189's insert-time cap (enqueues or directly runs the prune; prefer enqueue → it exercises the queue and shows up in events); (2) `smoke` no-op kind for tests. Shutdown order: scheduler stop → worker stop → server close. CF (`worker.ts`): untouched — no ctx, `NotConfiguredError` stance intact, `test-cf` proves it.

**Events + surfaces (R5, R6).** Emit `job.enqueued|started|completed|failed` (metadata: id, kind, status — no payload dump) on the bus; ADD these names to the shared event-name list from 0189 so the tap persists them and SSE streams them. Stats: `GET /api/jobs/stats` in a small `jobs` server module riding `JobQueue.stats()`. Jobs tab: append to the observability `tabs.ts` array — stats cards + recent `job.*` rows from the history API (`?name=job.` prefix filter or client-side filter; keep the API simple).

**Testing (R7).** In-memory SQLite; fake/injected interval — no real sleeps beyond one tick; cases: execute-to-completed, unknown-kind→failed-loud, shutdown-releases-in-flight, scheduler registration fires action (fake scheduler or short cron via injected clock), stats endpoint counts, CF no-op.

**Risks.** DB contention between worker polls and CLI writes (single local SQLite): if lock errors appear, set `busy_timeout` via a direct `PRAGMA` exec after adapter creation (ts-db `pragmas` option silently ignores unsupported keys — known gotcha). Don't let the worker swallow handler errors (fail loud, R12).

**Decomposition guidance.** Optional split: A = worker + registry + wiring + shutdown (R1–R3); B = scheduler entries + events + stats + tab (R4–R6). `--parent 0190` if split.

**Dependencies.** 0189 (tab-extension contract, shared event-name list, `system_events` prune hand-off). Blocks nothing hard, but 0191's action-execution design prefers this queue as its execution channel.
### Plan
- [ ] Upstream audit: read resolved `QueueJobDao`/`DBJobQueue` `.d.ts` for claim/complete/fail/release; record findings in Design; if insufficient, land the smallest ts-libs enhancement and bump the catalog.
- [ ] `JobHandlerRegistry` + `JobWorkerService` in `packages/app` with injected pollMs/clock; unit tests: execute, unknown-kind fail-loud, stop-releases-in-flight (R1, R2, R7).
- [ ] Serve wiring (Bun path): enable queue, build registry, start/stop worker in lifecycle; shutdown ordering test (R3).
- [ ] Scheduler start/stop in serve lifecycle; register `system-events-prune` (enqueue path) + `smoke`; test the registration + firing via injected clock (R4).
- [ ] Job lifecycle events on the bus; extend the shared event-name list so tap + SSE carry them (R5).
- [ ] `jobs` server module: `GET /api/jobs/stats`; endpoint test (R6).
- [ ] Jobs tab appended to observability `tabs.ts`: stats + recent job events (R6).
- [ ] CF check: `bun run test-cf` green, no queue/scheduler on Workers (R3).
- [ ] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R8).
- [ ] Manual: `spur serve`, watch `system-events-prune`/smoke activity appear in the Events + Jobs tabs.

<!-- AUTO-GENERATED by spur task refresh-roster -->
| WBS | Sub-task | Status |
| --- | -------- | ------ |
| 0200 | Job worker loop, handler registry, serve lifecycle wiring (0190 wave A) | todo |
| 0201 | Scheduler entries, job events, stats API, Jobs tab (0190 wave B) | todo |
<!-- END AUTO-GENERATED -->
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
- 2026-07-04T04:13:23.896Z todo → wip (system)
