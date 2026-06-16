import { isAppError } from '@gobing-ai/ts-utils';
import type { ErrorHandler } from 'hono';
import { GuardDeniedError, LockTimeoutError } from '../errors';

/**
 * Build a contract-compliant error envelope.
 *
 * Contract shape (packages/contracts/src/shared.ts):
 * `{ ok: false, error: { code: ApiErrorCode, message: string, details?: unknown } }`
 */
function errorEnvelope(code: string, message: string, details?: unknown) {
    return { ok: false as const, error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

/**
 * Global error handler for Hono `app.onError()`.
 *
 * Catches unhandled throws in handlers and maps them to the contract
 * error envelope `{ ok: false, error: { code, message, details? } }`.
 *
 * Mapping table (design §2.9.2):
 *
 * | Error class / pattern         | HTTP | API error code    |
 * |-------------------------------|------|-------------------|
 * | NotFoundError (ts-utils)      | 404  | NOT_FOUND         |
 * | ValidationError (ts-utils)    | 422  | VALIDATION_FAILED |
 * | ConflictError (ts-utils)      | 409  | CONFLICT          |
 * | GuardDeniedError              | 409  | GUARD_DENIED      |
 * | LockTimeoutError              | 503  | LOCK_TIMEOUT      |
 * | "Lifecycle transition denied" | 409  | GUARD_DENIED      |
 * | "Cannot acquire …lock"       | 503  | LOCK_TIMEOUT      |
 * | Unknown / InternalError       | 500  | INTERNAL_ERROR    |
 *
 * Never leaks raw error messages or stacks in production.
 * Respects Hono HTTPException.status. Threads `requestId`.
 */
export const globalErrorHandler: ErrorHandler = (err, c) => {
    const requestId = c.get('requestId');
    const isProd = (process.env.NODE_ENV ?? '') === 'production';

    // Respect Hono's HTTPException status code
    if ((err as { status?: number }).status !== undefined) {
        const status: number = (err as { status?: number }).status ?? 500;
        const msg = isProd ? 'Internal server error' : String(err instanceof Error ? err.message : err);
        const details = isProd
            ? undefined
            : err instanceof Error
              ? { stack: err.stack, requestId }
              : { raw: String(err), requestId };
        return c.json(errorEnvelope('INTERNAL_ERROR', msg, details), status as never);
    }

    const message = err instanceof Error ? err.message : String(err);

    // Guard denied (typed)
    if (err instanceof GuardDeniedError) {
        return c.json(
            errorEnvelope('GUARD_DENIED', isProd ? 'Transition blocked by lifecycle guard' : message, { requestId }),
            409,
        );
    }

    // Lock timeout (typed)
    if (err instanceof LockTimeoutError) {
        return c.json(
            errorEnvelope('LOCK_TIMEOUT', isProd ? 'Write lock timed out — retry later' : message, { requestId }),
            503,
        );
    }

    // ts-utils AppError
    if (isAppError(err)) {
        const errCode = (err as { code?: string }).code;
        const code =
            errCode === 'NOT_FOUND' ? 404 : errCode === 'VALIDATION' ? 422 : errCode === 'CONFLICT' ? 409 : 500;
        const apiCode =
            code === 404
                ? 'NOT_FOUND'
                : code === 422
                  ? 'VALIDATION_FAILED'
                  : code === 409
                    ? 'CONFLICT'
                    : 'INTERNAL_ERROR';
        const clientMsg = isProd ? 'Internal server error' : code === 500 ? 'Internal server error' : message;
        return c.json(errorEnvelope(apiCode, clientMsg, isProd ? undefined : { requestId }), code as never);
    }

    // Legacy generic Error pattern matching (PlanningWriteService throws generic Error)
    if (message.includes('Lifecycle transition denied')) {
        return c.json(
            errorEnvelope('GUARD_DENIED', isProd ? 'Transition blocked by lifecycle guard' : message, { requestId }),
            409,
        );
    }

    if (message.includes('Cannot acquire') && message.includes('lock')) {
        return c.json(
            errorEnvelope('LOCK_TIMEOUT', isProd ? 'Write lock timed out — retry later' : message, { requestId }),
            503,
        );
    }

    // Unknown / internal
    const details = isProd
        ? undefined
        : err instanceof Error
          ? { stack: err.stack, requestId }
          : { raw: String(err), requestId };
    return c.json(errorEnvelope('INTERNAL_ERROR', isProd ? 'Internal server error' : message, details), 500);
};
