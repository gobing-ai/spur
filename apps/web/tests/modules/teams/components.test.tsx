import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { type ReactNode, useEffect } from 'react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import ActivityTab from '../../../src/modules/teams/ActivityTab';
import MessagesTab from '../../../src/modules/teams/MessagesTab';
import RosterTab from '../../../src/modules/teams/RosterTab';
import { TeamsProvider, useTeamsSelection } from '../../../src/modules/teams/TeamsContext';
import TeamsShell from '../../../src/modules/teams/TeamsShell';
import TerminalTab from '../../../src/modules/teams/TerminalTab';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

class FakeEventSource {
    static instances: FakeEventSource[] = [];

    onopen: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    closed = false;

    constructor(readonly url: string) {
        FakeEventSource.instances.push(this);
    }

    close(): void {
        this.closed = true;
    }
}

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

/** Preset the shared Teams selection so a downstream tab can be tested in
 * isolation without driving the Roster round-trip. */
function SelectOnMount({ teamId, memberId, children }: { teamId: string; memberId: string; children: ReactNode }) {
    const { select } = useTeamsSelection();
    useEffect(() => {
        select(teamId, memberId);
    }, [teamId, memberId, select]);
    return <>{children}</>;
}

/**
 * Read a controlled input's React `onChange` off its fiber props and invoke it
 * directly. happy-dom + React 19 do not deliver `fireEvent.change`/`.input` to a
 * controlled input's onChange (capricorn86/happy-dom#856), so — like
 * task-kanban/task-filters.test.tsx bypasses dispatch by capturing onChange from
 * a mocked `@/ui`, this bypasses dispatch by reading the prop off the real node.
 */
type OnChangeHolder = Record<string, { onChange?: (e: { target: { value: string } }) => void } | undefined>;
function getReactOnChange(el: Element): ((e: { target: { value: string } }) => void) | undefined {
    const holder = el as unknown as OnChangeHolder;
    const key = Object.keys(holder).find((k) => k.startsWith('__reactProps$'));
    return key ? holder[key]?.onChange : undefined;
}

let originalEventSource: typeof EventSource | undefined;

beforeAll(() => {
    registerHappyDom();
    originalEventSource = globalThis.EventSource;
});

beforeEach(() => {
    FakeEventSource.instances = [];
    Object.defineProperty(globalThis, 'EventSource', {
        configurable: true,
        value: FakeEventSource,
    });
});

afterEach(async () => {
    cleanup();
    resetFetchForTesting();
    Object.defineProperty(globalThis, 'EventSource', {
        configurable: true,
        value: originalEventSource,
    });
    // These tests mount polling components (Roster/Messages) and MemberTerminal,
    // which leave React 19 scheduler work queued on a macrotask. Drain it now,
    // while `window` still exists, so no deferred render fires after this file's
    // afterAll unregisters happy-dom and crashes the next file (tests/happy-dom.ts).
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
});

afterAll(async () => {
    await teardownHappyDom();
});

