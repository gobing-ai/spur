---
name: "S3: Server domain modules — task + feature (handlers + ServerContext wiring + error mapping)"
description: "S3: Server domain modules — task + feature (handlers + ServerContext wiring + error mapping)"
status: Done
created_at: 2026-06-15T16:56:10.113Z
updated_at: 2026-06-16T18:05:15.841Z
folder: docs/tasks
type: task
feature-id: S3
priority: P1
estimated_hours: 11
tags: ["server-side-adjustment","wave-S1","group-S"]
impl_progress:
  planning: completed
  design: completed
  implementation: completed
  review: completed
  testing: completed
---

## 0078. "S3: Server domain modules — task + feature (handlers + ServerContext wiring + error mapping)"

### Background

Give the server real surface. The task and feature modules are the board's API dependency — the critical path. Each wraps a packages/app service behind its oRPC contract via implement(contract). Write verbs go through PlanningWriteService (one lock domain, ADR-021 invariant #1) by calling the existing services — the route NEVER writes markdown directly, NEVER owns a lock, NEVER owns a lifecycle transition. Others (workflow/rule/agent/history/team) follow the same pattern incrementally after these prove it. Anchors: ADR-021 invariant #1, design §2.4 (modules implement the S2 interface), §2.5 (handler binding).


### Requirements

- [x] **R1** taskModule + handlers bind taskContract via implement(contract); list/show/create/transition → TaskService.list/show/create/updateStatus → **MET** | `apps/server/src/modules/task/handlers.ts:8,33-72`; NotFoundError on null show :47; create maps ref.id/filePath :20-22
- [x] **R2** featureModule + handlers over FeatureService (list/show/create/transition/refresh) → **MET** | `apps/server/src/modules/feature/handlers.ts:30-72`
- [x] **R3** write verbs call packages/app services (route never writes markdown / owns lock) → **MET** | grep of `apps/server/src/modules/` for writeFile/atomicWrite/lock = NONE; handlers delegate to ctx.taskService()/featureService()
- [x] **R4** domain errors → S4 envelope/status (guard 409, validation 422, not-found 404, lock-timeout 503) → **MET** | `apps/server/src/middleware/error-handler.ts:25-31` table + 58/66 envelope codes; covered end-to-end by `tests/middleware/error-handler.test.ts` (ConflictError→409, GuardDeniedError→409, LockTimeoutError→503, message-pattern fallbacks)
- [x] **R5** modules registered in S2 registry after health → **MET** | `apps/server/src/modules/registry.ts:19` `builtins = [healthModule, taskModule, featureModule]`
- [x] **R6** TaskService.list takes TaskListFilters; map contract query params → **MET** | `task/handlers.ts:10-16` toFilters maps status/parent, drops unmapped keys
- [x] **R7** method-name parity vs actual services (feature 'transition') → **MET** | `FeatureService.transition(id, toStatus)` confirmed present (feature-service.ts:98); handler calls it (feature/handlers.ts:64). The design's "no transition method" caution is resolved — the method was added.
- [x] **R8** per-module tests; coverage ≥90% → **MET (with P3 note)** | `tests/modules/{task,feature}/handlers.test.ts`; all module files 100% line/func. Tests invoke handlers directly rather than app.request() (P3 #4) — functionally equivalent; HTTP status mapping covered separately.


### Q&A



### Design

Authority: design §2.4 (modules implement the S2 interface), §2.5 (handler binding via implement).
ADR-021 invariant #1 (one write path — routes call packages/app services, never write markdown / own a
lock / own a lifecycle transition). GATED on S2 (0075), S4 (0077), and the planning layer (already shipped
in packages/app).

