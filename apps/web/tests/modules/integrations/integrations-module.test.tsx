/**
 * Integrations board module (A82 1424).
 *
 * The failure modes: a tab order that drifts from the contract, a state chip that hides an enabled
 * surface with no token, a token value leaking into the DOM, a hand-written client snippet, a
 * gateway strip that fabricates counters, an empty module that renders nothing, a diagnostic with
 * no way back, and outbound/A2A rows from the wrong family.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { IntegrationsAgentReadiness, IntegrationsStatus, IntegrationsUsage } from '@gobing-ai/spur-contracts';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { resetBasePathForTesting } from '../../../src/components/base-path';
import { module as integrationsModule } from '../../../src/modules/integrations';
import { traceLink } from '../../../src/modules/integrations/helpers';
import IntegrationsModule from '../../../src/modules/integrations/IntegrationsModule';
import type { IntegrationsSeams } from '../../../src/modules/integrations/useIntegrations';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

registerHappyDom();
afterAll(teardownHappyDom);

const STATUS: IntegrationsStatus = {
    generatedAt: '2026-11-22T00:00:00.000Z',
    mcp: {
        enabled: true,
        path: '/mcp' as const,
        url: 'http://localhost:3007/mcp',
        auth: { envName: 'SPUR_MCP_TOKEN', tokenPresent: true },
        protocolVersion: '2026-07-28',
        namespace: 'ops',
        namespaceSource: 'config' as const,
        exposureIssues: [
            {
                tool: 'ops_dup',
                file: 'dup-a.yaml',
                reason: 'duplicate' as const,
                remedy: 'rename the workflow "dup" so each exposed workflow has a unique tool name',
            },
        ],
        tools: [
            {
                name: 'sp_task_list',
                origin: 'built-in' as const,
                description: 'List tasks',
                annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
                inputSchema: { type: 'object' },
            },
            {
                name: 'ops_daily_report',
                origin: 'workflow' as const,
                description: 'Run the report',
                annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
                inputSchema: { type: 'object' },
            },
        ],
        resources: [{ uriTemplate: 'spur://tasks/{wbs}', description: 'Task by WBS' }],
    },
    a2a: {
        enabled: true,
        basePath: '/a2a' as const,
        auth: { envName: 'SPUR_A2A_TOKEN', tokenPresent: false },
        members: [
            {
                member: 'proj-coder',
                direction: 'inbound' as const,
                role: 'coder',
                cardUrl: 'http://localhost:3007/a2a/members/proj-coder/.well-known/agent-card.json',
                writeFenced: true,
            },
            {
                member: 'proj-peer',
                direction: 'outbound' as const,
                kind: 'a2a' as const,
                target: 'https://peer.example',
            },
        ],
    },
    gateway: { served: false as const },
};

const USAGE: IntegrationsUsage = {
    tools: [
        {
            tool: 'sp_task_list',
            calls: 3,
            failures: 1,
            failureRate: 0.25,
            p50Ms: 4,
            p95Ms: 9,
            durationUnmeasured: 0,
            lastCalledAt: '2026-11-22T01:30:00.000Z',
        },
    ],
    resources: [],
    byActor: [],
    a2a: [{ member: 'proj-coder', received: 2, replayed: 1, conflict: 1, cancelled: 1 }],
    authDenied: [{ surface: 'mcp', reason: 'missing', count: 2 }],
    failureClusters: [],
    gatewayMcpActivity: { calls: 5, failures: 2, authDenials: 1, lastCall: '2026-11-22T01:30:00.000Z' },
    outboundActivity: { calls: 3, failures: 1, authDenials: 1, lastCall: '2026-11-22T01:40:00.000Z' },
};

const REQUESTS: Array<{
    messageId: string;
    requestKey: string | null;
    status: 'queued' | 'claimed' | 'delivered' | 'failed';
    attempts: number;
    error: string | null;
    runId: string | null;
    runStatus?: string | null;
    taskId: string | null;
    outcome: string | null;
    reason: string | null;
    hold: string | null;
    remoteTaskId?: string | null;
    remoteContextId?: string | null;
    remoteBranch?: string | null;
}> = [
    {
        messageId: 'm-a2a',
        requestKey: 'a2a:proj-coder:m-a2a',
        status: 'claimed',
        attempts: 1,
        error: null,
        runId: 'run-1',
        runStatus: 'running',
        taskId: null,
        outcome: null,
        reason: null,
        hold: null,
        // 1440 R2: the refs THIS receipt's own run persisted.
        remoteTaskId: 'remote-t1',
        remoteContextId: 'ctx-1',
        remoteBranch: 'lane/one',
    },
    {
        messageId: 'm-old',
        requestKey: 'a2a:proj-coder:m-old',
        status: 'delivered',
        attempts: 1,
        error: null,
        runId: '9f1d2c3b-4a5e-4f60-8b71-2c3d4e5f6071',
        runStatus: 'exited',
        taskId: null,
        outcome: 'completed',
        reason: null,
        hold: null,
    },
    {
        messageId: 'm-fleet',
        requestKey: 'fleet:task:1421:1',
        status: 'claimed',
        attempts: 1,
        error: null,
        runId: 'run-2',
        runStatus: 'running',
        taskId: '1421',
        outcome: null,
        reason: null,
        hold: null,
    },
];

const MCP_EVENTS = [
    {
        id: 'e1',
        eventName: 'mcp.tool.called',
        occurredAt: '2026-11-22T01:00:00.000Z',
        runId: null,
        payload: { data: { tool: 'sp_task_list', durationMs: 12, outcome: 'ok' } },
    },
    {
        id: 'e4',
        eventName: 'mcp.tool.called',
        occurredAt: '2026-11-22T01:05:00.000Z',
        runId: null,
        payload: { data: { tool: 'sp_task_list', durationMs: 3, outcome: 'error', errorCode: 'invalid_arguments' } },
    },
];
const A2A_EVENTS = [
    {
        id: 'e2',
        eventName: 'a2a.task.cancelled',
        occurredAt: '2026-11-22T02:00:00.000Z',
        runId: 'run-1',
        payload: { data: { member: 'proj-coder', taskId: 't1', runStopped: true } },
    },
    {
        id: 'e3',
        eventName: 'a2a.message.received',
        occurredAt: '2026-11-22T01:30:00.000Z',
        runId: null,
        payload: { data: { member: 'proj-coder', outcome: 'accepted' } },
    },
];

/** Per-test overrides the fake backend consults, so one case can serve a different answer. */
let overrides: {
    status?: () => Promise<IntegrationsStatus> | IntegrationsStatus;
    usage?: (input: { since?: string }) => IntegrationsUsage;
    /** The public Agent Card the inspector fetches (1440 R1); default: a valid card. */
    card?: () => Promise<Response>;
    /** The outbound receipt page the A2A tab reads (1440 R2). */
    receipts?: Array<{ id: string; kind: string; requestKey: string | null; status: string; taskId: string | null }>;
    /** Per-agent readiness the probe endpoint answers (1449 R4); default: not reported. */
    readiness?: IntegrationsAgentReadiness;
    /** The A2A sequence's timeline page (1454 R1/R2); default: no traffic in the window. */
    timeline?: () => { messages: unknown[]; nextCursor: string | null };
    /** The readiness read failing outright — the tolerant-fetch case. */
    readinessError?: Error;
} = {};
let statusRequests = 0;

