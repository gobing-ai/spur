/**
 * 1423 — the Integrations status/usage assembly.
 *
 * The failure modes that matter: a surface that is off must still be reported (an omitting
 * response reads as "unknown"), a token VALUE must never reach the payload, a failed gateway probe
 * must degrade to `counters: null` + diagnostic instead of failing the read, and the usage window
 * must come from the real ledger fold rather than a second query.
 */
import { describe, expect, test } from 'bun:test';
import type { IntegrationsInboundMember, IntegrationsStatus } from '@gobing-ai/spur-contracts';
import { createMigratedDb, type DbAdapter, SystemEventDao } from '@gobing-ai/spur-domain';
import { InboxService } from '../../src/services/inbox-service';
import type {
    IntegrationsA2aSource,
    IntegrationsGatewayProbe,
    IntegrationsMcpSource,
} from '../../src/services/integrations-service';
import { IntegrationsService, type IntegrationsSources } from '../../src/services/integrations-service';

const TOKEN = 'integrations-secret-token-9876';

/** The inbound rows of the merged A2A member list (K44 1451). */
function inbound(status: IntegrationsStatus): IntegrationsInboundMember[] {
    return status.a2a.members.filter((member): member is IntegrationsInboundMember => member.direction === 'inbound');
}

/** A fleet double: one inbound coder and one outbound A2A peer. */
function fleetDouble(options: { writeCapable?: boolean } = {}) {
    const declaration = {
        enabled: true,
        members: [
            { role: 'coder' as const, executor: 'claude', purpose: 'lands tasks' },
            { id: 'peer', a2a: 'https://peer.example' },
        ],
    };
    return {
        load: async () => declaration,
        memberAddresses: async () => [
            { instanceId: 'proj-coder', executor: 'claude', enabled: true, role: 'coder', purpose: 'lands tasks' },
            { instanceId: 'proj-peer', executor: '', enabled: true },
        ],
        resolve: async () => ({
            projectPath: '/proj',
            enabled: true,
            missing: [],
            members: [
                {
                    instanceId: 'proj-coder',
                    executor: 'claude',
                    enabled: true,
                    writeCapable: options.writeCapable ?? true,
                },
                { instanceId: 'proj-peer', executor: '', enabled: true, writeCapable: false },
            ],
        }),
    };
}

/** The MCP catalog the server would hand over. */
function mcpSource(overrides: Partial<IntegrationsMcpSource> = {}): IntegrationsMcpSource {
    return {
        enabled: true,
        authEnv: 'SPUR_MCP_TOKEN',
        tokenPresent: true,
        protocolVersion: '2026-07-28',
        tools: [
            {
                name: 'sp_task_list',
                description: 'List tasks',
                inputSchema: { type: 'object' },
                annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
            },
            {
                name: 'ops_daily_report',
                description: 'Run the daily report',
                inputSchema: { type: 'object' },
                annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
            },
        ],
        resources: [{ uri: 'spur://tasks/{wbs}', description: 'Task by WBS' }],
        builtinToolNames: ['sp_task_list'],
        ...overrides,
    };
}

function sources(
    options: {
        mcp?: Partial<IntegrationsMcpSource>;
        a2a?: IntegrationsA2aSource;
        gateway?: IntegrationsGatewayProbe;
    } = {},
): IntegrationsSources {
    return {
        mcp: async () => mcpSource(options.mcp),
        a2a: async () => options.a2a ?? { enabled: true, authEnv: 'SPUR_A2A_TOKEN', tokenPresent: true },
        gateway: async () => options.gateway ?? { counters: null, diagnostic: 'not reached' },
    };
}

function service(
    deps: { sources?: IntegrationsSources; writeCapable?: boolean; getDb?: () => Promise<DbAdapter> } = {},
): IntegrationsService {
    return new IntegrationsService({
        sources: deps.sources ?? sources(),
        fleet: fleetDouble({ writeCapable: deps.writeCapable }) as never,
        getDb: deps.getDb ?? (async () => createMigratedDb({ url: ':memory:' })),
        projectPath: '/proj',
    });
}

