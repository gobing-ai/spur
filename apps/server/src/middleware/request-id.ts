import type { MiddlewareHandler } from 'hono';

/**
 * Injects a UUID v4 `requestId` into the Hono context.
 *
 * Set as `c.var.requestId` so downstream middleware (logger, error handler) and
 * oRPC procedures can read it. Uses `crypto.randomUUID()` (Bun + Workers both
 * support it).
 *
 * @see design §2.2 middleware pipeline position 3
 */
export const requestId = (): MiddlewareHandler =>
    async function requestIdMiddleware(c, next) {
        c.set('requestId', crypto.randomUUID());
        await next();
    };
