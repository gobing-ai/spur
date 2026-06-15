import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
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
 * 3. `requestId`      — UUID v4 into `c.var.requestId`
 * 4. `bodyLimit`      — reject oversized bodies before oRPC parse (default 1 MiB)
 * 5. `requestLogger`  — structured log: method/path/status/duration/requestId
 * 6. `errorHandler`   — registered as app.onError() (Hono v4 catches at compose level)
 * 7. `compress`       — gzip/deflate for JSON responses
 * 8. `contextInjector`— sets `c.var.rt` (ServerContext lands in 0073)
 *
 * CORS default (R2): when `SPUR_CORS_ORIGINS` is unset, the default is **same-origin**
 * — no cross-origin is allowed (the allowlist is empty, so no `Access-Control-Allow-Origin`
 * is emitted for foreign origins). A wildcard (`*`) is NEVER the default: the single-operator
 * board is same-origin, and an exposed Worker must not blanket-allow every origin. Set
 * `SPUR_CORS_ORIGINS` to an explicit comma-separated allowlist to permit cross-origin clients.
 */
export function mountMiddleware(app: Hono, appRt?: ApplicationRuntime): void {
    const corsOrigins = process.env.SPUR_CORS_ORIGINS ? trimOrigins(process.env.SPUR_CORS_ORIGINS) : [];

    app.use('*', secureHeaders());
    // Same-origin default (R2): an empty allowlist means no foreign origin is echoed back.
    app.use('*', cors({ origin: corsOrigins }));
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
