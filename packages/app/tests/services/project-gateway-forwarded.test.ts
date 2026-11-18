import { describe, expect, it } from 'bun:test';
import { type ProjectEntry, projectEntrySchema } from '@gobing-ai/spur-config';
import { createGatewayHandler, type GatewayDeps } from '../../src/services/project-gateway';

function entry(name: string, path: string, extra: Partial<ProjectEntry> = {}): ProjectEntry {
    return projectEntrySchema.parse({ name, path, ...extra });
}

interface Seen {
    target: string;
    headers: Headers;
}

/** Handler deps whose upstream answers a fixed body and records what it was handed. */
function deps(seen: Seen[], overrides: Partial<GatewayDeps> = {}): GatewayDeps {
    return {
        listProjects: async () => [entry('ts-libs', '/tmp/ts-libs', { prefix: '/tslibs', port: 3007 })],
        ensureUpstream: async () => 3007,
        port: 3000,
        fetchUpstream: (async (input: unknown, init?: RequestInit) => {
            seen.push({ target: String(input), headers: new Headers(init?.headers) });
            return Response.json({ ok: true });
        }) as unknown as typeof fetch,
        ...overrides,
    };
}

/**
 * 1395 R3: the gateway tells the upstream where it really came from, so a card built behind the
 * gateway advertises the stable gateway URL instead of the ephemeral serve port.
 */
describe('1395 R3: forwarded identity on upstream requests', () => {
    it('sets x-forwarded-host to the gateway authority and x-forwarded-prefix to the prefix', async () => {
        const seen: Seen[] = [];
        const handler = createGatewayHandler(deps(seen));
        const res = await handler(
            new Request('http://localhost:3000/tslibs/a2a/members/x/.well-known/agent-card.json'),
        );
        expect(res.status).toBe(200);
        expect(seen).toHaveLength(1);
        expect(seen[0]?.headers.get('x-forwarded-host')).toBe('localhost:3000');
        expect(seen[0]?.headers.get('x-forwarded-prefix')).toBe('/tslibs');
        // The upstream loopback authority still wins for `host`, so the serve's own host guard passes.
        expect(seen[0]?.headers.get('host')).toBe('127.0.0.1:3007');
    });

    it('keeps the authority the client dialed, including a tunnel hostname', async () => {
        const seen: Seen[] = [];
        const handler = createGatewayHandler(
            deps(seen, { edge: { bindHost: 'localhost', allowedHosts: ['board.example.com'] } }),
        );
        await handler(
            new Request('http://localhost:3000/tslibs/api/tasks', { headers: { host: 'board.example.com' } }),
        );
        expect(seen[0]?.headers.get('x-forwarded-host')).toBe('board.example.com');
    });

    it('forwards the prefix of the matched project, not of the request text', async () => {
        const seen: Seen[] = [];
        const handler = createGatewayHandler(deps(seen));
        await handler(new Request('http://localhost:3000/tslibs/a2a/members/x/a2a/send'));
        expect(seen[0]?.headers.get('x-forwarded-prefix')).toBe('/tslibs');
        expect(seen[0]?.target).toBe('http://127.0.0.1:3007/a2a/members/x/a2a/send');
    });
});
