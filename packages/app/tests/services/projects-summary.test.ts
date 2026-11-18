import { afterEach, describe, expect, test } from 'bun:test';
import { type ProjectEntry, projectEntrySchema } from '@gobing-ai/spur-config';
import { createGatewayHandler } from '../../src/services/project-gateway';
import { collectProjectsView } from '../../src/services/projects-summary';

const SINCE = '2026-11-18T00:00:00.000Z';

function entry(name: string, path: string, extra: Partial<ProjectEntry> = {}): ProjectEntry {
    return projectEntrySchema.parse({ name, path, ...extra });
}

interface Upstream {
    port: number;
    stop(): void;
}

/** A real project upstream: `/api/health` plus a history page with the given event names. */
function startUpstream(eventNames: string[]): Upstream {
    const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: (req) => {
            const url = new URL(req.url);
            if (url.pathname === '/api/health') return Response.json({ ok: true });
            if (url.pathname === '/api/events/history') {
                return Response.json({
                    events: eventNames.map((eventName, index) => ({
                        id: `e-${index}`,
                        eventName,
                        occurredAt: SINCE,
                        prefix: eventName.split('.')[0],
                        payload: { summary: `${eventName} summary` },
                    })),
                    count: eventNames.length,
                });
            }
            return new Response('not found', { status: 404 });
        },
    });
    return { port: server.port as number, stop: () => server.stop(true) };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * 1402 R1/R2/R4 — the daily cross-project view.
 *
 * The failure modes that matter: a stopped project being woken by a read (the gateway starts what it
 * proxies), a running project's failure being reported as healthy, a remote entry being proxied at all,
 * and a missing gateway producing per-project noise instead of one honest status.
 */
describe('collectProjectsView through the real gateway handler (1402 R1/R2)', () => {
    /** The real handler, wired to fixture entries; `ensureUpstream` records every adoption. */
    async function gatewayFor(entries: ProjectEntry[], upstreamPorts: Record<string, number>) {
        const ensured: string[] = [];
        const handler = createGatewayHandler({
            listProjects: async () => entries,
            ensureUpstream: async (project) => {
                ensured.push(project.name);
                return upstreamPorts[project.path] ?? 1;
            },
            port: 0,
        });
        const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: (req) => handler(req) });
        cleanups.push(() => server.stop(true));
        return { port: server.port as number, ensured };
    }

    test('reports ok with event counts and the five latest events, and never touches a stopped project', async () => {
        const healthy = startUpstream([
            'task.created',
            'task.updated',
            'task.created',
            'message.sent',
            'history.imported',
            'task.updated',
            'flow.exited',
        ]);
        cleanups.push(healthy.stop);
        const entries = [
            entry('alpha', '/tmp/alpha', { prefix: '/alpha', port: healthy.port }),
            entry('beta', '/tmp/beta', { prefix: '/beta', port: 0 }),
        ];
        const gateway = await gatewayFor(entries, { '/tmp/alpha': healthy.port });

        const rows = await collectProjectsView({
            listProjects: async () => entries,
            gatewayPort: gateway.port,
            since: SINCE,
        });
        expect(rows.map((row) => [row.name, row.state])).toEqual([
            ['alpha', 'ok'],
            ['beta', 'stopped'],
        ]);
        expect(rows[0]?.eventCounts?.[0]).toEqual({ prefix: 'task', count: 4 });
        expect(rows[0]?.latest).toHaveLength(5);
        expect(rows[0]?.latest?.[0]).toEqual({
            eventName: 'task.created',
            occurredAt: SINCE,
            summary: 'task.created summary',
        });
        // R2: a stopped project is never requested — the gateway would have started it. The two
        // reads (health, history) each ensure the upstream; that is the handler's normal path.
        expect(gateway.ensured).toEqual(['alpha', 'alpha']);
    });

    test('a running project whose upstream refuses is unreachable, with the cause', async () => {
        const entries = [entry('gamma', '/tmp/gamma', { prefix: '/gamma', port: 1 })];
        // Port 1: nothing listens, so the gateway's own dial fails and it answers 502.
        const gateway = await gatewayFor(entries, { '/tmp/gamma': 1 });

        const rows = await collectProjectsView({
            listProjects: async () => entries,
            gatewayPort: gateway.port,
            since: SINCE,
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]?.state).toBe('unreachable');
        expect(rows[0]?.state === 'unreachable' ? rows[0].message : '').toContain('health answered 502');
    });

    test('a remote entry is named and never requested (ADR-151)', async () => {
        const entries = [entry('far', '/srv/far', { host: '192.168.87.27', port: 3003 })];
        const gateway = await gatewayFor(entries, {});
        const rows = await collectProjectsView({
            listProjects: async () => entries,
            gatewayPort: gateway.port,
            since: SINCE,
        });
        expect(rows).toEqual([{ name: 'far', prefix: null, state: 'remote-not-proxied' }]);
        expect(gateway.ensured).toEqual([]);
    });

    test('no gateway answering marks every running project gateway-down, once', async () => {
        const entries = [
            entry('alpha', '/tmp/alpha', { prefix: '/alpha', port: 3101 }),
            entry('beta', '/tmp/beta', { prefix: '/beta', port: 3102 }),
        ];
        const rows = await collectProjectsView({
            listProjects: async () => entries,
            gatewayPort: 1,
            since: SINCE,
        });
        expect(rows.map((row) => row.state)).toEqual(['gateway-down', 'gateway-down']);
        expect(rows[0]?.message).toContain('spur serve --gateway');
    });
});

describe('collectProjectsView budget (1402 R1)', () => {
    test('a project that never answers is cut off by its own timeout', async () => {
        const entries = [entry('slow', '/tmp/slow', { prefix: '/slow', port: 3103 })];
        // Gateway answers, the project read hangs: the row must still come back.
        const fetchImpl = (async (input: unknown, init?: RequestInit) => {
            const url = String(input);
            if (url.includes('/api/health') && !url.includes('/slow/'))
                return Response.json({ ok: true, gateway: true });
            // A transport that hangs until aborted, exactly as a real one does.
            return await new Promise<Response>((resolve, reject) => {
                const timer = setTimeout(() => resolve(new Response('late')), 5_000);
                init?.signal?.addEventListener('abort', () => {
                    clearTimeout(timer);
                    reject(new DOMException('The operation timed out.', 'TimeoutError'));
                });
            });
        }) as unknown as typeof fetch;
        const started = Date.now();
        const rows = await collectProjectsView({
            listProjects: async () => entries,
            gatewayPort: 3000,
            since: SINCE,
            fetchImpl,
            timeoutMs: 50,
        });
        expect(Date.now() - started).toBeLessThan(3_000);
        expect(rows[0]?.state).toBe('unreachable');
        expect(rows[0]?.state === 'unreachable' ? rows[0].message : '').toMatch(/timed out|TimeoutError/);
    });
});
