---
name: "S1: Server middleware pipeline + graceful shutdown + health endpoints"
description: "S1: Server middleware pipeline + graceful shutdown + health endpoints"
status: Backlog
created_at: 2026-06-15T16:01:22.479Z
updated_at: 2026-06-15T16:01:22.479Z
folder: docs/tasks
type: task
feature-id: S1
priority: P1
estimated_hours: 10
tags: ["server-side-adjustment","wave-S0","group-S"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0072. "S1: Server middleware pipeline + graceful shutdown + health endpoints"

### Background

apps/server is a health-check stub: createApp mounts only secureHeaders() + the oRPC handler; index.ts starts Bun.serve but discards the handle (no shutdown). This task establishes the cross-cutting request lifecycle every API module inherits, production-safe shutdown on the Bun path, and split liveness/readiness health. Anchors: ADR-019 (two entries, one createApp core), Spur design §2.2 (middleware order is load-bearing), §2.7 (graceful shutdown — Bun path only; Workers are stateless).


### Requirements

R1: Ordered middleware pipeline in createApp: secureHeaders -> cors -> requestId -> bodyLimit -> requestLogger -> errorHandler -> compress -> contextInjector. Order is load-bearing (design invariant #7). R2: CORS configurable origins via env (default same-origin). R3: requestId injects c.var.requestId (UUID v4), threaded into logs + error responses. R4: bodyLimit rejects oversized bodies (default 1 MiB) before oRPC parse. R5: requestLogger structured log (method/path/status/duration/requestId) via ts-infra Logger. R6: errorHandler global catch -> ts-utils api-response error envelope, never leaks stack in production, includes requestId. R7: compress (gzip/deflate) for JSON. R8: Bun index.ts captures the Bun.serve handle; SIGINT/SIGTERM -> drain in-flight (server.stop(true)) -> appRt.stop() -> flush logs -> exit. R9: health split: GET /api/health (liveness: uptime+memory) and GET /api/health/ready (readiness: DB SELECT 1 -> 200, unreachable -> 503). R10: ContextVariableMap extended with requestId (rt already declared). R11: existing apps/server tests + test-cf stay green; new middleware + health tests; coverage >=90%.


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



### Plan

- [ ] Create `apps/server/src/middleware/` with one file per concern (request-id, request-logger, error-handler, context-injector) + `pipeline.ts` exporting `mountMiddleware(app)` in the fixed order.
- [ ] `cors`: read allowed origins from env (e.g. `SPUR_CORS_ORIGINS`), default same-origin; use `hono/cors`.
- [ ] `requestId`: UUID v4 into `c.set('requestId', id)`; confirm `hono/request-id` vs custom against hono@4.12.23.
- [ ] `bodyLimit`: `hono/body-limit`, default 1 MiB (configurable later via server config).
- [ ] `requestLogger`: structured log via `appRt.logger` (method/path/status/duration/requestId); wraps the downstream handler so it sees the final status.
- [ ] `errorHandler`: global try/catch -> ts-utils api-response error envelope; no stack in prod (`NODE_ENV`); include `requestId`.
- [ ] `compress`: `hono/compress`.
- [ ] Extend `ContextVariableMap` with `requestId: string` (keep existing `rt`; `ctx` added in 0073).
- [ ] `bootstrap.ts createApp`: replace the bare `secureHeaders()` with `mountMiddleware(app)`; keep `/`, `/openapi.json`, `/api/*` mounts.
- [ ] `GET /api/health` (liveness: uptime + memory). `GET /api/health/ready` slot (DB `SELECT 1` probe finished with 0073's `getDb`; mark the seam in both tasks).
- [ ] `index.ts`: capture the `Bun.serve` handle; add SIGINT/SIGTERM `shutdown(signal)` -> `server.stop(true)` -> `await appRt.stop('shutdown')` -> exit; verify `appRt.stop` signature.
- [ ] Tests: each middleware sets its context var / header; oversized body -> rejected pre-parse; error -> envelope with requestId, no stack in prod; `/health` 200 with uptime+memory; pipeline order asserted; existing `app.test.ts` + `bootstrap.test.ts` + `test-cf` stay green.
- [ ] Gate: `bun run lint` + `bun run test` + `bun run test-cf` + `bun run build`; coverage >=90% on new middleware files.
- [ ] Cross-task seam note: `/health/ready` DB probe completes in 0073; `contextInjector` sets `ctx` in 0073; error->status table is 0077.


### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


