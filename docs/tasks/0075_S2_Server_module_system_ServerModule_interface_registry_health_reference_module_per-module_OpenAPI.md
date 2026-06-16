---
schema_version: 1
name: "S2: Server module system — ServerModule, registry, health reference module"
status: done
type: task
feature_id: S2
priority: P1
tags: ["server-side-adjustment","wave-S0","group-S"]
created_at: 2026-06-15T16:01:46.303Z
updated_at: 2026-06-15T16:01:46.303Z
---

## 0075. "S2: Server module system — ServerModule interface, registry, health reference module, per-module OpenAPI"

### Background

Establish the ServerModule interface — the standard contract for adding a new API domain (task, feature, workflow, rule, agent, history, team all follow it). Mirrors how apps/cli registers register<Noun>Command(program, context). createApp iterates registered modules; no domain code touches createApp directly. Each module IS an oRPC router sub-tree merged into the single global handler — one oRPC dispatch, one contract merge, one OpenAPI document. The existing health endpoint is migrated to this pattern as the reference module that proves it. Anchors: design §2.4, §6 (manifest reserved, not implemented).


### Requirements

## Requirements

- [x] **R1**: ServerModule interface `{ name; mount(app, ctx); middleware? }` → **MET** | Evidence: `apps/server/src/modules/types.ts:13` + `tests/modules/types.test.ts:5`
- [x] **R2**: `builtins` (health first) + fail-fast `registerModules` → **MET** | Evidence: `apps/server/src/modules/registry.ts:16,25` + `tests/modules/registry.test.ts:14` (asserts exact `Failed to mount server module '<name>'` message)
- [x] **R3**: `createApp` calls `registerModules` after pipeline + before `/api/*` → **MET** | Evidence: `apps/server/src/bootstrap.ts:71`
- [x] **R4**: health migrated to `healthModule`; contract stays global → **MET** | Evidence: `apps/server/src/modules/health/index.ts:16` + `packages/contracts/src/index.ts:17`
- [x] **R5**: per-module OpenAPI auto-merge; `/openapi.json` reflects modules → **MET** | Evidence: `apps/server/src/openapi.ts:13` + `tests/app.test.ts:20` (asserts `/health` path)
- [x] **R6**: module isolation (invariant #8) → **MET** | Evidence: `health/index.ts:19` mounts only own routes; no module writes the shared pipeline
- [x] **R7**: tests (custom module reachable, health via interface, OpenAPI paths, throwing built-in aborts, ≥90% cov) → **MET** | Evidence: `tests/modules/*.test.ts`; coverage registry 100%/100%, health 100%/96%


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

## Review — 2026-06-15

**Status:** 1 finding (P4 only)
**Scope:** apps/server/src/modules/{types,registry,health/index}.ts + bootstrap.ts seam
**Mode:** verify (Phase 7 SECU + Phase 8 traceability)
**Channel:** inline (current)
**Gate:** `bun run lint` → pass · 29 module/app/context tests pass · coverage: registry 100%/100%, health 100%/96%
**Verdict:** PASS

### P1 — Blockers
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| — | none | — | — | — |

### P2 — Warnings
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| — | none | — | — | — |

### P3 — Info
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| — | none | — | — | — |

### P4 — Suggestions
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | JSDoc tense typo ("contributed" → "contributes") | Usability | apps/server/src/modules/types.ts:8 | Present tense for module-behavior description |

**Fix-pass 2026-06-15:** 1 fixed (P4 doc typo at types.ts:8), 0 failed, 0 skipped. Gate re-run clean.


### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


