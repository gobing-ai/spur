import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type React from 'react';
import { useEffect, useRef } from 'react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import ActivityTab from '../../../src/modules/teams/ActivityTab';
import MessagesTab from '../../../src/modules/teams/MessagesTab';
import ProcessesTab, { buildWatchRows, filterWatchRows } from '../../../src/modules/teams/ProcessesTab';
import TeamControlStrip from '../../../src/modules/teams/TeamControlStrip';
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
            if (key.startsWith('data-') || key === 'disabled' || key === 'className' || key === 'aria-label') {
                rest[key] = props[key];
            }
        }
        rest.ref = ref;
        rest.value = props.value;
        // Pass a no-op onChange to suppress React's "value without onChange"
        // warning. The real onChange is captured via ref above.
        rest.onChange = () => {};

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

    function Loading(_props: Record<string, unknown>) {
        return <span data-loading>Loading…</span>;
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

    return { Select, Button, Badge, Loading, Modal };
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
    test('TeamsShell renders exactly the 4 v1 tabs with stable labels (0262)', async () => {
        setFetchForTesting((async () => jsonResponse({ teams: [] })) as unknown as typeof fetch);
        const { getByRole, container } = render(<TeamsShell />);

        for (const label of ['Terminal', 'Processes', 'Messages', 'Activity']) {
            expect(getByRole('tab', { name: label })).toBeDefined();
        }
        // The shell renders no more and no fewer than the 4 declared tabs.
        expect(container.querySelectorAll('[role="tab"]').length).toBe(4);
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
        expect(container.querySelectorAll('[data-processes-attach-btn]').length).toBe(2);
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
        expect(container.querySelectorAll('[data-processes-toggle-btn]').length).toBe(1);
        // Only supervised agent gets Attach.
        expect(container.querySelectorAll('[data-processes-attach-btn]').length).toBe(1);
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

    test('ProcessesTab Attach dispatches teams:attach-process with agentId (0262 AC)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/team/processes')) {
                return jsonResponse({
                    processes: [
                        {
                            agentId: 'attach-me',
                            pid: 99,
                            status: 'running',
                            startedAt: '2026-07-15T12:00:00.000Z',
                            exitCode: null,
                        },
                    ],
                    count: 1,
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const seen: string[] = [];
        const listener = (ev: Event) => {
            const detail = (ev as CustomEvent<{ agentId: string }>).detail;
            seen.push(detail.agentId);
        };
        globalThis.addEventListener('teams:attach-process', listener);

        const { getByText, container } = render(<ProcessesTab />);
        await waitFor(() => expect(getByText('attach-me')).toBeDefined());

        const btn = container.querySelector('[data-processes-attach-btn]') as HTMLButtonElement;
        expect(btn).not.toBeNull();
        act(() => {
            fireEvent.click(btn);
        });

        expect(seen).toEqual(['attach-me']);
        globalThis.removeEventListener('teams:attach-process', listener);
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
                            body: 'across-members',
                            status: 'sent',
                            createdAt: '2026-07-14T00:00:00.000Z',
                            inReplyTo: null,
                        },
                    ],
                    count: 1,
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { getByText, queryByText } = render(<MessagesTab />);

        await waitFor(() => expect(getByText('across-members')).toBeDefined());
        // The dead-end placeholder pointed at a tab that no longer exists.
        expect(queryByText(/Select a member from the Roster/)).toBeNull();
        // Feed spans recipients, so each row must name who it was addressed to.
        expect(getByText('op → planner')).toBeDefined();
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
                                  toId: 'builder',
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

    test('TerminalTab restores persisted team+member from localStorage on mount (0263 R2)', async () => {
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
        // Assert via MemberTerminal mount + prompt dismissal — happy-dom controlled
        // <select>.value is unreliable under the @/ui Select mock.
        await waitFor(
            () => {
                expect(queryByText('Choose a team and member above to open a terminal.')).toBeNull();
            },
            { timeout: 3000 },
        );
        await waitFor(() => {
            expect(container.querySelector('[data-member-terminal="planner"]')).not.toBeNull();
        });
        expect(container.querySelector('[data-terminal-member-select]')?.innerHTML).toContain('planner');

        // Restore the original localStorage state.
        if (stored === null || stored === undefined) {
            globalThis.localStorage?.removeItem(key);
        } else {
            globalThis.localStorage?.setItem(key, stored);
        }
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

    test('TerminalTab listens for teams:attach-process and selects the member (0265 R1-R3, R5)', async () => {
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

        // Wait for teams to load so the listener has a snapshot to resolve against.
        await waitFor(() => {
            expect(container.querySelector('[data-terminal-team-select]')).not.toBeNull();
        });

        // No selection yet — prompt is visible.
        expect(queryByText('Choose a team and member above to open a terminal.')).not.toBeNull();

        // ProcessesTab dispatches this event; simulate it here.
        act(() => {
            globalThis.dispatchEvent(new CustomEvent('teams:attach-process', { detail: { agentId: 'planner' } }));
        });

        // MemberTerminal mounts for the attached agentId (R3).
        await waitFor(() => {
            expect(container.querySelector('[data-member-terminal="planner"]')).not.toBeNull();
        });

        // Selection persisted to localStorage (R5 — handled by existing persist effect).
        await waitFor(() => {
            const raw = globalThis.localStorage?.getItem(key);
            expect(raw).not.toBeNull();
            const parsed = JSON.parse(raw ?? '{}') as { teamId: string; memberId: string };
            expect(parsed).toEqual({ teamId: 'alpha', memberId: 'planner' });
        });
    });

    test('TerminalTab ignores teams:attach-process for unknown agentId (0265 edge, no crash)', async () => {
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

        const { container, queryByText } = render(<TerminalTab />);

        await waitFor(() => {
            expect(container.querySelector('[data-terminal-team-select]')).not.toBeNull();
        });

        // Dispatch for an agentId that is not in any team.
        expect(() => {
            act(() => {
                globalThis.dispatchEvent(
                    new CustomEvent('teams:attach-process', { detail: { agentId: 'ghost-agent' } }),
                );
            });
        }).not.toThrow();

        // Selection unchanged — prompt still visible, no MemberTerminal mounted.
        expect(queryByText('Choose a team and member above to open a terminal.')).not.toBeNull();
        expect(container.querySelector('[data-member-terminal]')).toBeNull();
        expect(globalThis.localStorage?.getItem(key)).toBeNull();
    });

    // Regression: the listener lives in TerminalTab, but TeamsShell renders only the
    // active tab — so Terminal is unmounted exactly when Attach is clicked in Processes.
    // Mounting TerminalTab directly hides that gap; this drives the operator's real path.
    test('Attach in Processes opens that member in Terminal via the shell (0265 @core AC)', async () => {
        globalThis.localStorage?.removeItem('spur:board:teams:lastTerminal');
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
                    executions: [],
                    executionsCount: 0,
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { getByRole, container } = render(<TeamsShell />);

        // Attach only exists on the Processes tab, so the operator must be there to click it.
        fireEvent.click(getByRole('tab', { name: 'Processes' }));
        await waitFor(() => expect(container.querySelector('[data-processes-attach-btn]')).not.toBeNull());

        fireEvent.click(container.querySelector('[data-processes-attach-btn]') as Element);

        // Attach reveals the Terminal tab (R4) rather than leaving the operator on Processes.
        await waitFor(() => expect(getByRole('tab', { name: 'Terminal' }).getAttribute('aria-selected')).toBe('true'));

        // "Then Terminal shows that team and member selected / And MemberTerminal mounts".
        await waitFor(() => expect(container.querySelector('[data-member-terminal="planner"]')).not.toBeNull());

        // R5: the attached selection persists like any other.
        await waitFor(() => {
            const raw = globalThis.localStorage?.getItem('spur:board:teams:lastTerminal');
            expect(JSON.parse(raw ?? '{}')).toEqual({ teamId: 'alpha', memberId: 'planner' });
        });
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

    // ── TeamControlStrip (0266) ────────────────────────────────────────────
    test('TeamControlStrip renders nothing when no teams exist (0266 R1)', async () => {
        setFetchForTesting((async () => jsonResponse({ teams: [] })) as unknown as typeof fetch);
        const { container } = render(<TeamControlStrip />);
        await waitFor(() => expect(container.querySelector('[data-team-control-strip]')).toBeNull());
    });

    test('TeamControlStrip renders team picker + Up/Down buttons after loading teams (0266 R1)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const req = input instanceof Request ? input : new Request(String(input));
            if (req.url.includes('/team/teams')) {
                return jsonResponse({
                    teams: [
                        {
                            teamId: 'alpha',
                            name: 'Alpha',
                            members: [{ id: 'planner', type: 'codex', status: 'running' }],
                        },
                    ],
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<TeamControlStrip />);

        const strip = await waitFor(() => {
            const el = container.querySelector('[data-team-control-strip]');
            expect(el).not.toBeNull();
            return el as HTMLElement;
        });
        expect(strip.textContent).toContain('Team');
        // Select a team so the Up/Down controls materialize.
        act(() => getSelectOnChange('team-control')?.({ target: { value: 'alpha' } }));
        await waitFor(() => expect(container.querySelector('[data-team-control-up]')).not.toBeNull());
        expect(container.querySelector('[data-team-control-down]')).not.toBeNull();
        // Down button is enabled — members are present.
        const downBtn = container.querySelector('[data-team-control-down]') as HTMLButtonElement | null;
        expect(downBtn?.disabled).toBe(false);
    });

    test('TeamControlStrip Up button POSTs /up immediately and shows success notice (0266 R2)', async () => {
        const posts: { url: string; method: string }[] = [];
        let teamsGets = 0;
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const req = input instanceof Request ? input : new Request(String(input));
            if (req.url.includes('/team/teams')) {
                teamsGets += 1;
                return jsonResponse({
                    teams: [
                        {
                            teamId: 'alpha',
                            name: 'Alpha',
                            members: [{ id: 'planner', type: 'codex', status: 'stopped' }],
                        },
                    ],
                });
            }
            if (req.method === 'POST') posts.push({ url: req.url, method: req.method });
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<TeamControlStrip />);

        // Wait for teams to load, then select a team.
        await waitFor(() => expect(container.querySelector('[data-team-control-select]')).not.toBeNull());
        act(() => getSelectOnChange('team-control')?.({ target: { value: 'alpha' } }));

        const upBtn = await waitFor(() => {
            const el = container.querySelector('[data-team-control-up]') as HTMLButtonElement | null;
            expect(el).not.toBeNull();
            return el as HTMLButtonElement;
        });
        act(() => fireEvent.click(upBtn));

        await waitFor(() =>
            expect(posts.some((p) => p.url.includes('/team/alpha/up') && p.method === 'POST')).toBe(true),
        );
        // `?check=true` makes the server treat /up as a dry-run that starts nothing
        // (apps/server/src/modules/team/index.ts:250), so Up must post a bare URL.
        const upPost = posts.find((p) => p.url.includes('/team/alpha/up'));
        expect(new URL(upPost?.url ?? '').search).toBe('');
        await waitFor(() => expect(container.querySelector('[data-team-control-notice]')).not.toBeNull());
        expect(container.querySelector('[data-team-control-notice]')?.textContent).toContain('materialized');
        // AC "process/team status refreshes": load() runs on the success path only
        // (TeamControlStrip.tsx:119) — a refetch beyond the mount GET proves it, and the
        // 5s poll is far outside this test's window so it cannot account for the second GET.
        await waitFor(() => expect(teamsGets).toBeGreaterThan(1));
        // No confirm modal for Up — only Down requires it (R2).
        expect(container.querySelector('[data-team-down-confirm-modal]')).toBeNull();
    });

    test('TeamControlStrip Down opens confirm modal; cancel sends no POST (0266 R2)', async () => {
        const posts: { url: string; method: string }[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const req = input instanceof Request ? input : new Request(String(input));
            if (req.url.includes('/team/teams')) {
                return jsonResponse({
                    teams: [
                        {
                            teamId: 'alpha',
                            name: 'Alpha',
                            members: [{ id: 'planner', type: 'codex', status: 'running' }],
                        },
                    ],
                });
            }
            if (req.method === 'POST') posts.push({ url: req.url, method: req.method });
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<TeamControlStrip />);

        await waitFor(() => expect(container.querySelector('[data-team-control-select]')).not.toBeNull());
        act(() => getSelectOnChange('team-control')?.({ target: { value: 'alpha' } }));

        const downBtn = await waitFor(() => {
            const el = container.querySelector('[data-team-control-down]') as HTMLButtonElement | null;
            expect(el).not.toBeNull();
            return el as HTMLButtonElement;
        });
        act(() => fireEvent.click(downBtn));

        // Modal opens, no POST yet.
        const modal = await waitFor(() => {
            const el = container.querySelector('[data-team-down-confirm-modal]');
            expect(el).not.toBeNull();
            return el as HTMLElement;
        });
        expect(modal.textContent).toContain('Stop team?');
        expect(posts.filter((p) => p.url.includes('/down'))).toHaveLength(0);

        // Cancel closes the modal with no side effects.
        const cancelBtn = await waitFor(() => {
            const el = container.querySelector('[data-team-down-confirm-cancel]') as HTMLButtonElement | null;
            expect(el).not.toBeNull();
            return el as HTMLButtonElement;
        });
        act(() => fireEvent.click(cancelBtn));
        await waitFor(() => expect(container.querySelector('[data-team-down-confirm-modal]')).toBeNull());
        expect(posts.filter((p) => p.url.includes('/down'))).toHaveLength(0);
    });

    test('TeamControlStrip Down confirm POSTs /down and shows success notice (0266 R2+R3)', async () => {
        const posts: { url: string; method: string }[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const req = input instanceof Request ? input : new Request(String(input));
            if (req.url.includes('/team/teams')) {
                return jsonResponse({
                    teams: [
                        {
                            teamId: 'alpha',
                            name: 'Alpha',
                            members: [{ id: 'planner', type: 'codex', status: 'running' }],
                        },
                    ],
                });
            }
            if (req.method === 'POST') posts.push({ url: req.url, method: req.method });
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<TeamControlStrip />);

        await waitFor(() => expect(container.querySelector('[data-team-control-select]')).not.toBeNull());
        act(() => getSelectOnChange('team-control')?.({ target: { value: 'alpha' } }));

        const downBtn = await waitFor(() => {
            const el = container.querySelector('[data-team-control-down]') as HTMLButtonElement | null;
            expect(el).not.toBeNull();
            return el as HTMLButtonElement;
        });
        act(() => fireEvent.click(downBtn));

        const confirmBtn = await waitFor(() => {
            const el = container.querySelector('[data-team-down-confirm-confirm]') as HTMLButtonElement | null;
            expect(el).not.toBeNull();
            return el as HTMLButtonElement;
        });
        act(() => fireEvent.click(confirmBtn));

        await waitFor(() =>
            expect(posts.some((p) => p.url.includes('/team/alpha/down') && p.method === 'POST')).toBe(true),
        );
        // `?purge=true` would additionally tear down member specs
        // (apps/server/src/modules/team/index.ts:293); the confirm modal only warns
        // about stopping processes, so Down must post a bare URL.
        const downPost = posts.find((p) => p.url.includes('/team/alpha/down'));
        expect(new URL(downPost?.url ?? '').search).toBe('');
        await waitFor(() => expect(container.querySelector('[data-team-control-notice]')).not.toBeNull());
        expect(container.querySelector('[data-team-control-notice]')?.textContent).toContain('stopped');
    });

    test('TeamControlStrip shows error inline when /up returns non-OK (0266 R3)', async () => {
        const posts: { url: string; method: string }[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const req = input instanceof Request ? input : new Request(String(input));
            if (req.url.includes('/team/teams')) {
                return jsonResponse({
                    teams: [
                        {
                            teamId: 'alpha',
                            name: 'Alpha',
                            members: [{ id: 'planner', type: 'codex', status: 'stopped' }],
                        },
                    ],
                });
            }
            if (req.method === 'POST' && req.url.includes('/up')) {
                posts.push({ url: req.url, method: req.method });
                return new Response(JSON.stringify({ error: 'agent binary not found' }), {
                    status: 500,
                    headers: { 'content-type': 'application/json' },
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { container } = render(<TeamControlStrip />);

        await waitFor(() => expect(container.querySelector('[data-team-control-select]')).not.toBeNull());
        act(() => getSelectOnChange('team-control')?.({ target: { value: 'alpha' } }));

        const upBtn = await waitFor(() => {
            const el = container.querySelector('[data-team-control-up]') as HTMLButtonElement | null;
            expect(el).not.toBeNull();
            return el as HTMLButtonElement;
        });
        act(() => fireEvent.click(upBtn));

        await waitFor(() =>
            expect(posts.some((p) => p.url.includes('/team/alpha/up') && p.method === 'POST')).toBe(true),
        );
        await waitFor(() =>
            expect(container.querySelector('[data-team-control-error-inline]')?.textContent).toContain(
                'agent binary not found',
            ),
        );
    });
});

// ── filterWatchRows / buildWatchRows unit tests (spur#0267 R5) ──

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
        { agentId: 'beta', pid: 101, status: 'exited', startedAt: '2026-07-15T00:00:00Z', exitCode: 0, teamId: null },
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
