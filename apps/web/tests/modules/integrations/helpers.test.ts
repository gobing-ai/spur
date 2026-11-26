/**
 * Integrations module projections (A82 1424).
 *
 * These are the rules the task pins and the components must not re-invent: the three state chips,
 * the copyable snippet that names a variable instead of a token, the `a2a:` request-key family, and
 * the two deep-link URL shapes.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import type { IntegrationsStatus } from '@gobing-ai/spur-contracts';
import { resetBasePathForTesting } from '../../../src/lib/base-path';
import {
    a2aRequests,
    a2aTimelineInput,
    allSurfacesOff,
    assignLanes,
    clientSnippet,
    decodeA2aFilters,
    enablementKeys,
    encodeA2aFilters,
    formatUptime,
    type InboxRow,
    inboxLink,
    LANE_CAP,
    MCP_CLIENT_AGENTS,
    mergeTimelinePages,
    OVERFLOW_LANE,
    projectProtocolEvent,
    renderClientConfig,
    requestState,
    sinceForWindow,
    surfaceState,
    systemEventLink,
} from '../../../src/modules/integrations/helpers';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

registerHappyDom();
afterAll(teardownHappyDom);

describe('1424 — surface state vocabulary', () => {
    test('exactly three states, and only a missing token is the error tone', () => {
        expect(surfaceState({ enabled: false, auth: { tokenPresent: true } })).toBe('off');
        expect(surfaceState({ enabled: true, auth: { tokenPresent: true } })).toBe('on');
        expect(surfaceState({ enabled: true, auth: { tokenPresent: false } })).toBe('on · token unset');
    });

    test('every surface off is the only empty-state condition', () => {
        const off = {
            mcp: { enabled: false },
            a2a: { enabled: false, members: [] },
            gateway: { served: false },
        } as unknown as IntegrationsStatus;
        expect(allSurfacesOff(off)).toBe(true);
        expect(allSurfacesOff({ ...off, a2a: { enabled: true, members: [] } } as unknown as IntegrationsStatus)).toBe(
            false,
        );
        expect(
            allSurfacesOff({
                ...off,
                gateway: {
                    served: true,
                    namespace: '/spur-new',
                    rootMcpUrl: 'http://localhost:3000/mcp',
                    counters: null,
                    mcp: { enabled: true, auth: { envName: 'GW_TOKEN', tokenPresent: true } },
                },
            } as unknown as IntegrationsStatus),
        ).toBe(false);
        expect(
            allSurfacesOff({
                ...off,
                a2a: {
                    enabled: false,
                    members: [{ member: 'peer', direction: 'outbound', kind: 'a2a', target: 'http://peer' }],
                },
            } as unknown as IntegrationsStatus),
        ).toBe(false);
    });

    test('the empty state names the config keys that turn each surface on', () => {
        expect(enablementKeys().join(' ')).toContain('server.mcp.enabled');
        expect(enablementKeys().join(' ')).toContain('server.a2a.enabled');
    });
});

describe('1424 — client snippet', () => {
    const status = {
        mcp: { url: 'http://localhost:3007/mcp', auth: { envName: 'SPUR_MCP_TOKEN', tokenPresent: true } },
    } as unknown as IntegrationsStatus;

    test('names the endpoint and the variable placeholder, never a value', () => {
        const snippet = clientSnippet(status);
        expect(snippet).toContain('http://localhost:3007/mcp');
        expect(snippet).toContain(`\${SPUR_MCP_TOKEN}`);
        expect(snippet).not.toContain('Bearer ey');
    });

    test('an unnamed variable still renders a placeholder rather than an empty header', () => {
        const unnamed = {
            mcp: { url: null, auth: { envName: '', tokenPresent: false } },
        } as unknown as IntegrationsStatus;
        expect(clientSnippet(unnamed)).toContain(`\${<ENV_NAME>}`);
    });
});

describe('1424 — activity projections', () => {
    test('only the a2a: request-key family is A2A work', () => {
        const rows = [
            {
                messageId: 'a',
                requestKey: 'a2a:proj-coder:m1',
                status: 'claimed',
                runId: 'r1',
                taskId: null,
                outcome: null,
            },
            {
                messageId: 'b',
                requestKey: 'fleet:task:1421:1',
                status: 'claimed',
                runId: 'r2',
                taskId: '1421',
                outcome: null,
            },
            { messageId: 'c', requestKey: null, status: 'queued', runId: null, taskId: null, outcome: null },
        ];
        expect(a2aRequests(rows).map((row) => row.messageId)).toEqual(['a']);
    });

    test('a run status outranks the delivery status', () => {
        const base = {
            messageId: 'a',
            requestKey: 'a2a:x:y',
            status: 'claimed',
            runId: 'r1',
            taskId: null,
            outcome: null,
        };
        expect(requestState({ ...base, runStatus: 'running' })).toBe('running');
        expect(requestState({ ...base, runStatus: null })).toBe('claimed');
    });

    test('an events-history row keeps its catalog fields and drops non-rows', () => {
        const row = {
            id: 'e1',
            eventName: 'mcp.tool.called',
            occurredAt: '2026-11-22T01:00:00.000Z',
            runId: null,
            payload: { data: { tool: 'sp_task_list', durationMs: 12, outcome: 'ok', errorCode: 'invalid_arguments' } },
        };
        expect(projectProtocolEvent(row)).toMatchObject({
            id: 'e1',
            tool: 'sp_task_list',
            durationMs: 12,
            outcome: 'ok',
            errorCode: 'invalid_arguments',
        });
        expect(projectProtocolEvent(null)).toBeNull();
        expect(projectProtocolEvent({ nope: true })).toBeNull();
    });

    test('the usage window maps to a since timestamp, and `all` maps to none', () => {
        const now = Date.parse('2026-11-22T12:00:00.000Z');
        expect(sinceForWindow('24h', now)).toBe('2026-11-21T12:00:00.000Z');
        expect(sinceForWindow('1h', now)).toBe('2026-11-22T11:00:00.000Z');
        expect(sinceForWindow('7d', now)).toBe('2026-11-15T12:00:00.000Z');
        expect(sinceForWindow('all', now)).toBeUndefined();
    });
});

describe('1424 — deep links', () => {
    test('the inbox link is the path segment, not a query', () => {
        expect(inboxLink()).toBe('/board/projects/inbox');
    });

    test('a system event link carries the tab and its filter', () => {
        expect(systemEventLink('a2a.task.cancelled', 'run-1')).toBe(
            '/board/observability?tab=system-events&eventName=a2a.task.cancelled&runId=run-1',
        );
        expect(systemEventLink('mcp.tool.failed')).toBe(
            '/board/observability?tab=system-events&eventName=mcp.tool.failed',
        );
    });

    test('deep links respect the gateway base-path meta tag', () => {
        const meta = document.createElement('meta');
        meta.name = 'spur-base';
        meta.content = '/spur-new/';
        document.head.appendChild(meta);
        resetBasePathForTesting();
        try {
            expect(inboxLink()).toBe('/spur-new/board/projects/inbox');
            expect(systemEventLink('a2a.message.received')).toBe(
                '/spur-new/board/observability?tab=system-events&eventName=a2a.message.received',
            );
        } finally {
            meta.remove();
            resetBasePathForTesting();
        }
    });
});

// Task 1437 R6: the header's uptime is the only visible evidence of a long-running (stale) server.
describe('1437 — server uptime formatting', () => {
    test('picks the largest two units that fit', () => {
        expect(formatUptime(45)).toBe('45s');
        expect(formatUptime(240)).toBe('4m');
        expect(formatUptime(3 * 3_600 + 12 * 60)).toBe('3h 12m');
        expect(formatUptime(452_045)).toBe('5d 5h');
    });

    test('a negative or fractional reading never renders garbage', () => {
        expect(formatUptime(-1)).toBe('0s');
        expect(formatUptime(59.9)).toBe('59s');
    });
});

// ─── 1449 R3: one Client config per agent, in that agent's own native format ──────────────
// The failure modes: a snippet in a format the agent does not read, a literal `<server>` /
// `<ENV_NAME>` the operator must hand-edit, and auth guidance that cannot distinguish "token set"
// from "no token needed".
describe('1449 — per-agent client config', () => {
    const live = {
        mcp: {
            enabled: true,
            url: 'http://localhost:3070/spur-new/mcp',
            path: '/mcp',
            auth: { envName: 'SPUR_MCP_TOKEN', tokenPresent: true },
        },
        gateway: {
            served: true as const,
            namespace: '/spur-new',
            rootMcpUrl: 'http://localhost:3070/mcp',
            counters: null,
            mcp: { enabled: true, auth: { envName: 'SPUR_MCP_TOKEN', tokenPresent: true } },
        },
    } as unknown as IntegrationsStatus;

    test('Codex renders valid TOML with the stdio command and its env_vars allowlist', () => {
        const view = renderClientConfig(live, 'codex', 'project-stdio');
        expect(view.format).toBe('toml');
        expect(view.snippet).toContain('[mcp_servers.spur]');
        expect(view.snippet).toContain('command = "spur"');
        expect(view.snippet).toContain('"--url"');
        expect(view.snippet).toContain('env_vars = ["SPUR_MCP_AUTH_ENV", "SPUR_MCP_TOKEN"]');
        expect(view.configPath).toBe('~/.codex/config.toml');
    });

    test('Codex gateway bridge allowlists the one server.mcp token variable (K44 1450)', () => {
        const view = renderClientConfig(live, 'codex', 'gateway-stdio');
        expect(view.snippet).toContain('args = ["mcp", "--gateway"]');
        expect(view.snippet).toContain(
            `env_vars = ["SPUR_GATEWAY_PORT", "SPUR_MCP_ENABLED", "SPUR_MCP_AUTH_ENV", "${live.mcp.auth.envName}"]`,
        );
        expect(view.snippet).not.toContain('SPUR_GATEWAY_MCP');
        const custom = {
            ...live,
            mcp: { ...live.mcp, auth: { envName: 'MY_TOKEN', tokenPresent: true } },
        } as unknown as IntegrationsStatus;
        expect(renderClientConfig(custom, 'codex', 'gateway-stdio').snippet).toContain('"MY_TOKEN"]');
    });

    test('omp renders YAML and OpenCode/OpenClaw render their own JSON trees', () => {
        expect(renderClientConfig(live, 'omp', 'gateway-stdio').snippet).toContain('mcp_servers:');
        const opencode = renderClientConfig(live, 'opencode', 'http').snippet;
        expect(opencode).toContain('"$schema": "https://opencode.ai/config.json"');
        expect(opencode).toContain('"type": "remote"');
        expect(renderClientConfig(live, 'openclaw', 'http').snippet).toContain('"servers": {');
    });

    test('Gemini uses httpUrl for a direct HTTP entry and command/args for a bridge', () => {
        expect(renderClientConfig(live, 'gemini', 'http').snippet).toContain(
            '"httpUrl": "http://localhost:3070/spur-new/mcp"',
        );
        const stdio = renderClientConfig(live, 'gemini', 'gateway-stdio').snippet;
        expect(stdio).toContain('"command": "spur"');
        expect(stdio).toContain('"--gateway"');
    });

    test('every agent resolves a real URL — never a literal <server>', () => {
        for (const agent of MCP_CLIENT_AGENTS) {
            expect(renderClientConfig(live, agent, 'http').snippet).not.toContain('<server>');
        }
        // With the surface off, the Board's own origin is the fallback.
        const off = {
            mcp: { enabled: false, url: null, auth: { envName: 'SPUR_MCP_TOKEN', tokenPresent: true } },
            gateway: { served: false as const },
        } as unknown as IntegrationsStatus;
        expect(renderClientConfig(off, 'generic', 'http', 'http://localhost:4000').snippet).toContain(
            'http://localhost:4000/mcp',
        );
    });

    test('the guidance names the configured variable and explains it is not a stored secret', () => {
        const view = renderClientConfig(live, 'claude', 'gateway-stdio');
        expect(view.authNote).toContain('SPUR_MCP_TOKEN');
        expect(view.authNote).toContain('environment variable');
        expect(view.exportCommand).toBeNull();
        expect(view.snippet).not.toContain('<ENV_NAME>');
    });

    test('an unset token adds the export command, and its value is never in the snippet', () => {
        const unset = {
            mcp: {
                enabled: true,
                url: 'http://localhost:3070/mcp',
                auth: { envName: 'SPUR_MCP_TOKEN', tokenPresent: false },
            },
            gateway: { served: false as const },
        } as unknown as IntegrationsStatus;
        const view = renderClientConfig(unset, 'gemini', 'http');
        expect(view.exportCommand).toBe('export SPUR_MCP_TOKEN="$(openssl rand -hex 32)"');
        expect(view.authNote).toContain('not set');
    });

    test('an unauthenticated surface omits the Authorization header entirely', () => {
        const open = {
            mcp: {
                enabled: true,
                url: 'http://localhost:3070/mcp',
                auth: { envName: '', tokenPresent: false, allowUnauthenticated: true },
            },
            gateway: { served: false as const },
        } as unknown as IntegrationsStatus;
        const view = renderClientConfig(open, 'generic', 'http');
        expect(view.snippet).not.toContain('Authorization');
        expect(view.exportCommand).toBeNull();
        expect(view.authNote).toContain('allowUnauthenticated');
        // The state chip also reads the policy: an unauthenticated surface is on, not token-less.
        expect(surfaceState(open.mcp)).toBe('on');
    });

    test('a legacy-revision client is warned off direct HTTP, and the gateway bridge says when it is off', () => {
        expect(renderClientConfig(live, 'codex', 'http').transportNote).toContain('2026-07-28');
        const standalone = { mcp: live.mcp, gateway: { served: false as const } } as unknown as IntegrationsStatus;
        expect(renderClientConfig(standalone, 'claude', 'gateway-stdio').transportNote).toContain(
            'gateway MCP endpoint is off — enable server.mcp',
        );
    });
});

// ─── 1454: the A2A cooperation sequence is a projection, and these are its rules ────────────────
// The failure modes: a lane order that follows the array instead of the timeline, a reply that reads
// as a root, a self-message drawn as an arc between two columns, a `+N` column that silently drops
// participants, and a filter codec that eats another tab's query params or resurrects an unknown one.

/** One timeline row: everything the sequence reads, with the fields a test does not vary defaulted. */
function row(over: Partial<InboxRow> & { id: string }): InboxRow {
    return {
        fromId: 'operator',
        toId: 'proj-coder',
        body: 'body',
        kind: 'chat',
        status: 'queued',
        attempts: 0,
        error: null,
        claimedAt: null,
        deliveredAt: null,
        readAt: null,
        inReplyTo: null,
        threadId: over.id,
        requestKey: null,
        taskId: null,
        parentRunId: null,
        createdAt: 1_000,
        ...over,
    };
}

