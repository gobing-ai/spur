import { WbsCollisionError } from '@gobing-ai/spur-app';
import { getEnvVar } from '@gobing-ai/spur-config';
import { DOMAIN_ERROR_CODES, type DomainErrorCode } from '@gobing-ai/spur-contracts';
import { ORPCError } from '@orpc/server';
import type { ErrorHandler } from 'hono';
import { GuardDeniedError, LockTimeoutError } from '../errors';

/** Resolved error: HTTP status, API error code, client-safe message, optional debug details. */
interface ResolvedError {
    status: number;
    apiCode: string;
    message: string;
    details?: unknown;
}

/** Fields of a Hono `HTTPException` we rely on. */
interface HttpExceptionLike {
    status: number;
    message: string;
}

/** Fields of a ts-utils `AppError` we rely on. */
interface AppErrorLike {
    code: string;
    message: string;
}

/** True when `err` carries an HTTP status (e.g. Hono `HTTPException`). */
function hasHttpStatus(err: unknown): err is HttpExceptionLike {
    return typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number';
}

/** True when `err` is a ts-utils `AppError` (carries a domain `code`). */
function isAppErrorLike(err: unknown): err is AppErrorLike {
    return (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        typeof err.code === 'string' &&
        'message' in err &&
        typeof err.message === 'string'
    );
}

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
 * Map an HTTP status to the closest `ApiErrorCode` (the closed 6-code enum has no
 * generic 4xx code), so a Hono `HTTPException` envelope's `code` agrees with its
 * status instead of always reading `INTERNAL_ERROR`. Statuses without a matching
 * code fall back to `INTERNAL_ERROR`.
 */
function apiCodeForStatus(status: number): string {
    switch (status) {
        case 404:
            return 'NOT_FOUND';
        case 409:
            return 'CONFLICT';
        case 422:
            return 'VALIDATION_FAILED';
        case 503:
            return 'LOCK_TIMEOUT';
        default:
            return 'INTERNAL_ERROR';
    }
}

/**
 * Client-safe message for a given HTTP status in production envelopes.
 * Non-500 statuses must not collapse to the generic "Internal server error".
 */
function messageForStatus(status: number): string {
    switch (status) {
        case 400:
        case 422:
            return 'Bad request';
        case 401:
            return 'Unauthorized';
        case 403:
            return 'Forbidden';
        case 404:
            return 'Not found';
        case 409:
            return 'Conflict';
        case 503:
            return 'Service unavailable';
        default:
            return status >= 500 ? 'Internal server error' : 'Request failed';
    }
}

/**
 * Resolve any thrown value into a single `{ status, apiCode, message, details }`
 * tuple. Centralizing this lets the handler emit one `api.request.error` event
 * before returning, instead of duplicating the emit across every return branch.
 *
 * Mapping table (design §2.9.2):
 *
 * | Error class / pattern         | HTTP | API error code    |
 * |-------------------------------|------|-------------------|
 * | NotFoundError (ts-utils)      | 404  | NOT_FOUND         |
 * | ValidationError (ts-utils)    | 422  | VALIDATION_FAILED |
 * | ConflictError (ts-utils)      | 409  | CONFLICT          |
 * | GuardDeniedError              | 409  | GUARD_DENIED      |
 * | WbsCollisionError             | 409  | WBS_COLLISION     |
 * | LockTimeoutError              | 503  | LOCK_TIMEOUT      |
 * | Unknown / InternalError       | 500  | INTERNAL_ERROR    |
 *
 * Never leaks raw error messages or stacks in production.
 */
function resolveError(err: unknown, requestId: string | undefined, isProd: boolean): ResolvedError {
    if (hasHttpStatus(err)) {
        const status = err.status;
        const msg = isProd ? messageForStatus(status) : err.message;
        const details = isProd ? undefined : { stack: err instanceof Error ? err.stack : undefined, requestId };
        return { status, apiCode: apiCodeForStatus(status), message: msg, details };
    }

    const message = err instanceof Error ? err.message : String(err);

    // Guard denied (typed — PlanningWriteService throws GuardDeniedError)
    if (err instanceof GuardDeniedError) {
        return {
            status: 409,
            apiCode: 'GUARD_DENIED',
            message: isProd ? 'Transition blocked by lifecycle guard' : message,
            details: { requestId },
        };
    }

    // WBS collision (typed - TaskService throws WbsCollisionError when a file
    // with the allocated WBS prefix already exists; task 0416 R1)
    if (err instanceof WbsCollisionError) {
        return {
            status: 409,
            apiCode: 'WBS_COLLISION',
            message: isProd ? 'WBS collision - task already exists' : message,
            details: { requestId, wbs: err.wbs, existingPath: err.existingPath, attemptedPath: err.attemptedPath },
        };
    }

    // Lock timeout (typed — PlanningWriteService rethrows LockTimeoutError)
    if (err instanceof LockTimeoutError) {
        return {
            status: 503,
            apiCode: 'LOCK_TIMEOUT',
            message: isProd ? 'Write lock timed out — retry later' : message,
            details: { requestId },
        };
    }

    // ts-utils AppError
    if (isAppErrorLike(err)) {
        const errCode = err.code;
        const status =
            errCode === 'NOT_FOUND' ? 404 : errCode === 'VALIDATION' ? 422 : errCode === 'CONFLICT' ? 409 : 500;
        const apiCode = apiCodeForStatus(status);
        const clientMsg = isProd ? messageForStatus(status) : message;
        return { status, apiCode, message: clientMsg, details: isProd ? undefined : { requestId } };
    }

    // Unknown / internal
    const details = isProd
        ? undefined
        : err instanceof Error
          ? { stack: err.stack, requestId }
          : { raw: String(err), requestId };
    return { status: 500, apiCode: 'INTERNAL_ERROR', message: isProd ? 'Internal server error' : message, details };
}

