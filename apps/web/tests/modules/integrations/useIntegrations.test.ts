/**
 * A82 1424 — the Integrations data hook.
 *
 * The failure modes: a receipt page that blanks the tab when one outbound member cannot be read, a
 * window change that keeps the old aggregate, an error state a retry cannot clear, and chat traffic
 * counted as an outbound receipt.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import type { IntegrationsStatus, IntegrationsUsage } from '@gobing-ai/spur-contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { IntegrationsSeams } from '../../../src/modules/integrations/useIntegrations';
import { useIntegrations } from '../../../src/modules/integrations/useIntegrations';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

registerHappyDom();
afterAll(teardownHappyDom);

const STATUS: IntegrationsStatus = {
    generatedAt: '2026-11-22T00:00:00.000Z',
    mcp: {
        enabled: false,
        path: '/mcp',
        url: null,
        auth: { envName: '', tokenPresent: false },
        protocolVersion: '2026-07-28',
        tools: [],
        resources: [],
    },
    a2a: {
        enabled: true,
        basePath: '/a2a',
        auth: { envName: 'SPUR_A2A_TOKEN', tokenPresent: true },
        members: [{ member: 'proj-peer', direction: 'outbound', kind: 'a2a', target: 'https://peer.example' }],
    },
    gateway: { served: false },
};

const USAGE: IntegrationsUsage = {
    tools: [],
    resources: [],
    byActor: [],
    a2a: [],
    authDenied: [],
    failureClusters: [],
};

const REQUESTS = [
    {
        messageId: 'm-a2a',
        requestKey: 'a2a:proj-coder:m-a2a',
        status: 'claimed' as const,
        attempts: 1,
        error: null,
        runId: 'run-1',
        runStatus: 'running',
        taskId: null,
        outcome: null,
        reason: null,
        hold: null,
    },
];

/** The seams for one case; `state` lets a test flip a read's behaviour mid-flight. */
function makeSeams(
    options: {
        status?: () => Promise<IntegrationsStatus>;
        list?: () => Promise<{ messages: Array<Record<string, unknown>>; nextCursor: null }>;
        usageSince?: string[];
        historySince?: string[];
        requestsInputs?: unknown[];
    } = {},
): IntegrationsSeams {
    return {
        fetchHistory: async (request: Request) => {
            const url = new URL(request.url);
            // The health read carries no window and is not an activity list (task 1437 R6).
            if (url.pathname.endsWith('/health')) {
                return Response.json({ status: 'ok', service: 'spur', version: '0.4.43', uptime_seconds: 1 });
            }
            const query = url.searchParams;
            const prefix = query.get('prefix');
            options.historySince?.push(query.get('since') ?? '');
            // One row per family: `mcp` gets the tool call, `a2a` the intake, `auth` nothing.
            const events = prefix === 'mcp' ? [MCP_ROW] : prefix === 'a2a' ? [A2A_ROW] : [];
            return Response.json({ events });
        },
        api: {
            integrations: {
                status: options.status ?? (async () => STATUS),
                usage: async (input: { since?: string }) => {
                    options.usageSince?.push(input.since ?? '');
                    return USAGE;
                },
            },
            inbox: {
                requests: async (input?: unknown) => {
                    options.requestsInputs?.push(input);
                    return REQUESTS;
                },
                list:
                    options.list ??
                    (async () => ({
                        messages: [
                            { id: 'm-a2a', kind: 'request', status: 'claimed', requestKey: 'a2a:x:y', taskId: null },
                            { id: 'm-chat', kind: 'chat', status: 'delivered', requestKey: null, taskId: null },
                        ],
                        nextCursor: null,
                    })),
            },
        } as unknown as IntegrationsSeams['api'],
    };
}

const MCP_ROW = {
    id: 'e1',
    eventName: 'mcp.tool.called',
    occurredAt: '2026-11-22T01:00:00.000Z',
    payload: { data: { tool: 'sp_task_list', durationMs: 4 } },
};
const A2A_ROW = {
    id: 'e2',
    eventName: 'a2a.message.received',
    occurredAt: '2026-11-22T02:00:00.000Z',
    payload: { data: { member: 'proj-coder', outcome: 'accepted' } },
};

