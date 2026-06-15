---
name: "S2: Server module system — ServerModule interface, registry, health reference module, per-module OpenAPI"
description: "S2: Server module system — ServerModule interface, registry, health reference module, per-module OpenAPI"
status: Backlog
created_at: 2026-06-15T16:01:46.303Z
updated_at: 2026-06-15T16:01:46.303Z
folder: docs/tasks
type: task
feature-id: S2
priority: P1
estimated_hours: 8
tags: ["server-side-adjustment","wave-S0","group-S"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0075. "S2: Server module system — ServerModule interface, registry, health reference module, per-module OpenAPI"

### Background

Establish the ServerModule interface — the standard contract for adding a new API domain (task, feature, workflow, rule, agent, history, team all follow it). Mirrors how apps/cli registers register<Noun>Command(program, context). createApp iterates registered modules; no domain code touches createApp directly. Each module IS an oRPC router sub-tree merged into the single global handler — one oRPC dispatch, one contract merge, one OpenAPI document. The existing health endpoint is migrated to this pattern as the reference module that proves it. Anchors: design §2.4, §6 (manifest reserved, not implemented).


### Requirements

R1: ServerModule interface in apps/server/src/modules/types.ts: { readonly name: string; mount(app: Hono, ctx: ServerContext | undefined): void; readonly middleware?: MiddlewareHandler[] }. R2: registry.ts — builtins array in deterministic order (health first); registerModules(app, ctx) iterates and mounts; built-ins are FAIL-FAST (a broken built-in aborts startup with 'Failed to mount server module <name>'). R3: createApp calls registerModules(app, ctx) after the shared middleware pipeline + oRPC handler mount. R4: health migrated to a healthModule ServerModule as the reference implementation (proves the registry pattern; health contract stays in the global contract). R5: per-module OpenAPI — generateOpenApiSpec merges all mounted modules' contract sub-trees automatically; GET /openapi.json reflects every mounted module with no manual path maintenance (assert in tests, extends the existing app.test.ts pattern). R6: Module isolation (invariant #8): a module's mount() mounts ONLY its own routes; never modifies another module's routes or the shared pipeline. R7: Tests: a test ServerModule registers and its routes are reachable; health module serves via the interface; OpenAPI includes registered module paths; a throwing built-in aborts startup. Coverage >=90%. Module manifest YAML (design §6) is RESERVED, not implemented this round.


### Q&A



### Design

Authority: design §2.4 (Server module system), §6 (manifest reserved). Invariant #8 (module isolation).
Mirrors `apps/cli` `register<Noun>Command(program, context)`.

**Key design insight (design §2.4):** each module IS an oRPC router sub-tree. The module's `mount()`
does NOT add a separate fetch handler — the single global oRPC handler (`new OpenAPIHandler(router)` in
bootstrap.ts) serves all modules; a module contributes its contract sub-tree into the merged `router`.
This avoids per-module fetch handlers: one oRPC dispatch, one contract merge, one OpenAPI document.

**Interface (design §2.4):**
```typescript
// apps/server/src/modules/types.ts
export interface ServerModule {
  readonly name: string;                                   // 'health' | 'task' | 'feature' | ...
  mount(app: Hono, ctx: ServerContext | undefined): void;  // mount routes/middleware after the shared pipeline
  readonly middleware?: MiddlewareHandler[];               // optional module-scoped middleware
}
```

**Registry (design §2.4):**
```typescript
// apps/server/src/modules/registry.ts
const builtins: ServerModule[] = [ healthModule /*, taskModule (0078), featureModule (0078) */ ];
export function registerModules(app: Hono, ctx: ServerContext | undefined): void {
  for (const mod of builtins) {
    try { mod.mount(app, ctx); }
    catch (err) { throw new Error(`Failed to mount server module '${mod.name}': ${String(err)}`); }
  }
}
```
Built-ins are FAIL-FAST — a broken built-in aborts startup (a broken core module must never serve a
half-mounted API). Deterministic order (health first). No module depends on another being mounted first
(each self-contained — risk "registry order dependencies" mitigated).

**createApp integration (design §2.4):** after the shared middleware pipeline (0072) + the oRPC handler
mount, call `registerModules(app, ctx)`. The current `createApp` flow becomes: middleware ->
`/openapi.json` -> build `ctx` -> `/api/*` oRPC mount -> `registerModules(app, ctx)` -> (S5 static) ->
`/` redirect + notFound.

**Health as the reference module (design §2.4 — the S2 proof):**
```typescript
// apps/server/src/modules/health/index.ts
export const healthModule: ServerModule = {
  name: 'health',
  mount(_app, _ctx) { /* health is in the global contract; the enhanced health/ready (0072/0073) updates the contract. This module exists to prove the registry pattern. */ },
};
```
The existing health endpoint is migrated to register THROUGH this interface (finalized S2 AC: "the health
module was registered through the same interface as all other modules").

**Per-module OpenAPI (design §2.4):** each module's contract sub-tree merges into the composed `contract`
(packages/contracts/src/index.ts); `generateOpenApiSpec` (already in apps/server/src/openapi.ts) reflects
all mounted modules with NO manual path maintenance. Assert via the existing `app.test.ts` OpenAPI
pattern (it already checks `/openapi.json` includes expected paths).

**Module manifest YAML (design §6):** RESERVED, NOT implemented this round. The code-based registry
suffices; the manifest is noted so the interface design doesn't preclude it.

**Out of scope:** the task/feature modules themselves (0078 — they IMPLEMENT this interface), web module
system (W2/0083 — different interface).


### Solution



### Plan

- [ ] `apps/server/src/modules/types.ts`: `ServerModule` interface `{ name; mount(app, ctx); middleware? }`.
- [ ] `apps/server/src/modules/registry.ts`: `builtins` array (health first) + `registerModules(app, ctx)` with fail-fast try/catch wrapping each `mount()`.
- [ ] `apps/server/src/modules/health/index.ts`: `healthModule` ServerModule (reference); migrate the existing health endpoint to register through the interface (health contract stays in the global contract).
- [ ] `bootstrap.ts createApp`: call `registerModules(app, ctx)` after the shared pipeline + oRPC mount; keep `/openapi.json`, `/`, notFound.
- [ ] Confirm `generateOpenApiSpec` reflects mounted modules' contract sub-trees automatically (no manual path list).
- [ ] Tests: a test ServerModule mounts + its route is reachable via `app.request()`; health serves via the interface; `/openapi.json` includes registered module paths (extend existing app.test.ts); a throwing built-in `mount()` aborts startup with the `Failed to mount server module '<name>'` message; module isolation — module A's mount doesn't touch B's routes or the shared pipeline.
- [ ] Gate: `bun run lint` + `test` + `test-cf` + `build`; coverage >=90%.
- [ ] Note: module manifest YAML (design §6) is RESERVED — do NOT implement. 0078 adds taskModule/featureModule into the builtins array.


### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


