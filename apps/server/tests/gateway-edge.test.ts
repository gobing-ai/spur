import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGatewayHandler } from '@gobing-ai/spur-app';
import type { ProjectEntry } from '@gobing-ai/spur-config';
import { createApp } from '../src/bootstrap';
import type { ServerContext } from '../src/context';

/**
 * Feature K4 R8 end to end: the gateway's edge in front of a real serve built by `createApp`, with a
 * web dist shaped like the Board's build output (root-absolute `/_astro` chunks + import map).
 */
const webDist = mkdtempSync(join(tmpdir(), 'spur-gateway-edge-'));
const INDEX_HTML = [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<script type="importmap">{"imports":{"/_astro/runtime.js":"/_astro/runtime.js"}}</script>',
    '<link rel="icon" href="/favicon.svg">',
    '<script type="module" src="/_astro/entry.js"></script>',
    '</head><body><a href="/board">Board</a><div id="root"></div></body></html>',
].join('');
writeFileSync(join(webDist, 'index.html'), INDEX_HTML, 'utf8');
writeFileSync(
    join(webDist, 'site.webmanifest'),
    JSON.stringify({ start_url: '/board', scope: '/', icons: [{ src: '/icon-192.png', sizes: '192x192' }] }),
    'utf8',
);

const app = createApp(undefined, { ctx: { webDistPath: webDist } as unknown as ServerContext });
app.post('/echo', (c) => c.json({ ok: true }));
app.get('/legacy', (c) => c.redirect('/api/health'));

const upstreamRequests: string[] = [];
const upstream = Bun.serve({
    port: 0,
    fetch: (req) => {
        upstreamRequests.push(`${req.method} ${new URL(req.url).pathname}`);
        return app.fetch(req);
    },
});
const upstreamPort = upstream.port ?? 0;

const entry: ProjectEntry = { name: 'proj', path: '/tmp/proj', host: 'localhost', port: upstreamPort, prefix: '/p' };
const handler = createGatewayHandler({
    port: 3999,
    edge: { bindHost: 'localhost', allowedHosts: ['board.example.com'] },
    listProjects: async () => [entry],
    ensureUpstream: async () => upstreamPort,
});

function gateway(path: string, init: RequestInit & { host?: string } = {}): Promise<Response> {
    const host = init.host ?? 'localhost';
    const headers = new Headers(init.headers);
    headers.set('host', host);
    return handler(new Request(`http://${host}${path}`, { ...init, headers }));
}

afterAll(() => {
    upstream.stop(true);
    rmSync(webDist, { recursive: true, force: true });
});

describe('gateway edge in front of a real serve (K4 R8)', () => {
    test('serves the tunnel host and rebases the Board HTML and manifest', async () => {
        const res = await gateway('/p/', { host: 'board.example.com' });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('<meta name="spur-base" content="/p/">');
        expect(html).not.toContain('="/_astro');
        expect(html).toContain('"/p/_astro/runtime.js":"/p/_astro/runtime.js"');
        expect(html).toContain('href="/p/favicon.svg"');
        expect(html).toContain('href="/p/board"');

        const manifest = await gateway('/p/site.webmanifest', { host: 'board.example.com' });
        const body = (await manifest.json()) as { start_url: string; scope: string; icons: Array<{ src: string }> };
        expect(body.start_url).toBe('/p/board');
        expect(body.scope).toBe('/p/');
        expect(body.icons[0]?.src).toBe('/p/icon-192.png');
    });

    test('rebases the SPA fallback for a deep link', async () => {
        const res = await gateway('/p/board/tasks/1', { host: 'board.example.com' });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('<meta name="spur-base" content="/p/">');
        expect(html).not.toContain('="/_astro');
    });

    test('rebases a root-absolute Location from the upstream', async () => {
        const res = await gateway('/p/legacy', { host: 'board.example.com' });
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe('/p/api/health');
    });

    test('refuses an unlisted Host with 421 and never contacts the upstream', async () => {
        const before = upstreamRequests.length;
        const res = await gateway('/p/api/health', { host: 'evil.test' });
        expect(res.status).toBe(421);
        expect(upstreamRequests.length).toBe(before);
    });

    test('passes a same-origin POST through the serve csrf() via the Origin rewrite', async () => {
        const res = await gateway('/p/echo', {
            method: 'POST',
            host: 'board.example.com',
            headers: { origin: 'http://board.example.com', 'content-type': 'application/json' },
            body: JSON.stringify({ hello: 'world' }),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
    });

    test('passes a POST carrying the https tunnel Origin (TLS terminated by the tunnel)', async () => {
        const res = await gateway('/p/echo', {
            method: 'POST',
            host: 'board.example.com',
            headers: { origin: 'https://board.example.com', 'content-type': 'application/json' },
            body: JSON.stringify({ hello: 'world' }),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
    });

    test('refuses a cross-origin POST with 403 before any upstream contact', async () => {
        const before = upstreamRequests.length;
        const res = await gateway('/p/echo', {
            method: 'POST',
            host: 'board.example.com',
            headers: { origin: 'https://evil.test', 'content-type': 'application/json' },
            body: JSON.stringify({ hello: 'world' }),
        });
        expect(res.status).toBe(403);
        expect(upstreamRequests.length).toBe(before);
    });
});
