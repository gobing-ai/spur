---
schema_version: 1
name: "S1: EventBus + JobQueue + Scheduler infrastructure wiring into ServerContext"
status: done
type: task
feature_id: S1
priority: P1
tags: ["server-side-adjustment","wave-S0","group-S"]
created_at: 2026-06-15T16:01:22.520Z
updated_at: 2026-06-15T16:01:22.520Z
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

1. **Schema (`packages/domain/migrations.ts`):** added `QUEUE_JOBS_SCHEMA_SQL` (mirrors ts-db's
   `queue_jobs` DDL — table + `queue_jobs_ready_idx` + `expires_at` — kept byte-compatible with ts-db's
   embedded migrations `0000`/`0001`/`0002`, the same pattern as `INBOX_MESSAGES_SCHEMA_SQL`), composed
   it into `CLI_SCHEMA_SQL`, and added incremental migration `0004_spur_cli_queue_jobs`. Exported from
   the domain barrel.
2. **Domain wiring (`packages/domain/db.ts`):** `createJobQueue(db, events?)` → `new DBJobQueue(new
   QueueJobDao(db))`; `createQueueConsumer(db, config?)` → `DBQueueConsumer` (typed `ServerQueueConsumer`
   exposing `processOnce`). Both LAZY-import ts-db + the ts-infra `/job-queue-db` subpath so the domain
   barrel stays Worker-safe (the 0073 lesson). Added `@gobing-ai/ts-infra` as a `packages/domain` dep.
3. **ServerContext (`apps/server/context.ts`):** `eventBus()` returns the real `EventBus` (injected or
   `appRt.events`); `jobQueue()` is async/lazy/cached → calls the domain `createJobQueue` (throws
   `NotConfiguredError` when `jobQueueEnabled` false); `scheduler()` returns the configured
   `SchedulerAdapter` or throws. `ServerJobQueue`/`ServerScheduler` aliased to ts-infra `JobQueue`/
   `SchedulerAdapter`. apps/server imports neither ts-db nor the ts-infra subpath directly.