/**
 * The seams the module reads. Passed in explicitly rather than through the process-global rpc/fetch
 * mocks: bun's `mock.module` is not per-file, so a suite-order change could otherwise swap the
 * client underneath this test and turn it into a network call.
 */
function makeSeams(): IntegrationsSeams {
    /** Answer by path, so the module's own URL shapes are exercised end to end. */
    const fetchHistory = async (request: Request): Promise<Response> => {
        const url = new URL(request.url);
        // The shell also reads the served build's identity (task 1437 R6).
        if (url.pathname.endsWith('/health')) {
            return Response.json({ status: 'ok', service: 'spur', version: '0.4.43', uptime_seconds: 452_045 });
        }
        // The A2A card inspector fetches the member's public card through this same seam (1440 R1).
        if (url.pathname.endsWith('/.well-known/agent-card.json')) {
            if (overrides.card !== undefined) return overrides.card();
            return Response.json({ name: 'proj-coder', description: 'lane member', skills: [{ id: 'implement' }] });
        }
        const prefix = url.searchParams.get('prefix');
        return Response.json({ events: prefix === 'a2a' ? A2A_EVENTS : MCP_EVENTS });
    };
    const client = {
        integrations: {
            status: async () => {
                statusRequests += 1;
                return overrides.status === undefined ? STATUS : await overrides.status();
            },
            usage: async (input: { since?: string }) =>
                overrides.usage === undefined ? USAGE : overrides.usage(input ?? {}),
            // 1449 R4: the readiness read is its own procedure, so it can be absent (404) on an
            // older server without touching the status read.
            agentReadiness: async () => {
                if (overrides.readinessError !== undefined) throw overrides.readinessError;
                return overrides.readiness ?? { available: false, agents: [] };
            },
        },
        inbox: {
            requests: async () => REQUESTS,
            list: async () => ({ messages: overrides.receipts ?? [], nextCursor: null }),
            // 1454: the sequence view's only source; empty by default so the drawer tests below see
            // the same panel they always did.
            timeline: async () =>
                overrides.timeline === undefined ? { messages: [], nextCursor: null } : overrides.timeline(),
        },
    };
    /** The card inspector's own seam (1440 R1): the same fake backend, keyed by the card path. */
    const fetchCard = async (_url: string): Promise<Response> =>
        overrides.card === undefined
            ? Response.json({ name: 'proj-coder', description: 'lane member', skills: [{ id: 'implement' }] })
            : overrides.card();
    return { api: client as unknown as IntegrationsSeams['api'], fetchHistory, fetchCard };
}

beforeEach(() => {
    overrides = {};
    statusRequests = 0;
});

afterEach(cleanup);

describe('1424 — module identity and tabs (R1/R2)', () => {
    test('the module is auto-discoverable and routes to /board/integrations', () => {
        expect(integrationsModule.id).toBe('integrations');
        expect(integrationsModule.name).toBe('Integrations');
        expect(integrationsModule.route).toBe('integrations');
        expect(typeof integrationsModule.component).toBe('function');
    });

    test('the tab strip renders in contract order', async () => {
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getByTestId('integrations-summary-table')).toBeTruthy());
        expect(view.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Summary', 'MCP', 'A2A']);
    });

    test('the shell renders the kit header, the status chip and the tab strip', async () => {
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getByTestId('integrations-summary-table')).toBeTruthy());
        expect(view.getByRole('heading', { level: 1, name: 'Integrations' })).toBeTruthy();
        expect(view.getByTestId('integrations-status-chip').textContent).toBe('surfaces on');
        expect(view.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Summary', 'MCP', 'A2A']);
    });

    // Task 1437 R6: a stale server behind a fresh `dist/web` must be visible, not an opaque error.
    test('the header names the served build version and uptime', async () => {
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getByTestId('integrations-server-runtime')).toBeTruthy());
        await waitFor(() =>
            expect(view.getByTestId('integrations-server-runtime').textContent).toBe('server v0.4.43 · up 5d 5h'),
        );
    });

    test('an unreadable health route says so instead of hiding the gap', async () => {
        const seams: IntegrationsSeams = {
            ...makeSeams(),
            fetchHistory: async (request: Request) =>
                new URL(request.url).pathname.endsWith('/health')
                    ? Response.json({ error: 'not found' }, { status: 404 })
                    : Response.json({ events: [] }),
        };
        const view = render(<IntegrationsModule seams={seams} />);
        await waitFor(() =>
            expect(view.getByTestId('integrations-server-runtime').textContent).toBe('server identity unreadable'),
        );
    });
});

