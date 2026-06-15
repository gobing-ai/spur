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

/**
 * Mount the cross-cutting middleware pipeline on a Hono app in the
 * load-bearing order defined by design §2.2.
 *
 * Order is fixed — a reorder is a design-doc change first (invariant #7):
 *
 * 1. `secureHeaders`  — security headers on every response (existing)
 * 2. `cors`           — configurable origins; preflight OPTIONS succeed before requestId
 * 3. `requestId`      — UUID v4 into `c.var.requestId`
 * 4. `bodyLimit`      — reject oversized bodies before oRPC parse (default 1 MiB)
 * 5. `requestLogger`  — structured log: method/path/status/duration/requestId
 * 6. `errorHandler`   — global catch → ts-utils error envelope
 * 7. `compress`       — gzip/deflate for JSON responses
 * 8. `contextInjector`— sets `c.var.rt` (ServerContext lands in 0073)
 */
export const trimOrigins = (origins: string): string[] =>
    origins
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

export function mountMiddleware(app: Hono, appRt?: ApplicationRuntime): void {
    const corsOrigins = process.env.SPUR_CORS_ORIGINS ? trimOrigins(process.env.SPUR_CORS_ORIGINS) : [];

    app.use('*', secureHeaders());
    app.use('*', cors({ origin: corsOrigins.length > 0 ? corsOrigins : '*' }));
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
