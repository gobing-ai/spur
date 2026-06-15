import { errorResponse } from '@gobing-ai/ts-utils';
import type { ErrorHandler } from 'hono';

/**
 * Global error handler for Hono `app.onError()`.
 *
 * Catches unhandled throws in handlers and maps them to a structured
 * `{ code, message, result, data }` envelope (ts-utils `ApiErrorEnvelope`).
 * Never leaks the raw error message or stack in production
 * (`NODE_ENV === 'production'`).
 *
 * Respects Hono `HTTPException.status` so that framework-level errors
 * (e.g. `bodyLimit` 413, `notFound` 404) preserve their intended status code.
 *
 * Threads the `requestId` from the context into every error response so
 * clients can correlate failures with request logs.
 *
 * NOTE: Hono v4 catches errors at the compose level, so this MUST be
 * registered via `app.onError()`, not as middleware with `try/catch` around
 * `await next()`.
 *
 * @see design §2.2 middleware pipeline position 6 (implemented as onError)
 */
export const globalErrorHandler: ErrorHandler = (err, c) => {
    const requestId = c.get('requestId');
    const isProd = (process.env.NODE_ENV ?? '') === 'production';

    // Respect Hono's HTTPException status code (e.g. bodyLimit → 413)
    const status: number = (err as { status?: number }).status ?? 500;

    const message = isProd ? 'Internal server error' : String(err instanceof Error ? err.message : err);
    const details = isProd
        ? undefined
        : err instanceof Error
          ? { stack: err.stack, requestId }
          : { raw: String(err), requestId };

    const envelope = errorResponse(status, message, details);
    return c.json(envelope, status as never);
};
