import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type React from 'react';
import { type ReactNode, useEffect, useRef } from 'react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import ActivityTab from '../../../src/modules/teams/ActivityTab';
import MessagesTab from '../../../src/modules/teams/MessagesTab';
import RosterTab from '../../../src/modules/teams/RosterTab';
import { TeamsProvider, useTeamsSelection } from '../../../src/modules/teams/TeamsContext';
import TeamsShell from '../../../src/modules/teams/TeamsShell';
import TerminalTab from '../../../src/modules/teams/TerminalTab';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

// ── Mock @/ui to capture Select onChange handlers ────────────────────────
// happy-dom + React 19 do not deliver fireEvent.change to a controlled
// select's onChange (capricorn86/happy-dom#856). Instead of reading
// __reactProps$ (fragile across React versions), we replace the Select
// component with a native <select> that captures its onChange via a ref.
// Button / Badge / Modal get thin passthrough wrappers so fireEvent.click
// and data-attribute queries work against real DOM elements.

interface CapturedSelect {
    label: string;
    onChange: (e: { target: { value: string } }) => void;
}

const capturedSelects: CapturedSelect[] = [];

function getSelectOnChange(label: string): CapturedSelect['onChange'] | undefined {
    return capturedSelects.find((s) => s.label === label)?.onChange;
}

