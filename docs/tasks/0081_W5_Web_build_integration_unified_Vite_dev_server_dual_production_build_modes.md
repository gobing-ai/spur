---
name: "W5: Web build integration — unified Vite dev server + dual production build modes"
description: "W5: Web build integration — unified Vite dev server + dual production build modes"
status: done
created_at: 2026-06-15T16:56:35.825Z
updated_at: 2026-06-16T21:29:46.058Z
folder: docs/tasks
type: task
feature-id: W5
priority: P1
estimated_hours: 6
tags: ["server-side-adjustment","wave-W0","group-W"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0081. "W5: Web build integration — unified Vite dev server + dual production build modes"

### Background

Current friction: two dev servers (bun --hot apps/server :3000, astro dev :4321) with a Vite proxy in astro.config.mjs — CORS in dev, proxy drift, two processes. This task unifies dev via @hono/vite-dev-server (one process, one port, no proxy, no CORS-in-dev) and sets up dual production builds (Cloudflare Workers Static Assets default; local Hono serveStatic fallback) from the same source. Anchors: design §5.1, §5.2, risk item #2 (resolved).


### Requirements

## Requirements

R1: apps/server/vite.config.ts (NEW) with honoDevServer({ entry: 'src/worker.ts' }). R2: One orchestration so bun run dev serves BOTH /api/health and / (board) on ONE port with NO proxy and NO CORS-in-dev. R3: DROP the /api + /openapi.json proxy block from apps/web/astro.config.mjs. R4: Change apps/server dev script from 'bun --hot run src/index.ts' to 'vite'. R5: The standalone apps/server/src/index.ts entry REMAINS for the Bun-binary production path. R6: Production: astro build → dist/web; Cloudflare uses @hono/vite-build/cloudflare-workers for worker.ts; local uses bun build --compile + Hono serveStatic. R7: Add @hono/vite-dev-server (dev), @hono/vite-build (server CF build) deps. R8: Verify one-port both-served; astro build produces dist/web; production build paths documented + smoke-built. R9: two-process fallback note. GATED on W1.

### Traceability verdict (2026-06-16, post-implementation)

- [x] **R1** → **MET** | `apps/server/vite.config.ts:21` `honoDevServer({ entry: 'src/worker.ts' })` (NEW)
- [x] **R2** → **MET** | live smoke: `/` (200 html board) + `/api/health` (200 json) on ONE port 4321, no proxy, no CORS; `astro.config.mjs` honoDevServer `exclude` guards non-API routes
- [x] **R3** → **MET** | proxy block absent from apps/web/astro.config.mjs
- [x] **R4** → **MET** | `apps/server/package.json:10` dev = `vite`
- [x] **R5** → **MET** | `apps/server/src/index.ts` retained (import.meta.main → startServer); Vite is dev/CF-build only
- [x] **R6** → **MET** | `build:cf` → dist/index.js (Workers default export); `build` → local binary; `astro build` → dist/web (smoke-built, all 3)
- [x] **R7** → **MET** | @hono/vite-dev-server@0.24.1 + @hono/vite-build@1.11.1 + vite@7.3.3 in apps/server; @hono/vite-dev-server in apps/web (imported there); installed + resolvable
- [x] **R8** → **MET** | one-port both-served verified live; dist/web present; CF + local + static paths documented (Solution) + smoke-built
- [x] **R9** → **MET** | two-process dev-only fallback documented (Solution); production paths independent

Gate W1 (0080): SATISFIED (Done, committed at HEAD). Scope drift: none. Deferred seam: wrangler `[assets]` dir vs astro outDir → S5/0079 (per design out-of-scope).


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

## Solution

Unified the dev server to one port and wired both production build targets from one source.

**Unified dev (R1/R2/R4 — one port, no proxy, no CORS):** The Astro/Vite dev server (`apps/web`) hosts `@hono/vite-dev-server`, which intercepts ONLY `/api/*` + `/openapi.json` (via `exclude: [/^(?!\/api(\/|$)|\/openapi\.json$).*/]`) and routes them in-process to the Hono worker (`../server/src/worker.ts`); Astro owns `/` (the board, with HMR) and all assets. Root `dev` = `bun run --filter '@gobing-ai/spur-web' dev` → one process, one port (4321) serving both. The earlier full-intercept wiring made the worker's stand-alone `/`→/api/health redirect shadow the board (302); the `exclude` guard fixes it. `apps/server/vite.config.ts` (NEW, R1) also runs `honoDevServer({ entry: 'src/worker.ts' })` as the API-only server-side dev entry and `dev` script `vite` (R4).

**Production builds (R6) — dual target from one source:**
- Cloudflare: `apps/server/vite.config.ts` adds `@hono/vite-build/cloudflare-workers` (`build({ entry: 'src/worker.ts' })`); `bun run build:cf` → `dist/index.js` (222 kB, `export{… as default}` Workers fetch entry). `wrangler.toml` already has `main = src/worker.ts` + `[assets]`.
- Local: unchanged `bun build --compile` → `dist/server/spur-server` (Hono `serveStatic` via `webDistPath`, S5). `astro build` → static `dist/web` (index.html + hashed CSS).

**Entries (R5):** standalone `src/index.ts` (`import.meta.main` → `startServer`) retained for `spur serve` / Docker; Vite is dev/CF-build only.

**Deps (R7):** `@hono/vite-dev-server@0.24.1` + `@hono/vite-build@1.11.1` + `vite@7.3.3` added to `apps/server` (devDeps); `@hono/vite-dev-server` also in `apps/web` (its astro.config imports it). vite pinned to 7.3.3 to dedupe with astro/tailwind's existing copy.

**Fallback (R9):** if the unified plugin proves fragile, run `astro dev` (board) + `apps/server` `vite` (API) as two processes — dev-only, production build paths are independent and unaffected.

**Known seam (deferred to S5/0079):** `wrangler.toml [assets] directory = "../web/dist"` but `astro build` outputs to root `dist/web` — the `[assets]` binding + path reconciliation is S5's scope, not W5's (W5 produces the build; S5 serves it).


### Plan

## Plan

- [x] Add `@hono/vite-dev-server` (dev) + `@hono/vite-build` (server CF build) to apps/server; confirm versions compatible with hono@4.12.23 + Workers runtime.
- [x] `apps/server/vite.config.ts` (NEW): `honoDevServer({ entry: 'src/worker.ts' })`.
- [x] Wire one-port dev. Constraint: `bun run dev` serves `/api/health` AND `/` on ONE port, no proxy, no CORS-in-dev. (Astro vite hosts honoDevServer with an exclude guard; root dev → unified web server.)
- [x] DROP the `/api` + `/openapi.json` proxy block from apps/web/astro.config.mjs.
- [x] Change apps/server `dev` script `bun --hot run src/index.ts` -> `vite`. Keep index.ts as the standalone production entry.
- [x] Production: `astro build` -> `dist/web` static; `@hono/vite-build/cloudflare-workers` bundles worker.ts (build:cf); `bun build --compile` still builds the local binary. wrangler.toml `main = src/worker.ts` (the `[assets]` block is S5).
- [x] Verify: `bun run dev` one-port both-served; `astro build` output present; production build paths documented.
- [x] Tests: dev smoke (api + frontend on one port); build output assertions. (static-assets.test.ts encodes the prod one-port contract.)
- [x] Gate: `bun run lint` + `test` + `test-cf` + `build`; document the two-process dev fallback (risk #2).
- [x] GATE CHECK: W1 (0080) stack migration landed.


### Review

## Review — 2026-06-16

**Status:** implemented + verified (initial verify found FAIL; implemented in-session, re-verified PASS)
**Scope:** apps/server (vite.config.ts NEW, package.json, dev/build:cf scripts), apps/web/astro.config.mjs, root dev script, bun.lock
**Mode:** verify (Phase 7 SECU + Phase 8 traceability)
**Channel:** inline
**Gate:** lint pass · test 1431+158/0 · test-cf 1/1 · build (cli+server+web) pass
**Verdict:** PASS (after implementation)

### P1 — Blockers
| # | Title | Dimension | Location | Resolution |
|---|-------|-----------|----------|------------|
| 1 | `@hono/vite-dev-server` declared but NOT installed | Correctness | apps/web/package.json, bun.lock | FIXED — `bun install` ran; @hono scope resolves from apps/server + apps/web node_modules; verified live |
| 2 | honoDevServer wired into web only; no apps/server/vite.config.ts (R1) | Correctness | apps/web/astro.config.mjs | FIXED — created apps/server/vite.config.ts (R1); honoDevServer entry kept web-side for one-port board+API with HMR; both satisfy design §5.1 |

### P2 — Warnings
| # | Title | Dimension | Location | Resolution |
|---|-------|-----------|----------|------------|
| 3 | R2 unmet (two processes); R4 server dev not `vite` | Correctness | package.json, apps/server/package.json | FIXED — root dev → unified web server (one port, verified); server dev → `vite` |

### P3 — Info
| # | Title | Dimension | Location | Resolution |
|---|-------|-----------|----------|------------|
| 4 | `@hono/vite-build` (R7) absent; dual prod builds (R6) not wired | Usability | apps/server | FIXED — @hono/vite-build added; build:cf smoke-built (222 kB worker bundle); local binary + astro static verified |

### P4 — Suggestions
_(none)_

**Fix-pass 2026-06-16:** 4 fixed, 0 failed, 0 skipped. W5 implemented from near-zero (new server vite config, dep install + placement, unified-dev exclude guard, dual build wiring), re-verified PASS. One seam (wrangler `[assets]` dir vs astro outDir) explicitly deferred to S5/0079 per design scope.


### Testing

## Testing

W5 is dev/build infrastructure; verification is gate-based + live one-port smoke + build-artifact assertions (no new unit tests — the existing `static-assets.test.ts` already encodes the one-port serving contract for the production path and stays green).

**Unified dev smoke (R2/R8 — live, port 4321, single process):**
- `GET /` → 200 `text/html`, serves the Astro board with HMR (`<title>Spur`, `astro-island` SmokeIsland, `/src/styles/global.css` HMR link, dev toolbar).
- `GET /api/health` → 200 real JSON (`{"status":"ok",…}`) from the Hono worker — SAME port, no proxy, no CORS.
- `GET /openapi.json` → 200 `application/json`.

**Production build smoke (R6/R8):**
- `bun run --filter '@gobing-ai/spur-server' build:cf` → `dist/index.js` (222 kB), ends `export{… as default}` (valid Workers fetch entry).
- `bun run --filter '@gobing-ai/spur-server' build` → `dist/server/spur-server` (local Bun binary, 65 MB).
- `astro build` → `dist/web/index.html` + `dist/web/_astro/index.*.css`.

**Gate:**
- `bun run lint` → clean (Biome 320 files; all 7 workspaces `tsc --noEmit` exit 0).
- `bun run test` → 1431 + 158 pass / 0 fail (incl. `static-assets.test.ts` one-port contract).
- `bun run test-cf` → 1 pass (server Workers runtime).
- `bun run build` → cli + server (local binary) + web (static) all exit 0.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


