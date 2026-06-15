---
schema_version: 1
name: "S1: ServerContext service wiring + DB/FileSystem via ts-runtime"
status: wip
type: task
feature_id: S1
priority: P1
tags: ["server-side-adjustment","wave-S0","group-S"]
created_at: 2026-06-15T16:01:22.500Z
updated_at: 2026-06-15T16:01:22.500Z
---

## 0073. "S1: ServerContext service wiring + DB/FileSystem via ts-runtime"

### Background

Closes the gap between 'bootstrap gives a runtime' and 'oRPC handlers can call packages/app services'. Introduces ServerContext (analogous to apps/cli CliContext): a bundle of lazily-initialized packages/app services (TaskService, FeatureService, ...) built from the ApplicationRuntime's db/events/logger, accessed via c.get('ctx'). DB access goes through ts-runtime's NEW createDbAdapter (ts-libs task 0037) — NOT per-entry branching in apps/server (Spur invariant #9, enhance-first). Anchors: ADR-021 (functionality in packages/app), design §2.1.1, §2.3.


### Requirements

R1: ServerContext interface { cwd; fs; getDb(): Promise<DbAdapter>; taskService(): TaskService; featureService(): FeatureService; webDistPath?: string } (future: workflow/rule/agent/history/team services). R2: createServerContext(appRt, options) mirrors createCliContext; services lazy-initialized on first call, cached per process/isolate. R3: getDb() obtains the migrated DbAdapter via RuntimeFactory.createDbAdapter() from ts-runtime (consumes ts-libs 0037 by catalog bump); applies Spur's CLI_SCHEMA_SQL (the migration step today's createMigratedDb does); caches. R4: FileSystem (cwd-bound, createNodeFileSystem(cwd)) wired into context for planning-layer markdown I/O. R5: createApp builds ctx when appRt present; sets c.set('ctx', ctx) on /api/*; passes ctx into the oRPC handler context. R6: Remove the dead @gobing-ai/ts-db declaration from apps/server/package.json — DbAdapter type comes via @gobing-ai/spur-domain; no direct ts-db import in apps/server. R7: ContextVariableMap gains ctx: ServerContext. R8: ZERO platform-detection code in apps/server (invariant #9). R9: ServerContext tests with in-memory SQLite (:memory:) + fresh adapter per test; coverage >=90%. GATED on ts-libs 0037 released + consumed.


### Q&A



### Design


Authority: design §2.1.1 (runtime adaptation is ts-runtime's job), §2.3 (ServerContext), §2.3.1 (D1
scoped out). ADR-021 (functionality in packages/app). Invariant #9 (platform divergence ONLY in
ts-runtime). **GATED on ts-libs task 0037 released + consumed.**

**Pattern mirror:** `apps/cli/src/context.ts` `CliContext` is the template — lazy service accessors
(`agentService()`, `ruleService()`), `fs` cwd-bound via `createNodeFileSystem(cwd)`, services built
from the runtime's `db`/`events`/`logger`. `ServerContext` is the server analogue.

**Shape (design §2.3):**
```typescript
// apps/server/src/context.ts
export interface ServerContext {
  cwd: string;
  fs: FileSystem;                       // from @gobing-ai/ts-runtime
  webDistPath?: string;                 // for S5 static serving (from config.server.webDistPath)
  getDb(): Promise<DbAdapter>;          // DbAdapter type via @gobing-ai/spur-domain (NOT direct ts-db)
  taskService(): TaskService;
  featureService(): FeatureService;
  eventBus(): EventBus<PlanningEventMap>; // wired in 0074; declare the accessor here
  // Future: workflowService/ruleService/agentService/historyService/teamService
}
export function createServerContext(appRt: ApplicationRuntime, options: { cwd: string; fs?: FileSystem; webDistPath?: string }): ServerContext;
```

**Lazy + cached:** services init on first accessor call, cached for the process/isolate (same as
CliContext). Lazy DB means a misconfigured path surfaces on first API call, not at startup (design §2.3).

**DB wiring — THE critical seam (design §2.3, §2.1.1):**
- `getDb()` calls `RuntimeFactory.createDbAdapter(dbConfig)` from `@gobing-ai/ts-runtime` (the method
  added by ts-libs 0037), then applies Spur's migration SQL (`CLI_SCHEMA_SQL` from
  `packages/domain/src/migrations.ts`) — i.e. the connection comes from ts-runtime, the SCHEMA stays
  Spur's (mirrors today's `createMigratedDb` split: ts-db opens, Spur migrates). Cache the migrated
  adapter.
- `loadRuntimeFactory()` auto-selects node-bun vs cloudflare-workers; `apps/server` does NOT detect the
  platform (invariant #9). On the Worker path, `createDbAdapter` throws `D1NotConfiguredError` until D1
  ships — `getDb()` propagates it (the /health/ready + task/feature routes surface a clear typed failure;
  the Worker runs health + OpenAPI only this round, design §2.3.1).
- `DbAdapter` TYPE comes through `@gobing-ai/spur-domain` (it re-exports `DbAdapter` from ts-db);
  `apps/server` imports NO `@gobing-ai/ts-db` directly. **Remove the dead `@gobing-ai/ts-db` dependency
  from `apps/server/package.json`** (it has zero ts-db imports today — confirmed).

**FileSystem wiring:** `fs = options.fs ?? factory.createFileSystem()` cwd-bound; the planning services
(TaskService/FeatureService over PlanningWriteService) need it for markdown I/O.

**createApp integration (design §2.3):** build `ctx = appRt ? createServerContext(appRt, { cwd, fs, webDistPath }) : undefined`; the `contextInjector` middleware (0072) sets `c.set('ctx', ctx)`; the
oRPC handler context gains `ctx` so handlers (S3/0078) read `c.get('ctx')`. Extend `ContextVariableMap`
with `ctx: ServerContext`.

**Finishes the 0072 seam:** `/api/health/ready` DB probe = `await ctx.getDb()` then `SELECT 1` -> 200/503.

**Service method ground-truth (verified — DO NOT invent):** `TaskService`: `list(filters?)` /
`show(wbs)` / `create(params)` / `updateStatus(wbs,toStatus,actor?)` / `batchCreate(jsonPath)` /
`resolve(filePath)`. `FeatureService`: `list()` / `show(id)` / `create(name,parentId?)` /
`update(id,key,value)` / `refresh()` / `move(...)`. Both exported from `@gobing-ai/spur-app`.

**Out of scope:** EventBus/JobQueue/Scheduler bodies (0074 — declare the `eventBus()` accessor here, wire
in 0074), domain module handlers (0078), contracts (0077).




> **AMENDMENT (2026-06-15, ts-libs 0037 RELEASED as `@gobing-ai/ts-runtime@0.3.19`, consumed via
> catalog bump + `bun install`; gate green). Ground-truth corrections to the Design above:**
>
> 1. **Prerequisite is MET.** The catalog is `^0.3.19`; all 7 workspaces typecheck + test green with
>    the new API. This task is UNGATED — start when S1 sequencing allows.
> 2. **Factory return type is `RuntimeDbAdapter`, not `DbAdapter`.** Shipped:
>    `createDbAdapter(config: DatabaseConfig): Promise<RuntimeDbAdapter>` where
>    `DatabaseConfig = { url; driver?; d1Binding? }` and `RuntimeDbAdapter` is the structural subset
>    `{ exec, run, queryFirst, queryAll, close }`. A ts-db `DbAdapter` **is assignable to** it
>    (verified: ts-db `DbAdapter` public surface = the same 5 methods). `D1NotConfiguredError` +
>    `hasSqlDatabase` are exported from `@gobing-ai/ts-runtime`.
> 3. **`ServerContext.getDb()` returns the WIDE `DbAdapter`** (from `@gobing-ai/spur-domain`), because
>    `TaskService`/`FeatureService` (over `BaseDao`) need the full ts-db adapter. Do NOT type `getDb()`
>    as `RuntimeDbAdapter` (too narrow for the DAOs).
> 4. **DO NOT reimplement DB wiring in `apps/server`. Add a domain helper instead.**
>    `packages/domain/src/db.ts` already has `createMigratedDb({url})` = ts-db `createDbAdapter({driver:'bun-sqlite',url})`
>    + `applyCliMigrations(adapter)` (CLI/Bun-only). Add a sibling **`createMigratedDbViaRuntime(config: DatabaseConfig)`**
>    that calls `loadRuntimeFactory().createDbAdapter(config)` (platform-selected: Bun real adapter; CF
>    throws `D1NotConfiguredError`), then `applyCliMigrations`, then returns the value widened back to
>    `DbAdapter` (a checked cast lives HERE in spur-domain, documented — never in apps/server). The
>    runtime owns *connection + platform select*; spur-domain owns *schema migration + the widening
>    cast*; `apps/server` imports neither ts-db nor `loadRuntimeFactory` (invariant #9 stays intact).
> 5. `ServerContext.getDb()` = `await createMigratedDbViaRuntime({ url: dbUrl })`, cached. The
>    `/health/ready` probe (`SELECT 1`) and the task/feature handlers consume this. On the Worker path,
>    `getDb()` propagates `D1NotConfiguredError` (Worker runs health + OpenAPI only this round).
> 6. **`CLI_SCHEMA_SQL` is applied via the existing `applyCliMigrations(adapter)`** (the helper
>    `createMigratedDb` already uses) — reuse it; do not hand-roll schema application.


### Solution



### Plan


- [x] PREREQUISITE MET: ts-libs 0037 released as `@gobing-ai/ts-runtime@0.3.19`; catalog bumped to `^0.3.19`; `bun install` done; gate green (lint + test). UNGATED.
- [ ] Add `createMigratedDbViaRuntime(config: DatabaseConfig)` to `packages/domain/src/db.ts` (sibling of `createMigratedDb`): `loadRuntimeFactory().createDbAdapter(config)` -> `applyCliMigrations(adapter)` -> return widened to `DbAdapter` (the structural->DbAdapter cast lives HERE, documented; ts-db `DbAdapter` is assignable from `RuntimeDbAdapter`). Export it from `@gobing-ai/spur-domain`.
- [ ] Create `apps/server/src/context.ts`: `ServerContext` interface + `createServerContext(appRt, options)` (mirror `apps/cli/src/context.ts`).
- [ ] Lazy service accessors `taskService()` / `featureService()` building from `appRt.db`/`appRt.events`/`appRt.logger` + `fs`; cache instances.
- [ ] `fs`: `options.fs ?? loadRuntimeFactory()...createFileSystem()`, cwd-bound (`createNodeFileSystem(cwd)` pattern).
- [ ] `getDb(): Promise<DbAdapter>` (WIDE ts-db DbAdapter via spur-domain — NOT RuntimeDbAdapter): `await createMigratedDbViaRuntime({ url: dbUrl })`, cached. apps/server imports neither ts-db nor loadRuntimeFactory (invariant #9). Worker path propagates `D1NotConfiguredError`.
- [ ] Declare `eventBus(): EventBus<PlanningEventMap>` accessor (body wired in 0074; can return `appRt.events` typed now).
- [ ] Remove `@gobing-ai/ts-db` from `apps/server/package.json` deps; ensure `DbAdapter` type imports come via `@gobing-ai/spur-domain`.
- [ ] Extend `ContextVariableMap` with `ctx: ServerContext`.
- [ ] `bootstrap.ts createApp`: build `ctx` when `appRt` present; ensure `contextInjector` (0072) sets it; pass `ctx` into the oRPC handler `context`.
- [ ] Finish `GET /api/health/ready`: `await ctx.getDb()` + `SELECT 1` -> 200; on throw/unreachable -> 503 (closes the 0072 seam).
- [ ] Tests (in-memory SQLite `:memory:`, fresh adapter per test): `createServerContext` builds; `getDb()` returns a migrated adapter usable for a known query; services are the same instance across calls; `/health/ready` 200 when DB up, 503 when down; assert NO platform-detection code in apps/server (grep `isCloudflare`/`c.env`/`navigator.userAgent` in app code = none).
- [ ] Gate: `bun run lint` + `test` + `test-cf` + `build`; coverage >=90%.
- [ ] Note: 0074 fills `eventBus()`/jobqueue/scheduler; 0078 consumes `taskService()`/`featureService()` via `c.get('ctx')`.




### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


### History