describe('1424 — Summary (R3)', () => {
    test('one row per surface with the three state chips', async () => {
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getByTestId('integrations-summary-table')).toBeTruthy());
        // Project MCP: enabled with its token → `on`.
        expect(view.getByTestId('integrations-row-project-mcp').textContent).toContain('on');
        // A2A: enabled, token missing → the error tone chip.
        const a2a = view.getByTestId('integrations-row-a2a-inbound');
        expect(a2a.textContent).toContain('on · token unset');
        // Gateway: standalone → off.
        expect(view.getByTestId('integrations-row-gateway-mcp').textContent).toContain('off');
        // Outbound: one declared peer → on.
        expect(view.getByTestId('integrations-row-a2a-outbound').textContent).toContain('on');
    });

    // One config per protocol (K44): labels name the endpoint or direction, never a separate config.
    test('row labels name the protocol, then the endpoint or traffic direction', async () => {
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getByTestId('integrations-summary-table')).toBeTruthy());
        const label = (surface: string) =>
            view.getByTestId(`integrations-row-${surface}`).querySelector('td')?.textContent;
        expect(label('project-mcp')).toBe('MCP · project endpoint');
        expect(label('gateway-mcp')).toBe('MCP · gateway root');
        expect(label('a2a-inbound')).toBe('A2A · received');
        expect(label('a2a-outbound')).toBe('A2A · sent');
    });

    test('the activity columns come from the usage window', async () => {
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getByTestId('integrations-row-project-mcp')).toBeTruthy());
        const row = view.getByTestId('integrations-row-project-mcp').textContent ?? '';
        expect(row).toContain('3'); // three calls
        expect(row).toContain('25%'); // one failure of four
        expect(row).toContain('SPUR_MCP_TOKEN');
        const a2aCells = view.getByTestId('integrations-row-a2a-inbound').querySelectorAll('td');
        expect(a2aCells[4]?.textContent).toBe('4');
        expect(a2aCells[5]?.textContent).toBe('25%');
        expect(a2aCells[6]?.textContent).toBe(new Date('2026-11-22T01:30:00.000Z').toLocaleString());
    });

    test('the gateway strip reports unreadable counters instead of inventing them', async () => {
        overrides.status = () => ({
            ...STATUS,
            gateway: {
                served: true as const,
                namespace: '/tslibs',
                rootMcpUrl: 'http://localhost:3000/mcp',
                counters: null,
                // A name distinct from the project's proves the row shows the gateway's PROBED state
                // (its own machine config at boot), not a copy of this project's server.mcp.
                mcp: { enabled: true, auth: { envName: 'GATEWAY_TOKEN', tokenPresent: true } },
                diagnostic: 'connect ECONNREFUSED',
            },
        });
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getByTestId('gateway-counters-unavailable')).toBeTruthy());
        expect(view.getByTestId('gateway-counters-unavailable').textContent).toContain('ECONNREFUSED');
        const gateway = view.getByTestId('integrations-row-gateway-mcp').querySelectorAll('td');
        expect(gateway[3]?.textContent).toBe('GATEWAY_TOKEN');
        expect(gateway[4]?.textContent).toBe('5');
        expect(gateway[5]?.textContent).toBe('40%');
        const outbound = view.getByTestId('integrations-row-a2a-outbound').querySelectorAll('td');
        expect(outbound[4]?.textContent).toBe('3');
        expect(outbound[5]?.textContent).toBe('33%');
        expect(outbound[7]?.textContent).toBe('1');
    });
});

describe('1424 — MCP tab (R4)', () => {
    test('lists the catalog with origin and read/write badges, and the resources', async () => {
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getAllByRole('tab').length).toBe(3));
        fireEvent.click(view.getByRole('tab', { name: 'MCP' }));
        await waitFor(() => expect(view.getByTestId('integrations-mcp-tools')).toBeTruthy());
        const builtin = view.getByTestId('integrations-tool-sp_task_list').textContent ?? '';
        expect(builtin).toContain('built-in');
        expect(builtin).toContain('read');
        const workflow = view.getByTestId('integrations-tool-ops_daily_report').textContent ?? '';
        expect(workflow).toContain('workflow');
        expect(workflow).toContain('write');
        expect(view.getByTestId('integrations-mcp-resources').textContent).toContain('spur://tasks/{wbs}');
        const disclosure = view.getByTestId('integrations-tool-sp_task_list').querySelector('details');
        expect(disclosure?.querySelector('summary')?.textContent).toBe('input schema');
        expect(disclosure?.querySelector('pre')?.textContent).toContain('"type": "object"');
    });

    test('recent calls show tool, duration and outcome', async () => {
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getAllByRole('tab').length).toBe(3));
        fireEvent.click(view.getByRole('tab', { name: 'MCP' }));
        await waitFor(() => expect(view.getByTestId('integrations-mcp-calls')).toBeTruthy());
        const calls = view.getByTestId('integrations-mcp-calls').textContent ?? '';
        expect(calls).toContain('sp_task_list');
        expect(calls).toContain('12ms');
        expect(calls).toContain('ok');
        expect(calls).toContain('invalid_arguments');
    });

    test('the rendered module contains no token value', async () => {
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getByTestId('integrations-summary-table')).toBeTruthy());
        expect(document.body.innerHTML).not.toContain('SPUR_MCP_TOKEN_VALUE');
    });
});

describe('1424 — A2A tab (R5)', () => {
    test('member cards, A2A tasks and deep links render', async () => {
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getAllByRole('tab').length).toBe(3));
        fireEvent.click(view.getByRole('tab', { name: 'A2A' }));
        await waitFor(() => expect(view.getByTestId('integrations-a2a-members')).toBeTruthy());
        const member = view.getByTestId('integrations-a2a-member-proj-coder');
        expect(member.textContent).toContain('write-fenced');
        expect(member.querySelector('a')?.getAttribute('href')).toContain('/a2a/members/proj-coder/');
        const tasks = view.getByTestId('integrations-a2a-tasks').textContent ?? '';
        expect(tasks).toContain('m-a2a');
        expect(tasks).not.toContain('m-fleet');
        expect(view.getByTestId('integrations-a2a-tasks').querySelector('a')?.getAttribute('href')).toBe(
            '/board/projects/inbox',
        );
        const events = view.getByTestId('integrations-a2a-events');
        expect(events.querySelector('a')?.getAttribute('href')).toBe(
            '/board/observability?tab=system-events&eventName=a2a.task.cancelled&runId=run-1',
        );
        // K44 1451: both directions share the one members list, each row labelled with its direction.
        const list = view.getByTestId('integrations-a2a-members');
        expect(list.contains(view.getByTestId('integrations-a2a-member-proj-peer'))).toBe(true);
        expect(view.getByTestId('integrations-a2a-direction-proj-coder').textContent).toBe('inbound');
        expect(view.getByTestId('integrations-a2a-direction-proj-peer').textContent).toBe('outbound');
        expect(view.queryByTestId('integrations-a2a-outbound')).toBeNull();
    });

    test('disabled A2A listener renders member card URL as non-clickable text', async () => {
        overrides.status = () => ({
            ...STATUS,
            a2a: { ...STATUS.a2a, enabled: false },
        });
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getAllByRole('tab').length).toBe(3));
        fireEvent.click(view.getByRole('tab', { name: 'A2A' }));
        await waitFor(() => expect(view.getByTestId('integrations-a2a-members')).toBeTruthy());
        const member = view.getByTestId('integrations-a2a-member-proj-coder');
        expect(member.querySelector('a')).toBeNull();
        expect(member.textContent).toContain('agent-card.json');
        expect(member.textContent).toContain('A2A listener off');
    });
});