describe('1423 status — surfaces and credentials', () => {
    test('reports every surface whether it is on or off, with the auth env NAME', async () => {
        const status = await service({
            sources: sources({
                mcp: { enabled: true, authEnv: 'SPUR_MCP_TOKEN', tokenPresent: true },
                a2a: { enabled: false, authEnv: 'SPUR_A2A_TOKEN', tokenPresent: false },
            }),
        }).status({ origin: 'http://localhost:3007' });
        expect(status.mcp.enabled).toBe(true);
        expect(status.mcp.url).toBe('http://localhost:3007/mcp');
        expect(status.mcp.auth).toEqual({ envName: 'SPUR_MCP_TOKEN', tokenPresent: true });
        expect(status.mcp.protocolVersion).toBe('2026-07-28');
        expect(status.a2a.enabled).toBe(false);
        expect(status.a2a.auth).toEqual({ envName: 'SPUR_A2A_TOKEN', tokenPresent: false });
        expect(status.gateway).toEqual({ served: false });
    });

    test('a disabled MCP surface advertises no endpoint but still lists its catalog', async () => {
        const status = await service({ sources: sources({ mcp: { enabled: false, tokenPresent: false } }) }).status({
            origin: 'http://localhost:1',
        });
        expect(status.mcp.url).toBeNull();
        expect(status.mcp.tools).toHaveLength(2);
    });

    test('the catalog carries origin and annotations from the descriptors (1421, 1447)', async () => {
        const status = await service({
            sources: sources({
                mcp: {
                    tools: [
                        ...mcpSource().tools,
                        {
                            name: 'ops_smoke',
                            description: 'Smoke check',
                            inputSchema: { type: 'object' },
                            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
                        },
                    ],
                    manifestToolNames: ['ops_smoke'],
                },
            }),
        }).status({ origin: 'http://localhost:1' });
        const [builtin, workflow, manifest] = status.mcp.tools;
        expect(builtin).toMatchObject({
            name: 'sp_task_list',
            origin: 'built-in',
            annotations: { readOnlyHint: true, idempotentHint: true },
        });
        expect(workflow).toMatchObject({
            name: 'ops_daily_report',
            origin: 'workflow',
            description: 'Run the daily report',
        });
        expect(manifest).toMatchObject({
            name: 'ops_smoke',
            origin: 'manifest',
            description: 'Smoke check',
        });
        expect(status.mcp.resources).toEqual([{ uriTemplate: 'spur://tasks/{wbs}', description: 'Task by WBS' }]);
    });

    test('K44 1451 — inbound and outbound members come from the fleet declaration as one list with a direction', async () => {
        const status = await service().status({ origin: 'http://localhost:3007' });
        expect(status.a2a.members).toEqual([
            {
                member: 'proj-coder',
                direction: 'inbound',
                role: 'coder',
                cardUrl: 'http://localhost:3007/a2a/members/proj-coder/.well-known/agent-card.json',
                writeFenced: true,
            },
            { member: 'proj-peer', direction: 'outbound', kind: 'a2a', target: 'https://peer.example' },
        ]);
        // The two old lists are gone, not kept alongside.
        expect(Object.keys(status.a2a)).not.toContain('inbound');
        expect(Object.keys(status.a2a)).not.toContain('outbound');
    });

    test('a member whose executor cannot attest write capability is not advertised as fenced', async () => {
        const status = await service({ writeCapable: false }).status({ origin: 'http://localhost:1' });
        expect(inbound(status)[0]?.writeFenced).toBe(false);
    });

    test('disabled inbound members are omitted from the published A2A inbound list', async () => {
        const mixedFleet = {
            load: async () => ({
                enabled: true,
                members: [
                    { role: 'coder' as const, executor: 'claude', enabled: true },
                    { id: 'disabled-dev', role: 'coder' as const, executor: 'claude', enabled: false },
                ],
            }),
            memberAddresses: async () => [
                { instanceId: 'proj-coder', executor: 'claude', enabled: true, role: 'coder' },
                { instanceId: 'proj-disabled-dev', executor: 'claude', enabled: false, role: 'coder' },
            ],
            resolve: async () => ({
                projectPath: '/proj',
                enabled: true,
                missing: [],
                members: [{ instanceId: 'proj-coder', executor: 'claude', enabled: true, writeCapable: true }],
            }),
        };
        const status = await new IntegrationsService({
            sources: sources(),
            fleet: mixedFleet as never,
            getDb: async () => createMigratedDb({ url: ':memory:' }),
            projectPath: '/proj',
        }).status({ origin: 'http://localhost:3007' });
        expect(inbound(status).map((entry) => entry.member)).toEqual(['proj-coder']);
    });

    test('no serialized field contains the token value', async () => {
        const status = await service({
            sources: sources({ mcp: { authEnv: 'SPUR_MCP_TOKEN', tokenPresent: true } }),
        }).status({ origin: 'http://localhost:1' });
        expect(JSON.stringify(status)).not.toContain(TOKEN);
    });
});

