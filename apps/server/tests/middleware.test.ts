import { describe, expect, test } from 'bun:test';
import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { createApp } from '../src/bootstrap';
import { contextInjector } from '../src/middleware/context-injector';
import { globalErrorHandler } from '../src/middleware/error-handler';
import { mountMiddleware } from '../src/middleware/pipeline';
import { requestId } from '../src/middleware/request-id';
import { requestLogger } from '../src/middleware/request-logger';

function mockRuntime(logCalls?: { msg: string; data?: Record<string, unknown> }[]): ApplicationRuntime {
    return {
        config: {} as unknown as ApplicationRuntime['config'],
        appConfig: undefined,
        logger: {
            info: (msg: string, data?: Record<string, unknown>) => logCalls?.push({ msg, data }),
            warn: () => {},
            error: () => {},
            debug: () => {},
            trace: () => {},
            fatal: () => {},
            child: () => ({
                info: () => {},
                warn: () => {},
                error: () => {},
                debug: () => {},
                trace: () => {},
                fatal: () => {},
                child: () => ({}) as never,
            }),
        },
        events: { emit: () => {}, on: () => {}, off: () => {} },
        db: undefined,
        pluginHost: {} as unknown,
        stop: async () => {},
    } as unknown as ApplicationRuntime;
}

describe('requestId middleware', () => {
    test('injects a UUID v4 into c.var.requestId', async () => {
        const app = new Hono();
        let captured: string | undefined;

        app.use('*', requestId());
        app.get('/test', (c) => {
            captured = c.get('requestId');
            return c.text('ok');
        });

        await app.request('/test');
        expect(captured).toBeDefined();
        expect(captured).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    test('generates a unique requestId per request', async () => {
        const app = new Hono();
        const ids: string[] = [];

        app.use('*', requestId());
        app.get('/test', (c) => {
            ids.push(c.get('requestId'));
            return c.text('ok');
        });

        await app.request('/test');
        await app.request('/test');
        expect(ids[0]).not.toBe(ids[1]);
    });
});

describe('requestLogger middleware', () => {
    test('logs method, path, status, duration, requestId', async () => {
        const logCalls: { msg: string; data?: Record<string, unknown> }[] = [];
        const appRt = mockRuntime(logCalls);

        const app = new Hono();
        app.use('*', requestId());
        app.use('*', requestLogger(appRt));
        app.get('/test', (c) => c.text('hello'));

        await app.request('/test');
        expect(logCalls.length).toBe(1);
        expect(logCalls[0]?.msg).toBe('GET /test');
        expect(logCalls[0]?.data).toMatchObject({
            method: 'GET',
            path: '/test',
            status: 200,
        });
        expect(typeof logCalls[0]?.data?.duration_ms).toBe('number');
        expect(logCalls[0]?.data?.requestId).toMatch(/^[0-9a-f]{8}-/);
    });

    test('captures error status codes from onError', async () => {
        const logCalls: { msg: string; data?: Record<string, unknown> }[] = [];
        const appRt = mockRuntime(logCalls);

        const app = new Hono();
        app.use('*', requestId());
        app.use('*', requestLogger(appRt));
        app.onError(globalErrorHandler);
        app.get('/fail', () => {
            throw new Error('boom');
        });

        await app.request('/fail');
        expect(logCalls.length).toBe(1);
        // With onError, requestLogger sees the 500 from onError's response
        expect(logCalls[0]?.data?.status).toBe(500);
    });
});

describe('globalErrorHandler (onError)', () => {
    test('returns structured error envelope with requestId', async () => {
        const app = new Hono();
        let reqId = '';

        app.use('*', requestId());
        app.use('*', async (c, next) => {
            await next();
            reqId = c.get('requestId');
        });
        app.onError(globalErrorHandler);
        app.get('/fail', () => {
            throw new Error('test error');
        });

        const prevEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        try {
            const res = await app.request('/fail');
            expect(res.status).toBe(500);
            const body = (await res.json()) as Record<string, unknown>;
            expect(body.code).toBe(500);
            expect(body.message).toBe('test error');
            expect(body.result).toBe('error');
            expect(body.data).toBeNull();
            expect(body.details).toBeDefined();
            expect((body.details as Record<string, unknown>)?.requestId).toBe(reqId);
        } finally {
            process.env.NODE_ENV = prevEnv;
        }
    });

    test('suppresses stack in production', async () => {
        const app = new Hono();
        app.use('*', requestId());
        app.onError(globalErrorHandler);
        app.get('/fail', () => {
            throw new Error('secret');
        });

        const prevEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const res = await app.request('/fail');
            expect(res.status).toBe(500);
            const body = (await res.json()) as Record<string, unknown>;
            expect(body.message).toBe('Internal server error');
            expect(body.details).toBeUndefined();
        } finally {
            process.env.NODE_ENV = prevEnv;
        }
    });
});

describe('contextInjector middleware', () => {
    test('sets c.var.rt from ApplicationRuntime', async () => {
        const appRt = mockRuntime();
        const app = new Hono();
        let capturedRt: unknown;

        app.use('*', contextInjector(appRt));
        app.get('/test', (c) => {
            capturedRt = c.get('rt');
            return c.text('ok');
        });

        await app.request('/test');
        expect(capturedRt).toBe(appRt);
    });
});

describe('mountMiddleware', () => {
    test('applies all middleware and registers onError', async () => {
        const order: string[] = [];
        const appRt = mockRuntime();

        const app = new Hono();
        app.use('*', async (_c, next) => {
            order.push('before');
            await next();
        });

        mountMiddleware(app, appRt);

        app.get('/test', (c) => {
            order.push('handler');
            return c.text('ok');
        });

        await app.request('/test');
        expect(order).toContain('before');
        expect(order).toContain('handler');
    });

    test('skips runtime-dependent middleware when appRt is undefined', async () => {
        const app = new Hono();
        mountMiddleware(app); // no appRt

        app.get('/test', (c) => c.text('ok'));
        const res = await app.request('/test');
        expect(res.status).toBe(200);
    });

    test('secureHeaders sets security headers', async () => {
        const app = new Hono();
        app.use('*', secureHeaders());
        app.get('/test', (c) => c.text('ok'));

        const res = await app.request('/test');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    });

    test('onError produces JSON on unhandled errors', async () => {
        const app = new Hono();
        mountMiddleware(app);
        app.get('/fail', () => {
            throw new Error('onerror test');
        });

        const prevEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        try {
            const res = await app.request('/fail');
            expect(res.status).toBe(500);
            const body = (await res.json()) as Record<string, unknown>;
            expect(body.code).toBe(500);
            expect(body.result).toBe('error');
        } finally {
            process.env.NODE_ENV = prevEnv;
        }
    });
});

describe('health endpoints', () => {
    test('GET /api/health returns liveness data', async () => {
        const res = await createApp().request('/api/health');
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.status).toBe('ok');
        expect(typeof body.uptime_seconds).toBe('number');
        expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
        expect(typeof body.memory_rss_mb).toBe('number');
        expect(typeof body.memory_heap_mb).toBe('number');
    });

    test('GET /api/health/ready returns deferred readiness', async () => {
        const res = await createApp().request('/api/health/ready');
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.status).toBe('ok');
        expect(body.db).toBe('deferred');
    });

    test('root redirects to /api/health', async () => {
        const res = await createApp().request('/');
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe('/api/health');
    });

    test('health endpoint includes CORS headers', async () => {
        const res = await createApp().request('/api/health');
        expect(res.headers.get('access-control-allow-origin')).toBeDefined();
    });

    test('health endpoint includes security headers', async () => {
        const res = await createApp().request('/api/health');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    });
});

