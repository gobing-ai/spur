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
            expect(body.ok).toBe(false);
            expect(body.error).toBeDefined();
            expect((body.error as Record<string, unknown>).code).toBe('INTERNAL_ERROR');
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

    test('GET /api/health/ready returns 503 without ServerContext', async () => {
        const res = await createApp().request('/api/health/ready');
        expect(res.status).toBe(503);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.status).toBe('error');
        expect(body.db).toBe('unavailable');
    });

    test('GET /api/health/ready returns 200 connected when DB is available', async () => {
        const appRt = mockRuntime();
        const { createNodeFileSystem } = await import('@gobing-ai/ts-runtime');
        const { createServerContext } = await import('../../src/context');
        const fs = createNodeFileSystem('/tmp/test');
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs, dbUrl: ':memory:' });
        const app = createApp(appRt, { fs, ctx });
        const res = await app.request('/api/health/ready');
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.status).toBe('ok');
        expect(body.db).toBe('connected');
    });

    test('root redirects to /api/health', async () => {
        const res = await createApp().request('/');
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe('/api/health');
    });

    test('CORS default is same-origin: a foreign Origin is NOT echoed (R2)', async () => {
        // Default (no SPUR_CORS_ORIGINS) must not blanket-allow cross-origin.
        const prev = process.env.SPUR_CORS_ORIGINS;
        delete process.env.SPUR_CORS_ORIGINS;
        try {
            const res = await createApp().request('/api/health', {
                headers: { origin: 'https://evil.example.com' },
            });
            // Same-origin default → no Access-Control-Allow-Origin for a foreign origin,
            // and never a wildcard.
            const acao = res.headers.get('access-control-allow-origin');
            expect(acao).not.toBe('*');
            expect(acao).not.toBe('https://evil.example.com');
        } finally {
            if (prev === undefined) delete process.env.SPUR_CORS_ORIGINS;
            else process.env.SPUR_CORS_ORIGINS = prev;
        }
    });

    test('CORS echoes an explicitly allowlisted origin (SPUR_CORS_ORIGINS)', async () => {
        const prev = process.env.SPUR_CORS_ORIGINS;
        process.env.SPUR_CORS_ORIGINS = 'https://board.example.com, https://ops.example.com';
        try {
            const res = await createApp().request('/api/health', {
                headers: { origin: 'https://board.example.com' },
            });
            expect(res.headers.get('access-control-allow-origin')).toBe('https://board.example.com');
        } finally {
            if (prev === undefined) delete process.env.SPUR_CORS_ORIGINS;
            else process.env.SPUR_CORS_ORIGINS = prev;
        }
    });

    test('health endpoint includes security headers', async () => {
        const res = await createApp().request('/api/health');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    });
});

