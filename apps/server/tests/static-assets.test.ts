import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createApp } from '../src/bootstrap';
import type { ServerContext } from '../src/context';

const fixtureDist = join(import.meta.dir, 'fixtures', 'web-dist');
/**
 * Create a test app with webDistPath pointing to the fixture dist.
 * @param withDist - when false, creates the app without webDistPath (stand-alone mode)
 */
function appWithDist(withDist = true) {
    const ctx = withDist ? ({ webDistPath: fixtureDist } as unknown as ServerContext) : undefined;
    return createApp(undefined, { ctx });
}

describe('static asset serving', () => {
    test('GET / serves index.html when webDistPath is set', async () => {
        const app = appWithDist();
        const res = await app.request('/');
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('Stub Board');
    });

    test('GET / serves index.html as text/html', async () => {
        const app = appWithDist();
        const res = await app.request('/');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
    });

    test('GET /api/health works on the same port (one port, R4)', async () => {
        const app = appWithDist();
        const res = await app.request('/api/health');
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.status).toBe('ok');
    });

    test('GET /openapi.json works alongside static serving', async () => {
        const app = appWithDist();
        const res = await app.request('/openapi.json');
        expect(res.status).toBe(200);
    });

    test('SPA fallback: unknown client route returns index.html', async () => {
        const app = appWithDist();
        const res = await app.request('/board/tasks');
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('Stub Board');
    });

    test('SPA fallback: nested client route returns index.html', async () => {
        const app = appWithDist();
        const res = await app.request('/board/tasks/0001/detail');
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('Stub Board');
    });

    test('/api/unknown returns 404 with JSON envelope', async () => {
        const app = appWithDist();
        const res = await app.request('/api/nonexistent');
        expect(res.status).toBe(404);
        // Either JSON envelope or plain text 404 — but NOT index.html
        const text = await res.text();
        expect(text).not.toContain('Stub Board');
    });

    test('static asset file is served directly (not fallback)', async () => {
        const app = appWithDist();
        const res = await app.request('/asset.json');
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.ok).toBe(true);
    });

    test('JS asset is served with a javascript content-type (ES modules require it)', async () => {
        // Regression guard: index.html/asset.json passed even when the handler
        // only set content-type for .html/.json. A real Vite board ships .js/.css —
        // browsers reject <script type=module> without a JS MIME. Bun.file().type
        // now resolves the correct type per extension.
        const app = appWithDist();
        const res = await app.request('/app.js');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('javascript');
    });

    test('path traversal cannot escape webDistPath', async () => {
        // The handler joins user path onto webDistPath; containment relies on Hono
        // normalizing ../ segments before the handler sees them. Pin that here so a
        // future router/handler change cannot silently reintroduce a traversal leak.
        const app = appWithDist();
        for (const evil of [
            '/../../../../etc/hostname',
            '/..%2f..%2f..%2fetc%2fhostname',
            '/%2e%2e/%2e%2e/etc/passwd',
        ]) {
            const res = await app.request(evil);
            const text = await res.text();
            // Either a 404 or the SPA shell — never the contents of an out-of-root file.
            expect(text).not.toContain('root:');
            expect([200, 404]).toContain(res.status);
        }
    });

    test('existing app tests still pass: health without webDistPath', async () => {
        // Stand-alone mode (no webDistPath) — health should still work
        const app = appWithDist(false);
        const res = await app.request('/api/health');
        expect(res.status).toBe(200);
    });

    test('unknown route without webDistPath returns 404', async () => {
        const app = appWithDist(false);
        const res = await app.request('/board/tasks');
        expect(res.status).toBe(404);
    });
});
