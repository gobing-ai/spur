import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type React from 'react';
import { useEffect, useRef } from 'react';
import * as RealUI from '@/ui';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import ActivityTab, {
    buildRosterIndex,
    enrichRowFromRoster,
    MAX_ACTIVITY_ROWS,
    prependActivityRow,
    toRow,
} from '../../../src/modules/teams/ActivityTab';
import MessagesTab, { parseMessagesFeed } from '../../../src/modules/teams/MessagesTab';
import ProcessesTab, { buildWatchRows, filterWatchRows } from '../../../src/modules/teams/ProcessesTab';
import SupervisorTab from '../../../src/modules/teams/SupervisorTab';
import TeamsShell from '../../../src/modules/teams/TeamsShell';
import TerminalTab from '../../../src/modules/teams/TerminalTab';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

// ── Mock @/ui to capture Select onChange handlers ────────────────────────
// happy-dom + React 19 do not deliver fireEvent.change to a controlled
// select's onChange (capricorn86/happy-dom#856). Instead of reading
// __reactProps$ (fragile across React versions), we replace the Select
// component with a native <select> that captures its onChange via a ref.

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

        const { variant: _v, size: _s, ...rest } = props;

        return (
            <select
                {...rest}
                ref={ref}
                onChange={(e) => {
                    (props.onChange as ((e: unknown) => void) | undefined)?.(e);
                }}
            >
                {props.children as React.ReactNode}
            </select>
        );
    }

    return {
        ...RealUI,
        Select,
    };
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

let originalEventSource: typeof EventSource | undefined;

beforeAll(() => {
    registerHappyDom();
    originalEventSource = globalThis.EventSource;
});