describe('csrf middleware', () => {
    /**
     * Mount the real pipeline over a state-changing route, so these exercise the
     * middleware order rather than csrf() in isolation.
     */
    function appWithMutatingRoute(): Hono {
        const app = new Hono();
        mountMiddleware(app);
        app.post('/api/team/agents/a1/start', (c) => c.json({ ok: true }));
        app.get('/api/team/agents', (c) => c.json({ ok: true }));
        return app;
    }

    const withCorsEnv = async (value: string | undefined, fn: () => Promise<void>) => {
        const prev = process.env.SPUR_CORS_ORIGINS;
        if (value === undefined) delete process.env.SPUR_CORS_ORIGINS;
        else process.env.SPUR_CORS_ORIGINS = value;
        try {
            await fn();
        } finally {
            if (prev === undefined) delete process.env.SPUR_CORS_ORIGINS;
            else process.env.SPUR_CORS_ORIGINS = prev;
        }
    };

    test('blocks a cross-origin POST with no Content-Type (a CORS-simple request)', async () => {
        // The core CSRF shape: no body, no custom headers → no preflight → the
        // request reaches the handler and its side effect fires, even though the
        // attacker cannot read the response. CORS does not prevent this.
        await withCorsEnv(undefined, async () => {
            const res = await appWithMutatingRoute().request('http://localhost/api/team/agents/a1/start', {
                method: 'POST',
                headers: { origin: 'https://evil.example.com' },
            });
            expect(res.status).toBe(403);
        });
    });

    test('blocks a cross-origin POST that smuggles JSON as text/plain', async () => {
        // c.req.json() is text().then(JSON.parse) — it never checks Content-Type — so
        // text/plain keeps the request "simple" while still parsing as JSON server-side.
        await withCorsEnv(undefined, async () => {
            const res = await appWithMutatingRoute().request('http://localhost/api/team/agents/a1/start', {
                method: 'POST',
                headers: { origin: 'https://evil.example.com', 'content-type': 'text/plain' },
                body: JSON.stringify({ line: 'rm -rf /\n' }),
            });
            expect(res.status).toBe(403);
        });
    });

    test('allows a same-origin POST', async () => {
        await withCorsEnv(undefined, async () => {
            const res = await appWithMutatingRoute().request('http://localhost/api/team/agents/a1/start', {
                method: 'POST',
                headers: { origin: 'http://localhost' },
            });
            expect(res.status).toBe(200);
        });
    });

    test('allows a same-origin POST identified by Sec-Fetch-Site', async () => {
        await withCorsEnv(undefined, async () => {
            const res = await appWithMutatingRoute().request('http://localhost/api/team/agents/a1/start', {
                method: 'POST',
                headers: { 'sec-fetch-site': 'same-origin' },
            });
            expect(res.status).toBe(200);
        });
    });

    test('allows an explicitly allowlisted cross-origin POST (SPUR_CORS_ORIGINS)', async () => {
        // The csrf origin check mirrors the CORS allowlist, so opting an origin in
        // does not leave it able to read responses but unable to send requests.
        await withCorsEnv('https://board.example.com', async () => {
            const res = await appWithMutatingRoute().request('http://localhost/api/team/agents/a1/start', {
                method: 'POST',
                headers: { origin: 'https://board.example.com' },
            });
            expect(res.status).toBe(200);
        });
    });

    test('does not block JSON-typed cross-origin requests at the csrf layer', async () => {
        // application/json already forces a preflight, which CORS answers; csrf only
        // guards the form-element content types. Guarding JSON too would be redundant
        // and would break non-browser clients that send no Origin.
        await withCorsEnv(undefined, async () => {
            const res = await appWithMutatingRoute().request('http://localhost/api/team/agents/a1/start', {
                method: 'POST',
                headers: { origin: 'https://evil.example.com', 'content-type': 'application/json' },
                body: '{}',
            });
            expect(res.status).toBe(200);
        });
    });

    test('leaves safe methods alone', async () => {
        await withCorsEnv(undefined, async () => {
            const res = await appWithMutatingRoute().request('http://localhost/api/team/agents', {
                headers: { origin: 'https://evil.example.com' },
            });
            expect(res.status).toBe(200);
        });
    });

    test('still answers CORS preflight for an allowlisted origin', async () => {
        // csrf sits after cors precisely so preflight OPTIONS short-circuits in cors
        // (which returns 204 without calling next()) and never hits the csrf guard.
        await withCorsEnv('https://board.example.com', async () => {
            const res = await appWithMutatingRoute().request('http://localhost/api/team/agents/a1/start', {
                method: 'OPTIONS',
                headers: {
                    origin: 'https://board.example.com',
                    'access-control-request-method': 'POST',
                },
            });
            expect(res.status).toBe(204);
            expect(res.headers.get('access-control-allow-origin')).toBe('https://board.example.com');
        });
    });
});

describe('bodyLimit middleware', () => {
    // These POST text/plain, which is a csrf-guarded shape — so they must present a
    // same-origin Origin to reach bodyLimit at all. csrf deliberately runs first: an
    // unauthorized request should be refused before the server buffers its body.
    const sameOrigin = { origin: 'http://localhost', 'content-type': 'text/plain' };

    test('rejects oversized body before oRPC parse', async () => {
        const body = 'x'.repeat(2_000_000);
        const res = await createApp().request('http://localhost/api/health', {
            method: 'POST',
            headers: sameOrigin,
            body,
        });
        expect(res.status).toBe(413);
    });

    test('accepts body within limit', async () => {
        const body = 'x'.repeat(512_000);
        const res = await createApp().request('http://localhost/api/health', {
            method: 'POST',
            headers: sameOrigin,
            body,
        });
        // /api/health routes GET only, so an in-limit POST falls through to the
        // 404 handler — which is the proof we want: it passed csrf and bodyLimit and
        // reached routing. Asserting only `not 413` would also hold for a 403.
        expect(res.status).toBe(404);
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
            expect(body.error).toBeDefined();
            expect(
                ((body.error as Record<string, unknown>).details as Record<string, unknown>)?.requestId,
            ).toBeDefined();
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
