import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { type ProjectEntry, projectEntrySchema, removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { createGatewayHandler, type GatewayDeps, isGatewayAnswering } from '../../src/services/project-gateway';
import { ProjectRegistry, setPortProbeForTests } from '../../src/services/project-registry';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function entry(name: string, path: string, extra: Partial<ProjectEntry> = {}): ProjectEntry {
    return projectEntrySchema.parse({ name, path, ...extra });
}

interface Upstream {
    server: ReturnType<typeof Bun.serve>;
    port: number;
    aborted: () => boolean;
}

/** A real upstream stub: health by id, one SSE event per 50 ms, gzip, and abort observation. */
function startUpstream(id: string): Upstream {
    let sawAbort = false;
    const server = Bun.serve({
        port: 0,
        idleTimeout: 0,
        fetch(req) {
            const url = new URL(req.url);
            if (url.pathname === '/api/health') {
                return Response.json({ id });
            }
            if (url.pathname === '/api/events') {
                const stream = new ReadableStream<Uint8Array>({
                    start(controller) {
                        let n = 0;
                        const timer = setInterval(() => {
                            if (req.signal.aborted) return;
                            controller.enqueue(encoder.encode(`data: ${id}-${++n}\n\n`));
                        }, 50);
                        req.signal.addEventListener('abort', () => {
                            sawAbort = true;
                            clearInterval(timer);
                            try {
                                controller.close();
                            } catch {
                                // Already closed by the runtime when the peer aborted.
                            }
                        });
                    },
                });
                return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
            }
            if (url.pathname === '/gzip') {
                return new Response(gzipSync(encoder.encode(`${id} gzipped payload`)), {
                    headers: { 'content-type': 'text/plain', 'content-encoding': 'gzip' },
                });
            }
            return new Response(`upstream ${id} path ${url.pathname}`, { status: 200 });
        },
    });
    return { server, port: server.port ?? 0, aborted: () => sawAbort };
}

function deps(overrides: Partial<GatewayDeps> & Pick<GatewayDeps, 'listProjects' | 'ensureUpstream'>): GatewayDeps {
    return { port: 3000, ...overrides };
}

const shutdown: Array<() => void> = [];

afterEach(() => {
    setPortProbeForTests(undefined);
    for (const stop of shutdown.splice(0)) stop();
});

describe('gateway handler (K4 R3/R4/R5)', () => {
    it('routes each prefix to its own upstream with the prefix stripped', async () => {
        const a = startUpstream('a');
        const b = startUpstream('b');
        shutdown.push(
            () => a.server.stop(true),
            () => b.server.stop(true),
        );
        const projects = [entry('alpha', '/tmp/alpha'), entry('beta', '/tmp/beta')];
        const ports: Record<string, number> = { '/tmp/alpha': a.port, '/tmp/beta': b.port };
        const handler = createGatewayHandler(
            deps({
                listProjects: async () => projects,
                ensureUpstream: async (e: ProjectEntry) => ports[e.path] ?? 0,
            }),
        );

        const alpha = await handler(new Request('http://gw.test/alpha/api/health'));
        expect(alpha.status).toBe(200);
        expect(await alpha.json()).toEqual({ id: 'a' });

        const beta = await handler(new Request('http://gw.test/beta/api/health'));
        expect(await beta.json()).toEqual({ id: 'b' });
    });

    it('404s an unknown prefix and names the known prefixes, ignoring remote entries', async () => {
        const handler = createGatewayHandler(
            deps({
                listProjects: async () => [
                    entry('alpha', '/tmp/alpha'),
                    entry('remote', '/srv/remote', { host: '192.168.87.27', port: 3003 }),
                ],
                ensureUpstream: async () => 0,
            }),
        );

        const unknown = await handler(new Request('http://gw.test/nope/api/health'));
        expect(unknown.status).toBe(404);
        const body = await unknown.text();
        expect(body).toContain('/alpha');
        expect(body).not.toContain('/remote');

        const remote = await handler(new Request('http://gw.test/remote/board'));
        expect(remote.status).toBe(404);
    });

    it('409s a derived collision with the remedy and 308s a bare prefix', async () => {
        const upstream = startUpstream('gamma');
        shutdown.push(() => upstream.server.stop(true));
        const colliding = createGatewayHandler(
            deps({
                listProjects: async () => [entry('kk', '/tmp/a'), entry('KK', '/tmp/b')],
                ensureUpstream: async () => 0,
            }),
        );

        const collision = await colliding(new Request('http://gw.test/kk/board'));
        expect(collision.status).toBe(409);
        expect(await collision.text()).toContain('--prefix');

        const single = createGatewayHandler(
            deps({
                listProjects: async () => [entry('gamma', '/tmp/gamma')],
                ensureUpstream: async () => upstream.port,
            }),
        );
        const bare = await single(new Request('http://gw.test/gamma?x=1'));
        expect(bare.status).toBe(308);
        expect(bare.headers.get('location')).toBe('/gamma/?x=1');
        expect((await single(new Request('http://gw.test/gamma/'))).status).toBe(200);
    });

    it('starts a stopped project exactly once under concurrent first requests', async () => {
        let calls = 0;
        const upstream = startUpstream('alpha');
        shutdown.push(() => upstream.server.stop(true));
        const started: Array<string> = [];
        const handler = createGatewayHandler(
            deps({
                listProjects: async () => [entry('alpha', '/tmp/alpha')],
                ensureUpstream: async () => {
                    calls++;
                    started.push('once');
                    await new Promise((resolve) => setTimeout(resolve, 20));
                    return upstream.port;
                },
            }),
        );

        const responses = await Promise.all(
            Array.from({ length: 10 }, () => handler(new Request('http://gw.test/alpha/api/health'))),
        );
        expect(calls).toBe(1);
        expect(responses.every((r) => r.status === 200)).toBe(true);
    });

    it('502s with the project name and log path when the start fails', async () => {
        const handler = createGatewayHandler(
            deps({
                listProjects: async () => [entry('alpha', '/tmp/alpha')],
                ensureUpstream: async () => {
                    throw new Error('spawn refused by the owner claim');
                },
            }),
        );

        const res = await handler(new Request('http://gw.test/alpha/board'));
        expect(res.status).toBe(502);
        const body = await res.text();
        expect(body).toContain('alpha');
        expect(body).toContain('/tmp/alpha/.spur/run/serve-spawn.log');
        expect(body).toContain('spawn refused by the owner claim');
    });

    it('retries a refused connection exactly once after adoption, then 502s', async () => {
        let calls = 0;
        const deadPort = 1;
        const handler = createGatewayHandler(
            deps({
                listProjects: async () => [entry('alpha', '/tmp/alpha')],
                ensureUpstream: async () => {
                    calls++;
                    return deadPort;
                },
            }),
        );

        const res = await handler(new Request('http://gw.test/alpha/board'));
        expect(res.status).toBe(502);
        expect(calls).toBe(2);
        expect(await res.text()).toContain('alpha');
    });

    it('streams SSE incrementally and aborts the upstream when the client aborts', async () => {
        const upstream = startUpstream('alpha');
        shutdown.push(() => upstream.server.stop(true));
        const handler = createGatewayHandler(
            deps({
                listProjects: async () => [entry('alpha', '/tmp/alpha')],
                ensureUpstream: async () => upstream.port,
            }),
        );

        const controller = new AbortController();
        const res = await handler(new Request('http://gw.test/alpha/api/events', { signal: controller.signal }));
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/event-stream');
        const reader = res.body?.getReader();
        const first = await reader?.read();
        expect(decoder.decode(first?.value)).toContain('data: alpha-1');

        controller.abort();
        await Bun.sleep(300);
        expect(upstream.aborted()).toBe(true);
    });

    it('decodes a gzip upstream body and never forwards its content-encoding', async () => {
        const upstream = startUpstream('alpha');
        shutdown.push(() => upstream.server.stop(true));
        const handler = createGatewayHandler(
            deps({
                listProjects: async () => [entry('alpha', '/tmp/alpha')],
                ensureUpstream: async () => upstream.port,
            }),
        );

        const res = await handler(new Request('http://gw.test/alpha/gzip'));
        expect(res.status).toBe(200);
        expect(res.headers.get('content-encoding')).toBeNull();
        expect(res.headers.get('content-length')).toBeNull();
        expect(await res.text()).toBe('alpha gzipped payload');
    });

    it('answers the gateway index and /api/health at the root', async () => {
        const handler = createGatewayHandler(
            deps({
                port: 3111,
                listProjects: async () => [
                    entry('alpha', '/tmp/alpha', { port: 3007 }),
                    entry('<script>x</script>', '/tmp/xss'),
                ],
                ensureUpstream: async () => 3007,
            }),
        );

        const health = await handler(new Request('http://gw.test/api/health'));
        expect(health.status).toBe(200);
        expect(await health.json()).toEqual({
            ok: true,
            gateway: true,
            port: 3111,
            projects: [
                { name: 'alpha', prefix: '/alpha', running: true },
                { name: '<script>x</script>', prefix: '/script-x-script', running: false },
            ],
        });

        const index = await handler(new Request('http://gw.test/'));
        expect(index.status).toBe(200);
        expect(index.headers.get('content-type')).toContain('text/html');
        const html = await index.text();
        expect(html).toContain('/alpha/board');
        // Names come from directory basenames — never render them as markup.
        expect(html).not.toContain('<script>x');
        expect(html).toContain('&#60;script&#62;');
    });

    it('removes a registered project on POST /api/projects/remove and validates input', async () => {
        const removed: Array<{ path: string; host?: string }> = [];
        const handler = createGatewayHandler(
            deps({
                listProjects: async () => [],
                ensureUpstream: async () => 0,
                removeProject: async (path, host) => {
                    removed.push({ path, host });
                    return path === '/tmp/alpha';
                },
            }),
        );

        const getRes = await handler(new Request('http://gw.test/api/projects/remove'));
        expect(getRes.status).toBe(405);

        const badRes = await handler(
            new Request('http://gw.test/api/projects/remove', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ path: '' }),
            }),
        );
        expect(badRes.status).toBe(400);

        const okRes = await handler(
            new Request('http://gw.test/api/projects/remove', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ path: '/tmp/alpha', host: '192.168.1.50' }),
            }),
        );
        expect(okRes.status).toBe(200);
        expect(await okRes.json()).toEqual({ ok: true });
        expect(removed).toEqual([{ path: '/tmp/alpha', host: '192.168.1.50' }]);

        const missingRes = await handler(
            new Request('http://gw.test/api/projects/remove', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ path: '/tmp/missing' }),
            }),
        );
        expect(missingRes.status).toBe(404);
    });
});