describe('1454 — lane assignment (R1)', () => {
    test('arrows follow (createdAt, id) and lanes rank by first appearance', () => {
        const assignment = assignLanes([
            row({ id: 'm3', fromId: 'proj-coder', toId: 'operator', createdAt: 300 }),
            row({ id: 'm1', fromId: 'operator', toId: 'proj-coder', createdAt: 100 }),
            row({ id: 'm2', fromId: 'proj-coder', toId: 'proj-peer', createdAt: 200 }),
        ]);
        expect(assignment.arrows.map((arrow) => arrow.id)).toEqual(['m1', 'm2', 'm3']);
        // `operator` appears first (m1's sender), then `proj-coder`, then `proj-peer`.
        expect(assignment.lanes).toEqual(['operator', 'proj-coder', 'proj-peer']);
        expect(assignment.overflow).toEqual([]);
        expect(assignment.arrows[1]).toEqual({
            id: 'm2',
            fromLane: 'proj-coder',
            toLane: 'proj-peer',
            depth: 0,
            self: false,
        });
    });

    test('two rows written in the same millisecond order by id, not by input position', () => {
        const assignment = assignLanes([
            row({ id: 'b', fromId: 'proj-coder', toId: 'operator', createdAt: 500 }),
            row({ id: 'a', fromId: 'operator', toId: 'proj-coder', createdAt: 500 }),
        ]);
        expect(assignment.arrows.map((arrow) => arrow.id)).toEqual(['a', 'b']);
        expect(assignment.lanes).toEqual(['operator', 'proj-coder']);
    });

    test('a reply is indented under its thread, and a nested reply one level deeper', () => {
        const assignment = assignLanes([
            row({ id: 'root', fromId: 'operator', toId: 'proj-coder', createdAt: 100 }),
            row({
                id: 'reply',
                fromId: 'proj-coder',
                toId: 'operator',
                createdAt: 200,
                inReplyTo: 'root',
                threadId: 'root',
            }),
            row({
                id: 'nested',
                fromId: 'operator',
                toId: 'proj-coder',
                createdAt: 300,
                inReplyTo: 'reply',
                threadId: 'root',
            }),
            // A reply whose root is outside this page is still a reply: depth 1, never a root.
            row({ id: 'orphan', fromId: 'operator', toId: 'proj-coder', createdAt: 400, inReplyTo: 'elsewhere' }),
        ]);
        expect(assignment.arrows.map((arrow) => arrow.depth)).toEqual([0, 1, 2, 1]);
    });

    test('a self-message is one column and a loop, never an arc between two columns', () => {
        const assignment = assignLanes([row({ id: 'self', fromId: 'proj-coder', toId: 'proj-coder' })]);
        expect(assignment.lanes).toEqual(['proj-coder']);
        expect(assignment.arrows[0]).toEqual({
            id: 'self',
            fromLane: 'proj-coder',
            toLane: 'proj-coder',
            depth: 0,
            self: true,
        });
    });

    test('more than eight lifelines collapse into one `+N` column that loses nobody', () => {
        // Ten participants: `agent0` sends to `agent1` … `agent9`, so all ten own a lifeline.
        const rows = Array.from({ length: 9 }, (_, index) =>
            row({ id: `m${index}`, fromId: 'agent0', toId: `agent${index + 1}`, createdAt: 100 + index }),
        );
        const assignment = assignLanes(rows);
        expect(LANE_CAP).toBe(8);
        expect(assignment.lanes).toEqual([
            'agent0',
            'agent1',
            'agent2',
            'agent3',
            'agent4',
            'agent5',
            'agent6',
            'agent7',
        ]);
        expect(assignment.overflow).toEqual(['agent8', 'agent9']);
        // The arrows that touch an overflow address point at the collapsed column; no row is dropped.
        expect(assignment.arrows).toHaveLength(9);
        expect(assignment.arrows.filter((arrow) => arrow.toLane === OVERFLOW_LANE).map((arrow) => arrow.id)).toEqual([
            'm7',
            'm8',
        ]);
        // Expanded (an infinite cap) every participant owns a column and nothing overflows.
        const expanded = assignLanes(rows, Number.POSITIVE_INFINITY);
        expect(expanded.lanes).toHaveLength(10);
        expect(expanded.overflow).toEqual([]);
        expect(expanded.arrows.every((arrow) => arrow.toLane !== OVERFLOW_LANE)).toBe(true);
    });
});

