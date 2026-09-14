registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import MemberDetail from '../../../src/modules/projects/MemberDetail';
import type { MemberIssue, RosterEntry } from '../../../src/modules/projects/roster';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

afterAll(teardownHappyDom);

const OriginalEventSource = (globalThis as Record<string, unknown>).EventSource;
Object.defineProperty(globalThis, 'EventSource', {
    value: class {
        onmessage: unknown = null;
        onerror: unknown = null;
        close(): void {}
    },
    writable: true,
    configurable: true,
});
process.on?.('exit', () => {
    Object.defineProperty(globalThis, 'EventSource', {
        value: OriginalEventSource,
        writable: true,
        configurable: true,
    });
});

function entry(
    issues: readonly MemberIssue[] = [],
    status: RosterEntry['observed']['status'] = 'not-started',
): RosterEntry {
    return {
        instanceId: 'a1',
        declared: {
            instanceId: 'a1',
            role: 'planner',
            executor: 'claude',
            enabled: true,
            writeCapable: true,
            capabilityState: 'active',
        },
        observed: {
            status,
            pid: status === 'not-started' ? null : 42,
            startedAt: status === 'not-started' ? null : '2026-09-12T10:00:00.000Z',
            exitCode: status === 'exited' ? 3 : null,
        },
        isOrchestrator: false,
        issues,
    };
}

const calls: Array<{ url: string; method: string }> = [];

function stubFetch(): typeof fetch {
    return ((input: RequestInfo | URL) => {
        const req = input as Request;
        const url = new URL(req.url);
        calls.push({ url: url.pathname + (url.search ?? ''), method: req.method });
        if (url.pathname === '/api/messages/inbox') {
            return Promise.resolve(
                new Response(
                    JSON.stringify({
                        messages: [
                            {
                                id: 'm1',
                                fromId: 'orch',
                                toId: 'a1',
                                body: 'hello',
                                status: 'queued',
                                createdAt: '2026-09-12T10:00:00.000Z',
                                inReplyTo: null,
                            },
                        ],
                        count: 1,
                    }),
                    { status: 200 },
                ),
            );
        }
        if (url.pathname === '/api/events/history') {
            return Promise.resolve(
                new Response(
                    JSON.stringify({
                        events: [
                            {
                                id: 'e1',
                                eventName: 'agent.started',
                                occurredAt: '2026-09-12T10:00:01.000Z',
                                actor: 'a1',
                                payload: { agentId: 'a1' },
                            },
                            {
                                id: 'e2',
                                eventName: 'agent.started',
                                occurredAt: '2026-09-12T10:00:02.000Z',
                                actor: 'someone-else',
                                payload: { agentId: 'someone-else' },
                            },
                        ],
                    }),
                    { status: 200 },
                ),
            );
        }
        return Promise.resolve(new Response(JSON.stringify({ processes: [] }), { status: 200 }));
    }) as typeof fetch;
}

afterEach(() => {
    cleanup();
    resetFetchForTesting();
    calls.length = 0;
});

describe('MemberDetail pane (0842 R3)', () => {
    test('0851: shows the selected member model and workDir, then clears them for an unknown member', async () => {
        const fallback = stubFetch();
        setFetchForTesting(((input: RequestInfo | URL) => {
            if (new URL((input as Request).url).pathname === '/api/team/teams') {
                return Promise.resolve(
                    Response.json({
                        teams: [
                            {
                                teamId: 'project',
                                name: 'project',
                                workDir: '/work/project',
                                members: [
                                    { id: 'other', type: 'codex', status: 'unknown', model: 'wrong-model' },
                                    { id: 'a1', type: 'claude', status: 'unknown', model: 'configured-model' },
                                ],
                            },
                        ],
                    }),
                );
            }
            return fallback(input);
        }) as typeof fetch);
        const view = render(<MemberDetail entry={entry()} onClose={() => {}} />);
        await act(async () => {});
        expect(view.container.querySelector('[data-member-workdir]')?.textContent).toBe('/work/project');
        expect(view.container.querySelector('[data-member-model]')?.textContent).toBe('configured-model');
        view.rerender(<MemberDetail entry={{ ...entry(), instanceId: 'unknown' }} onClose={() => {}} />);
        await act(async () => {});
        expect(view.container.querySelector('[data-member-workdir]')?.textContent).toBe('Unavailable');
        expect(view.container.querySelector('[data-member-model]')?.textContent).toBe('Unavailable');
    });

    test('mounts terminal + member inbox read + activity read; no new transport, no POST on open', async () => {
        setFetchForTesting(stubFetch());
        const view = render(<MemberDetail entry={entry()} onClose={() => {}} />);
        await act(async () => {});
        expect(view.container.querySelector('[data-member-detail]')).not.toBeNull();
        expect(view.container.querySelector('[data-member-terminal="a1"]')).not.toBeNull();
        expect(view.container.querySelector('[data-member-message="m1"]')?.textContent).toContain('hello');
        // activity scoped to the member: the someone-else event is filtered out
        expect(view.container.querySelector('[data-member-activity-row="agent.started"]')).not.toBeNull();
        expect(view.container.textContent).not.toContain('someone-else');
        const gets = calls.map((c) => `${c.method} ${c.url}`);
        expect(gets).toContain('GET /api/messages/inbox?agent=a1');
        expect(gets).toContain('GET /api/events/history?limit=100');
        expect(calls.every((c) => c.method === 'GET')).toBe(true);
        view.unmount();
    });
});