describe('1423 status — gateway block', () => {
    const counters = {
        since: '2026-11-22T00:00:00.000Z',
        requests: 12,
        status4xx: 1,
        status5xx: 0,
        upstreamRestarts: { tslibs: 2 },
    };

    test('a forwarded prefix marks a gateway request and reports counters and the root URL', async () => {
        const status = await service({ sources: sources({ gateway: { counters } }) }).status({
            origin: 'http://127.0.0.1:3007',
            forwardedHost: 'localhost:3000',
            forwardedPrefix: '/tslibs',
        });
        expect(status.gateway).toEqual({
            served: true,
            namespace: '/tslibs',
            rootMcpUrl: 'http://localhost:3000/mcp',
            counters,
        });
        // URLs through the gateway keep the mount prefix the caller used.
        expect(status.mcp.url).toBe('http://localhost:3000/tslibs/mcp');
        expect(inbound(status)[0]?.cardUrl).toBe(
            'http://localhost:3000/tslibs/a2a/members/proj-coder/.well-known/agent-card.json',
        );
    });

    test('a direct legacy request uses the local canonical gateway base', async () => {
        const status = await service().status({
            origin: 'http://127.0.0.1:3007',
            localGatewayBase: 'http://localhost:3000/tslibs',
        });
        expect(status.gateway).toEqual({ served: false });
        expect(status.mcp.url).toBe('http://localhost:3000/tslibs/mcp');
        expect(inbound(status)[0]?.cardUrl).toBe(
            'http://localhost:3000/tslibs/a2a/members/proj-coder/.well-known/agent-card.json',
        );
    });

    test('forwardedProto https preserves the public https scheme behind TLS proxies', async () => {
        const status = await service({ sources: sources({ gateway: { counters } }) }).status({
            origin: 'http://127.0.0.1:3007',
            forwardedProto: 'https, http',
            forwardedHost: 'spur.example.com',
            forwardedPrefix: '/tslibs',
        });
        expect(status.mcp.url).toBe('https://spur.example.com/tslibs/mcp');
        expect(status.a2a.url).toBe('https://spur.example.com/tslibs/a2a');
        expect(inbound(status)[0]?.cardUrl).toBe(
            'https://spur.example.com/tslibs/a2a/members/proj-coder/.well-known/agent-card.json',
        );
        if (status.gateway.served) {
            expect(status.gateway.rootMcpUrl).toBe('https://spur.example.com/mcp');
        }
    });

    test('a failed probe degrades to null counters plus a diagnostic, never a failed read', async () => {
        const status = await service({
            sources: sources({ gateway: { counters: null, diagnostic: 'connect ECONNREFUSED' } }),
        }).status({ origin: 'http://127.0.0.1:3007', forwardedHost: 'localhost:3000', forwardedPrefix: '/tslibs' });
        expect(status.gateway).toMatchObject({
            served: true,
            counters: null,
            diagnostic: 'connect ECONNREFUSED',
        });
    });

    test('standalone never probes the gateway', async () => {
        let probed = 0;
        const local: IntegrationsSources = {
            mcp: async () => mcpSource(),
            a2a: async () => ({ enabled: false, authEnv: null, tokenPresent: false }),
            gateway: async () => {
                probed += 1;
                return { counters: null };
            },
        };
        const status = await service({ sources: local }).status({ origin: 'http://localhost:3007' });
        expect(status.gateway).toEqual({ served: false });
        expect(probed).toBe(0);
    });
});

