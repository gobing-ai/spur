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
    MCP_CLIENT_AGENTS,
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
            mcp: { enabled: true, auth: { envName: 'SPUR_GATEWAY_MCP_TOKEN', tokenPresent: true } },
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
            'gateway MCP entry is off',
        );
    });
});
