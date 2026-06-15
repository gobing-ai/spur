---
schema_version: 1
name: "S1: Server middleware pipeline + graceful shutdown + health endpoints"
status: done
type: task
feature_id: S1
priority: P1
tags: ["server-side-adjustment","wave-S0","group-S"]
created_at: 2026-06-15T16:01:22.479Z
updated_at: 2026-06-15T19:11:52.878Z
---

## 0072. "S1: Server middleware pipeline + graceful shutdown + health endpoints"

### Background

apps/server is a health-check stub: createApp mounts only secureHeaders() + the oRPC handler; index.ts starts Bun.serve but discards the handle (no shutdown). This task establishes the cross-cutting request lifecycle every API module inherits, production-safe shutdown on the Bun path, and split liveness/readiness health. Anchors: ADR-019 (two entries, one createApp core), Spur design §2.2 (middleware order is load-bearing), §2.7 (graceful shutdown — Bun path only; Workers are stateless).


### Requirements

R1. Ordered middleware pipeline in createApp: secureHeaders -> cors -> requestId -> bodyLimit -> requestLogger -> errorHandler -> compress -> contextInjector. Order is load-bearing (design invariant #7).
R2. CORS configurable origins via env (default same-origin).
R3. requestId injects c.var.requestId (UUID v4), threaded into logs + error responses.
R4. bodyLimit rejects oversized bodies (default 1 MiB) before oRPC parse.
R5. requestLogger structured log (method/path/status/duration/requestId) via ts-infra Logger.
R6. errorHandler global catch -> ts-utils api-response error envelope, never leaks stack in production, includes requestId.
R7. compress (gzip/deflate) for JSON.
R8. Bun index.ts captures the Bun.serve handle; SIGINT/SIGTERM -> drain in-flight (server.stop(true)) -> appRt.stop() -> flush logs -> exit.
R9. health split: GET /api/health (liveness: uptime+memory) and GET /api/health/ready (readiness: DB SELECT 1 -> 200, unreachable -> 503).
R10. ContextVariableMap extended with requestId (rt already declared).
R11. existing apps/server tests + test-cf stay green; new middleware + health tests; coverage >=90%.


### Q&A



### Design

Authority: design doc §2.2 (middleware pipeline), §2.7 (graceful shutdown), §2.1.1 (Workers have no
shutdown). Invariants #5 (two entries, one core), #7 (middleware order is fixed/load-bearing).

**Current code (verified):** `apps/server/src/bootstrap.ts` `createApp` mounts only
`secureHeaders()` (line 50), `/` redirect, `/openapi.json`, and the `/api/*` oRPC handler. `index.ts`
does `Bun.serve({ fetch: createApp(appRt).fetch, port: config.server.port })` and **discards the
handle** (no shutdown). `worker.ts` is the CF entry (stateless — no shutdown needed). `ContextVariableMap`
already declares `rt: ApplicationRuntime`.

**Middleware order (fixed — design §2.2):**
```
1. secureHeaders()        — security headers on every response incl. errors (EXISTING)
2. cors()                 — configurable origins; preflight OPTIONS must succeed before requestId
3. requestId()            — c.var.requestId (UUID v4); needed by the logger for correlation
4. bodyLimit({ maxSize }) — reject oversized body BEFORE oRPC Zod parse (default 1 MiB)
5. requestLogger()        — wraps handler; logs method/path/status/duration/requestId
6. errorHandler()         — wraps handler; unhandled throw -> api-response envelope, no stack in prod
7. compress()             — gzip/deflate the actual response body
8. contextInjector(appRt) — sets c.var.ctx (ServerContext, task 0073) right before oRPC mount
```
Rationale per middleware is in design §2.2 — DO NOT reorder; a reorder is a design-doc change first
(invariant #7). NOTE: `contextInjector` here sets `rt`/`ctx`; the ServerContext itself lands in 0073 —
this task wires the *pipeline slot* and `requestId`, and may stub `ctx` until 0073.

**Files:** new `apps/server/src/middleware/` — `pipeline.ts` (`mountMiddleware(app)` ordered),
`request-id.ts`, `request-logger.ts`, `error-handler.ts`, `context-injector.ts`. `bootstrap.ts`
`createApp` calls `mountMiddleware(app)` replacing the bare `secureHeaders()` line. Use Hono built-ins
where they exist (`hono/cors`, `hono/body-limit`, `hono/compress`, `hono/request-id` or custom) —
confirm each import path against the installed `hono@4.12.23`.

**Health split (design §2.2 / finalized S1 AC):** `GET /api/health` = liveness (uptime + memory, no
DB). `GET /api/health/ready` = readiness (DB `SELECT 1` -> 200; unreachable -> 503). The DB check needs
`ServerContext.getDb()` (0073) — until 0073, `/ready` can check only liveness and be completed in 0073,
OR sequence this after 0073's getDb lands. Recommend: ship `/health` here, finish `/ready` DB probe in
0073 (note the cross-task seam in both).

**Graceful shutdown (design §2.7 — ONLY the handle capture + signal handlers are new; the
buildConfigFromEnv -> runNodeApplication -> Bun.serve flow ALREADY EXISTS):**
```typescript
const server = Bun.serve({ fetch: createApp(appRt).fetch, port: config.server.port }); // capture handle
const shutdown = async (signal: string) => {
  appRt.logger.info({ signal }, 'Shutting down server');
  server.stop(true);            // drain in-flight (Bun default ~10s deadline)
  await appRt.stop('shutdown'); // close DB, flush logs
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
```
Confirm `appRt.stop(reason)` exists on the `ApplicationRuntime` from `runNodeApplication` (it does —
bootstrap.ts already threads `appRt`; check the `.stop` signature in ts-infra application types).

**Error envelope:** map to ts-utils `api-response` `{ ok:false, error:{ code, message, details? } }`
with `requestId`. Full error->status mapping table lands in S4 (0077); this task wires the
`errorHandler` slot + the envelope shape; reuse ts-utils errors if present.

**Out of scope:** ServerContext services (0073), infra wiring (0074), domain error->status table (0077),
module system (0075).


### Solution

Middleware pipeline implemented per design §2.2 fixed order (invariant #7):

- `apps/server/src/middleware/pipeline.ts:30` — `mountMiddleware(app, appRt)` mounts all middleware in load-bearing order + registers `app.onError(globalErrorHandler)`
- `apps/server/src/middleware/request-id.ts:17` — UUID v4 injected as `c.var.requestId`
- `apps/server/src/middleware/request-logger.ts:13` — structured log via `appRt.logger.info(msg, data)` capturing method/path/status/duration/requestId
- `apps/server/src/middleware/error-handler.ts:24` — `globalErrorHandler` using `app.onError()` with `errorResponse()` envelope; respects Hono HTTPException status codes (413, etc.), suppresses stack in production, threads `requestId`
- `apps/server/src/middleware/context-injector.ts:15` — sets `c.var.rt` (ServerContext `ctx` lands in 0073)
- `apps/server/src/bootstrap.ts:54` — `createApp` extended: `mountMiddleware` replaces bare `secureHeaders()`, `ContextVariableMap` adds `requestId` + `ctx`, `GET /api/health` (liveness: uptime + memory), `GET /api/health/ready` (readiness stub, DB probe in 0073)
- `apps/server/src/index.ts:20` — `Bun.serve` handle captured; SIGINT/SIGTERM → `server.stop(true)` → `appRt.stop('shutdown')` → exit

Tests: `apps/server/tests/middleware.test.ts` — 21 new tests (requestId, requestLogger, errorHandler/onError, contextInjector, mountMiddleware order, health endpoints, bodyLimit, pipeline integration). Existing tests updated for new health shape. `tests/cf/worker-runtime.cf.ts` updated.
### Plan


- [x] Create `apps/server/src/middleware/` with one file per concern (request-id, request-logger, error-handler, context-injector) + `pipeline.ts` exporting `mountMiddleware(app)` in the fixed order.
- [x] `cors`: read allowed origins from env (e.g. `SPUR_CORS_ORIGINS`), default same-origin; use `hono/cors`.
- [x] `requestId`: UUID v4 into `c.set('requestId', id)`; confirm `hono/request-id` vs custom against hono@4.12.23.
- [x] `bodyLimit`: `hono/body-limit`, default 1 MiB (configurable later via server config).
- [x] `requestLogger`: structured log via `appRt.logger` (method/path/status/duration/requestId); wraps the downstream handler so it sees the final status.
- [x] `errorHandler`: global try/catch -> ts-utils api-response error envelope; no stack in prod (`NODE_ENV`); include `requestId`.
- [x] `compress`: `hono/compress`.
- [x] Extend `ContextVariableMap` with `requestId: string` (keep existing `rt`; `ctx` added in 0073).
- [x] `bootstrap.ts createApp`: replace the bare `secureHeaders()` with `mountMiddleware(app)`; keep `/`, `/openapi.json`, `/api/*` mounts.
- [x] `GET /api/health` (liveness: uptime + memory). `GET /api/health/ready` slot (DB `SELECT 1` probe finished with 0073's `getDb`; mark the seam in both tasks).
- [x] `index.ts`: capture the `Bun.serve` handle; add SIGINT/SIGTERM `shutdown(signal)` -> `server.stop(true)` -> `await appRt.stop('shutdown')` -> exit; verify `appRt.stop` signature.
- [x] Tests: each middleware sets its context var / header; oversized body -> rejected pre-parse; error -> envelope with requestId, no stack in prod; `/health` 200 with uptime+memory; pipeline order asserted; existing `app.test.ts` + `bootstrap.test.ts` + `test-cf` stay green.
- [x] Gate: `bun run lint` + `bun run test` + `bun run test-cf` + `bun run build`; coverage >=90% on new middleware files.
- [x] Cross-task seam note: `/health/ready` DB probe completes in 0073; `contextInjector` sets `ctx` in 0073; error->status table is 0077.


### Review
**dev-verify verdict: PASS** (Phase 7 SECU + Phase 8 traceability, `--fix all --force`, verified 2026-06-15 by claude-code).

Task 0072 was implemented (commit `21b4eb4` + 5 follow-up fixes) and shipped `status: done`. Re-verified under `--force`. Full implementation present: `apps/server/src/middleware/{pipeline,request-id,request-logger,error-handler,context-injector}.ts` + `bootstrap.ts` health endpoints + `index.ts` graceful shutdown; 7 server/middleware test files.

**Phase 8 — Requirements traceability (11/11 addressed):**

| Req | Verdict | Evidence |
|---|---|---|
| R1 ordered pipeline | ✅ MET | `pipeline.ts:38-49` secureHeaders→cors→requestId→bodyLimit→requestLogger→onError→compress→contextInjector. errorHandler is `app.onError()` (Hono v4 compose-level catch) not inline — correct, documented `error-handler.ts:18-22`. |
| R2 CORS configurable, default same-origin | ✅ MET (after fix) | `pipeline.ts:51` reads `SPUR_CORS_ORIGINS`. **Was `'*'` default (SECU-1) — FIXED to same-origin (empty allowlist).** |
| R3 requestId UUID v4 | ✅ MET | `request-id.ts:14` `crypto.randomUUID()`; threaded to logs + errors. |
| R4 bodyLimit 1 MiB pre-parse | ✅ MET | `pipeline.ts:41` `bodyLimit({maxSize:1_048_576})` before oRPC mount; tested (413 on oversized). |
| R5 structured logger | ✅ MET | `request-logger.ts:19-25` method/path/status/duration_ms/requestId. |
| R6 error envelope, no prod stack, requestId | ✅ MET | `error-handler.ts:26-39` ts-utils `errorResponse`; prod gates message+stack; includes requestId; respects `HTTPException.status`. |
| R7 compress | ✅ MET | `pipeline.ts:46`. |
| R8 shutdown handle + signals | ✅ MET (code) / ⚠️ untested | `index.ts:23-36` handle capture, SIGINT/SIGTERM → `server.stop(true)` → `appRt.stop('shutdown')` → exit. `index.ts` entrypoint block is 0% coverage (entrypoint guard, not exercised under `bun test`) — see Finding 2. |
| R9 health split | 🔶 PARTIAL (by-design deferral) | `bootstrap.ts:65-78` `/api/health` liveness (uptime+memory) ✅; `/api/health/ready` returns `{db:'deferred'}` — DB `SELECT 1` deferred to 0073 (`ServerContext.getDb()` does not exist yet). Documented cross-task seam in the task Plan. See Finding 3. |
| R10 ContextVariableMap + requestId | ✅ MET | `bootstrap.ts:13-19`. |
| R11 gates green, ≥90% | ✅ MET | lint clean (7 workspaces typecheck); server 45 pass/0 fail; test-cf pass; middleware files 100% line+func. |

**Phase 7 — SECU:**
- **S:** SECU-1 (CORS wildcard default) found + fixed. No secrets, no injection surface, error stacks gated on non-prod. `bodyLimit` defends pre-parse.
- **C:** Pipeline order sound; health routes registered before `/api/*` wildcard so they win; error-handler respects framework status codes.
- **U:** requestId correlation across logs + error envelopes.
- **E:** No issues.

**Gate (post-fix):** `bun run lint` clean · server `bun test` 45 pass / 0 fail · `pipeline.ts`/`error-handler.ts`/`request-id.ts`/`request-logger.ts`/`context-injector.ts` 100% line+func · `bun run test-cf` pass.


### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | CORS default was `origin: '*'` (blanket-allow every origin), contradicting R2's stated "default same-origin for production". Low real-world risk for the single-operator local board, but a latent exposure if the Worker is ever shared, and a requirement mismatch. The existing test `health endpoint includes CORS headers` asserted only `toBeDefined()` on the header — vacuous (`headers.get()` returns `null`, which passes `toBeDefined()`), so it did not catch the wildcard. | Security (S) | `pipeline.ts:38` (cors origin), `pipeline.test.ts:98` (weak assertion) | P2 | **FIXED 2026-06-15** — default changed to same-origin (`cors({ origin: corsOrigins })` with empty allowlist → no foreign origin echoed, never `*`). Replaced the vacuous test with two real ones: a foreign Origin is NOT echoed (and never `*`), and an allowlisted `SPUR_CORS_ORIGINS` origin IS echoed. `pipeline.ts` still 100% coverage; gate green. |
| 2 | `apps/server/src/index.ts` graceful-shutdown block (R8) is at 0% line coverage — the `if (import.meta.main)` entrypoint guard is never executed under `bun test`, so the SIGINT/SIGTERM → `server.stop(true)` → `appRt.stop('shutdown')` path is unverified by automated tests. The code is correct on inspection. | Correctness (C) | `index.ts:14-41` | P3 | **ACCEPTED (not fixed)** — standard entrypoint-guard limitation; the shutdown logic is trivial and inspection-verified. A future hardening could extract `startServer()` (planned in task 0076) and unit-test the shutdown handler in isolation; defer to 0076 which already extracts that seam. |
| 3 | R9 `/api/health/ready` returns `{ db: 'deferred' }` rather than a real DB `SELECT 1` → 200/503. This is a DELIBERATE cross-task deferral: `ServerContext.getDb()` does not exist until task 0073, and the task Plan explicitly marks "/health/ready DB probe completes in 0073" as a seam. Not a defect. | Correctness (C) | `bootstrap.ts:76-78` | P3 | **ACCEPTED (by design)** — tracked: task 0073 replaces the stub with the real DB probe. The stub is correct for the current wave (Worker path has no DB until D1 anyway). |

No remaining P1/P2. Findings 2 and 3 are accepted deferrals tracked to tasks 0076 / 0073 respectively.


### Testing

**Verified 2026-06-15 (dev-verify, post-fix).**

- Command: `bun --cwd apps/server test --coverage` · `bun run test` · `bun run test-cf` · `bun run lint`
- Scope: all 5 middleware (requestId, requestLogger, errorHandler/onError, contextInjector, pipeline
  order) · health endpoints (liveness uptime+memory, readiness deferred-stub, root redirect, CORS
  same-origin default, security headers) · bodyLimit (oversized→413, within-limit pass) · pipeline
  integration (OpenAPI served, not-found 404 JSON, requestId on error responses) · CORS R2 (foreign
  origin NOT echoed / never `*`; allowlisted `SPUR_CORS_ORIGINS` origin echoed) · graceful shutdown
  (code-review only — `index.ts` entrypoint guard, Finding 2).
- Result: **server 45 pass / 0 fail**; all workspaces **1298 pass / 0 fail**; plugins/sp **158 pass /
  0 fail**; **test-cf 1 pass / 0 fail**.
- Coverage: `pipeline.ts` / `error-handler.ts` / `request-id.ts` / `request-logger.ts` /
  `context-injector.ts` all **100% line + function**; `bootstrap.ts` 100% line / 97.83% func. Coverage
  gate: PASS. (`index.ts` entrypoint block uncovered — Finding 2, accepted, deferred to 0076.)
- Evidence (real file layout — tests are split per concern, not a single `middleware.test.ts`):
  `apps/server/tests/middleware/{pipeline,request-id,request-logger,error-handler,context-injector,helpers}.test.ts`,
  `apps/server/tests/{app,bootstrap,openapi,router,worker,worker-retry}.test.ts`,
  `apps/server/tests/*.cf.ts` (Workers runtime via vitest).
- Gate: `bun run lint` clean (7 workspaces typecheck) · `bun run test` 1298/0 + 158/0 ·
  `bun run test-cf` 1/0 · `bun run build` (CLI + server + web) OK.


### References



### History

- 2026-06-15T19:11:49.812Z backlog → todo (system)
- 2026-06-15T19:11:52.878Z todo → wip (system)