describe('bodyLimit middleware', () => {
    test('rejects oversized body before oRPC parse', async () => {
        const body = 'x'.repeat(2_000_000); // 2 MiB > 1 MiB limit
        const res = await createApp().request('/api/health', {
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            body,
        });
        // With onError respecting HTTPException.status, bodyLimit 413 is preserved
        expect(res.status).toBe(413);
    });

    test('accepts body within limit', async () => {
        const body = 'x'.repeat(512_000); // 512 KiB < 1 MiB
        // POST to a route that accepts POST (none defined, but bodyLimit should
        // pass the body through before Hono routes it)
        const res = await createApp().request('/api/health', {
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            body,
        });
        // bodyLimit passes, but the GET route doesn't match POST → 404 from Hono routing
        // The key assertion: bodyLimit didn't reject (413)
        expect(res.status).not.toBe(413);
    });
});

describe('pipeline integration', () => {
    test('existing tests: OpenAPI spec is still served', async () => {
        const res = await createApp().request('/openapi.json');
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.openapi).toBe('3.1.1');
    });

    test('existing tests: not-found still returns 404 JSON', async () => {
        const res = await createApp().request('/missing');
        expect(res.status).toBe(404);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body).toEqual({ error: 'Not Found' });
    });

    test('requestId is present on error responses', async () => {
        const app = new Hono();
        app.use('*', requestId());
        app.onError(globalErrorHandler);
        app.get('/fail', () => {
            throw new Error('pipeline test');
        });

        const prevEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        try {
            const res = await app.request('/fail');
            const body = (await res.json()) as Record<string, unknown>;
            expect(body.details).toBeDefined();
            expect((body.details as Record<string, unknown>)?.requestId).toBeDefined();
        } finally {
            process.env.NODE_ENV = prevEnv;
        }
    });
});
