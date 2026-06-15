---
name: "S3: Server domain modules — task + feature (handlers + ServerContext wiring + error mapping)"
description: "S3: Server domain modules — task + feature (handlers + ServerContext wiring + error mapping)"
status: Backlog
created_at: 2026-06-15T16:56:10.113Z
updated_at: 2026-06-15T16:56:10.113Z
folder: docs/tasks
type: task
feature-id: S3
priority: P1
estimated_hours: 11
tags: ["server-side-adjustment","wave-S1","group-S"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0078. "S3: Server domain modules — task + feature (handlers + ServerContext wiring + error mapping)"

### Background

Give the server real surface. The task and feature modules are the board's API dependency — the critical path. Each wraps a packages/app service behind its oRPC contract via implement(contract). Write verbs go through PlanningWriteService (one lock domain, ADR-021 invariant #1) by calling the existing services — the route NEVER writes markdown directly, NEVER owns a lock, NEVER owns a lifecycle transition. Others (workflow/rule/agent/history/team) follow the same pattern incrementally after these prove it. Anchors: ADR-021 invariant #1, design §2.4 (modules implement the S2 interface), §2.5 (handler binding).


### Requirements

R1: apps/server/src/modules/task/ — taskModule (ServerModule) + handlers.ts binding taskContract via const os = implement(contract). list->TaskService.list; show->TaskService.show (NotFoundError when null); create->TaskService.create (maps result.ref.id/filePath); transition->TaskService.updateStatus(wbs,toStatus,actor). R2: apps/server/src/modules/feature/ — featureModule + handlers over FeatureService (list/show/create/transition/refresh) same pattern. R3: Write verbs call the packages/app services (which route through PlanningWriteService) — assert no route writes markdown directly (invariant #1). R4: Handlers map domain errors to the S4 envelope/status codes (guard denial 409, validation 422, not-found 404, lock-timeout 503). R5: Modules registered in the S2 registry (after health). R6: TaskService.list takes TaskListFilters; map contract query params -> TaskListFilters. R7: Verify method-name parity against the ACTUAL services: TaskService has list/show/create/updateStatus/batchCreate/resolve; FeatureService has list/show/create/update/refresh/move (NOTE feature 'transition' = the lifecycle update path; confirm the exact method before wiring). R8: Tests per module: mount on a test app, call via app.request(), assert response shape + status + error mapping; in-memory SQLite ServerContext. Coverage >=90%. GATED on S2 (module system), S4 (contracts), and the planning layer in packages/app (already shipped: TaskService/FeatureService/PlanningWriteService).


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



### Plan

- [ ] Read `apps/cli/src/commands/task.ts` + `feature.ts` and the services to confirm EXACT method names/signatures + how the CLI does status transitions (esp. feature — NO FeatureService.transition exists; mirror `spur feature update <id> <status>`).
- [ ] `apps/server/src/modules/task/handlers.ts`: bind `taskContract` via `implement(contract)` — list/show/create/transition over `TaskService` (list/show/create/updateStatus); map `result.ref.id`/`.filePath`; throw `NotFoundError` on missing show.
- [ ] `apps/server/src/modules/task/index.ts`: `taskModule` ServerModule mounting `taskHandlers(ctx)` into the global oRPC router.
- [ ] `apps/server/src/modules/feature/handlers.ts` + `index.ts`: same pattern over `FeatureService` (list/show/create/refresh + the confirmed status-transition path).
- [ ] `toFilters(query)` helper: map contract query params -> `TaskListFilters` (the real shape); drop unmapped keys.
- [ ] Register `taskModule` + `featureModule` in the S2 registry `builtins` (after health).
- [ ] Error mapping wired through 0077/0072 centralized handler; verify guard-denial 409 / validation 422 / not-found 404 / lock-timeout 503 end-to-end.
- [ ] ASSERT write-path invariant: grep `apps/server/src/modules/` for `fs.writeFile`/`atomicWrite`/lock acquisition = NONE (routes go through services only).
- [ ] Tests per module: mount on a test app, call via `app.request()` against an in-memory SQLite ServerContext; assert response shape + status + error mapping; a lifecycle-guard-violating transition returns 409 with the guard report; create returns wbs+filePath; list maps filters.
- [ ] Gate: `bun run lint` + `test` + `test-cf` + `build`; coverage >=90%.
- [ ] GATE CHECK: S2 (0075) module system + S4 (0077) contracts landed; planning layer (TaskService/FeatureService/PlanningWriteService) present in packages/app.


### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


