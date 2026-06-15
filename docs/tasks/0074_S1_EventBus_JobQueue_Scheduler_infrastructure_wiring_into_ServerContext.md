---
name: "S1: EventBus + JobQueue + Scheduler infrastructure wiring into ServerContext"
description: "S1: EventBus + JobQueue + Scheduler infrastructure wiring into ServerContext"
status: Backlog
created_at: 2026-06-15T16:01:22.520Z
updated_at: 2026-06-15T16:01:22.520Z
folder: docs/tasks
type: task
feature-id: S1
priority: P1
estimated_hours: 7
tags: ["server-side-adjustment","wave-S0","group-S"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0074. "S1: EventBus + JobQueue + Scheduler infrastructure wiring into ServerContext"

### Background

Make system-level infrastructure (EventBus/JobQueue/Scheduler) available to server modules, not just bootstrapped and ignored. EventBus<PlanningEventMap> is the pub/sub seam the deferred SSE handler (S6) will subscribe to. JobQueue is for async work (history import, rule runs) triggered via API. Scheduler is for periodic tasks. Each is opt-in via config with sensible defaults. ts-infra already exports EventBus, JobQueue/QueueConsumer, DBJobQueue/DBQueueConsumer, and Node/Cloudflare scheduler adapters. Anchors: design §A4 (drafted), §2.1.1 (Node vs Workers divergence behind the runtime/infra seam).


### Requirements

R1: EventBus exposed on ServerContext (typed EventBus<PlanningEventMap> from @gobing-ai/spur-app) — eventBus() accessor; sourced from appRt.events. R2: JobQueue wiring — ts-db QueueJobDao + ts-infra DBJobQueue/DBQueueConsumer; Bun/Node entry STARTS the consumer; Workers entry ENQUEUES ONLY (no long-lived consumer in a stateless isolate). The Bun-vs-Workers consumer divergence is selected at the entry layer, not branched in app code. R3: Scheduler wiring — ts-infra Node scheduler adapter for Bun, CloudflareSchedulerAdapter (Cron Triggers) for Workers; configurable; default off. R4: Each facility opt-in via the bootstrap/server config; server ships safe defaults (events on, jobqueue/scheduler off unless configured). R5: No facility creation crashes startup when disabled. R6: Tests: EventBus accessor returns the bus and a published PlanningEvent is observable; JobQueue enqueue + (Bun) consume roundtrip against in-memory SQLite; scheduler registration is a no-op when disabled. Coverage >=90%.


### Q&A



### Design

Authority: design §A4 (drafted — infra wiring), §2.1.1 (Bun-vs-Workers divergence behind the seam),
finalized S1 scope (EventBus/JobQueue/Scheduler). Builds on 0073's ServerContext.

**ts-infra ground-truth (verified exports):** `EventBus`, `JobQueue`, `QueueConsumer`,
`QueueConsumerConfig`, `QueueStats`, `QueueEvents`; scheduler adapters (Node + `CloudflareSchedulerAdapter`
from `scheduler-cloudflare`). `DBJobQueue` + `DBQueueConsumer` live under `job-queue/db-job-queue` /
`job-queue-db`. `QueueJobDao` is in `@gobing-ai/ts-db`. (Names confirmed; verify exact import paths +
constructor signatures against the installed catalog version before wiring.)

**EventBus (R1):** `appRt.events` is already the bootstrapped bus (bootstrap.ts threads `appRt.events`
into the oRPC context today). `ServerContext.eventBus()` returns it typed as `EventBus<PlanningEventMap>`
(`PlanningEventMap` from `@gobing-ai/spur-app`). This is the pub/sub seam the deferred SSE handler (S6)
will subscribe to — wiring it now means S6 is purely a framing+handler addition. The
`BusPlanningEventEmitter` (already in packages/app, published on the planning write path) feeds it.

**JobQueue (R2):** `DBJobQueue` over `QueueJobDao` (ts-db) for enqueue; `DBQueueConsumer` for processing.
The Bun/Node entry (`index.ts` / `serve.ts`) STARTS a consumer (long-lived process); the Workers entry
(`worker.ts`) ENQUEUES ONLY (a stateless isolate has no resident consumer). **This divergence is selected
at the ENTRY layer** (which entry starts the consumer), not branched in `bootstrap.ts`/app code
(invariant #9-aligned: the entry adapts the host). Default OFF unless configured.

**Scheduler (R3):** Node scheduler adapter for Bun (setInterval/node-cron); `CloudflareSchedulerAdapter`
(Cron Triggers) for Workers — again selected at the entry/runtime layer. For periodic tasks (stale-lock
cleanup, scheduled analytics). Default OFF; opt-in via config (`bootstrap.scheduler` / a server config
key). The Worker path needs a `scheduled(event)` export on `worker.ts` to receive Cron Triggers — add
only if a scheduled task is actually configured; otherwise leave the seam documented.

**Config (R4):** each facility opt-in. The `bootstrap:` config already abstracts logging/telemetry/events
(`enabled` flags); follow that pattern — `events.enabled` (default true), jobqueue/scheduler default off.
A disabled facility's accessor returns a no-op / throws a clear "not configured" error, never crashes
startup (R5).

**Accessors on ServerContext:** add `jobQueue()` / `scheduler()` alongside the `eventBus()` accessor
declared in 0073; lazy + cached.

**Out of scope:** the SSE handler itself (S6, deferred), any actual async job producer (this wires the
plumbing; history-import-via-API etc. are later modules).


### Solution



### Plan

- [ ] Verify ts-infra import paths + signatures for `DBJobQueue`, `DBQueueConsumer`, scheduler adapters, and ts-db `QueueJobDao` against the installed catalog version (names confirmed: EventBus/JobQueue/QueueConsumer/CloudflareSchedulerAdapter).
- [ ] `ServerContext.eventBus()` returns `appRt.events` typed `EventBus<PlanningEventMap>` (PlanningEventMap from @gobing-ai/spur-app); lazy/cached.
- [ ] `ServerContext.jobQueue()`: build `DBJobQueue` over `QueueJobDao` (from the migrated DB adapter); cached; returns a clear "not configured" guard when disabled.
- [ ] Bun/Node entry (`index.ts`/`serve.ts`): start `DBQueueConsumer` when jobqueue enabled. Workers entry (`worker.ts`): enqueue-only (no consumer). Selection at the entry layer, not in createApp.
- [ ] `ServerContext.scheduler()`: Node adapter for Bun, `CloudflareSchedulerAdapter` for Workers; default off; opt-in via config. If a Worker scheduled task is configured, add a `scheduled(event)` export to worker.ts; else document the seam.
- [ ] Config: extend the bootstrap/server config with `events.enabled` (default true), jobqueue/scheduler enabled flags (default false); a disabled facility never crashes startup (R5).
- [ ] Tests: `eventBus()` returns the bus and a published `PlanningEvent` is observable by a subscriber; `jobQueue()` enqueue + (Bun) consume roundtrip against in-memory SQLite; scheduler registration is a no-op when disabled; disabled facility accessor returns the guard, not a crash.
- [ ] Gate: `bun run lint` + `test` + `test-cf` + `build`; coverage >=90%.
- [ ] Note: S6 (deferred SSE) subscribes to `eventBus()`; this task only wires the bus accessor + jobqueue/scheduler plumbing.


### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