describe('1423 usage — the ledger fold', () => {
    test('aggregates attempted outbound requests and authentication refusals from the selected window', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const inbox = new InboxService({ getDb: async () => db });
            const request = await inbox.send({ from: 'operator', to: 'proj-peer', kind: 'request', body: 'fixture' });
            const claim = await inbox.claimById(request.message.id);
            if (claim === null) throw new Error('fixture was not claimable');
            await inbox.settle([claim], 'not-started', 'HTTP 401 Unauthorized');
            const integrations = service({ getDb: async () => db });
            expect((await integrations.usage({ since: '1970-01-01T00:00:00.000Z' })).outboundActivity).toEqual({
                calls: 1,
                failures: 1,
                lastCall: expect.any(String),
                authDenials: 1,
            });
            expect((await integrations.usage({ since: '2999-01-01T00:00:00.000Z' })).outboundActivity).toEqual({
                calls: 0,
                failures: 0,
                lastCall: null,
                authDenials: 0,
            });
        } finally {
            await db.close();
        }
    });
    test('reads the real event ledger over a bounded window', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        const dao = new SystemEventDao(db);
        const insert = async (name: string, data: Record<string, unknown>, at: string) => {
            await dao.insert({
                id: crypto.randomUUID(),
                event_name: name,
                occurred_at: at,
                actor: 'a2a',
                payload_json: JSON.stringify({ data }),
            });
        };
        await insert(
            'mcp.tool.called',
            { tool: 'sp_task_list', durationMs: 12, outcome: 'ok' },
            '2026-11-22T01:00:00.000Z',
        );
        await insert(
            'mcp.tool.failed',
            { tool: 'sp_task_list', errorCode: 'invalid_arguments' },
            '2026-11-22T03:00:00.000Z',
        );
        await insert('a2a.message.received', { member: 'proj-coder', outcome: 'accepted' }, '2026-11-22T03:05:00.000Z');
        await insert('a2a.task.cancelled', { member: 'proj-coder', taskId: 't1' }, '2026-11-22T03:10:00.000Z');
        await insert('auth.denied', { surface: 'mcp', reason: 'missing' }, '2026-11-22T03:15:00.000Z');

        const usage = await service({ getDb: async () => db }).usage({ since: '2026-11-22T02:00:00.000Z' });
        // The window excludes the 01:00 call, so the failure is the only MCP row in range.
        expect(usage.tools).toEqual([
            expect.objectContaining({ tool: 'sp_task_list', calls: 0, failures: 1, failureRate: 1 }),
        ]);
        expect(usage.a2a).toEqual([{ member: 'proj-coder', received: 1, replayed: 0, conflict: 0, cancelled: 1 }]);
        expect(usage.authDenied).toEqual([{ surface: 'mcp', reason: 'missing', count: 1 }]);
        await db.close();
    });

    test('an unbounded read includes every protocol row', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        await new SystemEventDao(db).insert({
            id: crypto.randomUUID(),
            event_name: 'mcp.tool.called',
            occurred_at: '2020-01-01T00:00:00.000Z',
            actor: 'human',
            payload_json: JSON.stringify({ data: { tool: 'sp_task_show', durationMs: 3 } }),
        });
        const usage = await service({ getDb: async () => db }).usage({});
        expect(usage.tools[0]).toMatchObject({ tool: 'sp_task_show', calls: 1 });
        await db.close();
    });
});