// ─── 1454: the A2A tab leads with the sequence, and the drawer is one disclosure below it ───────
describe('1454 — the sequence leads the A2A tab through the module shell (R1/R5)', () => {
    test('the shell wires the sequence ahead of a collapsed configuration drawer', async () => {
        overrides.timeline = () => ({
            messages: [
                {
                    id: 'm1',
                    fromId: 'operator',
                    toId: 'proj-coder',
                    body: 'implement task 1454',
                    kind: 'request',
                    status: 'delivered',
                    attempts: 1,
                    error: null,
                    claimedAt: Date.now() - 2_000,
                    deliveredAt: Date.now() - 1_500,
                    readAt: Date.now() - 1_000,
                    inReplyTo: null,
                    threadId: 'm1',
                    requestKey: 'a2a:proj-coder:m1',
                    taskId: null,
                    parentRunId: null,
                    createdAt: Date.now() - 3_000,
                },
            ],
            nextCursor: null,
        });
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getAllByRole('tab').length).toBe(3));
        fireEvent.click(view.getByRole('tab', { name: 'A2A' }));
        const grid = await waitFor(() => view.getByTestId('integrations-a2a-sequence-grid'));
        // The arrow is drawn for the row the shell's own seam returned.
        expect(view.getByTestId('integrations-a2a-arrow-trigger-m1').textContent).toContain('operator → proj-coder');
        const drawer = view.getByTestId('integrations-a2a-config-drawer');
        expect(drawer.hasAttribute('open')).toBe(false);
        expect(grid.compareDocumentPosition(drawer) & 4).toBe(4);
        // The Members content is still reachable inside the disclosure (no capability loss).
        expect(view.getByTestId('integrations-a2a-members')).toBeTruthy();
    });
});

describe('1424 — states (R7)', () => {
    test('an empty state names the config keys when every surface is off', async () => {
        overrides.status = () => ({
            ...STATUS,
            mcp: { ...STATUS.mcp, enabled: false, url: null },
            a2a: { ...STATUS.a2a, enabled: false, members: [] },
        });
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getByTestId('integrations-empty')).toBeTruthy());
        expect(view.getByTestId('integrations-empty').textContent).toContain('server.mcp.enabled');
        expect(view.getByTestId('integrations-empty').textContent).toContain('server.a2a.enabled');
    });

    test('a failed status read renders a diagnostic whose retry refetches', async () => {
        let fail = true;
        overrides.status = () => {
            if (fail) {
                fail = false;
                throw new Error('boom');
            }
            return STATUS;
        };
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getByTestId('integrations-diagnostic')).toBeTruthy());
        expect(view.getByTestId('integrations-diagnostic').textContent).toContain('boom');
        const before = statusRequests;
        fireEvent.click(view.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(view.getByTestId('integrations-summary-table')).toBeTruthy());
        expect(statusRequests).toBeGreaterThan(before);
    });

    // A project server started before a rebuild survives the gateway restart (ADR-151 §7) and
    // answers the old shape to the new Board: say so, instead of a TypeError from deep in a helper.
    test('a status from an older server build names the stale server instead of crashing', async () => {
        const { members: _members, ...a2a } = STATUS.a2a;
        overrides.status = () => ({ ...STATUS, a2a: { ...a2a, inbound: [], outbound: [] } }) as never;
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getByTestId('integrations-diagnostic')).toBeTruthy());
        const text = view.getByTestId('integrations-diagnostic').textContent ?? '';
        expect(text).toContain('older Spur build');
        expect(text).toContain('spur projects stop');
        expect(text).not.toContain("reading 'filter'");
    });
});

// ─── 1438 R2: the MCP tab explains the namespace and refuses to hide a remedy ──────────────
// The failure modes: a filter that also hides the exposure findings (the operator loses the
// remedy while narrowing the list), an example that expands a credential VALUE instead of its
// variable name, and a command offered for a surface that is off or not mounted.

