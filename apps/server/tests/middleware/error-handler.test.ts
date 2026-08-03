import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WbsCollisionError } from '@gobing-ai/spur-app';
import { EventBus } from '@gobing-ai/ts-infra';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { ConflictError, NotFoundError, ValidationError } from '@gobing-ai/ts-utils';
import { Hono } from 'hono';
import { createServerContext } from '../../src/context';
import { GuardDeniedError, LockTimeoutError } from '../../src/errors';
import { globalErrorHandler } from '../../src/middleware/error-handler';
import { mockRuntime } from './helpers';

function app() {
    const a = new Hono();
    a.onError(globalErrorHandler);
    return a;
}

/** Error envelope shape asserted by these tests (matches globalErrorHandler output). */
interface ErrorEnvelope {
    ok: boolean;
    error: { code: string; message?: string; details: Record<string, unknown> };
}

/** Parse JSON response body — cast for test assertions (Hono returns unknown). */
async function json(res: Response): Promise<ErrorEnvelope> {
    return (await res.json()) as ErrorEnvelope;
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

    test('WbsCollisionError -> 409 WBS_COLLISION', async () => {
        const a = app();
        a.get('/test', () => {
            throw new WbsCollisionError('0150', '/corpus/docs/tasks3/0150_x.md', '/corpus/docs/tasks3/0150_y.md');
        });
        const res = await a.request('/test');
        expect(res.status).toBe(409);
        const body = await json(res);
        expect(body.ok).toBe(false);
        expect(body.error.code).toBe('WBS_COLLISION');
        expect(body.error.details).toMatchObject({
            wbs: '0150',
            existingPath: '/corpus/docs/tasks3/0150_x.md',
            attemptedPath: '/corpus/docs/tasks3/0150_y.md',
        });
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

    test('generic Error is no longer string-matched to GUARD_DENIED (use GuardDeniedError)', async () => {
        const a = app();
        a.get('/test', () => {
            throw new Error('Lifecycle transition denied for task 0001: wip → done');
        });
        const res = await a.request('/test');
        // String matching removed — only instanceof GuardDeniedError maps to 409.
        expect(res.status).toBe(500);
        const body = await json(res);
        expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    test('generic Error is no longer string-matched to LOCK_TIMEOUT (use LockTimeoutError)', async () => {
        const a = app();
        a.get('/test', () => {
            throw new Error('Cannot acquire create allocation lock at /tmp/.create.lock: held by pid 12345');
        });
        const res = await a.request('/test');
        expect(res.status).toBe(500);
        const body = await json(res);
        expect(body.error.code).toBe('INTERNAL_ERROR');
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

    test('HTTPException status 409 → CONFLICT code', async () => {
        const a = app();
        a.get('/test', () => {
            throw new (class extends Error {
                status = 409;
            })('Conflict');
        });
        const res = await a.request('/test');
        expect(res.status).toBe(409);
        const body = await json(res);
        expect(body.error.code).toBe('CONFLICT');
    });

    test('HTTPException status 422 → VALIDATION_FAILED code', async () => {
        const a = app();
        a.get('/test', () => {
            throw new (class extends Error {
                status = 422;
            })('Validation failed');
        });
        const res = await a.request('/test');
        expect(res.status).toBe(422);
        const body = await json(res);
        expect(body.error.code).toBe('VALIDATION_FAILED');
    });

    test('HTTPException status 503 → LOCK_TIMEOUT code', async () => {
        const a = app();
        a.get('/test', () => {
            throw new (class extends Error {
                status = 503;
            })('Lock timeout');
        });
        const res = await a.request('/test');
        expect(res.status).toBe(503);
        const body = await json(res);
        expect(body.error.code).toBe('LOCK_TIMEOUT');
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

    test('production non-500 envelopes use status-appropriate messages (R2)', async () => {
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const a404 = app();
            a404.get('/n', () => {
                throw new NotFoundError('secret path');
            });
            const r404 = await a404.request('/n');
            expect(r404.status).toBe(404);
            expect((await json(r404)).error.message).toBe('Not found');

            const a422 = app();
            a422.get('/v', () => {
                throw new (class extends Error {
                    status = 422;
                })('field X invalid');
            });
            const r422 = await a422.request('/v');
            expect(r422.status).toBe(422);
            expect((await json(r422)).error.message).toBe('Bad request');

            const a500 = app();
            a500.get('/e', () => {
                throw new Error('stack should not leak');
            });
            const r500 = await a500.request('/e');
            expect(r500.status).toBe(500);
            expect((await json(r500)).error.message).toBe('Internal server error');
        } finally {
            process.env.NODE_ENV = prev;
        }
    });
    // ── F7: api.request.error system event emission (task 0226) ──────────
    test('[R8] emits api.request.error on the bus when ctx is available', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-f7-'));
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const ctx = createServerContext(mockRuntime(), {
            cwd,
            fs: createNodeFileSystem('/tmp/test'),
            dbUrl: ':memory:',
            eventsBus: bus,
        });
        const emitted: { name: string; payload: Record<string, unknown> }[] = [];
        bus.on('api.request.error', (payload: unknown) => {
            emitted.push({ name: 'api.request.error', payload: payload as Record<string, unknown> });
        });
        const a = new Hono();
        a.use('*', async (c, next) => {
            c.set('requestId', 'f7-req-001');
            c.set('ctx', ctx);
            await next();
        });
        a.get('/api/test', () => {
            throw new NotFoundError('resource gone');
        });
        a.onError(globalErrorHandler);
        const res = await a.request('/api/test');
        expect(res.status).toBe(404);
        expect(emitted).toHaveLength(1);
        const evt = emitted[0];
        expect(evt).toBeDefined();
        if (!evt) return;
        expect(evt.name).toBe('api.request.error');
        expect(evt.payload.method).toBe('GET');
        expect(evt.payload.path).toBe('/api/test');
        expect(evt.payload.status).toBe(404);
        expect(evt.payload.code).toBe('NOT_FOUND');
        expect(evt.payload.requestId).toBe('f7-req-001');
    });

    test('[R8] does NOT emit api.request.error when ctx is undefined (non-API route)', async () => {
        const a = new Hono();
        a.use('*', async (c, next) => {
            c.set('requestId', 'f7-req-002');
            await next();
        });
        a.get('/static/asset', () => {
            throw new NotFoundError('no asset');
        });
        a.onError(globalErrorHandler);
        const res = await a.request('/static/asset');
        expect(res.status).toBe(404);
        // No ctx on the Hono context → no bus emit. The response is still correct.
        const body = await json(res);
        expect(body.ok).toBe(false);
        expect(body.error.code).toBe('NOT_FOUND');
    });
});
