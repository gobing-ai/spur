registerHappyDom();

import { afterAll, describe, expect, test } from 'bun:test';
import { render, waitFor } from '@testing-library/react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import { discoverModules } from '../../../src/modules/discover';
import AgentTab from '../../../src/modules/inbox/AgentTab';
import AllTab, { filterMessagesByTeam, parseMessagesFeed } from '../../../src/modules/inbox/AllTab';
import InboxShell from '../../../src/modules/inbox/InboxShell';
import SupervisorTab, { SUPERVISOR_ENDPOINT_ID } from '../../../src/modules/inbox/SupervisorTab';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

/** Cast a mock fetch fn to typeof fetch. */
function mockFetch(fn: (req: Request) => Promise<Response>): typeof fetch {
    return fn as unknown as typeof fetch;
}

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

let mockSources: MockEventSource[] = [];
let originalEventSource: unknown;

interface MockEventSource {
    url: string;
    onmessage: ((event: { data: string }) => void) | null;
    _closed: boolean;
    close: () => void;
    _push: (data: unknown) => void;
}

function installMockEventSource(): void {
    originalEventSource = (globalThis as Record<string, unknown>).EventSource;
    const factory = function MockEventSourceImpl(url: string): MockEventSource {
        const inst: MockEventSource = {
            url,
            onmessage: null,
            _closed: false,
            close() {
                inst._closed = true;
            },
            _push(data: unknown) {
                if (inst._closed) return;
                inst.onmessage?.({ data: JSON.stringify(data) });
            },
        };
        mockSources.push(inst);
        return inst;
    };
    Object.defineProperty(globalThis, 'EventSource', { value: factory, writable: true, configurable: true });
}

function restoreEventSource(): void {
    Object.defineProperty(globalThis, 'EventSource', {
        value: originalEventSource,
        writable: true,
        configurable: true,
    });
}

function resetMockSources(): void {
    mockSources = [];
}

function findByText(container: HTMLElement, text: string): HTMLElement | null {
    const all = container.querySelectorAll('*');
    for (const el of Array.from(all)) {
        if (el.textContent === text) return el as HTMLElement;
    }
    return null;
}

/** Feed mock with messages from two teams (alpha, beta) plus supervisor traffic. */
function installFeedMock(): void {
    setFetchForTesting(
        mockFetch(async (req: Request) => {
            const url = req.url;
            if (url.includes('/team/teams')) {
                return jsonResponse({
                    teams: [
                        {
                            teamId: 'alpha',
                            name: 'Alpha',
                            members: [
                                { id: 'alpha-planner', type: 'claude', status: 'running' },
                                { id: 'alpha-coder', type: 'codex', status: 'running' },
                            ],
                        },
                        {
                            teamId: 'beta',
                            name: 'Beta',
                            members: [{ id: 'beta-lead', type: 'claude', status: 'stopped' }],
                        },
                    ],
                });
            }
            if (url.includes('/messages')) {
                return jsonResponse({
                    messages: [
                        {
                            id: 'm1',
                            fromId: 'alpha-planner',
                            toId: 'alpha-coder',
                            from: { agentId: 'alpha-planner', teamId: 'alpha' },
                            to: { agentId: 'alpha-coder', teamId: 'alpha' },
                            body: 'code it',
                            status: 'sent',
                            createdAt: '2026-01-01T00:00:01Z',
                            inReplyTo: null,
                            hasReply: false,
                            replyCount: 0,
                        },
                        {
                            id: 'm2',
                            fromId: SUPERVISOR_ENDPOINT_ID,
                            toId: 'alpha-planner',
                            to: { agentId: 'alpha-planner', teamId: 'alpha' },
                            body: 'supervisor note',
                            status: 'sent',
                            createdAt: '2026-01-01T00:00:02Z',
                            inReplyTo: null,
                            hasReply: false,
                            replyCount: 0,
                        },
                        {
                            id: 'm3',
                            fromId: 'beta-lead',
                            toId: 'beta-lead',
                            from: { agentId: 'beta-lead', teamId: 'beta' },
                            to: { agentId: 'beta-lead', teamId: 'beta' },
                            body: 'beta-only',
                            status: 'sent',
                            createdAt: '2026-01-01T00:00:03Z',
                            inReplyTo: null,
                            hasReply: false,
                            replyCount: 0,
                        },
                        {
                            // Member → supervisor: `to` has no teamId (supervisor endpoint), sender belongs to alpha.
                            id: 'm4',
                            fromId: 'alpha-coder',
                            toId: SUPERVISOR_ENDPOINT_ID,
                            from: { agentId: 'alpha-coder', teamId: 'alpha' },
                            to: { agentId: SUPERVISOR_ENDPOINT_ID },
                            body: 'report to supervisor',
                            status: 'sent',
                            createdAt: '2026-01-01T00:00:04Z',
                            inReplyTo: null,
                            hasReply: false,
                            replyCount: 0,
                        },
                    ],
                    count: 4,
                });
            }
            return jsonResponse({ ok: true });
        }),
    );
}