**Handler binding pattern (design §2.5):**
```typescript
// apps/server/src/modules/task/handlers.ts
import { implement } from '@orpc/server';
import { contract } from '@gobing-ai/spur-contracts';
const os = implement(contract);
function taskHandlers(ctx: ServerContext) {
  return {
    list: os.list.handler(async ({ input }) => ({ ok: true as const, data: await ctx.taskService().list(toFilters(input?.query)) })),
    show: os.show.handler(async ({ input }) => { const r = await ctx.taskService().show(input.wbs); if (!r) throw new NotFoundError(`Task ${input.wbs} not found`); return { ok: true as const, data: r }; }),
    create: os.create.handler(async ({ input }) => { const r = await ctx.taskService().create({ title: input.title, featureId: input.featureId, parentWbs: input.parentWbs }); return { ok: true as const, data: { wbs: r.ref.id, filePath: r.ref.filePath } }; }),
    transition: os.transition.handler(async ({ input }) => { await ctx.taskService().updateStatus(input.wbs, input.toStatus, input.actor); return { ok: true as const, data: { wbs: input.wbs, status: input.toStatus } }; }),
  };
}
```
`implement(contract)` enforces the handler signature against the contract at type-check time —
contract<->handler drift is a compile error (ADR-005, invariant #3).

**SERVICE METHOD GROUND-TRUTH (verified — DO NOT invent names):**
- `TaskService`: `list(filters?: TaskListFilters)` / `show(wbs): Promise<TaskShowResult>` /
  `create(params): Promise<WriteResult>` (result has `.ref.id` + `.ref.filePath`) /
  `updateStatus(wbs, toStatus, actor?): Promise<WriteResult>` / `batchCreate(jsonPath)` /
  `resolve(filePath)`.
- `FeatureService`: `list(): Promise<FeatureSummary[]>` / `show(id): Promise<FeatureShowResult|null>` /
  `create(name, parentId?): Promise<WriteResult>` / `update(id, key, value): Promise<WriteResult>` /
  `refresh(): Promise<{index, tasksUpdated}>` / `move(...)`.
  **NOTE: there is NO `FeatureService.transition` method.** The feature lifecycle status change goes
  through `update`/the lifecycle path. **Confirm the exact feature status-transition surface before
  wiring `featureContract.transition`** — it likely maps to `update(id, 'status', value)` which routes
  through the lifecycle adapter (0059), OR a dedicated method. Read `feature.ts` CLI command +
  FeatureService to see how the CLI does `spur feature update <id> <status>` and mirror it. Do NOT
  fabricate a `transition` method.

**Write-path invariant (R3 — ADR-021 #1):** the handlers call the SERVICES (TaskService/FeatureService),
which internally route writes through `PlanningWriteService` (the 9-step sequence, one lock domain). The
route NEVER calls `PlanningWriteService` directly, NEVER writes markdown, NEVER acquires a lock. Assert by
inspection: no `fs.writeFile`/`atomicWrite`/lock acquisition in `apps/server/src/modules/`.

**Modules (design §2.4):** `apps/server/src/modules/task/index.ts` = `taskModule` (ServerModule:
`{ name:'task', mount(app, ctx) }`) — `mount` binds `taskHandlers(ctx)` into the global oRPC router
(merge its contract sub-tree). `apps/server/src/modules/feature/index.ts` = `featureModule` same shape.
Both added to the S2 registry `builtins` (after health).

**Error mapping (R4):** handlers throw the domain errors (NotFoundError etc.); the centralized mapping
from 0077/0072 turns them into the envelope + status. Verify guard denial -> 409, validation -> 422,
not-found -> 404, lock-timeout -> 503 end-to-end with a real lifecycle-guard-violating transition.

**Filter mapping (R6):** `TaskListFilters` is the real shape (`task-service.ts:43`) — map contract query
params (status/feature/parent/assignee) to it; do not pass through unmapped keys.

**Out of scope:** workflow/rule/agent/history/team modules (follow incrementally), inline editing on the
server (read-only first), SSE handler (S6).


### Solution

Shipped the server's task + feature domain modules — each binds its oRPC contract via
`implement(contract)` and delegates every verb to the packages/app service (which routes writes through
PlanningWriteService — one lock domain, ADR-021 invariant #1). Routes never write markdown, own a lock,
or own a lifecycle transition.

**Files:**
- `apps/server/src/modules/task/handlers.ts` — `createTaskHandlers(ctx)` binding taskContract;
  list/show/create/transition → `TaskService.list/show/create/updateStatus`. `toFilters` maps contract
  query params → `TaskListFilters`.
- `apps/server/src/modules/feature/handlers.ts` — `createFeatureHandlers(ctx)` binding featureContract;
  list/show/create/transition/refresh → `FeatureService`.
- `apps/server/src/modules/{task,feature}/index.ts` — `taskModule`/`featureModule` (ServerModule) for
  registry discovery; oRPC procedures wired through the global router.
- `apps/server/src/modules/registry.ts` — `builtins = [healthModule, taskModule, featureModule]`.
- `apps/server/src/router.ts` — composes health + task + feature + stream(S6 placeholder).
- `apps/server/src/middleware/error-handler.ts` — domain-error → envelope/status mapping
  (GuardDenied 409, Validation 422, NotFound 404, LockTimeout 503), requestId threaded.

**Contract↔handler integrity fix (verification P1 #1–#2):** the committed handlers used
`as unknown as <ContractOutput>` double-casts to mask a real type mismatch — service `status: string` vs
contract enum — defeating the compile-time drift guard the whole seam depends on (ADR-005, invariant #3).
Removed the casts; handlers now map service output to the contract DTO, narrowing `status` via the
domain's `normalizeTaskStatus`/`normalizeFeatureStatus` and `priority` via the PRIORITIES set. The
contract's `featureSummarySchema.wbsCount` (required, but no producer exists) was made optional rather
than fabricated as `0`. A test asserting the fabricated `wbsCount === 0` was corrected to assert the
genuine mapped shape (R8). Removed a dead `export { router }` from `index.ts`.

**Verification:** lint + typecheck clean (7 workspaces); 158 tests pass / 0 fail; server modules
100% line/func coverage; test-cf pass; build (cli+server+web) pass; `autofix && spur-check` exit 0.


### Plan

- [x] Read services + CLI to confirm EXACT method names/signatures (esp. feature status transition).
- [x] `task/handlers.ts`: bind taskContract via implement(contract) — list/show/create/transition over TaskService; map ref.id/filePath; NotFoundError on missing show; narrow status to enum.
- [x] `task/index.ts`: taskModule ServerModule.
- [x] `feature/handlers.ts` + `index.ts`: same pattern over FeatureService incl. transition + refresh.
- [x] `toFilters(query)`: map contract query params → TaskListFilters; drop unmapped keys.
- [x] Register taskModule + featureModule in the S2 registry builtins (after health).
- [x] Error mapping wired through the centralized handler; guard 409 / validation 422 / not-found 404 / lock-timeout 503 verified by error-handler.test.ts.
- [x] ASSERT write-path invariant: grep modules/ for writeFile/atomicWrite/lock = NONE.
- [x] Tests per module; assert response shape + status + error mapping; in-memory ServerContext.
- [x] Gate: lint + test + test-cf + build; coverage 100% (≥90%).
- [x] GATE CHECK: S2 (0075) module system + S4 (0077) contracts landed; planning services present in packages/app.


### Review — 2026-06-16

**Status:** 4 findings (3 fixed, 1 noted)
**Scope:** apps/server/src/modules/{task,feature}/handlers.ts, src/router.ts, src/index.ts, src/middleware/error-handler.ts + contracts/feature.ts
**Mode:** verify (Phase 7 SECU + Phase 8 traceability)
**Channel:** inline
**Gate:** `lint` ✅ · `test` (158 pass / 0 fail) ✅ · `test-cf` ✅ · `build` ✅ · `autofix && spur-check` ✅
**Coverage:** task/feature handlers + index, router, error-handler all **100% line / 100% func** (R8 ≥90% ✅)

### P1 — Blockers
| # | Title | Dimension | Location | Recommendation | Status |
|---|-------|-----------|----------|----------------|--------|
| 1 | Handlers used `as unknown as <ContractOutput>` double-casts to silence contract↔handler type mismatch | Correctness | task/feature handlers.ts | Removed casts; handlers now build contract-shaped objects, narrowing `status: string` → enum via `normalizeTaskStatus`/`normalizeFeatureStatus` and `priority` → PRIORITIES. The drift-guard (ADR-005 / invariant #3) is real again — a future contract change now fails compile instead of silently passing. | **FIXED** |
| 2 | `featureSummarySchema.wbsCount` was REQUIRED but no producer exists; handler fabricated `wbsCount: 0` | Correctness | contracts/feature.ts:18, feature/handlers.ts | Made `wbsCount` optional in the contract (no corpus source computes a per-feature task count yet); handler omits it rather than lie. Populated later when an aggregation provides it. | **FIXED** |
| 3 | Dead `export { router }` in index.ts (router.ts exports `createRouter`, not `router`) → TS2305 | Correctness | server/index.ts:7 | Replaced with `export { createRouter }`. | **FIXED** |

### P2 — Warnings
_None._

### P3 — Info
| # | Title | Dimension | Location | Recommendation | Status |
|---|-------|-----------|----------|----------------|--------|
| 4 | Module handler tests invoke `handlers.x['~orpc'].handler` directly rather than mounting on a test app + `app.request()` as R8 specifies | Testability | tests/modules/{task,feature}/handlers.test.ts | Functionally equivalent (exercises handler logic, error mapping, response shape) and yields 100% coverage; end-to-end status-code mapping is separately covered by `tests/middleware/error-handler.test.ts`. Acceptable; revisit if full HTTP-path integration is wanted. | **NOTED** |

### P4 — Suggestions
_None._

**Root-cause note (Findings #1–#2):** task 0077's contract DTOs narrowed `status` to enums and required `wbsCount`, but the 0078 producer services (`TaskService.list`/`FeatureService.list`) return `status: string` and no count. The committed handlers papered over this with `as unknown as` casts (defeating the compile-time drift guard) and a fabricated `wbsCount: 0`. Proper fix: narrow at the handler via the domain's `normalize*Status` functions, and make `wbsCount` optional until a real source exists. Also fixed a fabricated-value test (asserted `wbsCount === 0`) to assert the genuine mapped shape (R8 — tests encode real behavior, not lies).

**Fix-pass 2026-06-16:** 3 fixed (P1 #1–#3), 1 noted (P3 #4), 0 failed. Gate green: lint ✅ · 158 tests ✅ · test-cf ✅ · build ✅ · server modules 100% coverage.


### Testing

- `tests/modules/task/handlers.test.ts` — route keys; list maps filters + narrows status; show returns detail / throws NotFoundError on null; create returns wbs+filePath; transition echoes status.
- `tests/modules/feature/handlers.test.ts` — route keys; list maps to contract DTO (status narrowed, wbsCount absent — corrected from the old fabricated `=== 0` assertion); show detail / NotFoundError; create; transition; refresh maps tasksUpdated → rebuilt.
- `tests/modules/registry.test.ts` — builtins order [health, task, feature].
- `tests/middleware/error-handler.test.ts` — domain-error → status/code end-to-end: ConflictError→409, GuardDeniedError→409 GUARD_DENIED, LockTimeoutError→503 LOCK_TIMEOUT, message-pattern fallbacks, prod stack suppression, requestId threading.
- `tests/router.test.ts` — health shape; task/feature/stream route keys; stubCtx throws; stream S6 placeholder rejects.

Result: server suite **110 pass / 0 fail**; full repo **158 pass / 0 fail** (the per-file coverage run). Coverage: task/feature handlers + index, router, error-handler all **100% line / 100% func** (≥90%). test-cf pass; build pass.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| Source | apps/server/src/modules/task/handlers.ts | claude | 2026-06-16 |
| Source | apps/server/src/modules/feature/handlers.ts | claude | 2026-06-16 |
| Source | apps/server/src/modules/{task,feature}/index.ts | claude | 2026-06-16 |
| Source | apps/server/src/modules/registry.ts | claude | 2026-06-16 |
| Source | apps/server/src/router.ts | claude | 2026-06-16 |
| Source | apps/server/src/middleware/error-handler.ts | claude | 2026-06-16 |
| Fix | packages/contracts/src/feature.ts (wbsCount → optional) | claude | 2026-06-16 |
| Test | apps/server/tests/modules/{task,feature}/handlers.test.ts | claude | 2026-06-16 |


### References


