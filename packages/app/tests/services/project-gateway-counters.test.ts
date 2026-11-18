import { describe, expect, it } from 'bun:test';
import { type ProjectEntry, projectEntrySchema } from '@gobing-ai/spur-config';
import { createGatewayHandler, type GatewayDeps } from '../../src/services/project-gateway';

function entry(name: string, path: string, extra: Partial<ProjectEntry> = {}): ProjectEntry {
    return projectEntrySchema.parse({ name, path, ...extra });
}

function deps(overrides: Partial<GatewayDeps>): GatewayDeps {
    return { listProjects: async () => [], ensureUpstream: async () => 1, port: 4111, ...overrides };
}

interface HealthCounters {
    since: string;
    requests: number;
    status4xx: number;
    status5xx: number;
    upstreamRestarts: Record<string, number>;
}

async function health(handler: (req: Request) => Promise<Response>): Promise<{
    ok: boolean;
    gateway: boolean;
    port: number;
    projects: unknown[];
    counters: HealthCounters;
}> {
    const res = await handler(new Request('http://localhost/api/health'));
    expect(res.status).toBe(200);
    return (await res.json()) as never;
}

describe('gateway health counters (1385 R1/R2)', () => {
    it('counts requests and status buckets by final status, including guard refusals', async () => {
        const handler = createGatewayHandler(
            deps({
                listProjects: async () => [entry('alpha', '/tmp/alpha')],
                // Port 1: nothing listens, so the proxied GET lands on the 502 path.
                ensureUpstream: async () => 1,
            }),
        );
        expect((await health(handler)).counters).toMatchObject({ requests: 0, status4xx: 0, status5xx: 0 });

        expect((await handler(new Request('http://localhost/'))).status).toBe(200);
        expect((await handler(new Request('http://localhost/nope/api/tasks'))).status).toBe(404);
        expect((await handler(new Request('http://localhost/alpha/api/tasks'))).status).toBe(502);

        const counters = (await health(handler)).counters;
        // Each health read reports the count before its own increment: 1 (the first read) + 3.
        expect(counters.requests).toBe(4);
        expect(counters.status4xx).toBe(1);
        expect(counters.status5xx).toBe(1);
        expect(typeof counters.since).toBe('string');
        expect(Number.isNaN(Date.parse(counters.since))).toBe(false);
    });

    it('counts guard refusals in the 4xx bucket and leaves the existing health fields untouched', async () => {
        const handler = createGatewayHandler(
            deps({
                listProjects: async () => [entry('alpha', '/tmp/alpha', { prefix: '/alpha' })],
                edge: { bindHost: 'localhost', allowedHosts: ['board.example.com'] },
            }),
        );
        expect((await handler(new Request('http://evil.test/x', { headers: { host: 'evil.test' } }))).status).toBe(421);
        const body = await health(handler);
        expect(body.counters).toMatchObject({ requests: 1, status4xx: 1, status5xx: 0 });
        // R2: additive only — liveness readers keep working.
        expect(body.ok).toBe(true);
        expect(body.gateway).toBe(true);
        expect(body.port).toBe(4111);
        expect(body.projects).toEqual([{ name: 'alpha', prefix: '/alpha', running: false }]);
    });

    it('keys upstream restarts by prefix, not by the colliding project name (R1)', async () => {
        let ensureCalls = 0;
        const handler = createGatewayHandler(
            deps({
                listProjects: async () => [entry('knowledge-kit', '/tmp/kk-a', { prefix: '/kk' })],
                ensureUpstream: async () => {
                    ensureCalls += 1;
                    return 1;
                },
            }),
        );
        // Two replayable GETs each hit the dead port and take the one-restart branch.
        await handler(new Request('http://localhost/kk/api/tasks'));
        await handler(new Request('http://localhost/kk/api/tasks'));
        expect(ensureCalls).toBe(4);
        expect((await health(handler)).counters.upstreamRestarts).toEqual({ '/kk': 2 });
    });

    it('resets with the handler, so a fresh instance starts at zero', async () => {
        const first = deps({ listProjects: async () => [] });
        await (await createGatewayHandler(first)(new Request('http://localhost/nope'))).text();
        const fresh = createGatewayHandler(deps({ listProjects: async () => [] }));
        expect((await health(fresh)).counters).toMatchObject({ requests: 0, status4xx: 0, status5xx: 0 });
    });
});
