import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';
import type { MiddlewareHandler } from 'hono';

/**
 * Structured-request-logging middleware.
 *
 * Wraps the downstream handler so it captures the final status code and
 * wall-clock duration. Successful requests (2xx/3xx) log at DEBUG to avoid
 * flooding the console during normal polling; client errors (4xx) at INFO;
 * server errors (5xx) at WARN — so the noise floor drops without losing
 * signal on failures.
 *
 * @see design §2.2 middleware pipeline position 5
 */
export const requestLogger = (appRt: ApplicationRuntime): MiddlewareHandler =>
    async function requestLoggerMiddleware(c, next) {
        const start = performance.now();
        await next();
        const duration = performance.now() - start;
        const status = c.res.status;
        const logData = {
            method: c.req.method,
            path: c.req.path,
            status,
            duration_ms: Math.round(duration * 100) / 100,
            requestId: c.get('requestId'),
        };

        if (status >= 500) {
            appRt.logger.warn(`${c.req.method} ${c.req.path}`, logData);
        } else if (status >= 400) {
            appRt.logger.info(`${c.req.method} ${c.req.path}`, logData);
        } else {
            appRt.logger.debug(`${c.req.method} ${c.req.path}`, logData);
        }
    };
