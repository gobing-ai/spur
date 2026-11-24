/**
 * 1423 — the Integrations procedures on the served API.
 *
 * The failure modes: the procedure missing when both protocol surfaces are off (the case the Board
 * most needs to explain), a token value reaching a response, the gateway block claiming counters it
 * could not read, and a history prefix the event catalog does not find (R7's regression lock).
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ProjectRegistry } from '@gobing-ai/spur-app';
import { removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { createMigratedDb, SystemEventDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { createApp } from '../../../src/bootstrap';
import type { ServerContext } from '../../../src/context';
import { integrationsModule } from '../../../src/modules/integrations';
import { setGatewayProbeFetchForTesting } from '../../../src/modules/integrations/handlers';
import { BUILTIN_TOOL_NAMES } from '../../../src/modules/mcp';

const MCP_TOKEN = 'integrations-mcp-token-value-4321';

/** A context slice the two procedures need: cwd/fs, the boot config switches, a DB, the fleet seam. */
async function makeCtx(
    boot: {
        mcp?: { enabled: boolean; authEnv: string | null; namespace?: string };
        a2a?: { enabled: boolean; authEnv: string | null };
        env?: Record<string, string | undefined>;
        cwd?: string;
        /** The project config `reloadAgentConfig` resolves — the fleet declaration the A2A block reads. */
        config?: unknown;
    } = {},
): Promise<{ ctx: ServerContext; close: () => Promise<void> }> {
    const db = await createMigratedDb({ url: ':memory:' });
    const cwd = boot.cwd ?? '/tmp/integrations-test';
    const ctx = {
        cwd,
        fs: createNodeFileSystem(cwd),
        // Port 1 stands in for "no gateway is reachable" (and never collides with a real one).
        env: boot.env ?? { SPUR_MCP_TOKEN: MCP_TOKEN, SPUR_A2A_TOKEN: 'a2a-token-value-0000', SPUR_GATEWAY_PORT: '1' },
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
        reloadAgentConfig: async () => boot.config ?? null,
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
            // The descriptor count, not a fixed number: every catalog addition grows both sides.
            expect(body.mcp.tools).toHaveLength(BUILTIN_TOOL_NAMES.length);
            expect(body.mcp.tools.every((tool) => tool.origin === 'built-in')).toBe(true);
            expect(body.mcp.tools.every((tool) => tool.annotations !== null)).toBe(true);
        } finally {
            await close();
        }
    });
});

