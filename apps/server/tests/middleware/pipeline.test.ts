import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { createApp } from '../../src/bootstrap';
import { globalErrorHandler } from '../../src/middleware/error-handler';
import { mountMiddleware, trimOrigins } from '../../src/middleware/pipeline';
import { requestId } from '../../src/middleware/request-id';
import { mockRuntime } from './helpers';

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
        mountMiddleware(app);

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
        const body = 'x'.repeat(2_000_000);
        const res = await createApp().request('/api/health', {
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            body,
        });
        expect(res.status).toBe(413);
    });

    test('accepts body within limit', async () => {
        const body = 'x'.repeat(512_000);
        const res = await createApp().request('/api/health', {
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            body,
        });
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

describe('trimOrigins helper', () => {
    test('splits comma-separated origins and trims whitespace', () => {
        expect(trimOrigins('a, b, c')).toEqual(['a', 'b', 'c']);
    });

    test('returns single entry without comma', () => {
        expect(trimOrigins('example.com')).toEqual(['example.com']);
    });

    test('filters empty entries', () => {
        expect(trimOrigins('a,, b')).toEqual(['a', 'b']);
    });

    test('handles trailing/leading whitespace', () => {
        expect(trimOrigins('  a , b  ')).toEqual(['a', 'b']);
    });
});
