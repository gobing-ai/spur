import { describe, expect, it } from 'bun:test';
import {
    createGatewayHandler,
    gatewayGuard,
    loopbackAuthority,
    rebaseHtml,
    rebaseLocation,
    rebaseManifest,
    upstreamRequestHeaders,
} from '../../src/services/project-gateway';

const edge = { bindHost: 'localhost', allowedHosts: ['board.example.com'] };

function req(path: string, init: RequestInit & { host?: string } = {}): Request {
    const headers = new Headers(init.headers);
    headers.set('host', init.host ?? 'localhost');
    return new Request(`http://${init.host ?? 'localhost'}${path}`, { ...init, headers });
}

describe('gateway host guard and CSRF (K4 R8)', () => {
    it('allows localhost, an IP literal and the configured tunnel host', () => {
        expect(gatewayGuard(req('/alpha/api/health'), edge)).toBeNull();
        expect(gatewayGuard(req('/alpha/api/health', { host: '127.0.0.1' }), edge)).toBeNull();
        expect(gatewayGuard(req('/alpha/api/health', { host: 'board.example.com' }), edge)).toBeNull();
    });

    it('refuses an unlisted host with 421', async () => {
        const res = gatewayGuard(req('/alpha/api/health', { host: 'evil.test' }), edge);
        expect(res?.status).toBe(421);
        expect(await res?.text()).toContain('Misdirected Request');
    });

    it('refuses a cross-origin POST with 403 before any upstream contact', async () => {
        const res = gatewayGuard(
            req('/alpha/api/tasks', {
                method: 'POST',
                host: 'board.example.com',
                headers: { origin: 'https://evil.test', 'content-type': 'application/json' },
            }),
            edge,
        );
        expect(res?.status).toBe(403);
    });

    it('accepts a same-origin POST on the tunnel host', () => {
        const res = gatewayGuard(
            req('/alpha/api/tasks', {
                method: 'POST',
                host: 'board.example.com',
                headers: { origin: 'http://board.example.com', 'content-type': 'application/json' },
            }),
            edge,
        );
        expect(res).toBeNull();
    });

    it('accepts the https tunnel Origin although the loopback listener sees an http request URL', () => {
        // cloudflared terminates TLS and forwards plain HTTP with the public Host, so Bun's req.url is
        // http://board.example.com/... while the browser's Origin is https://board.example.com.
        const res = gatewayGuard(
            req('/alpha/api/tasks', {
                method: 'POST',
                host: 'board.example.com',
                headers: { origin: 'https://board.example.com', 'content-type': 'application/json' },
            }),
            edge,
        );
        expect(res).toBeNull();
    });

    it('refuses an opaque or malformed Origin', () => {
        for (const origin of ['null', 'not a url', 'https://board.example.com.evil.test']) {
            const res = gatewayGuard(
                req('/alpha/api/tasks', {
                    method: 'POST',
                    host: 'board.example.com',
                    headers: { origin, 'content-type': 'application/json' },
                }),
                edge,
            );
            expect(res?.status).toBe(403);
        }
    });

    it('rejects a form POST without Origin, and passes a JSON POST without Origin', () => {
        const form = gatewayGuard(
            req('/alpha/api/tasks', {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
            }),
            edge,
        );
        expect(form?.status).toBe(403);
        const json = gatewayGuard(
            req('/alpha/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' } }),
            edge,
        );
        expect(json).toBeNull();
    });

    it('exempts the bearer-authenticated /a2a/ surface', () => {
        const res = gatewayGuard(
            req('/alpha/a2a/tasks', {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
            }),
            edge,
        );
        expect(res).toBeNull();
    });

    it('rewrites Host and Origin to the loopback upstream and drops hop-by-hop headers', () => {
        const headers = upstreamRequestHeaders(
            new Request('http://board.example.com/alpha/api/tasks', {
                method: 'POST',
                headers: {
                    origin: 'http://board.example.com',
                    host: 'board.example.com',
                    referer: 'http://board.example.com/alpha/board',
                    connection: 'keep-alive',
                    'x-trace': 'abc',
                },
            }),
            loopbackAuthority('127.0.0.1', 3901),
        );
        expect(headers.get('host')).toBe('127.0.0.1:3901');
        expect(headers.get('origin')).toBe('http://127.0.0.1:3901');
        expect(headers.get('referer')).toBeNull();
        expect(headers.get('connection')).toBeNull();
        expect(headers.get('x-trace')).toBe('abc');
    });
});