afterAll(async () => {
    await teardownHappyDom();
});

describe('Inbox module registration (R1)', () => {
    test('discovers the inbox module exactly once with a unique id and route', () => {
        const discovered = discoverModules();
        const ids = discovered.map((m) => m.id);
        expect(ids.filter((id) => id === 'inbox')).toHaveLength(1);
        const routes = discovered.map((m) => m.route);
        expect(routes.filter((r) => r === 'inbox')).toHaveLength(1);
        const inbox = discovered.find((m) => m.id === 'inbox');
        expect(inbox?.name).toBe('Inbox');
        expect(inbox?.sidebarLabel).toBe('Inbox');
        expect(typeof inbox?.component).toBe('function');
    });

    test('InboxShell renders All then Supervisor tabs even with no team running', async () => {
        installMockEventSource();
        resetMockSources();
        setFetchForTesting(mockFetch(async () => jsonResponse({ teams: [] })));
        const { container } = render(<InboxShell />);
        await waitFor(() => expect(container.querySelectorAll('[role="tab"]').length).toBe(2));
        const tabs = container.querySelectorAll('[role="tab"]');
        expect(tabs[0]?.textContent).toBe('All');
        expect(tabs[1]?.textContent).toBe('Supervisor');
        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });
});

describe('Inbox feed tabs (R2, R3)', () => {
    test('R2: AllTab lists every message with route and status (global omission)', async () => {
        installMockEventSource();
        resetMockSources();
        installFeedMock();
        const { container } = render(<AllTab />);
        await waitFor(() => expect(findByText(container, 'code it')).not.toBeNull());
        expect(findByText(container, 'supervisor note')).not.toBeNull();
        expect(findByText(container, 'beta-only')).not.toBeNull();
        expect(container.querySelector('[data-all-tab]')).not.toBeNull();
        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('R2: a malformed feed row does not crash the All tab', async () => {
        installMockEventSource();
        resetMockSources();
        setFetchForTesting(
            mockFetch(async (req: Request) => {
                if (req.url.includes('/messages')) {
                    return jsonResponse({
                        messages: [
                            {
                                id: 'good',
                                fromId: 'a',
                                toId: 'b',
                                to: { agentId: 'b' },
                                body: 'ok',
                                status: 'sent',
                                createdAt: 't',
                            },
                            { broken: true },
                            null,
                        ],
                        count: 3,
                    });
                }
                return jsonResponse({ ok: true });
            }),
        );
        const { container } = render(<AllTab />);
        await waitFor(() => expect(findByText(container, 'ok')).not.toBeNull());
        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('R3: SupervisorTab filters the feed to supervisor traffic only (global)', async () => {
        installMockEventSource();
        resetMockSources();
        installFeedMock();
        const { container } = render(<SupervisorTab />);
        await waitFor(() => expect(findByText(container, 'supervisor note')).not.toBeNull());
        expect(findByText(container, 'code it')).toBeNull();
        expect(findByText(container, 'beta-only')).toBeNull();
        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });
});

describe('Inbox team scope (task 0197 R4)', () => {
    test("AllTab with teamId shows only that team's messages (scoped behavior)", async () => {
        installMockEventSource();
        resetMockSources();
        installFeedMock();
        const { container } = render(<AllTab teamId="alpha" />);
        await waitFor(() => expect(findByText(container, 'code it')).not.toBeNull());
        expect(findByText(container, 'supervisor note')).not.toBeNull();
        // beta message is excluded when scoped to alpha.
        expect(findByText(container, 'beta-only')).toBeNull();
        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('AllTab with teamId=beta excludes alpha messages (scoped behavior)', async () => {
        installMockEventSource();
        resetMockSources();
        installFeedMock();
        const { container } = render(<AllTab teamId="beta" />);
        await waitFor(() => expect(findByText(container, 'beta-only')).not.toBeNull());
        expect(findByText(container, 'code it')).toBeNull();
        expect(findByText(container, 'supervisor note')).toBeNull();
        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test("SupervisorTab with teamId narrows to that team's supervisor traffic", async () => {
        installMockEventSource();
        resetMockSources();
        installFeedMock();
        const { container } = render(<SupervisorTab teamId="alpha" />);
        await waitFor(() => expect(findByText(container, 'supervisor note')).not.toBeNull());
        // P2 regression: a member → supervisor message (to has no teamId, but sender is an alpha member)
        // must survive team scoping (R4: sender OR recipient belongs to the team).
        expect(findByText(container, 'report to supervisor')).not.toBeNull();
        expect(findByText(container, 'code it')).toBeNull();
        expect(findByText(container, 'beta-only')).toBeNull();
        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('filterMessagesByTeam keeps rows where either endpoint resolves to the team', () => {
        const base = {
            fromId: 'x' as string | null,
            toId: 'y',
            body: 'b',
            status: 'sent' as const,
            createdAt: 't',
            inReplyTo: null,
            hasReply: false,
            replyCount: 0,
        };
        const rows = [
            {
                ...base,
                id: '1',
                fromId: 'a',
                toId: 'b',
                from: { agentId: 'a', teamId: 'alpha' },
                to: { agentId: 'b', teamId: 'alpha' },
            },
            {
                ...base,
                id: '2',
                fromId: 'a',
                toId: 'b',
                from: { agentId: 'a', teamId: 'beta' },
                to: { agentId: 'b', teamId: 'beta' },
            },
            { ...base, id: '3', fromId: 'c', toId: 'd', from: { agentId: 'c' }, to: { agentId: 'd', teamId: 'alpha' } },
            { ...base, id: '4', fromId: 'e', toId: 'f', from: { agentId: 'e', teamId: 'alpha' }, to: { agentId: 'f' } },
        ];
        const ids = filterMessagesByTeam(rows as never, 'alpha').map((r) => r.id);
        expect(ids).toEqual(['1', '3', '4']);
    });

    test('InboxShell with teamId locks scope and hides its team dropdown', async () => {
        installMockEventSource();
        resetMockSources();
        installFeedMock();
        const { container } = render(<InboxShell teamId="alpha" />);
        // alpha has 2 members -> All, Supervisor, alpha-planner, alpha-coder.
        await waitFor(() => expect(container.querySelectorAll('[role="tab"]').length).toBe(4));
        // No team dropdown when externally scoped.
        expect(container.querySelector('[data-inbox-team-select]')).toBeNull();
        // All tab (default) is scoped to alpha.
        await waitFor(() => expect(findByText(container, 'code it')).not.toBeNull());
        expect(findByText(container, 'beta-only')).toBeNull();
        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });
});

describe('Inbox per-agent tabs (R4)', () => {
    test('R4: InboxShell derives one tab per team member after the two fixed tabs', async () => {
        installMockEventSource();
        resetMockSources();
        installFeedMock();
        const { container } = render(<InboxShell />);
        // Default team is the first (alpha) with 2 members -> 4 tabs.
        await waitFor(() => expect(container.querySelectorAll('[role="tab"]').length).toBe(4));
        const tabs = container.querySelectorAll('[role="tab"]');
        expect(tabs[0]?.textContent).toBe('All');
        expect(tabs[1]?.textContent).toBe('Supervisor');
        expect(tabs[2]?.textContent).toContain('alpha-planner');
        expect(tabs[3]?.textContent).toContain('alpha-coder');
        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('R5: AgentTab renders durable messages only — opens no process stream', async () => {
        installMockEventSource();
        resetMockSources();
        installFeedMock();
        const { container } = render(<AgentTab agentId="alpha-planner" />);
        await waitFor(() => expect(findByText(container, 'supervisor note')).not.toBeNull());
        // alpha-planner is the sender of 'code it' and recipient of 'supervisor note'.
        expect(findByText(container, 'code it')).not.toBeNull();
        // beta traffic is excluded.
        expect(findByText(container, 'beta-only')).toBeNull();
        // No process EventSource is opened (no URL contains /team/processes/.../stream).
        expect(mockSources.some((s) => s.url.includes('/team/processes/'))).toBe(false);
        // No frame rows rendered.
        expect(container.querySelector('[data-timeline-frame]')).toBeNull();
        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });
});

describe('parseMessagesFeed (R2)', () => {
    test('narrows untrusted rows and defaults missing reply fields', () => {
        const parsed = parseMessagesFeed({
            messages: [
                { id: 'm1', fromId: 'a', toId: 'b', body: 'hi', status: 'queued', createdAt: 't' },
                { id: 1, body: 'bad' },
            ],
        });
        expect(parsed?.length).toBe(1);
        expect(parsed?.[0]?.hasReply).toBe(false);
        expect(parsed?.[0]?.replyCount).toBe(0);
        expect(parseMessagesFeed(null)).toBeNull();
        expect(parseMessagesFeed({ messages: 'nope' })).toBeNull();
    });
});