describe('1454 — filter codec (R2)', () => {
    test('every filter round-trips through `a2a.`-prefixed params', () => {
        const filters = {
            members: ['proj-coder', 'proj-peer'],
            direction: 'out' as const,
            kind: 'request' as const,
            status: 'failed' as const,
            threadId: 'thread-9',
            since: '2026-11-25T00:00:00.000Z',
            until: '2026-11-26T00:00:00.000Z',
        };
        const params = encodeA2aFilters(filters);
        // Every key carries the prefix, so writing them cannot clobber another tab's params.
        expect([...params.keys()].every((key) => key.startsWith('a2a.'))).toBe(true);
        expect(params.getAll('a2a.members')).toEqual(['proj-coder', 'proj-peer']);
        expect(decodeA2aFilters(params)).toEqual(filters);
        // The same round-trip from a query string, as the view reads it out of `location.search`.
        expect(decodeA2aFilters(params.toString())).toEqual(filters);
    });

    test('unknown keys and unknown values are dropped, and other tabs params are never read', () => {
        expect(
            decodeA2aFilters('tab=a2a&a2a.kind=chat&a2a.bogus=1&a2a.status=nope&members=proj-coder&a2a.direction=in'),
        ).toEqual({ kind: 'chat', direction: 'in' });
        expect(decodeA2aFilters('')).toEqual({});
        expect(decodeA2aFilters('tab=summary')).toEqual({});
        // The unfiltered view encodes nothing at all.
        expect([...encodeA2aFilters({}).keys()]).toEqual([]);
        expect([...encodeA2aFilters({ members: [] }).keys()]).toEqual([]);
    });

    test('the procedure input maps the header window to epoch-ms bounds and passes every filter', () => {
        const input = a2aTimelineInput(
            {
                members: ['proj-peer'],
                direction: 'out',
                kind: 'chat',
                status: 'delivered',
                threadId: 't1',
                until: '2026-11-26T00:00:00.000Z',
            },
            '24h',
        );
        expect(input.members).toEqual(['proj-peer']);
        expect(input.direction).toBe('out');
        expect(input.kind).toBe('chat');
        expect(input.status).toBe('delivered');
        expect(input.threadId).toBe('t1');
        expect(input.until).toBe(Date.parse('2026-11-26T00:00:00.000Z'));
        // A 24h window is an epoch-ms lower bound ~24h before now, never an ISO string on the wire.
        expect(typeof input.since).toBe('number');
        expect(Math.abs(Date.now() - (input.since ?? 0) - 24 * 60 * 60 * 1000)).toBeLessThan(60_000);
        expect(input.limit).toBeGreaterThan(0);
        // `all` is the unbounded read: no since at all.
        expect(a2aTimelineInput({}, 'all').since).toBeUndefined();
        // An explicit bound wins over the window, and a cursor rides along for paging.
        expect(a2aTimelineInput({ since: '2026-11-25T00:00:00.000Z' }, '24h', { cursor: 'c1' })).toMatchObject({
            since: Date.parse('2026-11-25T00:00:00.000Z'),
            cursor: 'c1',
        });
    });

    test('a fresh page merges over loaded rows without duplicating or reordering them', () => {
        const loaded = [row({ id: 'a', createdAt: 100 }), row({ id: 'b', createdAt: 200 })];
        const merged = mergeTimelinePages(
            [row({ id: 'b', createdAt: 200, status: 'delivered' }), row({ id: 'c', createdAt: 300 })],
            loaded,
        );
        expect(merged.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
        // The fresh copy of a row wins: the delivery the frame reported is what renders.
        expect(merged[1]?.status).toBe('delivered');
    });
});
