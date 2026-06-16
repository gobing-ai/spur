---
schema_version: 1
name: "S1: ServerContext service wiring + DB/FileSystem via ts-runtime"
status: done
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

1. **`packages/domain/src/db.ts` — `createMigratedDbViaRuntime(config)`** (the R3 seam): dynamically
   imports `loadRuntimeFactory()` from `@gobing-ai/ts-runtime`, calls `factory.createDbAdapter(config)`
   (platform-selected: Bun real adapter / CF throws `D1NotConfiguredError`), applies `applyCliMigrations`,
   and returns the value widened to the full ts-db `DbAdapter` (the structural→`DbAdapter` cast lives
   here, in spur-domain, documented). `createMigratedDb`'s ts-db import is lazy so the pure helpers stay
   Worker-safe. Plus `dbHealthCheck(db)` — a trivial `SELECT 1` liveness probe.
2. **`apps/server/src/context.ts` — `ServerContext` + `createServerContext(appRt, options)`**: lazy,
   cached accessors `getDb()` (→ `createMigratedDbViaRuntime`), `taskService()` / `featureService()`
   (built over `PlanningWriteService`, the one write path — ADR-021), `eventBus()` (returns
   `appRt.events`; body lands in 0074), and `checkDbHealth()` (readiness: `getDb()` + `dbHealthCheck`,
   error-swallowing → false). `fs` is cwd-bound, passed in by the caller.
3. **`apps/server/src/bootstrap.ts`**: `createApp(appRt, { fs, ctx })` injects `ServerContext` into
   `c.var.ctx` on `/api/*`; `ContextVariableMap` gains `ctx`. `/api/health/ready` calls
   `ctx.checkDbHealth()` → 200 connected / 503 unreachable; no `ctx` (CF path) → 503. **`bootstrap.ts`
   imports NO domain/app module** (Finding 1) — the readiness logic lives on `ServerContext`, so the
   Worker bundle never pulls `node:fs` from the domain barrel.
