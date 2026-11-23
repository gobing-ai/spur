/**
 * Integrations board module (A82 1424).
 *
 * The failure modes: a tab order that drifts from the contract, a state chip that hides an enabled
 * surface with no token, a token value leaking into the DOM, a hand-written client snippet, a
 * gateway strip that fabricates counters, an empty module that renders nothing, a diagnostic with
 * no way back, and outbound/A2A rows from the wrong family.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { IntegrationsStatus, IntegrationsUsage } from '@gobing-ai/spur-contracts';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { module as integrationsModule } from '../../../src/modules/integrations';
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
        inbound: [
            {
                member: 'proj-coder',
                role: 'coder',
                cardUrl: 'http://localhost:3007/a2a/members/proj-coder/.well-known/agent-card.json',
                writeFenced: true,
            },
        ],
        outbound: [{ member: 'proj-peer', kind: 'a2a' as const, target: 'https://peer.example' }],
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
let overrides: { status?: () => Promise<IntegrationsStatus> | IntegrationsStatus } = {};
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
        const prefix = url.searchParams.get('prefix');
        return Response.json({ events: prefix === 'a2a' ? A2A_EVENTS : MCP_EVENTS });
    };
    const client = {
        integrations: {
            status: async () => {
                statusRequests += 1;
                return overrides.status === undefined ? STATUS : await overrides.status();
            },
            usage: async () => USAGE,
        },
        inbox: {
            requests: async () => REQUESTS,
            list: async () => ({ messages: [], nextCursor: null }),
        },
    };
    return { api: client as unknown as IntegrationsSeams['api'], fetchHistory };
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
        expect(view.getByTestId('integrations-a2a-outbound').textContent).toContain('proj-peer');
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

describe('1424 — states (R7)', () => {
    test('an empty state names the config keys when every surface is off', async () => {
        overrides.status = () => ({
            ...STATUS,
            mcp: { ...STATUS.mcp, enabled: false, url: null },
            a2a: { ...STATUS.a2a, enabled: false, inbound: [], outbound: [] },
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
});