describe('1438 — MCP inspection and examples (R2)', () => {
    /** Open the MCP tab and wait for the catalog. */
    async function openMcp(view: ReturnType<typeof render>) {
        await waitFor(() => expect(view.getAllByRole('tab').length).toBe(3));
        fireEvent.click(view.getByRole('tab', { name: 'MCP' }));
        await waitFor(() => expect(view.getByTestId('integrations-mcp-tools')).toBeTruthy());
    }

    /** Type into the filter: react-dom's happy-dom input polyfill needs focus + change + keyup. */
    function filter(view: ReturnType<typeof render>, value: string) {
        const field = view.getByTestId('integrations-mcp-filter');
        fireEvent.focusIn(field);
        fireEvent.change(field, { target: { value } });
        fireEvent.keyUp(field);
    }

    test('the namespace and its provenance are named', async () => {
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await openMcp(view);
        const namespace = view.getByTestId('integrations-mcp-namespace').textContent ?? '';
        expect(namespace).toContain('ops');
        expect(namespace).toContain('config');
    });

    test('a partial tool name filters the list and the exposure remedy stays visible', async () => {
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await openMcp(view);
        filter(view, 'TASK');
        await waitFor(() => expect(view.queryByTestId('integrations-tool-ops_daily_report')).toBeNull());
        expect(view.getByTestId('integrations-tool-sp_task_list')).toBeTruthy();
        const exposure = view.getByTestId('integrations-mcp-exposure').textContent ?? '';
        expect(exposure).toContain('ops_dup');
        expect(exposure).toContain('rename the workflow');
        // The resources are a separate surface: filtering tools never hides them.
        expect(view.getByTestId('integrations-mcp-resources').textContent).toContain('spur://tasks/{wbs}');
    });

    test('a filter that matches nothing says so instead of rendering an empty table', async () => {
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await openMcp(view);
        filter(view, 'zzz');
        await waitFor(() => expect(view.getByTestId('integrations-mcp-no-match')).toBeTruthy());
        expect(view.getByTestId('integrations-mcp-exposure')).toBeTruthy();
    });

    test('the project probe and command name the credential variable, never its value', async () => {
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await openMcp(view);
        const command = view.getByTestId('integrations-mcp-project-command').textContent ?? '';
        expect(command).toContain('spur mcp --url');
        expect(command).toContain('http://localhost:3007/mcp');
        const probe = view.getByTestId('integrations-mcp-probe').textContent ?? '';
        expect(probe).toContain('server/discover');
        expect(probe).toContain(`\${SPUR_MCP_TOKEN}`);
        expect(document.body.innerHTML).not.toContain('SPUR_MCP_TOKEN_VALUE');
        // Standalone: no gateway entry is mounted, so no gateway command is offered.
        expect(view.queryByTestId('integrations-mcp-gateway-command')).toBeNull();
    });

    test('a gateway-prefixed project offers the gateway command on its own surface', async () => {
        overrides.status = () => ({
            ...STATUS,
            mcp: { ...STATUS.mcp, url: 'https://spur.example.com/tslibs/mcp' },
            gateway: {
                served: true as const,
                namespace: '/tslibs',
                rootMcpUrl: 'https://spur.example.com/mcp',
                counters: null,
                mcp: { enabled: true, auth: { envName: 'GATEWAY_TOKEN', tokenPresent: true } },
            },
        });
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await openMcp(view);
        expect(view.getByTestId('integrations-mcp-project-command').textContent).toContain(
            'https://spur.example.com/tslibs/mcp',
        );
        const gateway = view.getByTestId('integrations-mcp-gateway-command').textContent ?? '';
        expect(gateway).toContain('spur mcp --gateway');
    });

    test('an off surface omits its command and still lists the catalog', async () => {
        overrides.status = () => ({ ...STATUS, mcp: { ...STATUS.mcp, enabled: false, url: null } });
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await openMcp(view);
        expect(view.queryByTestId('integrations-mcp-project-command')).toBeNull();
        expect(view.queryByTestId('integrations-mcp-probe')).toBeNull();
        expect(view.getByTestId('integrations-tool-sp_task_list')).toBeTruthy();
    });
});

// ─── 1439 R1: the selected window's detail, and missing metrics that stay missing ──────────
// The failure modes: a window switch that leaves the previous window's numbers on screen, a
// null latency rendered as `0ms` (inventing a measurement), unmeasured calls folded silently into
// the percentile, and an empty slice that renders a header with nothing under it.

/** A second window: different rows, null latencies, unmeasured calls and one failure cluster. */
const ALL_USAGE: IntegrationsUsage = {
    tools: [
        {
            tool: 'sp_workflow_run',
            calls: 4,
            failures: 2,
            failureRate: 0.5,
            p50Ms: null,
            p95Ms: null,
            durationUnmeasured: 4,
            lastCalledAt: '2026-11-22T02:00:00.000Z',
        },
    ],
    resources: [{ uri: 'spur://runs/{id}', reads: 2, failures: 1 }],
    byActor: [{ actor: 'agent-beta', calls: 6, failures: 2 }],
    a2a: [{ member: 'proj-peer', received: 1, replayed: 2, conflict: 1, cancelled: 1 }],
    authDenied: [
        { surface: 'a2a', reason: 'expired', count: 3 },
        { surface: 'mcp', reason: 'missing', count: 5 },
    ],
    failureClusters: [
        {
            tool: 'sp_workflow_run',
            errorCode: 'invalid_arguments',
            count: 2,
            firstAt: '2026-11-22T01:00:00.000Z',
            lastAt: '2026-11-22T02:00:00.000Z',
            sampleEventIds: ['e9'],
        },
    ],
    gatewayMcpActivity: null,
};

/** Serve `ALL_USAGE` for the unbounded window and the default fixture for every bounded one. */
function usageByWindow(): void {
    overrides.usage = (input) => (input.since === undefined ? ALL_USAGE : USAGE);
}

// ─── 1446 R5: the catalog table joins the window's counters, and nothing hides an unadvertised tool ─
// The failure modes: a registered tool with no calls vanishing from the table, a zero rendered as
// "unavailable", and a tool that still runs but is no longer advertised disappearing entirely.