mock.module('@/ui', () => {
    function Select(props: Record<string, unknown>) {
        const ref = useRef<HTMLSelectElement | null>(null);

        useEffect(() => {
            const el = ref.current;
            if (!el || !props.onChange) return;
            const label =
                el.getAttribute('data-terminal-team-select') != null
                    ? 'team'
                    : el.getAttribute('data-terminal-member-select') != null
                      ? 'member'
                      : (el.getAttribute('aria-label') as string) || '';
            if (capturedSelects.some((s) => s.label === label)) return;
            capturedSelects.push({
                label,
                onChange: props.onChange as CapturedSelect['onChange'],
            });
            // props.onChange is stable across renders — captured once per label.
        }, [props.onChange]);

        const rest: Record<string, unknown> = {};
        for (const key of Object.keys(props)) {
            if (key.startsWith('data-') || key === 'disabled' || key === 'className') {
                rest[key] = props[key];
            }
        }
        rest.ref = ref;
        rest.value = props.value;

        return <select {...rest}>{props.children as React.ReactNode}</select>;
    }

    function Button(props: Record<string, unknown>) {
        const rest: Record<string, unknown> = {};
        for (const key of Object.keys(props)) {
            if (
                key === 'disabled' ||
                key === 'className' ||
                key.startsWith('data-') ||
                key === 'type' ||
                key.startsWith('on')
            ) {
                rest[key] = props[key];
            }
        }
        return <button {...rest}>{props.children as React.ReactNode}</button>;
    }

    function Badge(props: Record<string, unknown>) {
        const rest: Record<string, unknown> = {};
        for (const key of Object.keys(props)) {
            if (key.startsWith('data-') || key === 'className' || key.startsWith('on')) {
                rest[key] = props[key];
            }
        }
        return <span {...rest}>{props.children as React.ReactNode}</span>;
    }

    function Modal(props: Record<string, unknown>) {
        if (!props.open) return null;
        const rest: Record<string, unknown> = {};
        const onClose = props.onClose as React.MouseEventHandler | undefined;
        for (const key of Object.keys(props)) {
            if (
                key.startsWith('data-') ||
                key === 'className' ||
                key === 'role' ||
                key === 'aria-modal' ||
                key.startsWith('on')
            ) {
                rest[key] = props[key];
            }
        }
        return (
            // biome-ignore lint/a11y/noStaticElementInteractions: test mock Modal
            <div {...rest} onClick={onClose} role="presentation">
                {props.children as React.ReactNode}
            </div>
        );
    }

    return { Select, Button, Badge, Modal };
});

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
    capturedSelects.length = 0;
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

    test('RosterTab shows an autostart hint and Up feedback when no member is autostart (hint UX)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const req = input instanceof Request ? input : new Request(String(input));
            if (req.url.includes('/team/teams')) {
                return jsonResponse({
                    teams: [
                        {
                            teamId: 'alpha',
                            name: 'Alpha',
                            members: [{ id: 'planner', type: 'claude', status: 'stopped', autoStart: false }],
                        },
                    ],
                });
            }
            // Up response: materialized but 0 started (no autostart members).
            if (req.url.includes('/team/alpha/up')) {
                return jsonResponse({
                    materialized: { teamId: 'alpha', upserted: ['planner'], orphaned: [], written: true },
                    started: [],
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { getByText, getByRole, queryByText } = render(
            <TeamsProvider>
                <RosterTab />
            </TeamsProvider>,
        );

        await waitFor(() => expect(getByText('Alpha')).toBeDefined());

        // Proactive hint: no member has autostart → explain Up before the user clicks.
        await waitFor(() => expect(getByText(/Up starts only members with autostart/)).toBeDefined());
        expect(queryByText(/none here/)).not.toBeNull();

        // Reactive feedback: clicking Up surfaces "0 members started" instead of a silent no-op.
        fireEvent.click(getByRole('button', { name: 'Up' }));
        await waitFor(() => expect(getByText(/0 members started/)).toBeDefined());
    });

    test('RosterTab hides the autostart hint when a member has autostart enabled', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const req = input instanceof Request ? input : new Request(String(input));
            if (req.url.includes('/team/teams')) {
                return jsonResponse({
                    teams: [
                        {
                            teamId: 'beta',
                            name: 'Beta',
                            members: [{ id: 'runner', type: 'omp', status: 'stopped', autoStart: true }],
                        },
                    ],
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { getByText, queryByText } = render(
            <TeamsProvider>
                <RosterTab />
            </TeamsProvider>,
        );
        await waitFor(() => expect(getByText('Beta')).toBeDefined());
        // A member with autostart → no "Up starts only … none here" hint.
        expect(queryByText(/Up starts only members with autostart/)).toBeNull();
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

    test('TerminalTab shows the no-teams empty state when config has no teams (R7)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const req = input instanceof Request ? input : new Request(String(input));
            if (req.url.includes('/team/teams')) return jsonResponse({ teams: [] });
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { getByText, container } = render(<TerminalTab />);

        await waitFor(() => expect(getByText(/No teams defined/)).toBeDefined());
        // No dropdowns or toggle rendered in the empty state.
        expect(container.querySelector('[data-terminal-toolbar]')).toBeNull();
    });

    test('TerminalTab populates team+member dropdowns and renders MemberTerminal on selection (R1/R3)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const req = input instanceof Request ? input : new Request(String(input));
            if (req.url.includes('/team/teams')) {
                return jsonResponse({
                    teams: [
                        {
                            teamId: 'alpha',
                            name: 'Alpha',
                            members: [
                                { id: 'planner', type: 'claude', status: 'running' },
                                { id: 'coder', type: 'codex', status: 'stopped' },
                            ],
                        },
                    ],
                });
            }
            if (req.url.includes('/team/processes')) return jsonResponse({ processes: [] });
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container, queryByText } = render(<TerminalTab />);

        // Team dropdown is populated once the fetch resolves.
        const teamSelect = await waitFor(() => {
            const el = container.querySelector('[data-terminal-team-select]') as HTMLSelectElement | null;
            expect(el).not.toBeNull();
            return el as HTMLSelectElement;
        });
        expect(teamSelect.innerHTML).toContain('Alpha');

        // Drive the team select → member dropdown cascades.
        act(() => {
            getSelectOnChange('team')?.({ target: { value: 'alpha' } });
        });

        const memberSelect = await waitFor(() => {
            const el = container.querySelector('[data-terminal-member-select]') as HTMLSelectElement | null;
            expect(el).not.toBeNull();
            // Must have cascaded member options beyond the default placeholder.
            const sel = el as unknown as HTMLSelectElement;
            expect(sel.options.length).toBeGreaterThan(1);
            return sel;
        });
        // Member options show id + type + status (R2).
        expect(memberSelect.innerHTML).toContain('planner');
        expect(memberSelect.innerHTML).toContain('claude');
        expect(memberSelect.innerHTML).toContain('running');

        // Select the running member → status badge + toggle appear, prompt disappears.
        act(() => {
            getSelectOnChange('member')?.({ target: { value: 'planner' } });
        });

        await waitFor(() => expect(queryByText('Choose a team and member above to open a terminal.')).toBeNull());
        const badge = await waitFor(() => {
            const el = container.querySelector('[data-terminal-status-badge]') as HTMLSpanElement | null;
            expect(el).not.toBeNull();
            return el as HTMLSpanElement;
        });
        expect(badge.textContent).toContain('running');
    });

    test('TerminalTab stop toggle shows confirmation modal before POSTing stop (R2)', async () => {
        const posts: { url: string; method: string }[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const req = input instanceof Request ? input : new Request(String(input));
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
            if (req.method === 'POST') posts.push({ url: req.url, method: req.method });
            if (req.url.includes('/team/processes')) return jsonResponse({ processes: [] });
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<TerminalTab />);

        const _teamSelect = await waitFor(() => {
            const el = container.querySelector('[data-terminal-team-select]') as HTMLSelectElement | null;
            expect(el).not.toBeNull();
            return el as HTMLSelectElement;
        });
        void _teamSelect;
        act(() => getSelectOnChange('team')?.({ target: { value: 'alpha' } }));

        // Wait for member options to actually cascade (element always exists).
        await waitFor(() => {
            const el = container.querySelector('[data-terminal-member-select]') as HTMLSelectElement | null;
            expect(el).not.toBeNull();
            // Must have actual member options beyond the default.
            const sel = el as unknown as HTMLSelectElement;
            expect(sel.options.length).toBeGreaterThan(1);
            return sel;
        });
        act(() => getSelectOnChange('member')?.({ target: { value: 'planner' } }));

        // Toggle for a running member opens the confirmation modal — no POST yet.
        const toggleBtn = await waitFor(() => {
            const el = container.querySelector('[data-terminal-toggle-btn]') as HTMLButtonElement | null;
            expect(el).not.toBeNull();
            return el as HTMLButtonElement;
        });
        act(() => fireEvent.click(toggleBtn));

        const modal = await waitFor(() => {
            const el = container.querySelector('[data-stop-confirm-modal]') as HTMLElement | null;
            expect(el).not.toBeNull();
            return el as HTMLElement;
        });
        expect(modal.textContent).toContain('Stop member?');
        expect(posts.filter((p) => p.url.includes('/stop'))).toHaveLength(0);

        // Cancel closes the modal with no side effects.
        const cancelBtn = await waitFor(() => {
            const el = container.querySelector('[data-stop-confirm-cancel]') as HTMLButtonElement | null;
            expect(el).not.toBeNull();
            return el as HTMLButtonElement;
        });
        act(() => fireEvent.click(cancelBtn));
        await waitFor(() => expect(container.querySelector('[data-stop-confirm-modal]')).toBeNull());
        expect(posts.filter((p) => p.url.includes('/stop'))).toHaveLength(0);

        // Reopen and confirm → stop POST fires.
        act(() => fireEvent.click(toggleBtn));
        const confirmBtn = await waitFor(() => {
            const el = container.querySelector('[data-stop-confirm-confirm]') as HTMLButtonElement | null;
            expect(el).not.toBeNull();
            return el as HTMLButtonElement;
        });
        act(() => fireEvent.click(confirmBtn));

        await waitFor(() =>
            expect(posts.some((p) => p.url.includes('/team/agents/planner/stop') && p.method === 'POST')).toBe(true),
        );
    });

    test('TerminalTab start toggle POSTs the start URL immediately for stopped members (R4)', async () => {
        const posts: { url: string; method: string }[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const req = input instanceof Request ? input : new Request(String(input));
            if (req.url.includes('/team/teams')) {
                return jsonResponse({
                    teams: [
                        {
                            teamId: 'alpha',
                            name: 'Alpha',
                            members: [{ id: 'coder', type: 'codex', status: 'stopped' }],
                        },
                    ],
                });
            }
            if (req.method === 'POST') posts.push({ url: req.url, method: req.method });
            if (req.url.includes('/team/processes')) return jsonResponse({ processes: [] });
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<TerminalTab />);

        const _teamSelect = await waitFor(() => {
            const el = container.querySelector('[data-terminal-team-select]') as HTMLSelectElement | null;
            expect(el).not.toBeNull();
            return el as HTMLSelectElement;
        });
        void _teamSelect;
        act(() => getSelectOnChange('team')?.({ target: { value: 'alpha' } }));

        // Wait for member options to cascade before driving the member select.
        await waitFor(() => {
            const el = container.querySelector('[data-terminal-member-select]') as HTMLSelectElement | null;
            expect(el).not.toBeNull();
            const sel = el as unknown as HTMLSelectElement;
            expect(sel.options.length).toBeGreaterThan(1);
            return sel;
        });
        act(() => getSelectOnChange('member')?.({ target: { value: 'coder' } }));

        // Stopped member → Start button, no confirmation modal.
        const toggleBtn = await waitFor(() => {
            const el = container.querySelector('[data-terminal-toggle-btn]') as HTMLButtonElement | null;
            expect(el).not.toBeNull();
            return el as HTMLButtonElement;
        });
        expect(toggleBtn.textContent).toContain('Start');
        act(() => fireEvent.click(toggleBtn));

        // No confirmation modal for start — only stop requires it (R2).
        expect(container.querySelector('[data-stop-confirm-modal]')).toBeNull();

        await waitFor(() =>
            expect(posts.some((p) => p.url.includes('/team/agents/coder/start') && p.method === 'POST')).toBe(true),
        );
    });

    test('TerminalTab restores persisted team+member from localStorage on mount (R6)', async () => {
        const key = 'spur:board:teams:lastTerminal';
        const stored = globalThis.localStorage?.getItem(key);
        globalThis.localStorage?.setItem(key, JSON.stringify({ teamId: 'alpha', memberId: 'planner' }));

        setFetchForTesting((async (input: RequestInfo | URL) => {
            const req = input instanceof Request ? input : new Request(String(input));
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
            if (req.url.includes('/team/processes')) return jsonResponse({ processes: [] });
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container, queryByText } = render(<TerminalTab />);

        // After the first teams load, the persisted selection auto-restores.
        await waitFor(() => expect(queryByText('Choose a team and member above to open a terminal.')).toBeNull());
        const memberSelect = container.querySelector('[data-terminal-member-select]') as HTMLSelectElement;
        expect((memberSelect as HTMLSelectElement).value).toBe('planner');

        // Restore the original localStorage state.
        if (stored === null || stored === undefined) {
            globalThis.localStorage?.removeItem(key);
        } else {
            globalThis.localStorage?.setItem(key, stored);
        }
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