beforeEach(() => {
    FakeEventSource.instances = [];
    // Drain attach intent so a prior Processes→Terminal test cannot hijack restore.
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
    // These tests mount polling components (Messages) and MemberTerminal,
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
    test('TeamsShell renders exactly the 5 v1 tabs with stable labels (0378)', async () => {
        setFetchForTesting((async () => jsonResponse({ teams: [] })) as unknown as typeof fetch);
        const { getByRole, container } = render(<TeamsShell />);

        for (const label of ['Supervisor', 'Terminal', 'Process', 'Message', 'Activity']) {
            expect(getByRole('tab', { name: label })).toBeDefined();
        }
        // The shell renders no more and no fewer than the 5 declared tabs.
        expect(container.querySelectorAll('[role="tab"]').length).toBe(5);
        // 0269 R1: shared TeamControlStrip is gone from the shell.
        expect(container.querySelector('[data-team-control-strip]')).toBeNull();
    });

    // ── ProcessesTab (0262 + 0264 registry) ────────────────────────────────
    test('ProcessesTab renders supervised process rows from /api/team/processes (0262 AC)', async () => {
        const processCalls: string[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/team/processes')) {
                processCalls.push(url);
                return jsonResponse({
                    processes: [
                        {
                            agentId: 'planner',
                            pid: 4242,
                            status: 'running',
                            startedAt: '2026-07-15T12:00:00.000Z',
                            exitCode: null,
                        },
                        {
                            agentId: 'builder',
                            pid: 4243,
                            status: 'exited',
                            startedAt: '2026-07-15T11:00:00.000Z',
                            exitCode: 0,
                        },
                    ],
                    count: 2,
                    executions: [],
                    executionsCount: 0,
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { getByText, container } = render(<ProcessesTab />);

        await waitFor(() => expect(getByText('planner')).toBeDefined());
        expect(getByText('builder')).toBeDefined();
        expect(getByText('4242')).toBeDefined();
        expect(getByText('4243')).toBeDefined();
        expect(getByText('running')).toBeDefined();
        expect(getByText('exited')).toBeDefined();
        // Header labels process watch list (registry-backed after 0264).
        const root = container.querySelector('[data-processes-tab]');
        expect(root?.textContent).toContain('Process watch list');
        expect(root?.textContent).toContain('ProcessExecutor registry');
        // Polled team processes endpoint, not the full observability tree.
        expect(processCalls.some((u) => u.includes('/team/processes'))).toBe(true);
        expect(processCalls.some((u) => u.includes('/observability/processes'))).toBe(false);
        // Attach action present on each supervised row.
        expect(container.querySelectorAll('[data-processes-attach-btn]').length).toBe(0);
    });

    test('ProcessesTab shows registry one-shots alongside supervised rows (0264)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/team/processes')) {
                return jsonResponse({
                    processes: [
                        {
                            agentId: 'planner',
                            pid: 4242,
                            status: 'running',
                            startedAt: '2026-07-15T12:00:00.000Z',
                            exitCode: null,
                        },
                    ],
                    count: 1,
                    executions: [
                        {
                            id: 'pe_1',
                            label: 'git.status',
                            command: 'git',
                            args: ['status'],
                            pid: 99,
                            status: 'exited',
                            startedAt: '2026-07-15T12:01:00.000Z',
                            exitedAt: '2026-07-15T12:01:01.000Z',
                            exitCode: 0,
                            source: 'one-shot',
                            teamId: null,
                            agentId: null,
                        },
                        // Duplicate of supervised agent — should be de-duped by agentId.
                        {
                            id: 'pe_2',
                            label: 'agent:planner',
                            command: 'bun',
                            args: [],
                            pid: 4242,
                            status: 'running',
                            startedAt: '2026-07-15T12:00:00.000Z',
                            exitedAt: null,
                            exitCode: null,
                            source: 'supervisor',
                            teamId: null,
                            agentId: 'planner',
                        },
                    ],
                    executionsCount: 2,
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { getByText, container } = render(<ProcessesTab />);

        await waitFor(() => expect(getByText('planner')).toBeDefined());
        expect(getByText('git.status')).toBeDefined();
        // Source cell for the one-shot row (filter dropdown also labels "one-shot").
        expect(container.querySelector('[data-process-source="one-shot"]')).not.toBeNull();
        // Supervised row still has Start/Stop; one-shot has no control buttons.
        // Rows are read-only (0269 Plan 4) — no toggle or attach controls.
        expect(container.querySelectorAll('[data-processes-toggle-btn]').length).toBe(0);
        expect(container.querySelectorAll('[data-processes-attach-btn]').length).toBe(0);
    });

    test('ProcessesTab shows empty state when no supervised processes (0262 edge)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/team/processes')) {
                return jsonResponse({ processes: [], count: 0, executions: [], executionsCount: 0 });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { getByText, container } = render(<ProcessesTab />);

        await waitFor(() => expect(getByText(/No processes/)).toBeDefined());
        // 0263 R3: empty copy includes actionable guidance (no stale Roster refs).
        expect(getByText(/spur team start/)).toBeDefined();
        expect(container.querySelector('[data-processes-tab-empty]')).not.toBeNull();
        expect(container.querySelector('[data-processes-tab-loading]')).toBeNull();
    });

    // ── ProcessesTab filter UI (0267 R2, R4) ───────────────────────────────

    test('ProcessesTab renders filter controls and team column (0267 R2)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/team/processes')) {
                return jsonResponse({
                    processes: [
                        {
                            agentId: 'alpha',
                            pid: 1,
                            status: 'running',
                            startedAt: '2026-07-15T12:00:00Z',
                            exitCode: null,
                            teamId: 'red',
                        },
                    ],
                    count: 1,
                    executions: [],
                    executionsCount: 0,
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<ProcessesTab />);

        await waitFor(() => expect(container.querySelector('[data-processes-tab]')).not.toBeNull());
        // Filter controls present.
        expect(container.querySelector('[data-processes-filters]')).not.toBeNull();
        expect(container.querySelector('[data-processes-filter-running-input]')).not.toBeNull();
        expect(container.querySelector('[data-processes-filter-source]')).not.toBeNull();
        expect(container.querySelector('[data-processes-filter-team]')).not.toBeNull();
        // Team column shows the teamId.
        expect(container.querySelector('[data-process-team="red"]')).not.toBeNull();
    });

    test('running-only checkbox hides non-running rows (0267 R2)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/team/processes')) {
                return jsonResponse({
                    processes: [
                        {
                            agentId: 'runner',
                            pid: 1,
                            status: 'running',
                            startedAt: '2026-07-15T12:00:00Z',
                            exitCode: null,
                            teamId: null,
                        },
                        {
                            agentId: 'stopped',
                            pid: 2,
                            status: 'exited',
                            startedAt: '2026-07-15T12:00:00Z',
                            exitCode: 0,
                            teamId: null,
                        },
                    ],
                    count: 2,
                    executions: [],
                    executionsCount: 0,
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<ProcessesTab />);

        await waitFor(() => expect(container.querySelector('[data-processes-row="sup:runner"]')).not.toBeNull());
        expect(container.querySelector('[data-processes-row="sup:stopped"]')).not.toBeNull();

        // Toggle running-only.
        const checkbox = container.querySelector('[data-processes-filter-running-input]') as HTMLInputElement;
        act(() => fireEvent.click(checkbox));

        // stopped row hidden, runner still visible.
        await waitFor(() => expect(container.querySelector('[data-processes-row="sup:stopped"]')).toBeNull());
        expect(container.querySelector('[data-processes-row="sup:runner"]')).not.toBeNull();
    });

    test('team filter narrows rows to the selected team (0267 R2)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/team/processes')) {
                return jsonResponse({
                    processes: [
                        {
                            agentId: 'alpha',
                            pid: 1,
                            status: 'running',
                            startedAt: '2026-07-15T12:00:00Z',
                            exitCode: null,
                            teamId: 'red',
                        },
                        {
                            agentId: 'beta',
                            pid: 2,
                            status: 'running',
                            startedAt: '2026-07-15T12:00:00Z',
                            exitCode: null,
                            teamId: 'blue',
                        },
                    ],
                    count: 2,
                    executions: [],
                    executionsCount: 0,
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<ProcessesTab />);

        await waitFor(() => expect(container.querySelector('[data-processes-row="sup:alpha"]')).not.toBeNull());

        // Select team=red via native select.
        const select = container.querySelector('[data-processes-filter-team]') as HTMLSelectElement;
        act(() => fireEvent.change(select, { target: { value: 'red' } }));

        await waitFor(() => expect(container.querySelector('[data-processes-row="sup:beta"]')).toBeNull());
        expect(container.querySelector('[data-processes-row="sup:alpha"]')).not.toBeNull();
    });

    test('filters hiding all rows show the no-matches empty state (0267 R4)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/team/processes')) {
                return jsonResponse({
                    processes: [
                        {
                            agentId: 'alpha',
                            pid: 1,
                            status: 'exited',
                            startedAt: '2026-07-15T12:00:00Z',
                            exitCode: 0,
                            teamId: null,
                        },
                    ],
                    count: 1,
                    executions: [],
                    executionsCount: 0,
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<ProcessesTab />);

        await waitFor(() => expect(container.querySelector('[data-processes-row="sup:alpha"]')).not.toBeNull());

        // Toggle running-only — the only row is exited, so nothing matches.
        const checkbox = container.querySelector('[data-processes-filter-running-input]') as HTMLInputElement;
        act(() => fireEvent.click(checkbox));

        await waitFor(() => expect(container.querySelector('[data-processes-tab-no-matches]')).not.toBeNull());
        // Filter controls still visible so the user can widen.
        expect(container.querySelector('[data-processes-filters]')).not.toBeNull();
    });

    // Regression guard for the 0260 Roster removal: RosterTab was the only writer of
    // the shared TeamsContext selection, so a MessagesTab that filters on that
    // selection can never leave its empty state in production. This renders the tab
    // exactly as the shell does — no provider, no preset selection — so a
    // reintroduced selection gate fails here instead of shipping a dead tab.
    test('MessagesTab renders the global feed with no selection present (0260 R3)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/messages')) {
                return jsonResponse({
                    messages: [
                        {
                            id: 'm1',
                            fromId: 'op',
                            toId: 'planner',
                            to: { agentId: 'planner' },
                            body: 'across-members',
                            status: 'sent',
                            createdAt: '2026-07-14T00:00:00.000Z',
                            inReplyTo: null,
                            hasReply: false,
                            replyCount: 0,
                        },
                    ],
                    count: 1,
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);
        const { getByText, queryByText, container } = render(<MessagesTab />);

        await waitFor(() => expect(getByText('across-members')).toBeDefined());
        // The dead-end placeholder pointed at a tab that no longer exists.
        expect(queryByText(/Select a member from the Roster/)).toBeNull();
        // Feed spans recipients, so each row must name who it was addressed to.
        const route = container.querySelector('[data-message-route]');
        expect(route).not.toBeNull();
        expect(route?.textContent).toContain('op');
        expect(route?.textContent).toContain('planner');
        // 0269 R8: every card shows reply state (Awaiting when hasReply is false).
        const replyBadge = container.querySelector('[data-message-reply-badge]');
        expect(replyBadge?.textContent).toContain('Awaiting reply');
        expect(replyBadge?.getAttribute('data-message-reply-state')).toBe('awaiting');
    });

    test('parseMessagesFeed narrows untrusted rows and defaults missing reply fields (0269 C)', () => {
        const parsed = parseMessagesFeed({
            messages: [
                {
                    id: 'm1',
                    fromId: 'a',
                    toId: 'b',
                    body: 'hi',
                    status: 'queued',
                    createdAt: 't',
                    // no hasReply / replyCount / to identity
                },
                { id: 1, body: 'bad' }, // dropped
            ],
        });
        expect(parsed).not.toBeNull();
        expect(parsed?.length).toBe(1);
        expect(parsed?.[0]?.to.agentId).toBe('b');
        expect(parsed?.[0]?.hasReply).toBe(false);
        expect(parsed?.[0]?.replyCount).toBe(0);
        expect(parseMessagesFeed(null)).toBeNull();
        expect(parseMessagesFeed({ messages: 'nope' })).toBeNull();
    });

    test('MessagesTab shows identity, delivery chip, and Replied badge (0269 R8)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/messages')) {
                return jsonResponse({
                    messages: [
                        {
                            id: 'm1',
                            fromId: 'alpha-planner',
                            toId: 'alpha-coder',
                            from: {
                                agentId: 'alpha-planner',
                                teamName: 'Alpha',
                                memberLabel: 'planner',
                                agentType: 'claude',
                            },
                            to: {
                                agentId: 'alpha-coder',
                                teamName: 'Alpha',
                                memberLabel: 'coder',
                                agentType: 'codex',
                            },
                            body: 'do the thing',
                            status: 'injected',
                            createdAt: '2026-07-16T00:00:00.000Z',
                            inReplyTo: null,
                            hasReply: true,
                            replyCount: 2,
                        },
                    ],
                    count: 1,
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container, getByText } = render(<MessagesTab />);
        await waitFor(() => expect(getByText('do the thing')).toBeDefined());
        const route = container.querySelector('[data-message-route]');
        expect(route?.textContent).toContain('Alpha');
        expect(route?.textContent).toContain('planner');
        expect(route?.textContent).toContain('coder');
        expect(container.querySelector('[data-message-delivery]')?.textContent).toContain('injected');
        const reply = container.querySelector('[data-message-reply-badge]');
        expect(reply?.getAttribute('data-message-reply-state')).toBe('replied');
        expect(reply?.textContent).toContain('Replied');
        expect(reply?.textContent).toContain('2');
    });

    test('MessagesTab reads the unfiltered feed, not a per-agent inbox (0260 R3)', async () => {
        const urls: string[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            urls.push(url);
            return jsonResponse({ messages: [], count: 0 });
        }) as unknown as typeof fetch);

        render(<MessagesTab />);

        await waitFor(() => expect(urls.length).toBeGreaterThan(0));
        // An `?agent=` query would re-couple the tab to a per-member selection.
        expect(urls.some((u) => u.includes('/messages/inbox'))).toBe(false);
        expect(urls.some((u) => u.includes('agent='))).toBe(false);
    });

    test('MessagesTab refetches the global feed on a message.sent SSE event (0254 AC5/R6)', async () => {
        let secondVisible = false;
        const feedCalls: string[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/messages')) {
                feedCalls.push(url);
                const messages = [
                    {
                        id: 'm1',
                        fromId: 'op',
                        toId: 'planner',
                        to: { agentId: 'planner' },
                        body: 'first',
                        status: 'sent',
                        createdAt: '2026-07-14T00:00:00.000Z',
                        inReplyTo: null,
                        hasReply: false,
                        replyCount: 0,
                    },
                    ...(secondVisible
                        ? [
                              {
                                  id: 'm2',
                                  fromId: 'op',
                                  toId: 'builder',
                                  to: { agentId: 'builder' },
                                  body: 'live-arrived',
                                  status: 'sent',
                                  createdAt: '2026-07-14T00:01:00.000Z',
                                  inReplyTo: null,
                                  hasReply: false,
                                  replyCount: 0,
                              },
                          ]
                        : []),
                ];
                return jsonResponse({ messages, count: messages.length });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { getByText } = render(<MessagesTab />);

        await waitFor(() => expect(getByText('first')).toBeDefined());
        const before = feedCalls.length;
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
        expect(feedCalls.length).toBeGreaterThan(before);
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
        // Member options show id + type only — no status text (0269 R3).
        expect(memberSelect.innerHTML).toContain('planner');
        expect(memberSelect.innerHTML).toContain('claude');
        expect(memberSelect.innerHTML).not.toContain('running');

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

        // 0269 R2/R4: left focus + right roster; model hidden when unset; chips select.
        expect(container.querySelector('[data-terminal-focus]')).not.toBeNull();
        expect(container.querySelector('[data-terminal-roster]')).not.toBeNull();
        expect(container.querySelector('[data-terminal-model]')).toBeNull();
        expect(container.querySelectorAll('[data-terminal-roster-chip]').length).toBe(2);
        expect(container.querySelector('[data-terminal-up-btn]')).not.toBeNull();
        expect(container.querySelector('[data-terminal-down-btn]')).not.toBeNull();

        act(() => {
            const chip = container.querySelector(
                '[data-terminal-roster-chip][title="coder · codex"]',
            ) as HTMLButtonElement | null;
            chip?.click();
        });
        await waitFor(() => {
            const member = container.querySelector('[data-terminal-member-select]') as HTMLSelectElement | null;
            expect(member?.value).toBe('coder');
        });
    });

    test('TerminalTab shows model field only when member model is set (0269 edge)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const req = input instanceof Request ? input : new Request(String(input));
            if (req.url.includes('/team/teams')) {
                return jsonResponse({
                    teams: [
                        {
                            teamId: 'alpha',
                            name: 'Alpha',
                            members: [
                                { id: 'planner', type: 'claude', status: 'running', model: 'sonnet' },
                                { id: 'coder', type: 'codex', status: 'stopped' },
                            ],
                        },
                    ],
                });
            }
            if (req.url.includes('/team/processes')) return jsonResponse({ processes: [] });
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<TerminalTab />);
        await waitFor(() => expect(container.querySelector('[data-terminal-team-select]')).not.toBeNull());
        act(() => getSelectOnChange('team')?.({ target: { value: 'alpha' } }));
        await waitFor(() => {
            const el = container.querySelector('[data-terminal-member-select]') as HTMLSelectElement | null;
            expect(el?.options.length ?? 0).toBeGreaterThan(1);
        });
        act(() => getSelectOnChange('member')?.({ target: { value: 'planner' } }));
        await waitFor(() => {
            const model = container.querySelector('[data-terminal-model]');
            expect(model?.textContent).toContain('sonnet');
        });
        act(() => getSelectOnChange('member')?.({ target: { value: 'coder' } }));
        await waitFor(() => {
            expect(container.querySelector('[data-terminal-model]')).toBeNull();
        });
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

    test('TerminalTab restores persisted team+member from localStorage on mount (0263 R2)', async () => {
        const key = 'spur:board:teams:lastTerminal';
        // Seed a known selection; do not restore prior value mid-suite — always clear after.
        globalThis.localStorage?.setItem(key, JSON.stringify({ teamId: 'alpha', memberId: 'planner' }));
        expect(globalThis.localStorage?.getItem(key)).toContain('planner');

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

        const { container } = render(<TerminalTab />);

        // Positive assertion first: wait for MemberTerminal for the restored member.
        // CI (ubuntu) can exceed the default 1000ms waitFor budget for the React 19 chain
        // useTeamsData fetch → setState → restore effect → setTeamId/setMemberId → remount.
        // Prefer data attributes over queryByText (empty-state copy is brittle under timeout noise).
        await waitFor(
            () => {
                expect(container.querySelector('[data-member-terminal="planner"]')).not.toBeNull();
            },
            { timeout: 5000 },
        );
        expect(container.querySelector('[data-terminal-tab-prompt]')).toBeNull();
        expect(container.querySelector('[data-terminal-member-select]')?.innerHTML).toContain('planner');

        globalThis.localStorage?.removeItem(key);
    });

    test('TerminalTab persists selection to localStorage on change (0263 R1)', async () => {
        const key = 'spur:board:teams:lastTerminal';
        globalThis.localStorage?.removeItem(key);

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

        const { container } = render(<TerminalTab />);

        await waitFor(() => {
            expect(container.querySelector('[data-terminal-team-select]')).not.toBeNull();
        });
        act(() => getSelectOnChange('team')?.({ target: { value: 'alpha' } }));
        await waitFor(() => {
            const el = container.querySelector('[data-terminal-member-select]') as HTMLSelectElement | null;
            expect(el?.options.length).toBeGreaterThan(1);
        });
        act(() => getSelectOnChange('member')?.({ target: { value: 'planner' } }));

        await waitFor(() => {
            const raw = globalThis.localStorage?.getItem(key);
            expect(raw).not.toBeNull();
            expect(JSON.parse(raw ?? '{}')).toEqual({ teamId: 'alpha', memberId: 'planner' });
        });

        globalThis.localStorage?.removeItem(key);
    });

    test('TerminalTab rejects stale localStorage selection and clears it (0263 R2)', async () => {
        const key = 'spur:board:teams:lastTerminal';
        globalThis.localStorage?.setItem(key, JSON.stringify({ teamId: 'alpha', memberId: 'ghost-member' }));

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

        const { getByText, container } = render(<TerminalTab />);

        // Invalid member is not restored — prompt remains.
        await waitFor(() => expect(getByText('Choose a team and member above to open a terminal.')).toBeDefined());
        const memberSelect = container.querySelector('[data-terminal-member-select]') as HTMLSelectElement | null;
        expect(memberSelect?.value ?? '').toBe('');
        // Stale entry is cleared so the next reload stays clean.
        await waitFor(() => expect(globalThis.localStorage?.getItem(key)).toBeNull());
    });

    test('ActivityTab renders team/message/process events and filters out unrelated telemetry (0254 R7 + 0269 R9)', async () => {
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
                        {
                            id: 'e4',
                            eventName: 'process.spawned',
                            occurredAt: '2026-07-14T00:03:00.000Z',
                            actor: 'alpha-planner',
                            payload: { teamId: 'alpha', memberLabel: 'planner', agentType: 'claude' },
                        },
                    ],
                    count: 4,
                });
            }
            if (url.includes('/team/teams')) {
                return jsonResponse({
                    teams: [
                        {
                            teamId: 'alpha',
                            name: 'Alpha',
                            members: [{ id: 'alpha-planner', type: 'claude', status: 'running' }],
                        },
                    ],
                });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const { getByText, queryByText, container } = render(<ActivityTab />);

        await waitFor(() => expect(getByText('agent.started')).toBeDefined());
        expect(getByText('message.sent')).toBeDefined();
        expect(getByText('process.spawned')).toBeDefined();
        // System-wide telemetry (task.*) stays on Observability — filtered out here.
        expect(queryByText('task.created')).toBeNull();
        // Identity columns present (0269 R9).
        expect(container.textContent).toContain('Team');
        expect(container.textContent).toContain('Member');
        expect(container.textContent).toContain('Agent');
        expect(getByText('alpha')).toBeDefined();
        expect(getByText('claude')).toBeDefined();
    });

    test('buildRosterIndex + enrichRowFromRoster fill missing identity from actor (0269 R9)', () => {
        const roster = buildRosterIndex([
            {
                teamId: 'alpha',
                name: 'Alpha',
                members: [{ id: 'alpha-planner', type: 'claude', status: 'running' }],
            },
        ]);
        const enriched = enrichRowFromRoster(
            {
                id: 'x',
                eventName: 'process.stopped',
                occurredAt: 't',
                actor: 'alpha-planner',
            },
            roster,
        );
        expect(enriched.teamId).toBe('alpha');
        expect(enriched.memberLabel).toBe('alpha-planner');
        expect(enriched.agentType).toBe('claude');
        // Payload values win.
        const keep = enrichRowFromRoster(
            {
                id: 'y',
                eventName: 'process.stopped',
                occurredAt: 't',
                actor: 'alpha-planner',
                teamId: 'beta',
                memberLabel: 'other',
                agentType: 'codex',
            },
            roster,
        );
        expect(keep.teamId).toBe('beta');
        expect(keep.memberLabel).toBe('other');
        expect(keep.agentType).toBe('codex');
    });

    test('toRow maps process payload teamId/agentId/agentType (0269 P4 residual)', () => {
        const row = toRow({
            id: 'e1',
            eventName: 'process.spawned',
            occurredAt: '2026-07-16T00:00:00.000Z',
            actor: null,
            payload: { agentId: 'alpha-planner', teamId: 'alpha', agentType: 'claude', pid: 9 },
        });
        expect(row).not.toBeNull();
        expect(row?.actor).toBe('alpha-planner');
        expect(row?.teamId).toBe('alpha');
        expect(row?.memberLabel).toBe('alpha-planner');
        expect(row?.agentType).toBe('claude');
    });

    test('prependActivityRow caps live buffer at MAX_ACTIVITY_ROWS (0269 P4 residual)', () => {
        let rows: ReturnType<typeof prependActivityRow> | null = null;
        for (let i = 0; i < MAX_ACTIVITY_ROWS + 25; i++) {
            rows = prependActivityRow(rows, {
                id: `r${i}`,
                eventName: 'process.spawned',
                occurredAt: `t${i}`,
                actor: 'a',
            });
        }
        expect(rows?.length).toBe(MAX_ACTIVITY_ROWS);
        // Newest first.
        expect(rows?.[0]?.id).toBe(`r${MAX_ACTIVITY_ROWS + 24}`);
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

    describe('buildWatchRows + filterWatchRows (0267)', () => {
        const supervised = [
            {
                agentId: 'alpha',
                pid: 100,
                status: 'running',
                startedAt: '2026-07-15T00:00:00Z',
                exitCode: null,
                teamId: 'red',
            },
            {
                agentId: 'beta',
                pid: 101,
                status: 'exited',
                startedAt: '2026-07-15T00:00:00Z',
                exitCode: 0,
                teamId: null,
            },
        ];
        const executions = [
            {
                id: 'e1',
                label: 'one-shot',
                command: 'run',
                args: [],
                pid: 200,
                status: 'running',
                startedAt: '2026-07-15T00:00:00Z',
                exitedAt: null,
                exitCode: null,
                source: 'one-shot',
                teamId: 'blue',
                agentId: null,
            },
            {
                id: 'e2',
                label: 'sidecar',
                command: 'run',
                args: [],
                pid: 201,
                status: 'running',
                startedAt: '2026-07-15T00:00:00Z',
                exitedAt: null,
                exitCode: null,
                source: 'serve',
                teamId: null,
                agentId: 'gamma',
            },
        ];

        test('buildWatchRows threads teamId from both supervised and registry rows', () => {
            const rows = buildWatchRows(supervised, executions);
            const byKey = new Map(rows.map((r) => [r.key, r]));
            expect(byKey.get('sup:alpha')?.teamId).toBe('red');
            expect(byKey.get('sup:beta')?.teamId).toBeNull();
            expect(byKey.get('reg:e1')?.teamId).toBe('blue');
            expect(byKey.get('reg:e2')?.teamId).toBeNull();
        });

        test('runningOnly filter hides non-running rows', () => {
            const rows = buildWatchRows(supervised, executions);
            const filtered = filterWatchRows(rows, { runningOnly: true, source: 'all', team: 'all' });
            const keys = filtered.map((r) => r.key);
            expect(keys).toContain('sup:alpha');
            expect(keys).toContain('reg:e1');
            expect(keys).toContain('reg:e2');
            // beta is exited — filtered out.
            expect(keys).not.toContain('sup:beta');
        });

        test('source=supervisor hides non-supervisor rows', () => {
            const rows = buildWatchRows(supervised, executions);
            const filtered = filterWatchRows(rows, { runningOnly: false, source: 'supervisor', team: 'all' });
            const keys = filtered.map((r) => r.key);
            expect(keys).toEqual(['sup:alpha', 'sup:beta']);
        });

        test('source=one-shot keeps only one-shot registry rows', () => {
            const rows = buildWatchRows(supervised, executions);
            const filtered = filterWatchRows(rows, { runningOnly: false, source: 'one-shot', team: 'all' });
            const keys = filtered.map((r) => r.key);
            expect(keys).toEqual(['reg:e1']);
        });

        test('source=other keeps rows that are neither supervisor nor one-shot', () => {
            const rows = buildWatchRows(supervised, executions);
            const filtered = filterWatchRows(rows, { runningOnly: false, source: 'other', team: 'all' });
            const keys = filtered.map((r) => r.key);
            expect(keys).toEqual(['reg:e2']);
        });

        test('team filter narrows to a specific team', () => {
            const rows = buildWatchRows(supervised, executions);
            const filtered = filterWatchRows(rows, { runningOnly: false, source: 'all', team: 'red' });
            expect(filtered.map((r) => r.key)).toEqual(['sup:alpha']);
        });

        test('team=unassigned selects only rows with null teamId', () => {
            const rows = buildWatchRows(supervised, executions);
            const filtered = filterWatchRows(rows, { runningOnly: false, source: 'all', team: 'unassigned' });
            const keys = filtered.map((r) => r.key);
            expect(keys).toContain('sup:beta');
            expect(keys).toContain('reg:e2');
            expect(keys).not.toContain('sup:alpha');
            expect(keys).not.toContain('reg:e1');
        });

        test('combined runningOnly + team filter intersects correctly', () => {
            const rows = buildWatchRows(supervised, executions);
            const filtered = filterWatchRows(rows, { runningOnly: true, source: 'all', team: 'unassigned' });
            // Only reg:e2 is both running AND unassigned (beta is exited).
            expect(filtered.map((r) => r.key)).toEqual(['reg:e2']);
        });

        test('all-pass filter returns every row unchanged', () => {
            const rows = buildWatchRows(supervised, executions);
            const filtered = filterWatchRows(rows, { runningOnly: false, source: 'all', team: 'all' });
            expect(filtered).toHaveLength(rows.length);
        });
    });

    // ── SupervisorTab (0378) ──────────────────────────────────────────────

    test('SupervisorTab renders as the default-active tab in TeamsShell (0378 R1)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/team/teams')) {
                return jsonResponse({ teams: [{ teamId: 'alpha', name: 'Alpha', members: [] }] });
            }
            if (url.includes('/events/history')) return jsonResponse({ events: [] });
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<TeamsShell />);

        // Supervisor tab button is the first tab and is selected by default.
        const supTab = await waitFor(() => {
            const el = container.querySelector('[role="tab"][aria-selected="true"]') as HTMLElement | null;
            expect(el).not.toBeNull();
            return el as HTMLElement;
        });
        expect(supTab.textContent).toContain('Supervisor');
        // Supervisor panel is rendered.
        await waitFor(() => expect(container.querySelector('[data-supervisor-tab]')).not.toBeNull());
    });

    test('SupervisorTab shows team roster with member id, type, and running/stopped status (0378 R2)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/team/teams')) {
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
            if (url.includes('/events/history')) return jsonResponse({ events: [] });
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container, getByText } = render(<SupervisorTab />);

        await waitFor(() => expect(container.querySelector('[data-supervisor-tab]')).not.toBeNull());

        // Team name is visible.
        expect(getByText('Alpha')).toBeDefined();
        // Both members rendered with their ids.
        expect(container.querySelector('[data-supervisor-member-row="planner"]')).not.toBeNull();
        expect(container.querySelector('[data-supervisor-member-row="coder"]')).not.toBeNull();
        // Running member shows running badge; stopped shows stopped.
        const plannerRow = container.querySelector('[data-supervisor-member-row="planner"]') as HTMLElement;
        expect(plannerRow.textContent).toContain('running');
        expect(plannerRow.textContent).toContain('claude');
        const coderRow = container.querySelector('[data-supervisor-member-row="coder"]') as HTMLElement;
        expect(coderRow.textContent).toContain('stopped');
        expect(coderRow.textContent).toContain('codex');
    });

    test('SupervisorTab shows per-member uptime and last activity from events (0378 R3)', async () => {
        const startedIso = '2026-07-20T10:00:00.000Z';
        const activityIso = '2026-07-20T10:05:00.000Z';
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
            if (url.includes('/events/history')) {
                return jsonResponse({
                    events: [
                        {
                            id: 'evt-1',
                            eventName: 'team.member.started',
                            occurredAt: startedIso,
                            actor: 'planner',
                            payload: { teamId: 'alpha', memberLabel: 'planner' },
                        },
                        {
                            id: 'evt-2',
                            eventName: 'agent.completed',
                            occurredAt: activityIso,
                            actor: 'planner',
                            payload: { teamId: 'alpha', memberLabel: 'planner' },
                        },
                    ],
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<SupervisorTab />);

        // Uptime element exists and shows "up" prefix.
        const uptimeEl = await waitFor(() => {
            const el = container.querySelector('[data-supervisor-uptime="planner"]') as HTMLElement | null;
            expect(el).not.toBeNull();
            return el as HTMLElement;
        });
        expect(uptimeEl.textContent).toContain('up ');
        expect(uptimeEl.textContent).not.toBe('up -');

        // Last activity shows the event name.
        const lastActEl = container.querySelector('[data-supervisor-last-activity="planner"]') as HTMLElement;
        expect(lastActEl.textContent).toContain('agent.completed');
    });

    test('SupervisorTab reflects live SSE events by updating last activity (0378 R4)', async () => {
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
            if (url.includes('/events/history')) return jsonResponse({ events: [] });
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<SupervisorTab />);

        await waitFor(() => expect(container.querySelector('[data-supervisor-tab]')).not.toBeNull());

        // Initially no last activity.
        let lastActEl = container.querySelector('[data-supervisor-last-activity="planner"]') as HTMLElement;
        expect(lastActEl.textContent).toContain('last: -');

        // Simulate a live SSE event.
        await act(async () => {
            const es = FakeEventSource.instances[0];
            expect(es).toBeDefined();
            const esInstance = es as FakeEventSource;
            esInstance.onmessage?.({
                data: JSON.stringify({
                    id: 'evt-live',
                    eventName: 'agent.completed',
                    occurredAt: '2026-07-20T11:00:00.000Z',
                    actor: 'planner',
                    payload: { teamId: 'alpha', memberLabel: 'planner' },
                }),
            } as MessageEvent);
        });

        // Last activity should now show the event name.
        await waitFor(() => {
            lastActEl = container.querySelector('[data-supervisor-last-activity="planner"]') as HTMLElement;
            expect(lastActEl.textContent).toContain('agent.completed');
        });
    });

    test('SupervisorTab start button POSTs start URL for stopped member (0378 R5)', async () => {
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
            if (req.url.includes('/events/history')) return jsonResponse({ events: [] });
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<SupervisorTab />);

        const toggleBtn = await waitFor(() => {
            const el = container.querySelector('[data-supervisor-toggle="coder"]') as HTMLButtonElement | null;
            expect(el).not.toBeNull();
            return el as HTMLButtonElement;
        });
        expect(toggleBtn.textContent).toContain('Start');
        act(() => fireEvent.click(toggleBtn));

        // No confirmation modal for start.
        expect(container.querySelector('[data-stop-confirm-modal]')).toBeNull();

        await waitFor(() =>
            expect(posts.some((p) => p.url.includes('/team/agents/coder/start') && p.method === 'POST')).toBe(true),
        );
    });

    test('SupervisorTab stop button shows confirmation modal before POSTing stop (0378 R5)', async () => {
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
            if (req.url.includes('/events/history')) return jsonResponse({ events: [] });
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<SupervisorTab />);

        const toggleBtn = await waitFor(() => {
            const el = container.querySelector('[data-supervisor-toggle="planner"]') as HTMLButtonElement | null;
            expect(el).not.toBeNull();
            return el as HTMLButtonElement;
        });
        expect(toggleBtn.textContent).toContain('Stop');
        act(() => fireEvent.click(toggleBtn));

        // Confirmation modal appears.
        const modal = await waitFor(() => {
            const el = container.querySelector('[data-stop-confirm-modal]') as HTMLElement | null;
            expect(el).not.toBeNull();
            return el as HTMLElement;
        });
        expect(modal.textContent).toContain('Stop member?');
        expect(posts.filter((p) => p.url.includes('/stop'))).toHaveLength(0);

        // Confirm -> stop POST fires.
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

    test('SupervisorTab Up button POSTs team up URL (0378 R5)', async () => {
        const posts: { url: string; method: string }[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const req = input instanceof Request ? input : new Request(String(input));
            if (req.url.includes('/team/teams')) {
                return jsonResponse({
                    teams: [
                        {
                            teamId: 'alpha',
                            name: 'Alpha',
                            members: [{ id: 'planner', type: 'claude', status: 'stopped' }],
                        },
                    ],
                });
            }
            if (req.method === 'POST') posts.push({ url: req.url, method: req.method });
            if (req.url.includes('/events/history')) return jsonResponse({ events: [] });
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<SupervisorTab />);

        const upBtn = await waitFor(() => {
            const el = container.querySelector('[data-supervisor-team-up="alpha"]') as HTMLButtonElement | null;
            expect(el).not.toBeNull();
            return el as HTMLButtonElement;
        });
        act(() => fireEvent.click(upBtn));

        await waitFor(() =>
            expect(posts.some((p) => p.url.includes('/team/alpha/up') && p.method === 'POST')).toBe(true),
        );
    });

    test('SupervisorTab Down button shows confirmation modal before POSTing down (0378 R5)', async () => {
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
            if (req.url.includes('/events/history')) return jsonResponse({ events: [] });
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<SupervisorTab />);

        const downBtn = await waitFor(() => {
            const el = container.querySelector('[data-supervisor-team-down="alpha"]') as HTMLButtonElement | null;
            expect(el).not.toBeNull();
            return el as HTMLButtonElement;
        });
        act(() => fireEvent.click(downBtn));

        // Confirmation modal appears.
        const modal = await waitFor(() => {
            const el = container.querySelector('[data-down-confirm-modal]') as HTMLElement | null;
            expect(el).not.toBeNull();
            return el as HTMLElement;
        });
        expect(modal.textContent).toContain('Bring team down?');
        expect(posts.filter((p) => p.url.includes('/down'))).toHaveLength(0);

        // Confirm -> down POST fires.
        const confirmBtn = await waitFor(() => {
            const el = container.querySelector('[data-down-confirm-confirm]') as HTMLButtonElement | null;
            expect(el).not.toBeNull();
            return el as HTMLButtonElement;
        });
        act(() => fireEvent.click(confirmBtn));

        await waitFor(() =>
            expect(posts.some((p) => p.url.includes('/team/alpha/down') && p.method === 'POST')).toBe(true),
        );
    });

    test('SupervisorTab preserves event activity when the roster fetch fails (0378 R7/R24)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/team/teams')) {
                return new Response(JSON.stringify({ error: 'connection refused' }), {
                    status: 500,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (url.includes('/events/history')) {
                return jsonResponse({
                    events: [
                        {
                            id: 'activity-during-outage',
                            eventName: 'team.member.stopped',
                            occurredAt: '2026-07-29T12:00:00.000Z',
                            actor: 'planner',
                            payload: { teamId: 'alpha', memberLabel: 'planner', agentType: 'claude' },
                        },
                    ],
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<SupervisorTab />);

        await waitFor(() => expect(container.querySelector('[data-supervisor-tab-error]')).not.toBeNull());
        const errEl = container.querySelector('[data-supervisor-tab-error]') as HTMLElement;
        expect(errEl.textContent).toContain('Failed to load teams');
        await waitFor(() =>
            expect(container.querySelector('[data-supervisor-activity-row="team.member.stopped"]')).not.toBeNull(),
        );
    });

    test('SupervisorTab narrows untrusted event payload without crashing (0378 R7)', async () => {
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
            if (url.includes('/events/history')) {
                // Malformed events array - toRow should reject all, no crash.
                return jsonResponse({
                    events: [
                        null,
                        'not-an-object',
                        { id: 123, eventName: 'team.member.started' },
                        {
                            id: 'good',
                            eventName: 'agent.started',
                            occurredAt: '2026-07-20T10:00:00Z',
                            actor: 'planner',
                        },
                    ],
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<SupervisorTab />);

        // Component renders without crashing despite malformed events.
        await waitFor(() => expect(container.querySelector('[data-supervisor-tab]')).not.toBeNull());
        expect(container.querySelector('[data-supervisor-member-row="planner"]')).not.toBeNull();
    });

    test('SupervisorTab shows empty roster message for team with no members (0378 R6)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/team/teams')) {
                return jsonResponse({
                    teams: [{ teamId: 'empty', name: 'Empty', members: [] }],
                });
            }
            if (url.includes('/events/history')) return jsonResponse({ events: [] });
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<SupervisorTab />);

        await waitFor(() => expect(container.querySelector('[data-supervisor-empty-roster="empty"]')).not.toBeNull());
        const el = container.querySelector('[data-supervisor-empty-roster="empty"]') as HTMLElement;
        expect(el.textContent).toContain('No members configured');
    });
});