describe('1446 — per-tool call counters in the Tools table (R5)', () => {
    /** `sp_task_list` is advertised and busy; `ops_daily_report` is advertised and never called. */
    const CALLED_AND_UNCALLED: IntegrationsUsage = {
        ...USAGE,
        tools: [
            {
                tool: 'sp_task_list',
                calls: 3,
                failures: 1,
                failureRate: 0.25,
                p50Ms: 4,
                p95Ms: 9,
                durationUnmeasured: 0,
                lastCalledAt: '2026-11-22T01:30:00.000Z',
            },
            // Called in this window but no longer advertised: the usage table must keep it.
            {
                tool: 'sp_retired_tool',
                calls: 2,
                failures: 0,
                failureRate: 0,
                p50Ms: 7,
                p95Ms: 7,
                durationUnmeasured: 0,
                lastCalledAt: '2026-11-22T01:20:00.000Z',
            },
        ],
    };

    test('a called tool, an uncalled tool and an unadvertised tool are all visible', async () => {
        overrides.usage = () => CALLED_AND_UNCALLED;
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getAllByRole('tab').length).toBe(3));
        fireEvent.click(view.getByRole('tab', { name: 'MCP' }));
        await waitFor(() => expect(view.getByTestId('integrations-mcp-tools')).toBeTruthy());

        const called = view.getByTestId('integrations-tool-sp_task_list').querySelectorAll('td');
        expect(called[3]?.textContent).toBe('3');
        expect(called[4]?.textContent).toBe('1');
        expect(called[5]?.textContent).toBe('4ms / 9ms');
        expect(called[6]?.textContent).toBe(new Date('2026-11-22T01:30:00.000Z').toLocaleString());

        // An uncalled but advertised tool is a real zero, not an em dash — only the latency columns are unavailable.
        const uncalled = view.getByTestId('integrations-tool-ops_daily_report').querySelectorAll('td');
        expect(uncalled[3]?.textContent).toBe('0');
        expect(uncalled[4]?.textContent).toBe('0');
        expect(uncalled[5]?.textContent).toBe('—');
        expect(uncalled[6]?.textContent).toBe('—');

        // Attempts in the window: 3 + 1 failures on the listed tool, 2 on the retired one.
        expect(view.getByTestId('integrations-mcp-total-calls').textContent).toBe('6 calls');

        const retired = view.getByTestId('integrations-mcp-usage-tools').textContent ?? '';
        expect(retired).toContain('sp_retired_tool');
        expect(retired).not.toContain('sp_task_list');
    });
});

describe('1439 — selected-window usage detail (R1)', () => {
    test('Summary shows all six slices, with empty states where a slice is empty', async () => {
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getByTestId('integrations-usage-tools')).toBeTruthy());
        expect(view.getByTestId('integrations-usage-tools').textContent).toContain('sp_task_list');
        expect(view.getByTestId('integrations-usage-tools').textContent).toContain('4ms');
        expect(view.getByTestId('integrations-usage-actors-empty')).toBeTruthy();
        expect(view.getByTestId('integrations-usage-resources-empty')).toBeTruthy();
        expect(view.getByTestId('integrations-usage-clusters-empty')).toBeTruthy();
        expect(view.getByTestId('integrations-usage-a2a').textContent).toContain('proj-coder');
        const denials = view.getByTestId('integrations-usage-denials').textContent ?? '';
        expect(denials).toContain('mcp');
        expect(denials).toContain('missing');
    });

    test('selecting another window re-reads and replaces the detail', async () => {
        usageByWindow();
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getByTestId('integrations-usage-tools').textContent).toContain('sp_task_list'));
        fireEvent.click(view.getByRole('button', { name: 'All' }));
        await waitFor(() =>
            expect(view.getByTestId('integrations-usage-tools').textContent).toContain('sp_workflow_run'),
        );
        const tools = view.getByTestId('integrations-usage-tools').textContent ?? '';
        expect(tools).not.toContain('sp_task_list');
        // A null percentile stays unavailable and the unmeasured calls are counted, not averaged in.
        expect(tools).toContain('—');
        expect(tools).toContain('4 unmeasured');
        expect(view.getByTestId('integrations-usage-resources').textContent).toContain('spur://runs/{id}');
        expect(view.getByTestId('integrations-usage-actors').textContent).toContain('agent-beta');
        const clusters = view.getByTestId('integrations-usage-clusters').textContent ?? '';
        expect(clusters).toContain('invalid_arguments');
        expect(clusters).toContain('2');
        expect(view.getByTestId('integrations-usage-a2a').textContent).toContain('proj-peer');
        expect(view.getByTestId('integrations-usage-denials').textContent).toContain('expired');
    });

    test('the MCP tab carries the tool, resource and repeated-failure detail', async () => {
        usageByWindow();
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getAllByRole('tab').length).toBe(3));
        fireEvent.click(view.getByRole('button', { name: 'All' }));
        fireEvent.click(view.getByRole('tab', { name: 'MCP' }));
        await waitFor(() => expect(view.getByTestId('integrations-mcp-usage-tools')).toBeTruthy());
        const tools = view.getByTestId('integrations-mcp-usage-tools').textContent ?? '';
        expect(tools).toContain('sp_workflow_run');
        expect(tools).toContain('4 unmeasured');
        expect(view.getByTestId('integrations-mcp-usage-resources').textContent).toContain('spur://runs/{id}');
        expect(view.getByTestId('integrations-mcp-usage-clusters').textContent).toContain('invalid_arguments');
    });

    test('the A2A tab carries member intake and its own refusals only', async () => {
        usageByWindow();
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getAllByRole('tab').length).toBe(3));
        fireEvent.click(view.getByRole('button', { name: 'All' }));
        fireEvent.click(view.getByRole('tab', { name: 'A2A' }));
        await waitFor(() => expect(view.getByTestId('integrations-a2a-usage-members')).toBeTruthy());
        const members = view.getByTestId('integrations-a2a-usage-members').textContent ?? '';
        expect(members).toContain('proj-peer');
        expect(members).toContain('2');
        const denials = view.getByTestId('integrations-a2a-usage-denials').textContent ?? '';
        expect(denials).toContain('expired');
        // The mcp surface's refusals belong to the MCP tab, never to this one.
        expect(denials).not.toContain('missing');
    });
});

// ─── 1440: card inspection, outbound credential state and exact run links ───────────────────
// The failure modes: a card fetched without the operator asking (or from the outbound target), an
// inspector error that blanks the tab, a credential VALUE rendered instead of its variable name,
// remote refs attributed to the member instead of the receipt, and a Run link that dead-ends.

const UUID_RUN = '9f1d2c3b-4a5e-4f60-8b71-2c3d4e5f6071';

