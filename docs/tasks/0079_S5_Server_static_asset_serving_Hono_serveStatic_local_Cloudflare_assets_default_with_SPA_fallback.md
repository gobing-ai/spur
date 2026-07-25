---
name: "S5: Server static asset serving — Hono serveStatic (local) + Cloudflare  (default) with SPA fallback"
description: "S5: Server static asset serving — Hono serveStatic (local) + Cloudflare  (default) with SPA fallback"
status: done
created_at: 2026-06-15T16:56:10.135Z
updated_at: 2026-06-16T18:41:05.245Z
folder: docs/tasks
type: task
feature-id: S5
priority: P1
estimated_hours: 4
tags: ["server-side-adjustment","wave-S1","group-S"]
impl_progress:
  planning: completed
  design: completed
  implementation: completed
  review: completed
  testing: completed
---

## 0079. "S5: Server static asset serving — Hono serveStatic (local) + Cloudflare  (default) with SPA fallback"

### Background

One port for API + board on both deployment targets. Cloudflare-default: Workers Static Assets binding with SPA fallback. Local-fallback: Hono serveStatic from config.server.webDistPath. Unmatched non-/api routes serve index.html for client-side routing. Anchors: design §2.8, §5.2.


### Requirements

- [x] **R1** createApp mounts static serving from webDistPath AFTER /api routes + after registerModules, only when set → **MET** | `bootstrap.ts:51` registerModules → :56 /api/* → :67 `if (webDistPath)` static `app.use('*')`
- [x] **R2** SPA fallback: non-/api → index.html; /api/* unmatched → 404 JSON envelope → **MET** | `bootstrap.ts:86-101` notFound handler (path.startsWith('/api') → 404 json; else index.html); tests: SPA client-route → index.html, /api/unknown → 404 non-HTML
- [x] **R3** wrangler.toml [assets] directory + not_found_handling='single-page-application'; Worker checks assets first, falls through to createApp for /api → **MET** | `wrangler.toml:5-7`; `worker.ts:51` fetch → createApp(appRt).fetch (CF [assets] binding handles static+SPA at the edge before the Worker)
- [x] **R4** one port serves both / (board) and /api/health → **MET** | tests: `GET /` → index.html AND `GET /api/health` → ok on the same app instance; `GET /openapi.json` also works alongside
- [x] **R5** confirm Hono static import for Bun → **MET (via Bun.file)** | resolved by using `Bun.file()` directly (bootstrap.ts:73,93) — no `@hono/*` static dep; `.type` resolves MIME per extension. Design's "confirm import" intent satisfied.
- [x] **R6** tests: GET / → index.html + /api/health works; unknown client route → index.html; /api unknown → 404 envelope; coverage ≥90% → **MET** | `tests/static-assets.test.ts` (12 tests incl. new MIME + traversal guards); bootstrap.ts 100% func / 96.92% line


### Q&A



### Design

Authority: design §2.8 (static asset serving), §5.2 (production builds), invariant #5 (two entries).

**Local-fallback (Bun) — design §2.8:** `createApp` mounts Hono static serving from `ctx.webDistPath`
(= `config.server.webDistPath`) AFTER the `/api/*` routes, only when `webDistPath` is set:
```typescript
if (ctx?.webDistPath) {
  const { serveStatic } = await import('hono/serve-static'); // CONFIRM the Bun import path
  app.use('*', serveStatic({ root: ctx.webDistPath }));
}
```
**SPA fallback:** a catch-all serves `index.html` for non-`/api` client routes so React Router (W2/0083)
handles them; `/api/*` unmatched still returns the 404 JSON envelope:
```typescript
app.get('*', async (c) => {
  if (c.req.path.startsWith('/api')) return c.notFound();   // -> 404 envelope
  return c.html(await getIndexHtml(ctx.webDistPath));        // SPA shell
});
```
Ordering: static asset match -> SPA fallback -> the existing `notFound` (which must keep returning the
JSON envelope for `/api`). Place after `registerModules` (0075) in `createApp`.

**IMPORT-PATH RISK (R5):** Hono's static middleware differs by runtime — `hono/serve-static` (generic),
`hono/bun` (`serveStatic` for Bun), or `@hono/node-server/serve-static`. **Confirm the correct one for
the Bun runtime** and test it actually serves files under Bun (don't trust the design's placeholder
`hono/serve-static`). Add the chosen dep to `apps/server/package.json`.

**Cloudflare-default — design §2.8 / §5.2:** `apps/server/wrangler.toml`:
```toml
[assets]
directory = "../web/dist"
not_found_handling = "single-page-application"
```
The Worker's `fetch` checks the assets binding first; unmatched routes fall through to
`createApp(appRt).fetch` for `/api`. `not_found_handling = "single-page-application"` gives the SPA
fallback at the edge (no app code needed for the CF SPA fallback).

**One port (R4):** both `/` (board) and `/api/health` serve on the same port/host on BOTH targets
(local Bun.serve; CF Worker). Assert in tests.

**GATED on W5 (0081 — web build must produce `dist/web`).** The serving CODE + tests can land against a
fixture `dist` (a stub `index.html` + asset) BEFORE W5 if sequencing demands; real end-to-end needs W5.

**Out of scope:** the web build itself (W5/0081), Vite dev server (W5), production server bundling
(`wrangler deploy` / `bun build --compile` — those are W5/deploy mechanics).


### Solution

Static asset serving + SPA fallback on one port for both deployment targets (design §2.8, §5.2).

**Local (Bun) — `apps/server/src/bootstrap.ts`:** when `ctx.webDistPath` is set, `createApp` mounts a
static handler AFTER `/api/*` and `registerModules`. The handler tries an exact file match via
`Bun.file(join(webDistPath, path))`, serving it with the extension-derived MIME (`Bun.file().type`).
Unmatched non-`/api` routes fall to the `notFound` handler, which returns `index.html` (SPA shell for
React Router); unmatched `/api/*` returns the 404 JSON envelope. Stand-alone mode (no webDistPath)
keeps the `/ → /api/health` redirect.

**Cloudflare — `wrangler.toml` + `worker.ts`:** `[assets] directory="../web/dist"` +
`not_found_handling="single-page-application"` gives static serving + SPA fallback at the edge; the
Worker `fetch` falls through to `createApp(appRt).fetch` for `/api`. No app-side static code on the CF
path.

**Verification fixes:** MIME was set only for `.html`/`.json` — replaced with `Bun.file().type` so
js/css/svg/woff2/png/ico get correct content-types (ES modules require a JS MIME; the real Vite board
would otherwise fail to load). Hoisted `node:path` to an ESM import. Added regression tests for JS-asset
MIME and path-traversal containment (containment relies on Hono normalizing `../` — verified empirically,
now pinned).

**Verification:** lint + typecheck clean (7 workspaces); 158 tests pass / 0 fail (12 static-asset tests);
bootstrap.ts 100% func / 96.92% line; test-cf pass; build (cli+server+web) pass.

**GATE:** real end-to-end serving needs W5 (0081, `dist/web`); the serving code + fixture tests land now.


### Plan

- [x] Resolve the Bun static-serving approach — used `Bun.file()` directly (no `@hono/*` static dep); `.type` gives correct MIME.
- [x] `createApp`: when `ctx?.webDistPath` set, mount static serving AFTER `/api/*` + after `registerModules`.
- [x] SPA fallback catch-all: non-`/api` → `index.html`; `/api` unmatched → 404 JSON envelope. Ordering verified not to shadow `/api` or `/openapi.json`.
- [x] `wrangler.toml`: `[assets] directory="../web/dist"` + `not_found_handling="single-page-application"`.
- [x] Tests (fixture dist: stub index.html + asset.json + app.js): GET `/` → index.html AND `/api/health` on same port; unknown client route → index.html; `/api/unknown` → 404; JS-asset MIME; path-traversal containment.
- [x] Gate: lint + test + test-cf + build; coverage ≥90% (bootstrap 96.92% line / 100% func).
- [x] GATE: real end-to-end serving needs W5 (0081) `dist/web`; serving code + fixture tests landed first.


### Review — 2026-06-16

**Status:** 3 findings (3 fixed)
**Scope:** apps/server/src/bootstrap.ts (static serving + SPA fallback), wrangler.toml, worker.ts, tests/static-assets.test.ts
**Mode:** verify (Phase 7 SECU + Phase 8 traceability)
**Channel:** inline
**Gate:** `lint` ✅ · `test` (158 pass / 0 fail) ✅ · `test-cf` ✅ · `build` ✅ · `autofix && spur-check` ✅
**Coverage:** bootstrap.ts 100% func / 96.92% line; worker.ts 100/100 (R6 ≥90% ✅)

### P1 — Blockers
_None._

### P2 — Warnings
| # | Title | Dimension | Location | Recommendation | Status |
|---|-------|-----------|----------|----------------|--------|
| 1 | Static handler set content-type ONLY for .html/.json — JS/CSS/SVG/fonts served with no MIME | Correctness | bootstrap.ts:76-78 | Browsers reject `<script type=module>` without a JS content-type, so the real Vite board (W5) would fail to load while fixture tests (only .html/.json) stayed green. Replaced the two-branch check with `Bun.file().type`, which resolves the correct MIME for js/css/svg/woff2/png/ico. Added a JS-asset fixture + regression test. | **FIXED** |

### P3 — Info
| # | Title | Dimension | Location | Recommendation | Status |
|---|-------|-----------|----------|----------------|--------|
| 2 | `require('node:path')` inside the handler instead of ESM `import` | Maintainability | bootstrap.ts:68 | Hoisted to a top-level `import { join } from 'node:path'` — matches the project's ESM convention and the test file's own import. | **FIXED** |
| 3 | No test pinning path-traversal containment | Testability | tests/static-assets.test.ts | Traversal safety is real but *implicit* — it relies on Hono normalizing `../` before the handler runs (verified empirically: `../`, `%2f`, `%2e%2e` all contained, no leak). Added a regression test so a future router/handler change can't silently reintroduce a leak. | **FIXED** |

### P4 — Suggestions
_None._

**Security note (no finding):** the handler builds `join(webDistPath, c.req.path)` — `join` alone does NOT contain traversal (`join(dist,'/../x')` escapes). Containment was verified empirically: Hono's WHATWG path normalization collapses `../`/`%2f`/`%2e%2e` before the handler, so a planted secret one dir above the fixture was unreachable across all vectors (LEAKED=false). Now pinned by test (P3 #3). If the static layer is ever moved ahead of Hono's normalization, add an explicit `resolve(...).startsWith(webDistPath)` containment check.

**R5 note (design deviation, accepted):** the design suggested confirming a Hono `serveStatic` import (`hono/bun` vs `hono/serve-static`). The implementation instead uses `Bun.file()` directly — simpler, no extra dep, and `.type` gives correct MIME. Valid resolution of R5's "confirm the import" intent; no `@hono/*` static dep needed.

**Fix-pass 2026-06-16:** 3 fixed (P2 #1, P3 #2–#3), 0 failed. Gate green: lint ✅ · 158 tests (12 static, +2 new) ✅ · test-cf ✅ · build ✅.


### Testing

`apps/server/tests/static-assets.test.ts` (12 tests, fixture `tests/fixtures/web-dist/` = index.html + asset.json + app.js):

- `GET /` → index.html (200, text/html).
- `GET /api/health` + `GET /openapi.json` work on the same app (one port, R4).
- SPA fallback: `/board/tasks` and nested `/board/tasks/0001/detail` → index.html.
- `/api/nonexistent` → 404, NOT index.html.
- Direct asset `/asset.json` served (not fallback).
- **JS asset `/app.js` → javascript content-type** (regression guard for the MIME fix).
- **Path-traversal vectors (`../`, `%2f`, `%2e%2e`) cannot escape webDistPath** (regression guard).
- Stand-alone (no webDistPath): `/api/health` works; unknown route → 404.

Result: 12 pass / 0 fail; full repo 158 pass / 0 fail. bootstrap.ts 100% func / 96.92% line (uncovered: the index.html-missing catch fallthrough). test-cf pass; build pass.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| Source | apps/server/src/bootstrap.ts (static serving + SPA fallback) | claude | 2026-06-16 |
| Config | apps/server/wrangler.toml ([assets] block) | claude | 2026-06-16 |
| Source | apps/server/src/worker.ts (CF fetch → createApp) | claude | 2026-06-16 |
| Test | apps/server/tests/static-assets.test.ts | claude | 2026-06-16 |
| Fixture | apps/server/tests/fixtures/web-dist/{index.html,asset.json,app.js} | claude | 2026-06-16 |


### References