describe('1423 — the gateway block (R5)', () => {
    test('a direct-root request uses the registered local canonical gateway base', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-integrations-direct-'));
        const projectsFile = join(cwd, 'projects.json');
        setEnvVar('SPUR_PROJECTS_FILE', projectsFile);
        await new ProjectRegistry(projectsFile).upsert({ name: 'integrations-test', path: cwd, port: 3007 });
        const { ctx, close } = await makeCtx({
            cwd,
            mcp: { enabled: true, authEnv: 'SPUR_MCP_TOKEN' },
            env: { SPUR_MCP_TOKEN: MCP_TOKEN, SPUR_GATEWAY_PORT: '3000' },
        });
        try {
            const body = (await (await statusOf(ctx)).json()) as { mcp: { url: string } };
            expect(body.mcp.url).toBe('http://localhost:3000/integrations-test/mcp');
        } finally {
            await close();
            removeEnvVar('SPUR_PROJECTS_FILE');
            rmSync(cwd, { recursive: true, force: true });
        }
    });

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

    test('gateway probe uses SPUR_GATEWAY_PORT and honors x-forwarded-proto', async () => {
        const { ctx, close } = await makeCtx({
            mcp: { enabled: true, authEnv: 'SPUR_MCP_TOKEN' },
            env: { SPUR_MCP_TOKEN: MCP_TOKEN, SPUR_GATEWAY_PORT: '4123' },
        });
        const probedUrls: string[] = [];
        setGatewayProbeFetchForTesting(async (input) => {
            probedUrls.push(input);
            return Response.json({
                ok: true,
                gateway: true,
                counters: {
                    since: '2026-11-22T00:00:00.000Z',
                    requests: 1,
                    status4xx: 0,
                    status5xx: 0,
                    upstreamRestarts: {},
                },
            });
        });
        try {
            const res = await statusOf(ctx, {
                'x-forwarded-proto': 'https',
                'x-forwarded-host': 'spur.example.com',
                'x-forwarded-prefix': '/tslibs',
            });
            expect(res.status).toBe(200);
            expect(probedUrls[0]).toStartWith('http://localhost:4123/api/health');
            const body = (await res.json()) as { mcp: { url: string }; gateway: { rootMcpUrl?: string } };
            expect(body.mcp.url).toBe('https://spur.example.com/tslibs/mcp');
            expect(body.gateway.rootMcpUrl).toBe('https://spur.example.com/mcp');
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

describe('1423 — history supports both spellings of protocol prefixes (R7)', () => {
    const protocolEvents = { mcp: 'mcp.tool.called', a2a: 'a2a.message.received', auth: 'auth.denied' };
    for (const [prefix, event] of Object.entries(protocolEvents)) {
        test(`prefix=${prefix} and prefix=${prefix}. read the same cataloged family`, async () => {
            const { ctx, close } = await makeCtx();
            try {
                const dao = await ctx.systemEventDao();
                for (const name of Object.values(protocolEvents)) {
                    await dao.insert({ id: name, event_name: name, occurred_at: '2026-07-03T23:59:59.000Z' });
                }
                const app = appFor(ctx);
                for (const filter of [prefix, `${prefix}.`]) {
                    const res = await app.request(`/api/events/history?prefix=${filter}`);
                    expect(res.status).toBe(200);
                    const body = (await res.json()) as { events: Array<{ id: string; prefix: string }> };
                    expect(body.events.map((row) => [row.id, row.prefix])).toEqual([[event, prefix]]);
                }
            } finally {
                await close();
            }
        });
    }

    test('an unknown dotted prefix is still refused', async () => {
        const { ctx, close } = await makeCtx();
        try {
            const res = (await appFor(ctx).fetch(
                new Request('http://127.0.0.1:3007/api/events/history?prefix=unknown.'),
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

// ─── 1438 R1: the namespace, its provenance and the refused exposures ──────────────────────
// The failure modes: a discarded resolver issue list (the seam 1437 filed as G1), a provenance
// that reports "config" for a manifest, and a status catalog that disagrees with `tools/list`.

const fixtures: string[] = [];
afterAll(() => {
    for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});

/** A scratch project carrying the given files (relative path → body). */
function fixture(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'spur-integrations-1438-'));
    fixtures.push(root);
    for (const [path, body] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), body);
    }
    return root;
}

/** An exposable workflow definition; two of the same `name` derive one colliding tool name. */
function exposedWorkflow(name: string): string {
    return `name: ${name}
kind: state-machine
metadata:
  mcp:
    expose: true
initialState: start
states:
  - id: start
terminalStates:
  - start
`;
}

interface ExposureBody {
    mcp: {
        namespace?: string | null;
        namespaceSource?: string;
        tools: Array<{ name: string }>;
        exposureIssues?: Array<{ tool: string; file: string; reason: string; remedy: string }>;
    };
}

/** The names `tools/list` serves from the same context (the agreement half of AC1). */
async function listedToolNames(ctx: ServerContext): Promise<string[]> {
    const res = (await appFor(ctx).fetch(
        new Request('http://127.0.0.1:3007/mcp', {
            method: 'POST',
            headers: {
                authorization: `Bearer ${MCP_TOKEN}`,
                'content-type': 'application/json',
                'mcp-protocol-version': '2026-07-28',
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        }),
    )) as Response;
    const body = (await res.json()) as { result?: { tools?: Array<{ name: string }> } };
    return (body.result?.tools ?? []).map((tool) => tool.name).sort();
}

describe('1438 — namespace provenance and refused exposures (R1)', () => {
    test('explicit config wins, a colliding workflow is refused with a remedy, and both catalogs agree', async () => {
        const root = fixture({
            '.spur/workflows/report.yaml': exposedWorkflow('report'),
            '.spur/workflows/dup-a.yaml': exposedWorkflow('dup'),
            '.spur/workflows/dup-b.yaml': exposedWorkflow('dup'),
        });
        const { ctx, close } = await makeCtx({
            mcp: { enabled: true, authEnv: 'SPUR_MCP_TOKEN', namespace: 'ops' },
            cwd: root,
        });
        try {
            const body = (await (await statusOf(ctx)).json()) as ExposureBody;
            expect(body.mcp.namespace).toBe('ops');
            expect(body.mcp.namespaceSource).toBe('config');
            const names = body.mcp.tools.map((tool) => tool.name);
            expect(names).toContain('ops_report');
            expect(names).not.toContain('ops_dup');
            const issues = body.mcp.exposureIssues ?? [];
            expect(issues.map((issue) => [issue.tool, issue.reason])).toEqual([
                ['ops_dup', 'duplicate'],
                ['ops_dup', 'duplicate'],
            ]);
            expect(issues.every((issue) => issue.remedy.includes('rename'))).toBe(true);
            expect(issues[0]?.file).toEndWith('dup-a.yaml');
            expect(names.sort()).toEqual(await listedToolNames(ctx));
        } finally {
            await close();
        }
    });

    test('one valid plugin manifest supplies the namespace when none is configured', async () => {
        const root = fixture({
            'plugins/kk/plugin.json': JSON.stringify({ name: 'kk' }),
            '.spur/workflows/report.yaml': exposedWorkflow('report'),
        });
        const { ctx, close } = await makeCtx({ mcp: { enabled: true, authEnv: 'SPUR_MCP_TOKEN' }, cwd: root });
        try {
            const body = (await (await statusOf(ctx)).json()) as ExposureBody;
            expect(body.mcp.namespace).toBe('kk');
            expect(body.mcp.namespaceSource).toBe('plugin-manifest');
            expect(body.mcp.tools.map((tool) => tool.name)).toContain('kk_report');
            expect(body.mcp.exposureIssues).toEqual([]);
        } finally {
            await close();
        }
    });

    test('no namespace refuses every exposed workflow with the enabling remedy', async () => {
        const root = fixture({ '.spur/workflows/report.yaml': exposedWorkflow('report') });
        const { ctx, close } = await makeCtx({ mcp: { enabled: true, authEnv: 'SPUR_MCP_TOKEN' }, cwd: root });
        try {
            const body = (await (await statusOf(ctx)).json()) as ExposureBody;
            expect(body.mcp.namespace).toBeNull();
            expect(body.mcp.namespaceSource).toBe('none');
            const issues = body.mcp.exposureIssues ?? [];
            expect(issues).toHaveLength(1);
            expect(issues[0]?.reason).toBe('no-namespace');
            expect(issues[0]?.remedy).toContain('SPUR_MCP_NAMESPACE');
            expect(body.mcp.tools.map((tool) => tool.name)).not.toContain('report');
            expect((body.mcp.tools.map((tool) => tool.name) as string[]).sort()).toEqual(await listedToolNames(ctx));
        } finally {
            await close();
        }
    });
});

// ─── 1440 R2: outbound credential state, by variable name only ──────────────────────────────
const PEER_TOKEN = 'integrations-peer-token-value-9876';

describe('1440 — outbound credential state (R2)', () => {
    test('a declared credential reports its variable name and presence, never the value', async () => {
        const { ctx, close } = await makeCtx({
            // The listener stays off: the outbound block is built from the declaration, and an
            // enabled A2A module would need its own inbox seam in this slice.
            a2a: { enabled: false, authEnv: null },
            env: { PEER_A2A_TOKEN: PEER_TOKEN, SPUR_GATEWAY_PORT: '1' },
            config: {
                agent: {
                    fleet: {
                        members: [
                            {
                                id: 'peer',
                                a2a: 'https://peer.example/.well-known/agent-card.json',
                                authEnv: 'PEER_A2A_TOKEN',
                            },
                            {
                                id: 'unset-peer',
                                a2a: 'https://other.example/.well-known/agent-card.json',
                                authEnv: 'UNSET_PEER_TOKEN',
                            },
                        ],
                    },
                },
            },
        });
        try {
            const raw = await (await statusOf(ctx)).text();
            expect(raw).not.toContain(PEER_TOKEN);
            const body = JSON.parse(raw) as {
                a2a: {
                    outbound: Array<{
                        member: string;
                        kind: string;
                        target: string;
                        auth?: { envName: string; tokenPresent: boolean };
                    }>;
                };
            };
            const byEnv = new Map(body.a2a.outbound.map((member) => [member.auth?.envName, member]));
            expect(byEnv.get('PEER_A2A_TOKEN')?.auth).toEqual({ envName: 'PEER_A2A_TOKEN', tokenPresent: true });
            expect(byEnv.get('UNSET_PEER_TOKEN')?.auth).toEqual({ envName: 'UNSET_PEER_TOKEN', tokenPresent: false });
            expect(byEnv.get('PEER_A2A_TOKEN')?.target).toBe('https://peer.example/.well-known/agent-card.json');
        } finally {
            await close();
        }
    });
});