describe('gateway response adaptation (K4 R8)', () => {
    it('rebases root-absolute attributes, import-map entries and injects the meta once', () => {
        const html = [
            '<!doctype html><html><head>',
            '<script type="importmap">{"imports":{"/_astro/x.js":"/_astro/x.js","react":"https://esm.sh/react"}}</script>',
            '<link rel="icon" href="/favicon.svg">',
            '<link rel="preconnect" href="//cdn.example.com">',
            '<script type="module" src="/_astro/entry.js"></script>',
            '</head><body><a href="#a">a</a><a href="/board">b</a>',
            '<a href="https://x.test/y">c</a></body></html>',
        ].join('');
        const once = rebaseHtml(html, '/alpha');
        expect(once).toContain('<meta name="spur-base" content="/alpha/">');
        expect(once).toContain('href="/alpha/favicon.svg"');
        expect(once).toContain('src="/alpha/_astro/entry.js"');
        expect(once).toContain('href="/alpha/board"');
        expect(once).toContain('href="//cdn.example.com"');
        expect(once).toContain('href="https://x.test/y"');
        expect(once).toContain('href="#a"');
        expect(once).toContain('"/alpha/_astro/x.js":"/alpha/_astro/x.js"');
        expect(once).toContain('"react":"https://esm.sh/react"');
        expect(rebaseHtml(once, '/alpha')).toBe(once);
    });

    it('rebases only root-relative Locations', () => {
        expect(rebaseLocation('/api/health', '/alpha')).toBe('/alpha/api/health');
        expect(rebaseLocation('//cdn/x', '/alpha')).toBe('//cdn/x');
        expect(rebaseLocation('https://x.test/y', '/alpha')).toBe('https://x.test/y');
        expect(rebaseLocation('/alpha/board', '/alpha')).toBe('/alpha/board');
    });

    it('rebases manifest start_url, scope and icon sources', () => {
        const manifest = JSON.stringify({
            start_url: '/board',
            scope: '/',
            icons: [{ src: '/icon-192.png', sizes: '192x192' }],
        });
        const rebased = JSON.parse(rebaseManifest(manifest, '/alpha')) as {
            start_url: string;
            scope: string;
            icons: Array<{ src: string }>;
        };
        expect(rebased.start_url).toBe('/alpha/board');
        expect(rebased.scope).toBe('/alpha/');
        expect(rebased.icons[0]?.src).toBe('/alpha/icon-192.png');
    });
});

describe('gateway adaptation edge cases (K4 R8)', () => {
    it('leaves a malformed import map untouched and prepends the meta without a <head>', () => {
        const html = '<script type="importmap">{not json}</script><p>hi</p>';
        const out = rebaseHtml(html, '/alpha');
        expect(out).toContain('{not json}');
        expect(out.startsWith('<meta name="spur-base" content="/alpha/">')).toBe(true);
    });

    it('rebases top-level import-map string values', () => {
        const html = '<script type="importmap">{"basePath":"/assets","imports":{}}</script>';
        expect(rebaseHtml(html, '/alpha')).toContain('"basePath":"/alpha/assets"');
    });

    it('retries a refusal reported only as a message, and adapts the retried response', async () => {
        let calls = 0;
        const handler = createGatewayHandler({
            port: 3000,
            listProjects: async () => [
                { name: 'alpha', path: '/tmp/alpha', host: 'localhost', port: 3901, prefix: '/alpha' },
            ],
            ensureUpstream: async () => 3901,
            fetchUpstream: (async () => {
                calls++;
                if (calls === 1) throw new Error('Unable to connect to 127.0.0.1:3901');
                return new Response('<html><head><link rel="icon" href="/a.svg"></head></html>', {
                    status: 200,
                    headers: { 'content-type': 'text/html', location: '/elsewhere' },
                });
            }) as unknown as typeof fetch,
        });

        const res = await handler(new Request('http://gw.test/alpha/'));
        expect(calls).toBe(2);
        expect(res.status).toBe(200);
        expect(res.headers.get('location')).toBe('/alpha/elsewhere');
        expect(await res.text()).toContain('href="/alpha/a.svg"');
    });

    it('rebases a web manifest served from a non-html upstream', async () => {
        const handler = createGatewayHandler({
            port: 3000,
            listProjects: async () => [
                { name: 'alpha', path: '/tmp/alpha', host: 'localhost', port: 3901, prefix: '/alpha' },
            ],
            ensureUpstream: async () => 3901,
            fetchUpstream: (async () =>
                new Response(JSON.stringify({ start_url: '/board', icons: [{ src: '/i.png' }, null] }), {
                    headers: { 'content-type': 'application/manifest+json' },
                })) as unknown as typeof fetch,
        });

        const res = await handler(new Request('http://gw.test/alpha/site.webmanifest'));
        const body = (await res.json()) as { start_url: string; icons: Array<{ src: string } | null> };
        expect(body.start_url).toBe('/alpha/board');
        expect(body.icons[0]?.src).toBe('/alpha/i.png');
        expect(body.icons[1]).toBeNull();
    });
});