describe('1440 — A2A inspection and trace links', () => {
    async function openA2a(view: ReturnType<typeof render>) {
        await waitFor(() => expect(view.getAllByRole('tab').length).toBe(3));
        fireEvent.click(view.getByRole('tab', { name: 'A2A' }));
        await waitFor(() => expect(view.getByTestId('integrations-a2a-members')).toBeTruthy());
    }

    test('the card JSON is fetched only on demand and rendered as text', async () => {
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await openA2a(view);
        expect(view.queryByTestId('integrations-a2a-card-json')).toBeNull();
        fireEvent.click(view.getByTestId('integrations-a2a-card-load'));
        await waitFor(() => expect(view.getByTestId('integrations-a2a-card-json')).toBeTruthy());
        const json = view.getByTestId('integrations-a2a-card-json').textContent ?? '';
        expect(json).toContain('"name": "proj-coder"');
        expect(json).toContain('"skills"');
    });

    test('the card inspector stays on the Board mount when the advertised origin differs', async () => {
        const base = document.createElement('meta');
        base.name = 'spur-base';
        base.content = '/mounted/';
        document.head.append(base);
        resetBasePathForTesting();
        const reads: string[] = [];
        const seams = makeSeams();
        try {
            const view = render(
                <IntegrationsModule
                    seams={{
                        ...seams,
                        fetchCard: async (url) => {
                            reads.push(url);
                            return Response.json({ name: 'proj-coder' });
                        },
                    }}
                />,
            );
            await openA2a(view);
            expect(reads).toEqual([]);
            fireEvent.click(view.getByTestId('integrations-a2a-card-load'));
            await waitFor(() => expect(view.getByTestId('integrations-a2a-card-json')).toBeTruthy());
            expect(reads).toEqual(['/mounted/a2a/members/proj-coder/.well-known/agent-card.json']);
        } finally {
            base.remove();
            resetBasePathForTesting();
        }
    });

    test('an unavailable card shows an inline error and a retry, not a blank tab', async () => {
        overrides.card = async () => new Response('nope', { status: 500 });
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await openA2a(view);
        fireEvent.click(view.getByTestId('integrations-a2a-card-load'));
        await waitFor(() => expect(view.getByTestId('integrations-a2a-card-error')).toBeTruthy());
        expect(view.getByTestId('integrations-a2a-card-error').textContent).toContain('500');
        // The rest of the tab is untouched by one failed card.
        expect(view.getByTestId('integrations-a2a-members')).toBeTruthy();
    });

    test('a disabled listener offers no card fetch and no examples', async () => {
        overrides.status = () => ({ ...STATUS, a2a: { ...STATUS.a2a, enabled: false, url: null } });
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await openA2a(view);
        expect(view.queryByTestId('integrations-a2a-card-load')).toBeNull();
        expect(view.queryByTestId('integrations-a2a-examples-proj-coder')).toBeNull();
    });

    test('the CLI examples name the card and the credential helper, never a token', async () => {
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await openA2a(view);
        const examples = view.getByTestId('integrations-a2a-examples-proj-coder').textContent ?? '';
        expect(examples).toContain('a2a card get -o json');
        expect(examples).toContain('a2a send -o json --request-payload');
        expect(examples).toContain('--credential-helper');
        expect(examples).toContain('http://localhost:3007/a2a/members/proj-coder/.well-known/agent-card.json');
        expect(document.body.innerHTML).not.toContain('SPUR_MCP_TOKEN_VALUE');
    });

    test('outbound credential state is the variable name and its presence', async () => {
        overrides.status = () => ({
            ...STATUS,
            a2a: {
                ...STATUS.a2a,
                members: [
                    {
                        member: 'proj-peer',
                        direction: 'outbound' as const,
                        kind: 'a2a' as const,
                        target: 'https://peer.example',
                        auth: { envName: 'PEER_A2A_TOKEN', tokenPresent: false },
                    },
                ],
            },
        });
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await openA2a(view);
        const auth = view.getByTestId('integrations-a2a-auth-proj-peer').textContent ?? '';
        expect(auth).toContain('PEER_A2A_TOKEN');
        expect(auth).toContain('unset');
    });

    test('each receipt shows its own remote refs, and a missing ref stays absent', async () => {
        // Two receipts for one member: `m-a2a` persisted refs, `m-fleet` did not.
        overrides.receipts = [
            { id: 'm-a2a', kind: 'request', requestKey: 'a2a:proj-coder:m-a2a', status: 'claimed', taskId: null },
            { id: 'm-fleet', kind: 'request', requestKey: 'fleet:task:1421:1', status: 'claimed', taskId: '1421' },
        ];
        overrides.status = () => ({
            ...STATUS,
            a2a: {
                ...STATUS.a2a,
                members: [
                    {
                        member: 'proj-peer',
                        direction: 'outbound' as const,
                        kind: 'a2a' as const,
                        target: 'https://peer.example',
                    },
                ],
            },
        });
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await openA2a(view);
        const outbound = view.getByTestId('integrations-a2a-member-proj-peer').textContent ?? '';
        expect(outbound).toContain('remote-t1');
        expect(outbound).toContain('ctx-1');
        expect(outbound).toContain('lane/one');
        expect(outbound).toContain('no remote refs');
    });

    test('a UUID run opens Observability Trace, and a non-UUID run is plain text', async () => {
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await openA2a(view);
        // The fixture's `run-1` is not a run id — no link, no dead end.
        expect(view.queryByTestId('integrations-a2a-run-m-a2a')).toBeNull();
        expect(view.getByTestId('integrations-a2a-tasks').textContent).toContain('run-1');
        const link = view.getByTestId('integrations-a2a-run-m-old');
        expect(link.getAttribute('href')).toBe(`/board/observability?tab=trace&runId=${UUID_RUN}`);
    });

    test('an enabled listener with no inbound members warns', async () => {
        overrides.status = () => ({
            ...STATUS,
            a2a: { ...STATUS.a2a, members: STATUS.a2a.members.filter((member) => member.direction === 'outbound') },
        });
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getAllByRole('tab').length).toBe(3));
        fireEvent.click(view.getByRole('tab', { name: 'A2A' }));
        await waitFor(() => expect(view.getByTestId('integrations-a2a-no-inbound')).toBeTruthy());
    });
});

describe('1440 — trace link helper', () => {
    test('a UUID becomes a base-aware Trace link; anything else yields none', () => {
        expect(traceLink(UUID_RUN)).toBe(`/board/observability?tab=trace&runId=${UUID_RUN}`);
        expect(traceLink('run-1')).toBeNull();
        expect(traceLink(null)).toBeNull();
    });
});