4. **`apps/server/src/index.ts`** (Bun entry): builds `fs = createNodeFileSystem(cwd)` + `ctx =
   createServerContext(appRt, { cwd, fs })` via dynamic import inside `start()`, passes `{ fs, ctx }` to
   `createApp`. No top-level platform code (invariant #9).
5. **R6:** removed the dead `@gobing-ai/ts-db` dependency from `apps/server/package.json`; the server's
   `DbAdapter` type comes via `@gobing-ai/spur-domain`; no direct ts-db import in `apps/server/src`.
6. **Tests:** domain `createMigratedDbViaRuntime` end-to-end (`:memory:`, real node-bun factory) +
   schema-parity vs `createMigratedDb`; `dbHealthCheck` true/false; server readiness 503/200-connected;
   CF Worker fetch entrypoint (regression guard). Gate: `bun run lint` + `test` + `test-cf` + `build`,
   per-file ≥90%.
7. **Consumes ts-libs 0037** (`@gobing-ai/ts-runtime@0.3.19`) via the catalog bump (prerequisite met).


### Plan



- [x] PREREQUISITE MET: ts-libs 0037 released as `@gobing-ai/ts-runtime@0.3.19`; catalog bumped to `^0.3.19`; `bun install` done; gate green (lint + test). UNGATED.
- [x] Add `createMigratedDbViaRuntime(config: DatabaseConfig)` to `packages/domain/src/db.ts` (sibling of `createMigratedDb`): `loadRuntimeFactory().createDbAdapter(config)` -> `applyCliMigrations(adapter)` -> return widened to `DbAdapter` (the structural->DbAdapter cast lives HERE, documented; ts-db `DbAdapter` is assignable from `RuntimeDbAdapter`). Export it from `@gobing-ai/spur-domain`.
- [x] Create `apps/server/src/context.ts`: `ServerContext` interface + `createServerContext(appRt, options)` (mirror `apps/cli/src/context.ts`).
- [x] Lazy service accessors `taskService()` / `featureService()` building from `appRt.db`/`appRt.events`/`appRt.logger` + `fs`; cache instances.
- [x] `fs`: `options.fs ?? loadRuntimeFactory()...createFileSystem()`, cwd-bound (`createNodeFileSystem(cwd)` pattern).
- [x] `getDb(): Promise<DbAdapter>` (WIDE ts-db DbAdapter via spur-domain — NOT RuntimeDbAdapter): `await createMigratedDbViaRuntime({ url: dbUrl })`, cached. apps/server imports neither ts-db nor loadRuntimeFactory (invariant #9). Worker path propagates `D1NotConfiguredError`.
- [x] Declare `eventBus(): EventBus<PlanningEventMap>` accessor (body wired in 0074; can return `appRt.events` typed now).
- [x] Remove `@gobing-ai/ts-db` from `apps/server/package.json` deps; ensure `DbAdapter` type imports come via `@gobing-ai/spur-domain`.
- [x] Extend `ContextVariableMap` with `ctx: ServerContext`.
- [x] `bootstrap.ts createApp`: build `ctx` when `appRt` present; ensure `contextInjector` (0072) sets it; pass `ctx` into the oRPC handler `context`.
- [x] Finish `GET /api/health/ready`: `await ctx.getDb()` + `SELECT 1` -> 200; on throw/unreachable -> 503 (closes the 0072 seam).
- [x] Tests (in-memory SQLite `:memory:`, fresh adapter per test): `createServerContext` builds; `getDb()` returns a migrated adapter usable for a known query; services are the same instance across calls; `/health/ready` 200 when DB up, 503 when down; assert NO platform-detection code in apps/server (grep `isCloudflare`/`c.env`/`navigator.userAgent` in app code = none).
- [x] Gate: `bun run lint` + `test` + `test-cf` + `build`; coverage >=90%.
- [x] Note: 0074 fills `eventBus()`/jobqueue/scheduler; 0078 consumes `taskService()`/`featureService()` via `c.get('ctx')`.


### Review

**dev-verify verdict: PASS (after 2 fixes)** — Phase 7 SECU + Phase 8 traceability, `--fix all --force`, verified 2026-06-15 by claude-code.

Task 0073 was implemented (commit `375f1c7` + 3 fixes, shipped `status: done`). Re-verified under `--force`. Implementation present: `apps/server/src/context.ts` (`ServerContext` + `createServerContext`), `packages/domain/src/db.ts` (`createMigratedDbViaRuntime` + `dbHealthCheck`), `bootstrap.ts` ctx injection + real readiness probe, `index.ts` Bun-path ctx build. Verification found **2 issues (1 P1 shipped-regression, 1 P2 coverage) — both FIXED**.

**Phase 8 — Requirements traceability (9/9 MET):**

| Req | Verdict | Evidence |
|---|---|---|
| R1 ServerContext interface | ✅ MET | `context.ts:21-37` `{ cwd, fs, webDistPath?, getDb(), taskService(), featureService(), eventBus() }` + `checkDbHealth()` (added in fix). |
| R2 createServerContext, lazy+cached | ✅ MET | `context.ts:58-107` lazy caches `dbPromise`/`taskSvc`/`featureSvc`; mirrors CliContext. |
| R3 getDb via RuntimeFactory.createDbAdapter + migrate | ✅ MET | `context.ts:73-76` → `createMigratedDbViaRuntime` (`db.ts:28-34`): `loadRuntimeFactory().createDbAdapter(config)` + `applyCliMigrations` + documented widening cast. Consumes ts-runtime 0.3.19 (0037). |
| R4 FileSystem cwd-bound | ✅ MET | `index.ts:23` `createNodeFileSystem(process.cwd())` (dynamic import); `context.ts:60` stores `fs`. |
| R5 createApp builds + injects ctx | ✅ MET | `bootstrap.ts:57,68,100-103` `createApp(appRt, {fs,ctx})`; `c.set('ctx', ctx)` on `/api/*`. |
| R6 dead ts-db removed | ✅ MET | `apps/server/package.json` no longer declares `@gobing-ai/ts-db`; no direct ts-db import in `apps/server/src` (grep clean). DbAdapter type via spur-domain. |
| R7 ContextVariableMap gains ctx | ✅ MET | `bootstrap.ts:14-20` `ctx: ServerContext`. |
| R8 ZERO platform-detection in apps/server | ✅ MET | No `isCloudflare`/`c.env`/`navigator.userAgent`/`loadRuntimeFactory` in `apps/server/src`. Platform select lives in `createMigratedDbViaRuntime` (spur-domain) + the dynamic `createNodeFileSystem` import in the Bun entrypoint only. |
| R9 tests ≥90% | ✅ MET (after Finding 2 fix) | `context.ts` 100% line/97.96% func; `db.ts` 100%/100% (was 80%/72%); server 55 pass; domain 366 pass. |

**Phase 7 — SECU:**
- **S:** No secrets/injection. `getDb()` propagates `D1NotConfiguredError` on CF (typed, no silent undefined). `checkDbHealth()` swallows errors → 503 (correct for a readiness probe; no info leak).
- **C:** SECU-1 (P1) — shipped test-cf regression — found + fixed (see Findings). DB connection/schema split honored (runtime owns connection, domain owns migration + widening cast).
- **U:** Readiness 200 connected / 503 unreachable; clean.
- **E:** Lazy DB promise caches; no redundant connections.

**Gate (post-fix):** `bun run lint` clean (7 workspaces) · `bun run test` 1312/0 + 158/0 · **`bun run test-cf` 1/0 (regression fixed)** · `bun run build` all workspaces OK · `context.ts`/`db.ts` ≥90%.


### Findings (inline — no separate section in this template)

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | **Shipped test-cf regression (gate violation).** As committed (375f1c7), `bootstrap.ts` imported `dbHealthCheck` from the `@gobing-ai/spur-domain` barrel. `bootstrap.ts` is loaded by `worker.ts` (the Cloudflare entry), so the Worker bundle transitively pulled the domain barrel's static `node:fs` / `node:fs/promises` imports (`migrations.ts`, `planning/locks.ts`) → the Workers isolate crashed at module-init ("Worker exited unexpectedly"). `bun run test-cf` failed (exit 1) on the committed HEAD — verified by stashing all session changes and re-running. The task's own R-gate ("existing test-cf stays green", and verification gate #3) was violated at ship time. (Note: ts-db itself loads `bun:sqlite` LAZILY, so SQLite was NOT the cause — the Node-builtin static imports in the domain barrel were.) | Correctness/Security (C) | `bootstrap.ts:1` (import), reachable via `worker.ts`→`createApp` | **P1** | **FIXED 2026-06-15** — removed the domain import from `bootstrap.ts`; moved the readiness probe to `ServerContext.checkDbHealth()` (Bun-path-only context, which may import domain freely). The Worker path passes no `ctx` → readiness returns 503 → `bootstrap.ts` now has ZERO domain import → Worker bundle no longer pulls `node:fs`. Also made `createMigratedDb`'s ts-db import lazy (`db.ts`) as defense-in-depth. test-cf now passes (1/0). |
| 2 | **R9 coverage gap on the core deliverable.** `createMigratedDbViaRuntime` (`db.ts:28-34`) — the R3 deliverable — had NO direct test; `db.ts` sat at 80% line / 72% func (lines 28-32 uncovered), below the project per-file ≥90% standard (`bunfig.toml`). The only db.ts test covered `dbHealthCheck`. The function was exercised only INDIRECTLY via the server readiness test, so a regression in the runtime-factory wiring would not have been caught at the domain level. (The repo-aggregate gate passed, masking the per-file gap — the known Bun aggregate-vs-per-file behavior.) | Correctness (C) | `packages/domain/src/db.ts:28-34`, `packages/domain/tests/db.test.ts` | **P2** | **FIXED 2026-06-15** — added 2 domain tests: (a) `createMigratedDbViaRuntime({url:':memory:'})` end-to-end on the real node-bun factory (asserts healthCheck true + migrated tables exist), (b) parity test proving via-runtime and Bun-direct apply the identical CLI schema. `db.ts` now 100% line+func. |

No remaining P1/P2. Both findings were latent in the shipped 0073 and are now resolved; full gate green incl. test-cf.


### Testing

**Verified 2026-06-15 (dev-verify, post-fix — 2 findings resolved).**

- Command: `bun --cwd apps/server test --coverage` · `bun --cwd packages/domain test --coverage` ·
  `bun run test` · `bun run test-cf` · `bun run lint` · `bun run build`
- Scope: `ServerContext` (lazy/cached `getDb`, `taskService`, `featureService`, `eventBus`,
  `checkDbHealth`) · `createMigratedDbViaRuntime` end-to-end on the node-bun runtime factory + schema
  parity vs `createMigratedDb` · `dbHealthCheck` (true/false paths) · `/api/health/ready` (503 without
  ServerContext, 200 connected with DB) · createApp ctx injection · CF Worker fetch entrypoint
  (regression guard).
- Result: **server 55 pass / 0 fail**; **domain 366 pass / 0 fail**; all workspaces **1312 pass /
  0 fail**; plugins/sp **158 pass / 0 fail**; **test-cf 1 pass / 0 fail (regression fixed — was
  exit 1 at the committed HEAD)**.
- Coverage: `context.ts` 100% line / 97.96% func · `db.ts` 100% line+func (was 80%/72% — Finding 2) ·
  `bootstrap.ts` 100% line / 94.92% func. Per-file ≥90% standard met on all 0073 files.
- Evidence: `apps/server/tests/middleware/pipeline.test.ts` (health/ready 503+200 connected),
  `apps/server/tests/context*.test.ts`, `packages/domain/tests/db.test.ts` (createMigratedDbViaRuntime
  + parity + dbHealthCheck), `apps/server/tests/cf/worker-runtime.cf.ts` (Worker fetch, now passing).
- Gate: `bun run lint` clean (7 workspaces typecheck) · `bun run test` 1312/0 + 158/0 ·
  `bun run test-cf` 1/0 · `bun run build` CLI + server + web OK.
- Findings: 2 fixed (P1 test-cf Worker-crash regression from a domain barrel import in `bootstrap.ts`;
  P2 missing direct coverage of `createMigratedDbViaRuntime`). See Review § Findings.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References

- **Design:** `docs/design/server-side-adjustment-design.md` §2.1.1 (runtime adaptation is ts-runtime's
  job; enhance-first), §2.3 (ServerContext + getDb API note), §2.3.1 (D1 scoped out). Invariant #9
  (platform divergence only in ts-runtime).
- **Decisions:** ADR-005 (oRPC type seam), ADR-019 (two entries / one createApp core), ADR-021
  (functionality in `packages/app`; one write path).
- **Finalized scope:** `docs/design/server-side-adjustment-feature-finalized.md` — S1 (Server
  foundation), P1 prerequisite (ts-runtime DB seam, marked RELEASED).
- **Upstream prerequisite (consumed):** ts-libs task **0037** → `@gobing-ai/ts-runtime@0.3.19`
  (`RuntimeFactory.createDbAdapter`, `RuntimeCapabilities.hasSqlDatabase`, `D1NotConfiguredError`,
  `RuntimeDbAdapter` structural type). Catalog pinned `^0.3.19`.
- **Related Spur tasks:** 0072 (S1 middleware/shutdown/health — this task completes the `/health/ready`
  DB probe it stubbed); 0074 (S1 EventBus/JobQueue/Scheduler — fills the `eventBus()` accessor declared
  here); 0078 (S3 — consumes `taskService()`/`featureService()` via `c.get('ctx')`).
- **Key source:** `apps/server/src/context.ts`, `apps/server/src/bootstrap.ts`,
  `apps/server/src/index.ts`, `packages/domain/src/db.ts`.
- **CLI pattern mirrored:** `apps/cli/src/context.ts` (`CliContext` — the lazy-accessor template).


### History

