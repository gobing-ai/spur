import { describe, expect, it } from 'bun:test';
import { type ProjectEntry, projectEntrySchema } from '@gobing-ai/spur-config';
import { createGatewayHandler, type GatewayDeps, type GatewayEvent } from '../../src/services/project-gateway';

function entry(name: string, path: string, extra: Partial<ProjectEntry> = {}): ProjectEntry {
    return projectEntrySchema.parse({ name, path, ...extra });
}

/** Handler deps with a capturing sink; overrides land before the capture so they cannot clobber it. */
function deps(overrides: Partial<GatewayDeps>, events: GatewayEvent[]): GatewayDeps {
    return {
        listProjects: async () => [],
        ensureUpstream: async () => 1,
        port: 4111,
        ...overrides,
        onEvent: (event) => events.push(event),
    };
}

function kinds(events: GatewayEvent[]): string[] {
    return events.map((event) => event.kind);
}

describe('gateway structured events (1384 R1/R3)', () => {
    it('emits guard.host once for a 421 host refusal', async () => {
        const events: GatewayEvent[] = [];
        const handler = createGatewayHandler(
            deps({ edge: { bindHost: 'localhost', allowedHosts: ['board.example.com'] } }, events),
        );
        const res = await handler(new Request('http://evil.test/x/api/tasks', { headers: { host: 'evil.test' } }));
        expect(res.status).toBe(421);
        expect(kinds(events)).toEqual(['guard.host']);
        expect(events[0]).toMatchObject({ status: 421, path: '/x/api/tasks' });
        expect(events[0]?.ts).toBeDefined();
    });

    it('emits guard.csrf once for a 403 cross-origin refusal', async () => {
        const events: GatewayEvent[] = [];
        const handler = createGatewayHandler(
            deps({ edge: { bindHost: 'localhost', allowedHosts: ['board.example.com'] } }, events),
        );
        const res = await handler(
            new Request('http://board.example.com/x/api/tasks', {
                method: 'POST',
                headers: { host: 'board.example.com', origin: 'https://evil.test', 'content-type': 'application/json' },
            }),
        );
        expect(res.status).toBe(403);
        expect(kinds(events)).toEqual(['guard.csrf']);
        expect(events[0]).toMatchObject({ status: 403 });
    });

    it('emits route.collision with the prefix and both identities on a 409', async () => {
        const events: GatewayEvent[] = [];
        const handler = createGatewayHandler(
            deps(
                {
                    listProjects: async () => [
                        entry('alpha', '/tmp/alpha', { prefix: '/x' }),
                        entry('beta', '/tmp/beta', { prefix: '/x' }),
                    ],
                },
                events,
            ),
        );
        const res = await handler(new Request('http://localhost/x/api/tasks'));
        expect(res.status).toBe(409);
        expect(kinds(events)).toEqual(['route.collision']);
        expect(events[0]).toMatchObject({ prefix: '/x', names: ['alpha', 'beta'] });
    });

    it('emits a failed upstream.ensure on a 502 start failure', async () => {
        const events: GatewayEvent[] = [];
        const handler = createGatewayHandler(
            deps(
                {
                    listProjects: async () => [entry('alpha', '/tmp/alpha')],
                    ensureUpstream: async () => {
                        throw new Error('spawn failed');
                    },
                },
                events,
            ),
        );
        const res = await handler(new Request('http://localhost/alpha/api/tasks'));
        expect(res.status).toBe(502);
        expect(kinds(events)).toEqual(['upstream.ensure']);
        expect(events[0]).toMatchObject({ outcome: 'failed', reason: 'spawn failed' });
        expect(typeof events[0]?.ms).toBe('number');
    });

    it('emits ensure ok, proxy.unreachable, and one upstream.restart on the GET retry path', async () => {
        const events: GatewayEvent[] = [];
        // Port 1: nothing listens, both loopback dial attempts are refused.
        const handler = createGatewayHandler(
            deps(
                {
                    listProjects: async () => [entry('alpha', '/tmp/alpha')],
                    ensureUpstream: async () => 1,
                },
                events,
            ),
        );
        const res = await handler(new Request('http://localhost/alpha/api/tasks'));
        expect(res.status).toBe(502);
        // One ensure occurrence per request: first dial fails both families → the replayable GET
        // restarts once → the second dial fails → unreachable 502. The retry's own ensure is part of
        // the restart occurrence, not a second upstream.ensure.
        expect(kinds(events)).toEqual(['upstream.ensure', 'upstream.restart', 'proxy.unreachable']);
        const firstUnreachable = events.find((event) => event.kind === 'proxy.unreachable');
        expect(firstUnreachable?.dialed).toEqual(['127.0.0.1:1', '[::1]:1']);
        expect(firstUnreachable).toMatchObject({ name: 'alpha', prefix: '/alpha' });
        expect(events.filter((event) => event.kind === 'upstream.restart')).toHaveLength(1);
    });

    it('never records request headers, query strings or bodies — pathname only (R3)', async () => {
        const events: GatewayEvent[] = [];
        const handler = createGatewayHandler(
            deps(
                {
                    listProjects: async () => [entry('alpha', '/tmp/alpha')],
                    ensureUpstream: async () => {
                        throw new Error('spawn failed');
                    },
                },
                events,
            ),
        );
        await handler(
            new Request('http://localhost/alpha/api/tasks?token=abc123', {
                headers: { 'x-secret': 'hunter2', 'content-type': 'application/json' },
                body: '{"rows":[]}',
            }),
        );
        const serialized = JSON.stringify(events);
        expect(serialized).not.toContain('hunter2');
        expect(serialized).not.toContain('abc123');
        expect(serialized).not.toContain('rows');
        expect(serialized).not.toContain('?');
    });
});