describe('1447 — manifest origin badge in McpTab', () => {
    test('AC6: renders manifest origin badge in the Tools table', async () => {
        overrides.status = () => ({
            ...STATUS,
            mcp: {
                ...STATUS.mcp,
                tools: [
                    ...STATUS.mcp.tools,
                    {
                        name: 'ops_plugin_smoke',
                        origin: 'manifest' as const,
                        description: 'Run plugin smoke',
                        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
                        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
                    },
                ],
            },
        });
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getAllByRole('tab').length).toBe(3));
        fireEvent.click(view.getByRole('tab', { name: 'MCP' }));
        const row = await waitFor(() => view.getByTestId('integrations-tool-ops_plugin_smoke'));
        expect(row.textContent).toContain('manifest');
    });
});

// ─── 1449 R1/R3/R4: diagnostics, the per-agent Client config, and readiness pins ───────────
// The failure modes: a gateway-root MCP entry that looks configured while the project it forwards
// to has none, a startup config failure rendered as "all surfaces off", a client snippet the agent
// cannot read, and a readiness badge that claims active without evidence.
describe('1449 — diagnostics, client config tabs and readiness pins', () => {
    const GATEWAY_ON: IntegrationsStatus['gateway'] = {
        served: true as const,
        namespace: '/spur-new',
        rootMcpUrl: 'http://localhost:3070/mcp',
        counters: null,
        mcp: { enabled: true, auth: { envName: 'SPUR_MCP_TOKEN', tokenPresent: true } },
    };

    async function openClientConfig(view: ReturnType<typeof render>) {
        await waitFor(() => expect(view.getAllByRole('tab').length).toBe(3));
        fireEvent.click(view.getByRole('tab', { name: 'MCP' }));
        await waitFor(() => expect(view.getByTestId('integrations-mcp-snippet')).toBeTruthy());
    }

    test('a config-load failure is named on the Summary instead of reading as all-off', async () => {
        overrides.status = () => ({ ...STATUS, configDiagnostic: 'server.mcp.enabled: expected boolean' });
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getByTestId('integrations-config-diagnostic')).toBeTruthy());
        expect(view.getByTestId('integrations-config-diagnostic').textContent).toContain('server.mcp.enabled');
    });

    test('gateway MCP on while the project MCP is off warns on both tabs', async () => {
        overrides.status = () => ({
            ...STATUS,
            mcp: { ...STATUS.mcp, enabled: false, url: null },
            gateway: GATEWAY_ON,
        });
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await waitFor(() => expect(view.getByTestId('integrations-gateway-mcp-warning')).toBeTruthy());
        expect(view.getByTestId('integrations-gateway-mcp-warning').textContent).toContain('server.mcp.enabled');
        await openClientConfig(view);
        expect(view.getByTestId('integrations-mcp-gateway-warning').textContent).toContain('tools/call');
    });

    test('each agent tab renders its own native format, and the transport toggle drives the shape', async () => {
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await openClientConfig(view);
        // The default agent is Claude Code over the gateway bridge.
        expect(view.getByTestId('integrations-mcp-snippet').textContent).toContain('"mcpServers"');
        // ModuleTabs owns the ids (`integrations-mcp-client-<agent>`), not a data-testid.
        fireEvent.click(view.getByRole('tab', { name: 'Codex' }));
        await waitFor(() =>
            expect(view.getByTestId('integrations-mcp-snippet').textContent).toContain('[mcp_servers.spur]'),
        );
        fireEvent.click(view.getByTestId('integrations-mcp-transport-http'));
        await waitFor(() =>
            expect(view.getByTestId('integrations-mcp-snippet').textContent).toContain(
                'url = "http://localhost:3007/mcp"',
            ),
        );
        expect(view.getByTestId('integrations-mcp-client-auth').textContent).toContain('SPUR_MCP_TOKEN');
        // The heavy browser suite pins these ids; the TabView must not rename them.
        expect(view.getByTestId('integrations-mcp-project-command')).toBeTruthy();
    });

    test('readiness pins report each state with its detail and remedy', async () => {
        overrides.readiness = {
            available: true,
            agents: [
                {
                    agent: 'claude',
                    label: 'Claude Code',
                    state: 'active',
                    transport: 'stdio',
                    configPath: '/home/.claude.json',
                    detail: 'stdio entry spur in /home/.claude.json · 4 calls in the last 24h',
                    remedy: null,
                    observedCalls: 4,
                },
                {
                    agent: 'codex',
                    label: 'Codex',
                    state: 'misconfigured',
                    transport: 'stdio',
                    configPath: '/home/.codex/config.toml',
                    detail: 'Codex passes no environment without env_vars',
                    remedy: null,
                    observedCalls: 0,
                },
                {
                    agent: 'pi',
                    label: 'pi',
                    state: 'not-configured',
                    transport: null,
                    configPath: null,
                    detail: 'no native config at ~/.pi/agent/mcp.json',
                    remedy: 'add a spur entry running spur mcp --url http://localhost:3007/mcp',
                    observedCalls: 0,
                },
                {
                    agent: 'opencode',
                    label: 'OpenCode',
                    state: 'not-installed',
                    transport: null,
                    configPath: null,
                    detail: 'opencode is not on PATH',
                    remedy: 'install opencode and re-run this check',
                    observedCalls: 0,
                },
            ],
        };
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await openClientConfig(view);
        const pins = view.getByTestId('integrations-mcp-readiness').textContent ?? '';
        for (const state of ['active', 'misconfigured', 'not-configured', 'not-installed']) {
            expect(pins).toContain(state);
        }
        expect(view.getByTestId('integrations-readiness-pi').textContent).toContain('spur mcp --url');
        expect(view.getByTestId('integrations-readiness-claude').textContent).toContain('4 calls');
    });

    test('an older server without the readiness procedure degrades to "not reported"', async () => {
        overrides.readinessError = new Error('404 not found');
        const view = render(<IntegrationsModule seams={makeSeams()} />);
        await openClientConfig(view);
        expect(view.getByTestId('integrations-mcp-readiness-unavailable').textContent).toContain(
            'does not report per-agent readiness',
        );
        // The rest of the module still renders: readiness is additive, never load-bearing.
        expect(view.getByTestId('integrations-mcp-tools')).toBeTruthy();
    });
});
