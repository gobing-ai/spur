import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';
import type { MiddlewareHandler } from 'hono';

/**
 * Structured-request-logging middleware.
 *
 * Wraps the downstream handler so it captures the final status code and
 * wall-clock duration. Logs `{ method, path, status, duration_ms, requestId }`
 * via the `ApplicationRuntime` logger.
 *
 * @see design §2.2 middleware pipeline position 5
 */
export const requestLogger = (appRt: ApplicationRuntime): MiddlewareHandler =>
    async function requestLoggerMiddleware(c, next) {
        const start = performance.now();
        await next();
        const duration = performance.now() - start;

        appRt.logger.info(`${c.req.method} ${c.req.path}`, {
            method: c.req.method,
            path: c.req.path,
            status: c.res.status,
            duration_ms: Math.round(duration * 100) / 100,
            requestId: c.get('requestId'),
        });
    };
