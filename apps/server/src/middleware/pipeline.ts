import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import { contextInjector } from './context-injector';
import { globalErrorHandler } from './error-handler';
import { requestId } from './request-id';
import { requestLogger } from './request-logger';

/** Parse a comma-separated CORS origins string into a trimmed, non-empty string array. */
export const trimOrigins = (origins: string): string[] =>
    origins
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

/**
 * Mount the cross-cutting middleware pipeline on a Hono app in the
 * load-bearing order defined by design §2.2.
 *
 * Order is fixed — a reorder is a design-doc change first (invariant #7):
 *
 * 1. `secureHeaders`  — security headers on every response (existing)
 * 2. `cors`           — configurable origins; default same-origin (R2). Preflight
 *    OPTIONS succeed before requestId.
 * 3. `csrf`           — reject cross-origin state-changing requests. MUST follow
 *    `cors`, which answers preflight OPTIONS itself and never calls `next()`.
 * 4. `requestId`      — UUID v4 into `c.var.requestId`
 * 5. `bodyLimit`      — reject oversized bodies before oRPC parse (default 1 MiB)
 * 6. `requestLogger`  — structured log: method/path/status/duration/requestId
 * 7. `errorHandler`   — registered as app.onError() (Hono v4 catches at compose level)
 * 8. `compress`       — gzip/deflate for JSON responses
 * 9. `contextInjector`— sets `c.var.rt` (ServerContext lands in 0073)
 *
 * CORS default (R2): when `SPUR_CORS_ORIGINS` is unset, the default is **same-origin**
 * — no cross-origin is allowed (the allowlist is empty, so no `Access-Control-Allow-Origin`
 * is emitted for foreign origins). A wildcard (`*`) is NEVER the default: the single-operator
 * board is same-origin, and an exposed Worker must not blanket-allow every origin. Set
 * `SPUR_CORS_ORIGINS` to an explicit comma-separated allowlist to permit cross-origin clients.
 *
 * CSRF: CORS is not a request-blocking control — it governs whether a response may be
 * *read*, not whether the request runs. A cross-origin `POST` with a form-element
 * content-type (`text/plain`, `multipart/form-data`, `application/x-www-form-urlencoded`,
 * or none at all) is a "simple request": no preflight, so it reaches the handler and its
 * side effect happens even though the attacker cannot read the reply. That matters here
 * because the API is unauthenticated by design (single local operator) and exposes
 * process control — `POST /api/team/agents/:id/{start,stop}` and, since `c.req.json()`
 * parses the body without checking Content-Type, `POST /api/team/processes/:id/stdin`,
 * which writes a line into a running agent's stdin. Binding to localhost does not help:
 * the operator's own browser can reach it. `csrf()` closes this by requiring a same-origin
 * `Origin` / `Sec-Fetch-Site` on exactly those request shapes; JSON-typed API calls are
 * unaffected, so the board (same-origin) and CLI clients keep working.
 */
export function mountMiddleware(app: Hono, appRt?: ApplicationRuntime): void {
    const corsOrigins = process.env.SPUR_CORS_ORIGINS ? trimOrigins(process.env.SPUR_CORS_ORIGINS) : [];

    app.use('*', secureHeaders());
    // Same-origin default (R2): an empty allowlist means no foreign origin is echoed back.
    app.use('*', cors({ origin: corsOrigins }));
    // Mirror the CORS allowlist: same-origin is always trusted, and any origin the
    // operator explicitly opted into via SPUR_CORS_ORIGINS is trusted too. With the
    // allowlist empty (the default) this reduces to csrf()'s stock same-origin rule.
    app.use('*', csrf({ origin: (origin, c) => origin === new URL(c.req.url).origin || corsOrigins.includes(origin) }));
    app.use('*', requestId());
    app.use('*', bodyLimit({ maxSize: 1_048_576 })); // 1 MiB
    if (appRt) {
        app.use('*', requestLogger(appRt));
    }
    app.onError(globalErrorHandler);
    app.use('*', compress());
    if (appRt) {
        app.use('*', contextInjector(appRt));
    }
}
