/**
 * 1423 — the Integrations procedures on the served API.
 *
 * The failure modes: the procedure missing when both protocol surfaces are off (the case the Board
 * most needs to explain), a token value reaching a response, the gateway block claiming counters it
 * could not read, and a history prefix the event catalog does not find (R7's regression lock).
 */
import { describe, expect, test } from 'bun:test';
import { createMigratedDb, SystemEventDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { createApp } from '../../../src/bootstrap';
import type { ServerContext } from '../../../src/context';
import { integrationsModule } from '../../../src/modules/integrations';
import { setGatewayProbeFetchForTesting } from '../../../src/modules/integrations/handlers';

const MCP_TOKEN = 'integrations-mcp-token-value-4321';

/** A context slice the two procedures need: cwd/fs, the boot config switches, a DB, the fleet seam. */
async function makeCtx(
    boot: {
        mcp?: { enabled: boolean; authEnv: string | null };
        a2a?: { enabled: boolean; authEnv: string | null };
    } = {},
): Promise<{ ctx: ServerContext; close: () => Promise<void> }> {
    const db = await createMigratedDb({ url: ':memory:' });
    const ctx = {
        cwd: '/tmp/integrations-test',
        fs: createNodeFileSystem('/tmp/integrations-test'),
        // Port 1 stands in for "no gateway is reachable" (and never collides with a real one).
        env: { SPUR_MCP_TOKEN: MCP_TOKEN, SPUR_A2A_TOKEN: 'a2a-token-value-0000', SPUR_GATEWAY_PORT: '1' },
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
        getDb: async () => db,
        systemEventDao: async () => new SystemEventDao(db),
        bootConfig: () => ({
            // The other built-ins read their switches at mount, so a slice must carry the whole shape.
            logging: { level: 'error' },
            telemetry: { enabled: false },
            events: { enabled: true, diagnostic: false },
            jobqueue: { enabled: false },
            scheduler: { enabled: false },
            mcp: boot.mcp ?? { enabled: false, authEnv: null },
            a2a: boot.a2a ?? { enabled: false, authEnv: null },
        }),
        reloadAgentConfig: async () => null,
        eventBus: () => ({ emit: () => {} }),
        spurConfig: null,
    } as unknown as ServerContext;
    return {
        ctx,
        close: async () => {
            await db.close();
        },
    };
}

function appFor(ctx: ServerContext) {
    return createApp(undefined, { ctx });
}

async function statusOf(ctx: ServerContext, headers: Record<string, string> = {}): Promise<Response> {
    return appFor(ctx).fetch(
        new Request('http://127.0.0.1:3007/api/integrations/status', { headers }),
    ) as Promise<Response>;
}

describe('1423 — the status procedure is always mounted (R1)', () => {
    test('it answers with both surfaces off', async () => {
        const { ctx, close } = await makeCtx();
        try {
            const res = await statusOf(ctx);
            expect(res.status).toBe(200);
            const body = (await res.json()) as {
                mcp: { enabled: boolean; auth: { envName: string; tokenPresent: boolean } };
                a2a: { enabled: boolean };
                gateway: { served: boolean };
            };
            expect(body.mcp.enabled).toBe(false);
            expect(body.mcp.auth).toEqual({ envName: '', tokenPresent: false });
            expect(body.a2a.enabled).toBe(false);
            expect(body.gateway).toEqual({ served: false });
        } finally {
            await close();
        }
    });

    test('both procedures exist on the router', async () => {
        const { ctx, close } = await makeCtx();
        try {
            const usage = (await appFor(ctx).fetch(
                new Request('http://127.0.0.1:3007/api/integrations/usage'),
            )) as Response;
            expect(usage.status).toBe(200);
            const body = (await usage.json()) as { tools: unknown[] };
            expect(Array.isArray(body.tools)).toBe(true);
        } finally {
            await close();
        }
    });
});

describe('1423 — no token value in the payload (R2)', () => {
    test('the MCP block reports the variable name and its presence only', async () => {
        const { ctx, close } = await makeCtx({ mcp: { enabled: true, authEnv: 'SPUR_MCP_TOKEN' } });
        try {
            const res = await statusOf(ctx);
            const raw = await res.text();
            expect(res.status).toBe(200);
            expect(raw).not.toContain(MCP_TOKEN);
            const body = JSON.parse(raw) as { mcp: { enabled: boolean; auth: unknown; url: string } };
            expect(body.mcp.enabled).toBe(true);
            expect(body.mcp.auth).toEqual({ envName: 'SPUR_MCP_TOKEN', tokenPresent: true });
            expect(body.mcp.url).toBe('http://127.0.0.1:3007/mcp');
        } finally {
            await close();
        }
    });

    test('the catalog comes from the same descriptors tools/list serves', async () => {
        const { ctx, close } = await makeCtx({ mcp: { enabled: true, authEnv: 'SPUR_MCP_TOKEN' } });
        try {
            const body = (await (await statusOf(ctx)).json()) as {
                mcp: { tools: Array<{ name: string; origin: string; annotations: unknown }> };
            };
            expect(body.mcp.tools).toHaveLength(10);
            expect(body.mcp.tools.every((tool) => tool.origin === 'built-in')).toBe(true);
            expect(body.mcp.tools.every((tool) => tool.annotations !== null)).toBe(true);
        } finally {
            await close();
        }
    });
});

describe('1423 — the gateway block (R5)', () => {
    test('counters come from the gateway health read', async () => {
        const counters = {
            since: '2026-11-22T00:00:00.000Z',
            requests: 7,
            status4xx: 1,
            status5xx: 0,
            upstreamRestarts: { tslibs: 1 },
        };
        setGatewayProbeFetchForTesting(async (input) => {
            expect(input).toContain('/api/health');
            return Response.json({ ok: true, gateway: true, counters });
        });
        const { ctx, close } = await makeCtx();
        try {
            const body = (await (
                await statusOf(ctx, { 'x-forwarded-host': 'localhost:3000', 'x-forwarded-prefix': '/tslibs' })
            ).json()) as { gateway: { counters: unknown; diagnostic?: string } };
            expect(body.gateway.counters).toEqual(counters);
            expect(body.gateway.diagnostic).toBeUndefined();
        } finally {
            setGatewayProbeFetchForTesting(undefined);
            await close();
        }
    });

    test('a forwarded prefix makes it a gateway request; an unreadable probe is reported, not thrown', async () => {
        const { ctx, close } = await makeCtx();
        try {
            const res = await statusOf(ctx, { 'x-forwarded-host': 'localhost:3000', 'x-forwarded-prefix': '/tslibs' });
            expect(res.status).toBe(200);
            const body = (await res.json()) as {
                gateway: {
                    served: boolean;
                    namespace: string;
                    rootMcpUrl: string;
                    counters: unknown;
                    diagnostic?: string;
                };
            };
            expect(body.gateway.served).toBe(true);
            expect(body.gateway.namespace).toBe('/tslibs');
            expect(body.gateway.rootMcpUrl).toBe('http://localhost:3000/mcp');
            // Nothing listens on the gateway port in a test process: null counters + a diagnostic.
            expect(body.gateway.counters).toBeNull();
            expect(typeof body.gateway.diagnostic).toBe('string');
        } finally {
            await close();
        }
    });
});

describe('1423 — history prefixes are dot-less (R7 regression lock)', () => {
    for (const prefix of ['mcp', 'a2a', 'auth']) {
        test(`prefix=${prefix} is a cataloged family`, async () => {
            const { ctx, close } = await makeCtx();
            try {
                const res = (await appFor(ctx).fetch(
                    new Request(`http://127.0.0.1:3007/api/events/history?prefix=${prefix}`),
                )) as Response;
                expect(res.status).toBe(200);
                const body = (await res.json()) as { events: Array<{ prefix: string }> };
                expect(body.events.every((row) => row.prefix === prefix)).toBe(true);
            } finally {
                await close();
            }
        });
    }

    test('a dotted prefix is refused as uncataloged', async () => {
        const { ctx, close } = await makeCtx();
        try {
            const res = (await appFor(ctx).fetch(
                new Request('http://127.0.0.1:3007/api/events/history?prefix=mcp.'),
            )) as Response;
            expect(res.status).toBe(400);
        } finally {
            await close();
        }
    });
});

describe('1423 — the module registers unconditionally', () => {
    test('its mount is a no-op and its name is stable', () => {
        expect(integrationsModule.name).toBe('integrations');
        expect(() => integrationsModule.mount(undefined as never, undefined)).not.toThrow();
    });
});