describe('teams module components', () => {
    test('TeamsShell renders exactly the 4 v1 tabs with stable labels (0254 AC1)', async () => {
        setFetchForTesting((async () => jsonResponse({ teams: [] })) as unknown as typeof fetch);
        const { getByRole, container } = render(<TeamsShell />);

        for (const label of ['Roster', 'Terminal', 'Messages', 'Activity']) {
            expect(getByRole('tab', { name: label })).toBeDefined();
        }
        // The shell renders no more and no fewer than the 4 declared tabs.
        expect(container.querySelectorAll('[role="tab"]').length).toBe(4);
    });

    test('RosterTab lists teams and the Up control POSTs the up URL (0254 AC2)', async () => {
        const calls: { url: string; method: string }[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const req = input instanceof Request ? input : new Request(String(input));
            calls.push({ url: req.url, method: req.method });
            if (req.url.includes('/team/teams')) {
                return jsonResponse({
                    teams: [
                        {
                            teamId: 'alpha',
                            name: 'Alpha',
                            members: [{ id: 'planner', type: 'claude', status: 'running' }],
                        },
                    ],
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { getByText, getByRole } = render(
            <TeamsProvider>
                <RosterTab />
            </TeamsProvider>,
        );

        await waitFor(() => expect(getByText('Alpha')).toBeDefined());
        expect(getByText('planner')).toBeDefined();

        fireEvent.click(getByRole('button', { name: 'Up' }));

        await waitFor(() =>
            expect(calls.some((c) => c.method === 'POST' && c.url.includes('/team/alpha/up'))).toBe(true),
        );
    });

    test('selecting a member drives the Messages tab inbox fetch downstream (0254 AC3)', async () => {
        const inboxCalls: string[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/team/teams')) {
                return jsonResponse({
                    teams: [
                        {
                            teamId: 'alpha',
                            name: 'Alpha',
                            members: [{ id: 'planner', type: 'claude', status: 'running' }],
                        },
                    ],
                });
            }
            if (url.includes('/messages/inbox')) {
                inboxCalls.push(url);
                return jsonResponse({ messages: [], count: 0 });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { getByRole, getByText } = render(<TeamsShell />);

        // Roster is the default tab; select the member.
        await waitFor(() => expect(getByText('planner')).toBeDefined());
        fireEvent.click(getByText('planner'));

        // Switch to Messages — the selected member id must drive its inbox fetch.
        fireEvent.click(getByRole('tab', { name: 'Messages' }));

        await waitFor(() => expect(inboxCalls.some((url) => url.includes('agent=planner'))).toBe(true));
    });

    test('MessagesTab refetches the inbox on a message.sent SSE event (0254 AC5/R6)', async () => {
        let secondVisible = false;
        const inboxCalls: string[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/messages/inbox')) {
                inboxCalls.push(url);
                const messages = [
                    {
                        id: 'm1',
                        fromId: 'op',
                        body: 'first',
                        status: 'sent',
                        createdAt: '2026-07-14T00:00:00.000Z',
                        inReplyTo: null,
                    },
                    ...(secondVisible
                        ? [
                              {
                                  id: 'm2',
                                  fromId: 'op',
                                  body: 'live-arrived',
                                  status: 'sent',
                                  createdAt: '2026-07-14T00:01:00.000Z',
                                  inReplyTo: null,
                              },
                          ]
                        : []),
                ];
                return jsonResponse({ messages, count: messages.length });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { getByText } = render(
            <TeamsProvider>
                <SelectOnMount teamId="alpha" memberId="planner">
                    <MessagesTab />
                </SelectOnMount>
            </TeamsProvider>,
        );

        await waitFor(() => expect(getByText('first')).toBeDefined());
        const before = inboxCalls.length;
        expect(FakeEventSource.instances.length).toBeGreaterThan(0);

        // A new message lands server-side; fire the SSE event the board emits.
        secondVisible = true;
        await act(async () => {
            FakeEventSource.instances[0]?.onmessage?.(
                new MessageEvent('message', {
                    data: JSON.stringify({
                        eventName: 'message.sent',
                        occurredAt: '2026-07-14T00:01:00.000Z',
                        actor: 'op',
                        payload: {},
                    }),
                }),
            );
        });

        await waitFor(() => expect(getByText('live-arrived')).toBeDefined());
        expect(inboxCalls.length).toBeGreaterThan(before);
    });

    test('MessagesTab composer POSTs /api/messages for the selected member (0254 AC5)', async () => {
        const posts: string[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const req = input instanceof Request ? input : new Request(String(input));
            if (req.url.includes('/messages/inbox')) return jsonResponse({ messages: [], count: 0 });
            if (req.method === 'POST') {
                posts.push(await req.text());
                return jsonResponse({ ok: true });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { getByPlaceholderText, getByRole } = render(
            <TeamsProvider>
                <SelectOnMount teamId="alpha" memberId="planner">
                    <MessagesTab />
                </SelectOnMount>
            </TeamsProvider>,
        );

        // Type into the composer (fiber onChange — see getReactOnChange), then Send.
        const input = await waitFor(() => getByPlaceholderText('Type a message and press Enter…'));
        act(() => {
            getReactOnChange(input)?.({ target: { value: 'hello' } });
        });
        fireEvent.click(getByRole('button', { name: 'Send' }));

        await waitFor(() => expect(posts.length).toBeGreaterThan(0));
        expect(posts[0]).toContain('"toId":"planner"');
        expect(posts[0]).toContain('"body":"hello"');
    });

    test('TerminalTab shows the empty state until a member is selected (0254 R5)', () => {
        const { getByText } = render(
            <TeamsProvider>
                <TerminalTab />
            </TeamsProvider>,
        );
        expect(getByText('Select a member from the Roster to open a terminal.')).toBeDefined();
    });

    test('TerminalTab renders MemberTerminal once a member is selected (0254 R5)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/team/processes')) return jsonResponse({ processes: [] });
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { queryByText } = render(
            <TeamsProvider>
                <SelectOnMount teamId="alpha" memberId="planner">
                    <TerminalTab />
                </SelectOnMount>
            </TeamsProvider>,
        );

        // The empty-state prompt yields to MemberTerminal for the selected member.
        await waitFor(() => expect(queryByText('Select a member from the Roster to open a terminal.')).toBeNull());
    });

    test('ActivityTab renders team/message events and filters out unrelated telemetry (0254 R7)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/events/history')) {
                return jsonResponse({
                    events: [
                        {
                            id: 'e1',
                            eventName: 'agent.started',
                            occurredAt: '2026-07-14T00:00:00.000Z',
                            actor: 'supervisor',
                            payload: {},
                        },
                        {
                            id: 'e2',
                            eventName: 'message.sent',
                            occurredAt: '2026-07-14T00:01:00.000Z',
                            actor: 'planner',
                            payload: {},
                        },
                        {
                            id: 'e3',
                            eventName: 'task.created',
                            occurredAt: '2026-07-14T00:02:00.000Z',
                            actor: 'op',
                            payload: {},
                        },
                    ],
                    count: 3,
                });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const { getByText, queryByText } = render(<ActivityTab />);

        await waitFor(() => expect(getByText('agent.started')).toBeDefined());
        expect(getByText('message.sent')).toBeDefined();
        // System-wide telemetry (task.*) stays on Observability — filtered out here.
        expect(queryByText('task.created')).toBeNull();
    });

    test('ActivityTab prepends live team events and ignores unrelated ones (0254 R7)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/events/history')) return jsonResponse({ events: [], count: 0 });
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const { getByText, queryByText } = render(<ActivityTab />);

        await waitFor(() => expect(getByText('No team activity yet.')).toBeDefined());
        expect(FakeEventSource.instances.length).toBeGreaterThan(0);

        await act(async () => {
            FakeEventSource.instances[0]?.onmessage?.(
                new MessageEvent('message', {
                    data: JSON.stringify({
                        eventName: 'agent.exited',
                        occurredAt: '2026-07-14T00:05:00.000Z',
                        actor: 'planner',
                        payload: {},
                    }),
                }),
            );
        });

        await waitFor(() => expect(getByText('agent.exited')).toBeDefined());

        // A non-team event must never appear on the team timeline.
        await act(async () => {
            FakeEventSource.instances[0]?.onmessage?.(
                new MessageEvent('message', {
                    data: JSON.stringify({
                        eventName: 'task.updated',
                        occurredAt: '2026-07-14T00:06:00.000Z',
                        actor: 'op',
                        payload: {},
                    }),
                }),
            );
        });
        expect(queryByText('task.updated')).toBeNull();
    });
});