describe('lifecycle controls (0842 R6)', () => {
    test('executor-unavailable disables start/stop with the reason named and issues no request', async () => {
        setFetchForTesting(stubFetch());
        const view = render(<MemberDetail entry={entry(['executor-unavailable'])} onClose={() => {}} />);
        await act(async () => {});
        const start = view.container.querySelector('[data-member-start]') as HTMLButtonElement;
        const stop = view.container.querySelector('[data-member-stop]') as HTMLButtonElement;
        expect(start.disabled).toBe(true);
        expect(stop.disabled).toBe(true);
        expect(view.container.querySelector('[data-lifecycle-reason]')?.textContent).toContain('executor unavailable');
        await act(async () => {
            start.click();
        });
        expect(calls.every((c) => c.method === 'GET')).toBe(true); // no POST issued
        view.unmount();
    });

    test('unresolved also disables with its own named reason', async () => {
        setFetchForTesting(stubFetch());
        const view = render(<MemberDetail entry={entry(['unresolved'])} onClose={() => {}} />);
        await act(async () => {});
        expect(view.container.querySelector('[data-lifecycle-reason]')?.textContent).toContain('unresolved');
        view.unmount();
    });

    test('a stoppable running member POSTs stop to the existing endpoint', async () => {
        setFetchForTesting(stubFetch());
        const view = render(<MemberDetail entry={entry([], 'running')} onClose={() => {}} />);
        await act(async () => {});
        const stop = view.container.querySelector('[data-member-stop]') as HTMLButtonElement;
        expect(stop.disabled).toBe(false);
        await act(async () => {
            stop.click();
        });
        expect(calls).toContainEqual({ url: '/api/team/agents/a1/stop', method: 'POST' });
        view.unmount();
    });

    // Moved from the retired Teams SupervisorTab tests (0849 R5): the start verb is the
    // same capability, now owned by this pane, and it was the one gap in the moved set.
    test('a stopped member POSTs start to the existing endpoint, with no confirmation step', async () => {
        setFetchForTesting(stubFetch());
        const view = render(<MemberDetail entry={entry([], 'not-started')} onClose={() => {}} />);
        await act(async () => {});
        const start = view.container.querySelector('[data-member-start]') as HTMLButtonElement;
        expect(start.disabled).toBe(false);
        await act(async () => {
            start.click();
        });
        expect(calls).toContainEqual({ url: '/api/team/agents/a1/start', method: 'POST' });
        view.unmount();
    });
});

describe('focus contract (0842 R4)', () => {
    test('Escape dismisses the pane through onClose', async () => {
        setFetchForTesting(stubFetch());
        let closed = 0;
        const view = render(<MemberDetail entry={entry()} onClose={() => (closed += 1)} />);
        await act(async () => {});
        expect(view.container.querySelector('[data-member-detail]')).not.toBeNull();
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(closed).toBe(1);
        await act(async () => {
            (view.container.querySelector('[data-member-detail-close]') as HTMLButtonElement).click();
        });
        expect(closed).toBe(2);
        view.unmount();
    });
});
