import { describe, expect, test } from 'bun:test';
import { ConflictError, NotFoundError, ValidationError } from '@gobing-ai/ts-utils';
import { Hono } from 'hono';
import { GuardDeniedError, LockTimeoutError } from '../../src/errors';
import { globalErrorHandler } from '../../src/middleware/error-handler';

function app() {
    const a = new Hono();
    a.onError(globalErrorHandler);
    return a;
}

/** Parse JSON response body — cast for test assertions (Hono returns unknown). */
// biome-ignore lint/suspicious/noExplicitAny: test helper for JSON body assertions
async function json(res: Response): Promise<any> {
    return res.json();
}

describe('globalErrorHandler', () => {
    test('NotFoundError → 404', async () => {
        const a = app();
        a.get('/test', () => {
            throw new NotFoundError('Task 0001 not found');
        });
        const res = await a.request('/test');
        expect(res.status).toBe(404);
        const body = await json(res);
        expect(body.ok).toBe(false);
        expect(body.error.code).toBe('NOT_FOUND');
    });

    test('ValidationError → 422', async () => {
        const a = app();
        a.get('/test', () => {
            throw new ValidationError('Invalid input');
        });
        const res = await a.request('/test');
        expect(res.status).toBe(422);
        const body = await json(res);
        expect(body.ok).toBe(false);
        expect(body.error.code).toBe('VALIDATION_FAILED');
    });

    test('ConflictError → 409', async () => {
        const a = app();
        a.get('/test', () => {
            throw new ConflictError('Resource conflict');
        });
        const res = await a.request('/test');
        expect(res.status).toBe(409);
        const body = await json(res);
        expect(body.ok).toBe(false);
        expect(body.error.code).toBe('CONFLICT');
    });

    test('GuardDeniedError → 409 GUARD_DENIED', async () => {
        const a = app();
        a.get('/test', () => {
            throw new GuardDeniedError('Transition blocked by lifecycle guard');
        });
        const res = await a.request('/test');
        expect(res.status).toBe(409);
        const body = await json(res);
        expect(body.ok).toBe(false);
        expect(body.error.code).toBe('GUARD_DENIED');
    });

    test('LockTimeoutError → 503', async () => {
        const a = app();
        a.get('/test', () => {
            throw new LockTimeoutError('Write lock timed out');
        });
        const res = await a.request('/test');
        expect(res.status).toBe(503);
        const body = await json(res);
        expect(body.ok).toBe(false);
        expect(body.error.code).toBe('LOCK_TIMEOUT');
    });

    test('"Lifecycle transition denied" message → 409 GUARD_DENIED', async () => {
        const a = app();
        a.get('/test', () => {
            throw new Error('Lifecycle transition denied for task 0001: wip → done');
        });
        const res = await a.request('/test');
        expect(res.status).toBe(409);
        const body = await json(res);
        expect(body.ok).toBe(false);
        expect(body.error.code).toBe('GUARD_DENIED');
    });

    test('"Cannot acquire … lock" message → 503 LOCK_TIMEOUT', async () => {
        const a = app();
        a.get('/test', () => {
            throw new Error('Cannot acquire create allocation lock at /tmp/.create.lock: held by pid 12345');
        });
        const res = await a.request('/test');
        expect(res.status).toBe(503);
        const body = await json(res);
        expect(body.ok).toBe(false);
        expect(body.error.code).toBe('LOCK_TIMEOUT');
    });

    test('unknown error → 500 INTERNAL_ERROR', async () => {
        const a = app();
        a.get('/test', () => {
            throw new Error('Something unexpected');
        });
        const res = await a.request('/test');
        expect(res.status).toBe(500);
        const body = await json(res);
        expect(body.ok).toBe(false);
        expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    test('Hono HTTPException preserves status; unmapped status → INTERNAL_ERROR', async () => {
        const a = app();
        a.get('/test', () => {
            throw new (class extends Error {
                status = 413;
            })('Payload too large');
        });
        const res = await a.request('/test');
        expect(res.status).toBe(413);
        // 413 has no matching ApiErrorCode in the closed enum — falls back to INTERNAL_ERROR.
        const body = await json(res);
        expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    test('Hono HTTPException with a mapped status uses the matching code, not INTERNAL_ERROR', async () => {
        const a = app();
        a.get('/test', () => {
            throw new (class extends Error {
                status = 404;
            })('No such route');
        });
        const res = await a.request('/test');
        expect(res.status).toBe(404);
        // The envelope code must agree with the status (regression: was always INTERNAL_ERROR).
        const body = await json(res);
        expect(body.error.code).toBe('NOT_FOUND');
    });

    test('error response includes requestId when available', async () => {
        const a = new Hono();
        a.use('*', async (c, next) => {
            c.set('requestId', 'test-req-123');
            await next();
        });
        a.get('/test', () => {
            throw new NotFoundError('missing');
        });
        a.onError(globalErrorHandler);
        const res = await a.request('/test');
        const body = await json(res);
        expect(body.error).toBeDefined();
        expect(body.error.details).toBeDefined();
        expect(body.error.details.requestId).toBe('test-req-123');
    });
});
