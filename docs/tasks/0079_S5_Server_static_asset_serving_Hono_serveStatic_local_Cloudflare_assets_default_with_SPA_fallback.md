---
name: "S5: Server static asset serving — Hono serveStatic (local) + Cloudflare  (default) with SPA fallback"
description: "S5: Server static asset serving — Hono serveStatic (local) + Cloudflare  (default) with SPA fallback"
status: Backlog
created_at: 2026-06-15T16:56:10.135Z
updated_at: 2026-06-15T16:56:10.135Z
folder: docs/tasks
type: task
feature-id: S5
priority: P1
estimated_hours: 4
tags: ["server-side-adjustment","wave-S1","group-S"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0079. "S5: Server static asset serving — Hono serveStatic (local) + Cloudflare  (default) with SPA fallback"

### Background

One port for API + board on both deployment targets. Cloudflare-default: Workers Static Assets binding with SPA fallback. Local-fallback: Hono serveStatic from config.server.webDistPath. Unmatched non-/api routes serve index.html for client-side routing. Anchors: design §2.8, §5.2.


### Requirements

R1: Local path — createApp mounts Hono serveStatic from ctx.webDistPath (config.server.webDistPath) AFTER the /api routes, only when webDistPath is set. R2: SPA fallback — a catch-all serves index.html for non-/api paths so React Router handles client-side routes; /api/* unmatched still returns the 404 JSON envelope. R3: Cloudflare path — apps/server/wrangler.toml gains [assets] directory=../web/dist + not_found_handling='single-page-application'; the Worker fetch checks assets first, falls through to createApp for /api. R4: One port serves both / (board) and /api/health (assert in tests). R5: Confirm the exact hono/serve-static import for the Bun runtime (hono/serve-static vs @hono/node-server/serve-static) — test under Bun. R6: Tests: with webDistPath set, GET / serves index.html and GET /api/health still works; unknown client route -> index.html; /api unknown -> 404 envelope. Coverage >=90%. GATED on W5 (web build must produce dist/web assets) — but the serving CODE can land + be tested against a fixture dist before W5 if needed.


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



### Plan

- [ ] Confirm the correct Hono static middleware import for the Bun runtime (`hono/bun` serveStatic vs `hono/serve-static` vs `@hono/node-server/serve-static`); test it serves files under Bun. Add the dep to apps/server/package.json.
- [ ] `createApp`: when `ctx?.webDistPath` set, mount static serving from `webDistPath` AFTER `/api/*` + after `registerModules`.
- [ ] SPA fallback catch-all: non-`/api` -> `index.html`; `/api` unmatched -> the existing 404 JSON envelope. Verify ordering doesn't shadow `/api` or `/openapi.json`.
- [ ] `apps/server/wrangler.toml`: add `[assets] directory="../web/dist"` + `not_found_handling="single-page-application"`.
- [ ] Tests (against a fixture `dist` with a stub index.html + one asset): GET `/` serves index.html AND GET `/api/health` works on the same port; unknown client route (`/board/tasks`) -> index.html; `/api/unknown` -> 404 envelope.
- [ ] Gate: `bun run lint` + `test` + `test-cf` + `build`; coverage >=90%.
- [ ] GATE: real end-to-end serving needs W5 (0081) `dist/web`; the serving code + fixture tests can land first.


### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