4. **Bun entry (`apps/server/index.ts`):** when `jobqueue.enabled`, builds + STARTS a `DBQueueConsumer`
   (via domain `createQueueConsumer`) and drains it on shutdown; when `scheduler.enabled`, builds a
   `NodeSchedulerAdapter` (ts-infra `/scheduler-node`), passes it to the context, starts + stops it. The
   Bun-vs-Worker consumer divergence is selected by WHICH entry runs (invariant #9) — the Worker never
   starts a consumer.
5. **Config (`serverBootstrapConfig`):** added `jobqueue.enabled` / `scheduler.enabled` (default false;
   `events.enabled` default true) — R4 opt-in with safe defaults.
6. **Tests:** real EventBus publish→observe; `jobQueue()` enqueue + stats + cache; **enqueue→consume
   roundtrip** (`processOnce`); `NodeSchedulerAdapter` register/start/stop; domain `createJobQueue`/
   `createQueueConsumer` roundtrip; migration tests updated for `0004` (length 5, queue table writable,
   applied-count 3/4). Coverage: `db.ts`/`migrations.ts`/`context.ts` 100%.
7. Uses the released `@gobing-ai/ts-*@0.3.19` infra (ts-infra `DBJobQueue`/`DBQueueConsumer`/
   `NodeSchedulerAdapter`, ts-db `QueueJobDao`) — no stubs, no new engine code (ADR-021 reuse).


### Plan


- [x] Verify ts-infra import paths + signatures for `DBJobQueue`, `DBQueueConsumer`, scheduler adapters, and ts-db `QueueJobDao` against the installed catalog version (names confirmed: EventBus/JobQueue/QueueConsumer/CloudflareSchedulerAdapter).
- [x] `ServerContext.eventBus()` returns `appRt.events` typed `EventBus<PlanningEventMap>` (PlanningEventMap from @gobing-ai/spur-app); lazy/cached.
- [x] `ServerContext.jobQueue()`: build `DBJobQueue` over `QueueJobDao` (from the migrated DB adapter); cached; returns a clear "not configured" guard when disabled.
- [x] Bun/Node entry (`index.ts`/`serve.ts`): start `DBQueueConsumer` when jobqueue enabled. Workers entry (`worker.ts`): enqueue-only (no consumer). Selection at the entry layer, not in createApp.
- [x] `ServerContext.scheduler()`: Node adapter for Bun, `CloudflareSchedulerAdapter` for Workers; default off; opt-in via config. If a Worker scheduled task is configured, add a `scheduled(event)` export to worker.ts; else document the seam.
- [x] Config: extend the bootstrap/server config with `events.enabled` (default true), jobqueue/scheduler enabled flags (default false); a disabled facility never crashes startup (R5).
- [x] Tests: `eventBus()` returns the bus and a published `PlanningEvent` is observable by a subscriber; `jobQueue()` enqueue + (Bun) consume roundtrip against in-memory SQLite; scheduler registration is a no-op when disabled; disabled facility accessor returns the guard, not a crash.
- [x] Gate: `bun run lint` + `test` + `test-cf` + `build`; coverage >=90%.
- [x] Note: S6 (deferred SSE) subscribes to `eventBus()`; this task only wires the bus accessor + jobqueue/scheduler plumbing.


### Review

**dev-verify verdict: PASS (after fixing R2/R3 from stubs to real wiring)** — Phase 7 SECU + Phase 8 traceability, `--fix all --force`, verified 2026-06-15 by claude-code. Operator directive: implement JobQueue/Scheduler with the real `@gobing-ai/ts-*` infrastructure (no stubs).

Task 0074 shipped (commit `246f605`, `status: done`) with **R1 (EventBus) correct but R2 (JobQueue) and R3 (Scheduler) as interface-only stubs** (`jobQueue()`/`scheduler()` always threw; no DBJobQueue/QueueJobDao/consumer/scheduler-adapter; `queue_jobs` table not even migrated; R6 tests vacuous). Per the operator directive, R2/R3 were **implemented fully** using ts-infra `DBJobQueue`/`DBQueueConsumer` + ts-db `QueueJobDao` + ts-infra `NodeSchedulerAdapter`.

**Phase 8 — Requirements traceability (6/6 MET):**

| Req | Verdict | Evidence |
|---|---|---|
| R1 EventBus on ServerContext | ✅ MET | `context.ts` `eventBus()` returns the real `EventBus<PlanningEventMap>` (`appRt.events` or injected `eventsBus`). Test: real publish→observe roundtrip. |
| R2 JobQueue wiring (DBJobQueue+QueueJobDao; Bun starts consumer, Worker enqueue-only) | ✅ MET (implemented) | `packages/domain/db.ts` `createJobQueue(db)` → `new DBJobQueue(new QueueJobDao(db))`; `createQueueConsumer(db)` → `DBQueueConsumer`. `ServerContext.jobQueue()` builds it (lazy/cached, async). `index.ts` (Bun entry) STARTS `DBQueueConsumer` when `jobqueue.enabled`; the Worker path never starts a consumer (divergence at the entry, not in app code). `queue_jobs` table added to `CLI_SCHEMA_SQL` + migration `0004`. |
| R3 Scheduler wiring (Node adapter Bun / Cloudflare Workers; configurable; default off) | ✅ MET (implemented) | `index.ts` builds `NodeSchedulerAdapter` (ts-infra `/scheduler-node`) when `scheduler.enabled`, registers + starts + stops it. `ServerContext.scheduler()` returns the configured adapter (the entry selects Node vs Cloudflare). `ServerScheduler` aliased to ts-infra `SchedulerAdapter`. |
| R4 Each facility opt-in; safe defaults | ✅ MET | `serverBootstrapConfig` ships `events.enabled:true`, `jobqueue.enabled:false`, `scheduler.enabled:false`. Disabled facilities throw `NotConfiguredError` (no crash). |
| R5 No facility creation crashes startup when disabled | ✅ MET | `index.ts` only builds consumer/scheduler under their `enabled` flags; defaults off → server boots clean. |
| R6 Tests (EventBus observe; enqueue→consume roundtrip; scheduler) ≥90% | ✅ MET (real, not vacuous) | `context.test.ts`: real EventBus publish→observe; `jobQueue()` enqueue + stats; **enqueue→consume roundtrip** (`processOnce` drains, asserts `seen===[42]`, `completed===1`); `NodeSchedulerAdapter` register/start/stop. `db.test.ts`: `createJobQueue`/`createQueueConsumer` roundtrip. Coverage: `db.ts` 100%, `migrations.ts` 100%, `context.ts` 100%. |

**Phase 7 — SECU:**
- **S:** payloads are JSON-serialized by the DAO (parameterized writes); no injection. `NotConfiguredError` on disabled facilities (fail-loud, no silent no-op).
- **C:** the ts-db/ts-infra job-queue wiring lives in `packages/domain` (owns the ts-db boundary + queue schema) — `apps/server` imports neither ts-db nor the ts-infra subpath directly; test-cf stays green (Worker-safe, the 0073 lesson held). Bun-vs-Worker consumer divergence is at the entry layer (invariant #9).
- **U:** clear "not configured" error message names the facility + how to enable it.
- **E:** lazy + cached job-queue promise; consumer uses the package's polling/visibility-timeout defaults.

**Gate (post-fix):** `bun run lint` clean (7 workspaces) · `bun run test` 1323/0 + 158/0 · `bun run test-cf` 1/0 · `bun run build` all OK · `db.ts`/`migrations.ts`/`context.ts` 100%.
### Findings (inline — no separate section in this template)

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | **R2 (JobQueue) shipped as an interface-only STUB, not real wiring.** `ServerContext.jobQueue()` unconditionally threw `NotConfiguredError` even when "enabled" (`jobQueueCache` was never populated); no `DBJobQueue`/`QueueJobDao`/`DBQueueConsumer`; the `queue_jobs` table was not in `CLI_SCHEMA_SQL` (so even a real `enqueue` would fail "no such table"); `index.ts` started no consumer. The R6 "enqueue→consume roundtrip" test did not exist; the only jobQueue test asserted the stub throws (vacuous, the cerebrum stub anti-pattern). | Correctness (C) | `context.ts` jobQueue(), `index.ts`, `packages/domain/migrations.ts` | **P1** | **FIXED 2026-06-15 (operator directive: use real ts-* infra)** — added `queue_jobs` to `CLI_SCHEMA_SQL` + migration `0004`; `packages/domain` `createJobQueue`/`createQueueConsumer` over ts-db `QueueJobDao` + ts-infra `DBJobQueue`/`DBQueueConsumer`; `ServerContext.jobQueue()` builds a real producer (async/lazy/cached); `index.ts` starts `DBQueueConsumer` on the Bun path under `jobqueue.enabled`. Real enqueue→consume roundtrip tests (server + domain). |
| 2 | **R3 (Scheduler) shipped as an interface-only STUB.** No Node/Cloudflare scheduler adapter; `scheduler()` only returned a pre-built adapter passed via options (never supplied), else threw. The "Node adapter for Bun / Cloudflare for Workers" divergence was absent; no scheduler test beyond the throw-guard. | Correctness (C) | `context.ts` scheduler(), `index.ts` | **P1** | **FIXED 2026-06-15** — `index.ts` (Bun entry) builds `NodeSchedulerAdapter` (ts-infra `/scheduler-node`) under `scheduler.enabled`, registers/starts/stops it; `ServerScheduler` aliased to the ts-infra `SchedulerAdapter` interface; entry selects Node vs Cloudflare (invariant #9). Real `NodeSchedulerAdapter` register/start/stop test added. |
| 3 | **R6 tests were vacuous.** The EventBus test only asserted the accessor returns an object with `.emit`/`.on` (never published+observed an event); jobQueue/scheduler tests only asserted the stubs throw. This claimed R6 done while exercising nothing. | Correctness (C) | `context.test.ts` | **P2** | **FIXED 2026-06-15** — EventBus test now publishes on a real `EventBus` and asserts the handler observed the payload; jobQueue/scheduler tests exercise real enqueue/consume/stats + adapter lifecycle. |
| 4 | **Re-introduced ts-db into apps/server reach (regression risk vs 0073).** The job-queue wiring needs ts-db `QueueJobDao`. Putting it directly in `apps/server` would re-create the 0073 Worker-crash class (ts-db/node:fs in the Worker bundle). | Correctness (C) | architecture | **P2** | **FIXED (by design)** — the wiring lives in `packages/domain` (`createJobQueue`/`createQueueConsumer`, lazy ts-db/ts-infra-subpath imports); `apps/server` calls the domain helper, imports neither ts-db nor the ts-infra subpath. `test-cf` verified green. Added `@gobing-ai/ts-infra` as a `packages/domain` dependency (was a real new import). |

No remaining P1/P2. All four resolved; full gate green incl. test-cf.


### Testing

**Verified 2026-06-15 (dev-verify — R2/R3 implemented from stubs to real ts-* wiring; 4 findings resolved).**

- Command: `bun --cwd apps/server test --coverage` · `bun --cwd packages/domain test --coverage` ·
  `bun run lint` · `bun run test` · `bun run test-cf` · `bun run build`
- Scope: EventBus real publish→observe · JobQueue `enqueue`/`stats`/cache · **enqueue→consume roundtrip**
  (`DBQueueConsumer.processOnce` drains, asserts handler saw the payload + `completed===1`/`pending===0`)
  · `NodeSchedulerAdapter` register/start/stop · disabled-facility `NotConfiguredError` guards · domain
  `createJobQueue`/`createQueueConsumer` roundtrip · `queue_jobs` migration (`0004`, table writable,
  applied-counts) · CF Worker fetch entrypoint (Worker-safe regression guard).
- Result: **server 65 pass / 0 fail**; **domain 369 pass / 0 fail**; all workspaces **1323 pass /
  0 fail**; plugins/sp **158 pass / 0 fail**; **test-cf 1 pass / 0 fail**.
- Coverage: `packages/domain/src/db.ts` 100% line+func (incl. `createJobQueue`/`createQueueConsumer`) ·
  `packages/domain/src/migrations.ts` 100% · `apps/server/src/context.ts` 100% line+func ·
  `bootstrap.ts` 100% line / 95% func. Per-file ≥90% met on all 0074 files. (`index.ts` entrypoint
  block uncovered — entrypoint guard, accepted; the consumer/scheduler START logic there is covered
  indirectly by the domain + context tests of the same helpers.)
- Evidence: `apps/server/tests/context.test.ts` (EventBus observe, jobQueue roundtrip, scheduler),
  `packages/domain/tests/db.test.ts` (createJobQueue/createQueueConsumer), `packages/domain/tests/dao/
  migrations.test.ts` (queue_jobs `0004`), `apps/server/tests/cf/worker-runtime.cf.ts`.
- Gate: `bun run lint` clean (7 workspaces) · `bun run test` 1323/0 + 158/0 · `bun run test-cf` 1/0 ·
  `bun run build` CLI + server + web OK.
- Findings: 4 fixed (R2 JobQueue stub→real, R3 Scheduler stub→real, R6 vacuous tests→real, ts-db kept
  out of apps/server via domain helper). See Review § Findings.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References

- **Design:** `docs/design/server-side-adjustment-design.md` §2.1.1 (runtime adaptation), §A4 / finalized
  S1 scope (EventBus/JobQueue/Scheduler wiring). Invariant #8 (module isolation), #9 (platform divergence
  only at the entry / behind ts-runtime).
- **Decisions:** ADR-021 (functionality in `packages/app`/`packages/domain`; reuse ts-* engines, no new
  engine code).
- **Upstream infra used (`@gobing-ai/ts-*@0.3.19`):** ts-infra `DBJobQueue`/`DBQueueConsumer`
  (`/job-queue-db` subpath), `NodeSchedulerAdapter` (`/scheduler-node`), `EventBus`, `SchedulerAdapter`/
  `JobQueue`/`QueueConsumer` types; ts-db `QueueJobDao` + the `queue_jobs` schema (mirrored in Spur).
- **Related Spur tasks:** 0073 (S1 ServerContext — this task extends it with jobQueue/scheduler accessors;
  the Worker-safe domain-helper pattern is the 0073 lesson applied), 0072 (S1 middleware/health), 0078
  (S3 — a future job producer would `enqueue` via `ctx.jobQueue()`), S6 (deferred SSE — subscribes to
  `ctx.eventBus()`).
- **Key source:** `apps/server/src/context.ts`, `apps/server/src/index.ts`,
  `packages/domain/src/db.ts`, `packages/domain/src/migrations.ts`.
- **Cerebrum lessons applied:** Worker-safe imports (no ts-db/node:fs reachable from bootstrap/worker);
  per-file coverage (test the deliverable directly, not via aggregate).

