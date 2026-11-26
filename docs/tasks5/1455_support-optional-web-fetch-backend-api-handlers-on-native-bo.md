---
schema_version: 1
name: Support optional Web-Fetch backend API handlers on native Board modules (/api/modules/:id/*)
status: todo
template: feature-impl
created_at: 2026-11-26T18:16:32.513Z
updated_at: "2026-11-26T18:59:17.118Z"

priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 6
feature_id: A84
---

## 1455. Support optional Web-Fetch backend API handlers on native Board modules (/api/modules/:id/*)

### Background

Downstream Spur Board modules (shipped in A8 / task 0989) can currently contribute static frontend assets (`directory`, `entry`, `styles` served under `/modules/<id>/*`), but have no mechanism to serve module-owned backend HTTP routes. Downstream projects such as `knowledge-kit` are forced to run a separate loopback HTTP server (`kk board serve` on `127.0.0.1:4340`), manually enforce `--board-origin`/CORS, maintain a second daemon/LaunchAgent, and break over remote HTTPS gateway access (`https://spur.robinmin.net/<project>/...` cannot call `http://127.0.0.1:4340`).

Because `spur self serve` already runs Hono on Bun with `mountMiddleware` (host guard + CSRF) and `registerModules(app, ctx)` mounted before oRPC `/api/*` (`apps/server/src/bootstrap.ts:32-37`), and the gateway (`packages/app/src/services/project-gateway.ts:454`) already proxies `/<project>/*` with header rewriting, adding an optional Web-Fetch ESM `api` handler to `bootstrap.modules` (`type: react`) eliminates the second server cleanly.

**Refine corrections (2026-11-26)**
- Audited against `packages/config/src/board-modules.ts:80-106`, `packages/app/src/services/board-catalog-service.ts:18-46,183-272`, `apps/server/src/bootstrap.ts:30-70`, `apps/server/src/modules/board/index.ts:1-137`, and `apps/web/src/modules/contribution.ts:1-38`.
- Clarified path confinement: `entry` and `styles` stay confined to `declaration.directory`, whereas `api` is project-relative and confined to `projectRoot` (both lexical and fail-closed `realPath`) so multiple modules in one project (e.g. `collect`, `daily-voice`, `itc`) can share a single built backend bundle without duplicating files.
- Clarified schema dual-source: both `packages/config/src/board-modules.ts` (Zod `.strict()`) and `schemas/spur-config.schema.json` (plus bundled CLI schema copy) must be updated together.
- Clarified mount precedence: `boardModule.mount` runs inside `registerModules(app, ctx)` before oRPC `app.use('/api/*', ...)` and after `mountMiddleware(app, appRt)`, so `/api/modules/:id/*` inherits host guard + CSRF automatically and never falls into oRPC.
- Clarified shared cache key: keying the lazy ESM import cache by `realApiPath` + `mtimeMs` lets multiple modules sharing one `api.js` share one loaded module instance while reloading automatically on rebuild.

### Requirements

- [ ] R1. Extend `bootstrap.modules` (`type: 'react'`) in `packages/config/src/board-modules.ts` and `schemas/spur-config.schema.json` with an optional `api?: string` field (non-empty project-relative path to a built ESM bundle); reject `api` on `type: 'iframe'` and keep `.strict()` / `additionalProperties: false`.
- [ ] R2. Export `BoardModuleApiContext` (`{ readonly projectPath: string; readonly moduleId: string }`) and `BoardModuleApiHandler` (`{ fetch(request: Request, ctx: BoardModuleApiContext): Response | Promise<Response> }`) from `apps/web/src/modules/contribution.ts` and regenerate `apps/cli/board/index.d.ts` via `packages/app/src/builder/emit-board-types.ts`.
- [ ] R3. Validate and resolve `declaration.api` in `prepareBoardModules` (`packages/app/src/services/board-catalog-service.ts`): reject absolute paths, lexical escapes outside `projectRoot`, missing/non-file targets, and fail-closed `realPath` escapes outside `realProjectRoot`; expose `readonly apiPath?: string` on `BoardModuleAssetRoot` only (never in the public `BoardModuleDescriptor` catalog DTO).
- [ ] R4. Mount `/api/modules/:id` and `/api/modules/:id/*` in `boardModule` (`apps/server/src/modules/board/index.ts`): return 404 JSON for unknown/disabled modules or modules without `apiPath`; re-verify fail-closed `realPath` confinement inside `realProjectRoot` at request time; strip `/api/modules/:id` (defaulting empty remainder to `/`, preserving query string, method, headers, and body) before calling `handler.fetch(rewrittenRequest, { projectPath, moduleId })`; isolate thrown errors or malformed exports into a 500 JSON response without crashing the server.
- [ ] R5. Cache loaded handlers by `(realApiPath, mtimeMs)` using dynamic ESM import with a `?v=<mtimeMs>` cache-buster so rebuilding `api.js` takes effect on the next request without restarting `spur self serve`, and multiple modules pointing at the same `api.js` share one loaded instance.
- [ ] R6. Verify same-origin gateway proxying (`/<project>/api/modules/:id/*`) works end-to-end across `GET`/`POST` requests (including query strings and request/response bodies) through `createGatewayHandler` without CORS headers or a separate loopback port, and update Spur module authoring docs in the same commit.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Config schema accepts optional `api` on react modules and rejects invalid shapes (req: R1)
  Given a project `.spur/config.yaml` with `bootstrap.modules`
  When a `type: react` entry declares `api: "apps/cli/dist/board/api.js"`
  Then `parseBoardModuleDeclarations` and JSON-Schema validation succeed
  And an `api: ""` or `api` on a `type: iframe` entry fails with a `bootstrap.modules[i]` validation error.

Scenario: AC2 — `@gobing-ai/spur/board` publishes the type-only API handler contract (req: R2)
  Given `apps/web/src/modules/contribution.ts` updated with `BoardModuleApiContext` and `BoardModuleApiHandler`
  When `emit-board-types` runs
  Then `apps/cli/board/index.d.ts` exports both interfaces with zero value imports and `bun run typecheck` passes.

Scenario: AC3 — Startup preparation fails closed on missing or escaping `api` paths (req: R3)
  Given an enabled `type: react` module declaring `api`
  When `prepareBoardModules` runs with an absolute path, `../` escape, missing file, or symlink resolving outside `projectRoot`
  Then it throws `BoardModuleConfigError` naming the module id and reason
  And for a valid project-relative `api` file, `PreparedBoardModules.roots[i].apiPath` holds the resolved path while `catalog.modules[i]` omits filesystem paths.

Scenario: AC4 — `/api/modules/:id/*` dispatches rewritten requests and isolates errors (req: R4)
  Given a running Hono app with `boardModule` mounted and an enabled module `demo` declaring `api`
  When a client sends `GET /api/modules/demo/items?limit=5` and `POST /api/modules/demo/actions` with a JSON body
  Then the handler receives `pathname === "/items"` with `?limit=5` (and `"/actions"` with the POST body) plus `{ projectPath, moduleId: "demo" }`
  And requests to an unknown/disabled module or a module without `api` return `404` JSON
  And a handler that throws or lacks a `fetch` function returns `500` JSON without crashing the server.

Scenario: AC5 — Rebuilding `api.js` reloads automatically on mtime change (req: R5)
  Given a module `api.js` already loaded by `/api/modules/demo/version` returning `"v1"`
  When `api.js` is overwritten on disk with `"v2"` (advancing `mtimeMs`)
  Then the next request to `/api/modules/demo/version` returns `"v2"` without restarting the server
  And two modules sharing the same `api.js` reuse the same cached module entry when `mtimeMs` is unchanged.

Scenario: AC6 — Gateway proxies `/<project>/api/modules/:id/*` same-origin end-to-end (req: R6)
  Given a project served behind `startGateway` / `createGatewayHandler` with a react module declaring `api`
  When a client calls `GET` and `POST` against `http://localhost:<gatewayPort>/<project>/api/modules/<id>/...`
  Then the gateway forwards the request to the project's `spur self serve`, passes CSRF/host checks, and returns the module handler's response with zero CORS setup.
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

#### Chosen approach

Mount optional in-process Web-Fetch ESM handlers under `/api/modules/:id/*` inside the existing `boardModule` (`apps/server/src/modules/board/index.ts`), reusing `spur`'s existing Hono middleware pipeline, project-root confinement, and gateway proxy.

#### Key invariants & tradeoffs

1. **Project-root confinement (not `directory` confinement) for `api`:**
   - Static browser assets (`entry`, `styles`) live inside each module's `directory` (e.g. `apps/cli/dist/board/daily-voice/`).
   - Backend API bundles (`api`) are frequently shared across all modules of a project (e.g. `apps/cli/dist/board/api.js` serving `collect`, `daily-voice`, and `itc`). Resolving `api` relative to `projectRoot` with `isInsideRoot(projectRoot, apiPath)` + fail-closed `isInsideRoot(realProjectRoot, realApiPath)` allows sharing without weakening confinement.
   - Startup (`prepareBoardModules`) and request time (`boardModule`) both verify `realPath` confinement, matching `serveModuleAsset` (task 1208).
2. **Mount order & security:**
   - `apps/server/src/bootstrap.ts:32-37` runs `mountMiddleware(app, appRt)` (host guard + CSRF) then `registerModules(app, ctx)` BEFORE oRPC `app.use('/api/*', ...)`.
   - Registering `app.all('/api/modules/:id', ...)` and `app.all('/api/modules/:id/*', ...)` in `boardModule.mount` therefore automatically enforces host guard + CSRF and never collides with oRPC.
   - Path rewriting strips only `/api/modules/${id}` from `url.pathname` (preserving search params, method, headers, and body stream via `new Request(rewrittenUrl, request)`).
3. **Cache & hot reload:**
   - Cache map `Map<string, { mtimeMs: number; fetch: BoardModuleApiHandler['fetch'] }>` keyed by `realApiPath`.
   - On each request, `fs.stat(realApiPath)` checks `mtimeMs`; on miss or change, dynamically imports `pathToFileURL(realApiPath).href + '?v=' + mtimeMs` and accepts `mod.default?.fetch ?? mod.fetch`.
4. **Why in-process ESM over a supervised sidecar subprocess:**
   - Zero extra ports, zero process supervision/orphan cleanup, sub-millisecond dispatch, and native Web `Request`/`Response` compatibility with Bun + Hono.
   - Tradeoff: assumes trusted local project code in Bun. If untrusted or non-JS modules are ever needed, a future `command` sidecar variant can mount behind the exact same `/api/modules/:id/*` URL contract without breaking frontends.

#### Impacted surfaces

- `apps/web/src/modules/contribution.ts` + generated `apps/cli/board/index.d.ts`
- `packages/config/src/board-modules.ts` + `schemas/spur-config.schema.json` (and bundled CLI schema)
- `packages/app/src/services/board-catalog-service.ts` (`BoardModuleAssetRoot.apiPath`, `prepareBoardModules`)
- `apps/server/src/modules/board/index.ts` (`/api/modules/:id/*` dispatch, loader, error isolation)
- Tests: `packages/config/tests/board-modules.test.ts`, `packages/app/tests/services/board-catalog-service.test.ts`, `apps/server/tests/modules/board/` (unit + gateway E2E)
- Docs: ADR / module authoring contract docs in `docs/`

#### Out of scope

- Supervised subprocess / Unix-socket sidecar execution for non-JS backends.
- Live reload of `.spur/config.yaml` module declarations (adding/removing modules still requires server restart per A8 AC5; only rebuilding an already-declared `api.js` reloads on `mtimeMs`).

### Plan

1. Add `BoardModuleApiContext` and `BoardModuleApiHandler` to `apps/web/src/modules/contribution.ts` and regenerate `apps/cli/board/index.d.ts` via `emit-board-types`.
2. Add optional `api: z.string().min(1).optional()` to the `react` variant in `packages/config/src/board-modules.ts` and mirror it in `schemas/spur-config.schema.json` (plus any synced CLI schema copy).
3. Extend `BoardModuleAssetRoot` with `readonly apiPath?: string` in `packages/app/src/services/board-catalog-service.ts`; validate lexical + `isFile` + fail-closed `realPath` containment inside `projectRoot` in `prepareBoardModules`.
4. Add `/api/modules/:id` and `/api/modules/:id/*` handling in `apps/server/src/modules/board/index.ts` with request-time `realPath` re-check, `(realApiPath, mtimeMs)` lazy ESM cache, URL prefix stripping, and 500 JSON error isolation.
5. Add tests covering schema validation, `prepareBoardModules` confinement, route dispatch/rewriting/error isolation, `mtimeMs` reload, and gateway proxy E2E (`/<project>/api/modules/:id/*`).
6. Update Spur module authoring docs / ADR and run `bun run lint` + targeted and full test suites.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Owner feature: A84 (`Board module backend API handlers: optional in-process Web-Fetch routes (/api/modules/:id/*)`), child of A8 (`Downstream Spur Board modules and embedded resources`).
- Downstream consumer task: `knowledge-kit` WBS `0447` (`Migrate KK Board modules to Spur native /api/modules/:id/* backend and retire kk board serve`)
- Key source files:
  - `apps/web/src/modules/contribution.ts`
  - `packages/config/src/board-modules.ts`
  - `packages/app/src/services/board-catalog-service.ts`
  - `apps/server/src/bootstrap.ts`
  - `apps/server/src/modules/board/index.ts`
  - `packages/app/src/services/project-gateway.ts`

### History

- 2026-11-26T18:46:34.314Z backlog → todo (system)

