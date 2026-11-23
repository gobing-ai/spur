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
    allSurfacesOff,
    clientSnippet,
    enablementKeys,
    formatUptime,
    inboxLink,
    projectProtocolEvent,
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
            a2a: { enabled: false, outbound: [] },
            gateway: { served: false },
        } as unknown as IntegrationsStatus;
        expect(allSurfacesOff(off)).toBe(true);
        expect(allSurfacesOff({ ...off, a2a: { enabled: true, outbound: [] } } as unknown as IntegrationsStatus)).toBe(
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
                a2a: { enabled: false, outbound: [{ member: 'peer', kind: 'a2a', target: 'http://peer' }] },
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