/**
 * API codes the typed domain-error table above owns. `toDomainORPCError`
 * produces only these, and the `/api/*` oRPC body encoder re-shapes only these —
 * every other oRPC error keeps its default body. The list lives in the
 * contracts package because the typed client's decoder reads it too
 * (task 1185): one vocabulary, so the two ends cannot disagree about which
 * codes carry the envelope.
 */
/** True when `code` is one of the typed domain-error codes the transport seam re-shapes. */
export function isDomainErrorApiCode(code: string): code is DomainErrorCode {
    return (DOMAIN_ERROR_CODES as readonly string[]).includes(code);
}

/**
 * The `/api/*` response body for a typed domain error, or `undefined` to leave oRPC's own
 * serialization in place. The encode end of the envelope whose decode end is the typed client's
 * `customErrorResponseBodyDecoder` — kept here beside {@link toDomainORPCError} so the pair is read
 * and changed together (task 1185).
 */
export function encodeDomainErrorBody(error: {
    code: string;
    message: string;
    data?: unknown;
}): { ok: false; error: { code: DomainErrorCode; message: string; details?: unknown } } | undefined {
    if (!isDomainErrorApiCode(error.code)) return undefined;
    return {
        ok: false,
        error: {
            code: error.code,
            message: error.message,
            ...(error.data !== undefined ? { details: error.data } : {}),
        },
    };
}

/**
 * Translate a thrown typed domain error into the oRPC error the `/api/*`
 * OpenAPI handler serializes, preserving the documented HTTP status.
 *
 * The oRPC handler owns `/api/*` (bootstrap.ts) and converts every thrown value
 * into a generic 500 `INTERNAL_SERVER_ERROR` response itself, so a
 * `GuardDeniedError`/`WbsCollisionError`/`LockTimeoutError` never reaches
 * `globalErrorHandler`. Returning `undefined` for anything else leaves oRPC's
 * default handling for every other error untouched.
 */
export function toDomainORPCError(err: unknown): ORPCError<string, unknown> | undefined {
    if (!(err instanceof GuardDeniedError || err instanceof WbsCollisionError || err instanceof LockTimeoutError)) {
        return undefined;
    }
    const isProd = (getEnvVar('NODE_ENV') ?? '') === 'production';
    // No Hono requestId on this path — each resolver tolerates `undefined`.
    const resolved = resolveError(err, undefined, isProd);
    return new ORPCError(resolved.apiCode, {
        status: resolved.status,
        message: resolved.message,
        data: resolved.details,
    });
}

/**
 * Global error handler for Hono `app.onError()`.
 *
 * Catches unhandled throws in handlers, maps them to the contract error envelope
 * `{ ok: false, error: { code, message, details? } }`, and emits an
 * `api.request.error` system event on the request's event bus when a
 * `ServerContext` is available on the Hono context.
 *
 * `c.get('ctx')` is set only inside the `/api/*` oRPC handler
 * (bootstrap.ts:82-83); non-API routes have no `ctx` and skip the emit. The
 * event payload (`{ method, path, status, code, requestId }`) is safe under the
 * `api.request.error` catalog entry's `metadata-only` payload policy — none of
 * its keys are in the redaction list (`body`, `content`, `message`, `prompt`,
 * `query`, `response`, `value`).
 */
export const globalErrorHandler: ErrorHandler = (err, c) => {
    const requestId = c.get('requestId');
    const isProd = (getEnvVar('NODE_ENV') ?? '') === 'production';
    const resolved = resolveError(err, requestId, isProd);

    const ctx = c.get('ctx');
    if (ctx) {
        ctx.eventBus()?.emit('api.request.error', {
            method: c.req.method,
            path: c.req.path,
            url: c.req.path,
            status: resolved.status,
            route: c.req.routePath,
            code: resolved.apiCode,
            requestId: requestId ?? null,
            error: resolved.message,
            severity: 'error',
        });
    }

    return c.json(errorEnvelope(resolved.apiCode, resolved.message, resolved.details), resolved.status as never);
};
