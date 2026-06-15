---
name: "W5: Web build integration — unified Vite dev server + dual production build modes"
description: "W5: Web build integration — unified Vite dev server + dual production build modes"
status: Backlog
created_at: 2026-06-15T16:56:35.825Z
updated_at: 2026-06-15T16:56:35.825Z
folder: docs/tasks
type: task
feature-id: W5
priority: P1
estimated_hours: 6
tags: ["server-side-adjustment","wave-W0","group-W"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0081. "W5: Web build integration — unified Vite dev server + dual production build modes"

### Background

Current friction: two dev servers (bun --hot apps/server :3000, astro dev :4321) with a Vite proxy in astro.config.mjs — CORS in dev, proxy drift, two processes. This task unifies dev via @hono/vite-dev-server (one process, one port, no proxy, no CORS-in-dev) and sets up dual production builds (Cloudflare Workers Static Assets default; local Hono serveStatic fallback) from the same source. Anchors: design §5.1, §5.2, risk item #2 (resolved).


### Requirements

R1: apps/server/vite.config.ts (NEW) with honoDevServer({ entry: 'src/worker.ts' }). R2: One orchestration so bun run dev serves BOTH /api/health and / (board) on ONE port with NO proxy and NO CORS-in-dev (root vite.config.ts orchestrating both apps, OR the server vite dev integrating Astro — pick the simplest that satisfies one-port/no-proxy; exact wiring is impl detail per design §5.1). R3: DROP the /api + /openapi.json proxy block from apps/web/astro.config.mjs. R4: Change apps/server dev script from 'bun --hot run src/index.ts' to 'vite'. R5: The standalone apps/server/src/index.ts entry REMAINS for the Bun-binary production path (spur serve, Docker) — Vite is dev-only. R6: Production: astro build outputs static files to dist/web; Cloudflare uses @hono/vite-build/cloudflare-workers for worker.ts + Workers Static Assets; local uses bun build --compile + Hono serveStatic. R7: Add @hono/vite-dev-server (dev), @hono/vite-build (server CF build) deps. R8: Verify: bun run dev one-port both-served; astro build produces dist/web; production build paths documented + smoke-built. R9: If unified dev proves fragile, the two-process fallback is dev-only and doesn't affect production — note this. GATED on W1 (stack).


### Q&A



### Design

Authority: design §5.1 (unified Vite dev server), §5.2 (production builds), risk item #2 (resolved).

**Current friction:** two dev servers (`bun --hot apps/server/src/index.ts` :3000; `astro dev` :4321)
+ a Vite proxy in astro.config.mjs (`/api` + `/openapi.json` -> :3000). CORS in dev, proxy drift, two
processes.

**Unified dev (design §5.1):** a single Vite dev server serves BOTH the Hono API and the Astro frontend
via `@hono/vite-dev-server` (Cloudflare-official). It intercepts API requests and routes them to the Hono
app in dev.
```typescript
// apps/server/vite.config.ts (NEW)
import { honoDevServer } from '@hono/vite-dev-server';
import { defineConfig } from 'vite';
export default defineConfig({ plugins: [ honoDevServer({ entry: 'src/worker.ts' }) ] });
```
**Monorepo wiring (design §5.1, risk #2):** one root-level orchestration via
`honoDevServer({ entry: 'apps/server/src/worker.ts' })` + Astro's Vite integration — OR the server vite
dev integrating the Astro frontend. The design CONSTRAINT (not the exact wiring) is binding: **one port,
one process, NO proxy, NO CORS-in-dev**. Pick the simplest wiring satisfying that; the exact orchestration
is an impl detail. Verify `bun run dev` serves both `/api/health` and `/` on one port.

**Existing-repo changes (design §5.1 / risk #2):**
1. DROP the `/api` + `/openapi.json` proxy block from `apps/web/astro.config.mjs` (the temporary one W1
   may have left).
2. Change `apps/server` dev script from `bun --hot run src/index.ts` to `vite`.
3. Add `apps/server/vite.config.ts` with `honoDevServer`.
The standalone `apps/server/src/index.ts` entry REMAINS for the Bun-binary production path (spur serve,
Docker) — Vite is dev-only; production builds do NOT involve Vite for the local-fallback path.

**Production builds (design §5.2):**
| Target | Server build | Web build | Deploy |
|---|---|---|---|
| Cloudflare (default) | `@hono/vite-build/cloudflare-workers` bundles `worker.ts` | `astro build` -> static `dist/web` | `wrangler deploy` from apps/server |
| Local (fallback) | `bun build --compile` (existing) | `astro build` -> static (served by Hono serveStatic, S5) | `spur serve` / run binary |
`apps/server/wrangler.toml` `main = "src/worker.ts"`, `[assets]` (the binding lands in S5/0079).

**Deps (R7):** `@hono/vite-dev-server` (dev), `@hono/vite-build` (server CF build) — add to
apps/server. Confirm versions + that they're compatible with the installed hono@4.12.23 + the Workers
runtime.

**Fallback (R9):** if unified dev proves fragile, the two-process fallback is dev-only and does NOT
affect production — document this escape hatch.

**GATED on W1 (0080 — stack must be migrated first).**

**Out of scope:** static asset SERVING middleware (S5/0079 — this task produces the build; S5 serves it);
the Cloudflare `[assets]` binding (S5).


### Solution



### Plan

- [ ] Add `@hono/vite-dev-server` (dev) + `@hono/vite-build` (server CF build) to apps/server; confirm versions compatible with hono@4.12.23 + Workers runtime.
- [ ] `apps/server/vite.config.ts` (NEW): `honoDevServer({ entry: 'src/worker.ts' })`.
- [ ] Wire one-port dev (root vite.config.ts orchestrating both, OR server vite integrating Astro). Constraint: `bun run dev` serves `/api/health` AND `/` on ONE port, no proxy, no CORS-in-dev.
- [ ] DROP the `/api` + `/openapi.json` proxy block from apps/web/astro.config.mjs.
- [ ] Change apps/server `dev` script `bun --hot run src/index.ts` -> `vite`. Keep index.ts as the standalone production entry.
- [ ] Production: confirm `astro build` -> `dist/web` static; smoke `@hono/vite-build/cloudflare-workers` bundles worker.ts; `bun build --compile` still builds the local binary. wrangler.toml `main = src/worker.ts` (the `[assets]` block is S5).
- [ ] Verify: `bun run dev` one-port both-served; `astro build` output present; production build paths documented.
- [ ] Tests: a dev smoke (api + frontend on one port) where feasible; build output assertions.
- [ ] Gate: `bun run lint` + `test` + `test-cf` + `build`; document the two-process dev fallback (risk #2).
- [ ] GATE CHECK: W1 (0080) stack migration landed.


### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