describe('1424 — hook data assembly', () => {
    test('a request message with no receipt row falls back to its delivery status', async () => {
        const seams = makeSeams({
            list: async () => ({
                messages: [
                    // `m-orphan` has no receipt row yet: the tab still names it and its delivery state.
                    { id: 'm-orphan', kind: 'request', status: 'queued', requestKey: 'a2a:x:orphan', taskId: null },
                ],
                nextCursor: null,
            }),
        });
        const { result } = renderHook(() => useIntegrations(seams));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.receipts[0]?.rows).toEqual([
            {
                messageId: 'm-orphan',
                requestKey: 'a2a:x:orphan',
                status: 'queued',
                runId: null,
                taskId: null,
                outcome: null,
            },
        ]);
    });

    test('a failed activity read surfaces the server error detail instead of a silently empty list', async () => {
        const seams: IntegrationsSeams = {
            ...makeSeams(),
            fetchHistory: async () => Response.json({ error: 'unknown prefix: "mcp"' }, { status: 400 }),
        };
        const { result } = renderHook(() => useIntegrations(seams));
        await waitFor(() => expect(result.current.error).not.toBeNull());
        expect(result.current.error?.message).toBe('events/history answered 400 (unknown prefix: "mcp")');
    });

    test('requests queries scope "all" so non-orchestrator A2A tasks and outbound receipts are included', async () => {
        const requestsInputs: unknown[] = [];
        const seams = makeSeams({ requestsInputs });
        const { result } = renderHook(() => useIntegrations(seams));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(requestsInputs).toEqual([{ limit: 100, scope: 'all' }]);
    });

    test('the activity lists are newest-first across the two families', async () => {
        const seams: IntegrationsSeams = {
            ...makeSeams(),
            fetchHistory: async (request: Request) => {
                const prefix = new URL(request.url).searchParams.get('prefix');
                if (prefix === 'a2a') return Response.json({ events: [A2A_ROW] });
                if (prefix === 'auth') {
                    return Response.json({
                        events: [
                            // Newer than the A2A row, so it must sort ahead of it.
                            {
                                id: 'e3',
                                eventName: 'auth.denied',
                                occurredAt: '2026-11-22T03:00:00.000Z',
                                payload: { data: { surface: 'a2a', reason: 'missing' } },
                            },
                        ],
                    });
                }
                return Response.json({ events: [] });
            },
        };
        const { result } = renderHook(() => useIntegrations(seams));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.a2aEvents.map((row) => row.id)).toEqual(['e3', 'e2']);
    });

    test('loads the status, the activity and only the a2a: request rows', async () => {
        const seams = makeSeams();
        const { result } = renderHook(() => useIntegrations(seams));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBeNull();
        expect(result.current.status?.a2a.enabled).toBe(true);
        expect(result.current.mcpEvents.map((row) => row.id)).toEqual(['e1']);
        // a2a + auth families merge into one newest-first list.
        expect(result.current.a2aEvents.map((row) => row.id)).toEqual(['e2']);
        expect(result.current.requests.map((row) => row.messageId)).toEqual(['m-a2a']);
    });

    test('outbound receipts keep request traffic only, and carry the receipt run state', async () => {
        const seams = makeSeams();
        const { result } = renderHook(() => useIntegrations(seams));
        await waitFor(() => expect(result.current.loading).toBe(false));
        const receipts = result.current.receipts;
        expect(receipts).toHaveLength(1);
        expect(receipts[0]?.member).toBe('proj-peer');
        // The request message is kept with its receipt row; the chat message is not a receipt.
        expect(receipts[0]?.rows.map((row) => row.messageId)).toEqual(['m-a2a']);
        expect(receipts[0]?.rows[0]?.runId).toBe('run-1');
    });

    test('an unreadable outbound member degrades to no receipts instead of failing the module', async () => {
        const seams = makeSeams({
            list: async () => {
                throw new Error('member unreachable');
            },
        });
        const { result } = renderHook(() => useIntegrations(seams));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBeNull();
        expect(result.current.receipts).toEqual([{ member: 'proj-peer', rows: [] }]);
    });

    test('the usage window is sent to the procedure, and changing it refetches', async () => {
        const seen: string[] = [];
        const history: string[] = [];
        const seams = makeSeams({ usageSince: seen, historySince: history });
        const { result } = renderHook(() => useIntegrations(seams));
        await waitFor(() => expect(result.current.loading).toBe(false));
        const since = seen[0] ?? '';
        expect(since).not.toBe('');
        expect(history).toEqual([since, since, since]);
        act(() => result.current.setWindow('all'));
        await waitFor(() => expect(result.current.window).toBe('all'));
        // `all` is the unbounded read: no `since` is sent.
        expect(seen).toContain('');
        expect(history.slice(3)).toEqual(['', '', '']);
    });

    test('a failed status read surfaces an error, and retry clears it', async () => {
        let failing = true;
        const seams = makeSeams({
            status: async () => {
                if (failing) throw new Error('boom');
                return STATUS;
            },
        });
        const { result } = renderHook(() => useIntegrations(seams));
        await waitFor(() => expect(result.current.error).not.toBeNull());
        expect(result.current.error?.message).toBe('boom');
        failing = false;
        act(() => result.current.retry());
        await waitFor(() => expect(result.current.error).toBeNull());
        expect(result.current.status?.a2a.enabled).toBe(true);
    });
});

// Task 1437 R6: the served build's identity must survive a failed status read, because a stale
// server IS the failure being reported.
describe('1437 — served build identity', () => {
    test('health names the served version and uptime beside the status read', async () => {
        const seams: IntegrationsSeams = {
            ...makeSeams(),
            fetchHistory: async (request: Request) =>
                new URL(request.url).pathname.endsWith('/health')
                    ? Response.json({ status: 'ok', service: 'spur', version: '0.4.43', uptime_seconds: 90 })
                    : Response.json({ events: [] }),
        };
        const { result } = renderHook(() => useIntegrations(seams));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.server).toEqual({ version: '0.4.43', uptimeSeconds: 90 });
    });

    test('an unreadable health route leaves the identity null without failing the module', async () => {
        const seams: IntegrationsSeams = {
            ...makeSeams(),
            fetchHistory: async (request: Request) =>
                new URL(request.url).pathname.endsWith('/health')
                    ? Response.json({ error: 'not found' }, { status: 404 })
                    : Response.json({ events: [] }),
        };
        const { result } = renderHook(() => useIntegrations(seams));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBeNull();
        expect(result.current.server).toBeNull();
    });
});