describe('allocatePort reserved ports (K4 R3)', () => {
    it('never hands out the reserved gateway port', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-gateway-port-'));
        const file = join(dir, 'projects.json');
        setEnvVar('SPUR_PROJECTS_FILE', file);
        setPortProbeForTests(async (port: number) => (port === 3000 || port === 3001 ? 'available' : 'in-use'));
        try {
            const registry = new ProjectRegistry(file);
            expect(await registry.allocatePort(undefined, new Set([3000]))).toBe(3001);
        } finally {
            removeEnvVar('SPUR_PROJECTS_FILE');
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('isGatewayAnswering (K4 R7)', () => {
    it('is true only for a real gateway health answer', async () => {
        const servers: Array<ReturnType<typeof Bun.serve>> = [];
        const serve = (handler: () => Response): number => {
            const server = Bun.serve({ port: 0, fetch: handler });
            servers.push(server);
            return server.port ?? 0;
        };
        try {
            expect(await isGatewayAnswering(serve(() => Response.json({ ok: true, gateway: true })))).toBe(true);
            expect(await isGatewayAnswering(serve(() => Response.json({ ok: true })))).toBe(false);
            expect(await isGatewayAnswering(serve(() => new Response('nope', { status: 500 })))).toBe(false);
            // Nothing listening: the probe answers false and never throws.
            const closed = Bun.serve({ port: 0, fetch: () => new Response('') });
            const closedPort = closed.port ?? 0;
            closed.stop(true);
            expect(await isGatewayAnswering(closedPort)).toBe(false);
        } finally {
            for (const server of servers) server.stop(true);
        }
    });
});
