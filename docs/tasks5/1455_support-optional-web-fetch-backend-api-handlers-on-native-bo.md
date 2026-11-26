---
schema_version: 1
name: Support optional Web-Fetch backend API handlers on native Board modules (/api/modules/:id/*)
status: done
template: feature-impl
created_at: 2026-11-26T18:16:32.513Z
updated_at: "2026-11-26T20:34:57.135Z"

priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 6
feature_id: A84
done_forced: "false"
done_reason: unforced close
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

- [x] R1. Extend `bootstrap.modules` (`type: 'react'`) in `packages/config/src/board-modules.ts` and `schemas/spur-config.schema.json` with an optional `api?: string` field (non-empty project-relative path to a built ESM bundle); reject `api` on `type: 'iframe'` and keep `.strict()` / `additionalProperties: false`.
- [x] R2. Export `BoardModuleApiContext` (`{ readonly projectPath: string; readonly moduleId: string }`) and `BoardModuleApiHandler` (`{ fetch(request: Request, ctx: BoardModuleApiContext): Response | Promise<Response> }`) from `apps/web/src/modules/contribution.ts` and regenerate `apps/cli/board/index.d.ts` via `packages/app/src/builder/emit-board-types.ts`.
- [x] R3. Validate and resolve `declaration.api` in `prepareBoardModules` (`packages/app/src/services/board-catalog-service.ts`): reject absolute paths, lexical escapes outside `projectRoot`, missing/non-file targets, and fail-closed `realPath` escapes outside `realProjectRoot`; expose `readonly apiPath?: string` on `BoardModuleAssetRoot` only (never in the public `BoardModuleDescriptor` catalog DTO).
- [x] R4. Mount `/api/modules/:id` and `/api/modules/:id/*` in `boardModule` (`apps/server/src/modules/board/index.ts`): return 404 JSON for unknown/disabled modules or modules without `apiPath`; re-verify fail-closed `realPath` confinement inside `realProjectRoot` at request time; strip `/api/modules/:id` (defaulting empty remainder to `/`, preserving query string, method, headers, and body) before calling `handler.fetch(rewrittenRequest, { projectPath, moduleId })`; isolate thrown errors or malformed exports into a 500 JSON response without crashing the server.
- [x] R5. Cache loaded handlers by `(realApiPath, mtimeMs)` using dynamic ESM import with a `?v=<mtimeMs>` cache-buster so rebuilding `api.js` takes effect on the next request without restarting `spur self serve`, and multiple modules pointing at the same `api.js` share one loaded instance.
- [x] R6. Verify same-origin gateway proxying (`/<project>/api/modules/:id/*`) works end-to-end across `GET`/`POST` requests (including query strings and request/response bodies) through `createGatewayHandler` without CORS headers or a separate loopback port, and update Spur module authoring docs in the same commit.

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

**Approach**

One optional `api` field on a `react` declaration names a project-relative built ESM bundle. Startup
confines and resolves it (lexical + `isFile` + fail-closed `realPath`), and the existing Board server
module mounts `/api/modules/<id>/*` ahead of oRPC so a module's Web-Fetch handler inherits the host
guard and CSRF. Nothing about the deployment changes: no second process, no port, no CORS, and a
module without `api` keeps the shipped asset-only behaviour.

Loading deviates from the task's planned `?v=<mtimeMs>` import cache-buster: Bun keys its module
registry by file path and ignores query/hash cache busters (verified directly), so `import()` never
sees a rebuilt file. The loader therefore resolves through `createRequire`, evicts that entry, and
re-requires — keyed per real path and `mtimeMs`. The known limit (a bundle using top-level await
cannot be re-evaluated) is recorded in the code and in the design satellite.

**Change map**

| Change | Anchor |
| --- | --- |
| Optional `api` on the strict react declaration variant | `packages/config/src/board-modules.ts:94` |
| The mirrored JSON-Schema property (react branch only) | `apps/cli/schemas/spur-config.schema.json:189` |
| Published type-only handler contract (`BoardModuleApiContext`, `BoardModuleApiHandler`) | `apps/web/src/modules/contribution.ts:47` |
| Generated declaration entry carrying both interfaces | `apps/cli/board/index.d.ts:46` |
| `apiPath` on the server-only asset root (never the catalog DTO) | `packages/app/src/services/board-catalog-service.ts:39` |
| Project-root-relative resolution of the declared bundle | `packages/app/src/services/board-catalog-service.ts:130` |
| Startup confinement: lexical escape, `isFile`, fail-closed `realPath` | `packages/app/src/services/board-catalog-service.ts:284` |
| `/api/modules` mount prefix | `apps/server/src/modules/board/index.ts:122` |
| Path split into module id + module-relative suffix | `apps/server/src/modules/board/index.ts:149` |
| Per-real-path, `mtimeMs`-keyed bundle cache with request-time confinement | `apps/server/src/modules/board/index.ts:171` |
| Cache-evicting evaluation of a rebuilt bundle | `apps/server/src/modules/board/index.ts:201` |
| Rewritten dispatch, 404/500 JSON isolation | `apps/server/src/modules/board/index.ts:217` |
| Mount registration ahead of the oRPC `/api/*` handler | `apps/server/src/modules/board/index.ts:297` |

Documentation in the same change: the authoring guide's declaration example and the new §6.6 backend
routes contract (`docs/design/downstream-board-modules.md`), the end-user trust section
(`docs/help/how_to_customize_project_modules.md`), and the architecture paragraph that still said
"accepted, not built" (`docs/03_ARCHITECTURE.md`).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/config/src/board-modules.ts:94` adds optional non-empty `api` to the strict react variant; `apps/cli/schemas/spur-config.schema.json:189` mirrors it (`minLength: 1`). `(cd packages/config && bun test tests/board-modules.test.ts)` → 20 pass, 0 fail (re-run 2026-11-26). |
| R2 | MET | `apps/web/src/modules/contribution.ts:47` / `:64` declare `BoardModuleApiContext` / `BoardModuleApiHandler`; `apps/cli/board/index.d.ts:46` / `:62` carry the emitted interfaces. `bun run typecheck` → all workspaces exit 0 (re-run). |
| R3 | MET | `packages/app/src/services/board-catalog-service.ts:130` resolves `api` against the project root; `packages/app/src/services/board-catalog-service.ts:284` enforces `isFile` + fail-closed `realPath`; `packages/app/src/services/board-catalog-service.ts:39` keeps `apiPath` on `BoardModuleAssetRoot` only. `(cd packages/app && bun test tests/services/board-catalog-service.test.ts)` → 21 pass, 0 fail. |
| R4 | MET | `apps/server/src/modules/board/index.ts:217` dispatch (404 before bundle touch, request-time real-path re-check, prefix strip, 500 isolation); `apps/server/src/modules/board/index.ts:297` mounts inside `registerModules`, which `apps/server/src/bootstrap.ts:37` runs after `mountMiddleware` and before oRPC. `apps/server/tests/board-module-api.test.ts:140` through `:240` pass. |
| R5 | MET | `apps/server/src/modules/board/index.ts:171` per-real-path `mtimeMs` cache; `apps/server/src/modules/board/index.ts:201` evicts the require cache entry before re-evaluation (documented deviation from `?v=`, Solution §Approach). `apps/server/tests/board-module-api.test.ts:262` and `:282` pass. |
| R6 | MET | `apps/server/tests/board-module-api.test.ts:306` drives `createGatewayHandler` against a real upstream with GET+query and POST+JSON body, asserting no CORS header; docs updated in the same commit 63d226ecf (`docs/design/downstream-board-modules.md`, `docs/help/how_to_customize_project_modules.md`, `docs/03_ARCHITECTURE.md`). `(cd apps/server && bun test tests/board-module-api.test.ts)` → 18 pass, 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Config schema accepts optional `api` on react modules and rejects invalid shapes (req: R1) | MET | test | `packages/config/tests/board-modules.test.ts` — 20 pass (re-run this session). |
| AC2 — `@gobing-ai/spur/board` publishes the type-only API handler contract (req: R2) | MET | command | `apps/cli/board/index.d.ts:46`, `:62`; `bun run typecheck` exit 0 across workspaces (re-run). |
| AC3 — Startup preparation fails closed on missing or escaping `api` paths (req: R3) | MET | test | `packages/app/tests/services/board-catalog-service.test.ts` — 21 pass (re-run). |
| AC4 — `/api/modules/:id/*` dispatches rewritten requests and isolates errors (req: R4) | MET | test | `apps/server/tests/board-module-api.test.ts:140`, `:172`, `:194`, `:217`, `:240` — pass (re-run). |
| AC5 — Rebuilding `api.js` reloads automatically on mtime change (req: R5) | MET | test | `apps/server/tests/board-module-api.test.ts:262`, `:282` — pass (re-run). |
| AC6 — Gateway proxies `/<project>/api/modules/:id/*` same-origin end-to-end (req: R6) | MET | test | `apps/server/tests/board-module-api.test.ts:306` — pass (re-run). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Disposition:** approve with recorded residuals. Gate: full tier PASS (`attempts: 1`,
receipt digest `dd3645f487b0`); `bun run test-cf` PASS.

**P1 (blocker).** None.

**P2 (major).**

- *Reload seam is not the planned `?v=` cache-buster.* Verified directly: Bun keys its module registry
  by file path and ignores both `?v=` and `#` busters, so `import()` returns the already-evaluated
  module and a rebuilt bundle would never take effect — the AC5 behaviour the task specified. The
  loader now resolves through `createRequire`, evicts that entry and re-requires, keyed by real path
  and `mtimeMs`. Residual: a bundle using top-level await cannot be re-evaluated, so its rebuild
  requires a server restart. Recorded as a `shortcut:` comment beside the loader, in
  `docs/design/downstream-board-modules.md` §6.6 and in `docs/03_ARCHITECTURE.md`.
- *Coverage gate vs dynamically loaded fixtures.* The gate failed on the test fixture bundles under
  the OS temp dir (bun attributes their coverage per run). Excluded `**/spur-board-api-*/**` in
  `bunfig.toml` alongside the existing `spur-wf-ext-*` precedent — fixture attribution noise, not
  product code.

**P3 (minor).**

- `moduleApiCache` keeps one entry per real path for the process lifetime; a declaration removed from
  config leaves its entry behind (a few hundred bytes, process-scoped, no code executed). Acceptable
  while declarations only change on restart.
- Two `realPath` syscalls per module-API request (project root + bundle) are deliberate: the fail-closed
  confinement must be re-proven at request time, not cached from startup.
- A module handler receives the still-encoded pathname; it decodes with `new URL(request.url)`, which is
  standard Web-Fetch behaviour rather than a project convention.

**P4 (advisory).**

- Request bodies are buffered (`arrayBuffer()`) rather than streamed before dispatch. Chosen so a
  handler sees a replayable body and the dispatch mirrors the gateway's own buffering; revisit only if
  a module needs multi-hundred-MB uploads.
- Inbound `content-length` is forwarded verbatim on body-less methods; harmless for the JSON-shaped
  module APIs this contract targets.

**Security review.** No request-derived path reaches the filesystem: the mount is resolved from the
declaration, the split id only ever indexes the prepared roots, and the bundle path is the startup
real-path checked again per request. Unknown, disabled and API-less modules are indistinguishable
(404 JSON before any bundle is touched), handler failures surface as generic 500 JSON with the detail
kept in the server log, and the host guard + CSRF still apply because the mount sits ahead of oRPC.

**Architecture.** The route lives in the existing Board server module (no new seam), the contract
stays type-only in the published entry, and `apiPath` remains server-side on `BoardModuleAssetRoot`
— never in the catalog DTO. Trust boundary (declared project code inside the server process) is the
one ADR-128's 2026-11-26 amendment already accepted.

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
- 2026-11-26T19:59:55.478Z todo → wip (system)
- 2026-11-26T19:59:58.963Z wip → testing (system)
- 2026-11-26T20:00:02.687Z testing → done (system)

