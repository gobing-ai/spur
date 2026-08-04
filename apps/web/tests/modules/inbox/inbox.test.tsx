registerHappyDom();

import { afterAll, describe, expect, test } from 'bun:test';
import { act, render, waitFor } from '@testing-library/react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import { discoverModules } from '../../../src/modules/discover';
import AgentTab from '../../../src/modules/inbox/AgentTab';
import AllTab, { parseMessagesFeed } from '../../../src/modules/inbox/AllTab';
import InboxShell from '../../../src/modules/inbox/InboxShell';
import SupervisorTab, { SUPERVISOR_ENDPOINT_ID } from '../../../src/modules/inbox/SupervisorTab';
import { mergeTimeline } from '../../../src/modules/inbox/timeline';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

/** Cast a mock fetch fn to typeof fetch. */
function mockFetch(fn: (req: Request) => Promise<Response>): typeof fetch {
    return fn as unknown as typeof fetch;
}

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

interface MockEventSource {
    url: string;
    onmessage: ((event: { data: string }) => void) | null;
    onerror: (() => void) | null;
    close: () => void;
    _push: (data: unknown) => void;
    _closed: boolean;
}

let mockSources: MockEventSource[] = [];
let originalEventSource: unknown;

function installMockEventSource(): void {
    originalEventSource = (globalThis as Record<string, unknown>).EventSource;
    const factory = function MockEventSourceImpl(url: string): MockEventSource {
        const inst: MockEventSource = {
            url,
            onmessage: null,
            onerror: null,
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

/** Default feed mock: two messages across agents, plus supervisor traffic. */
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
                            to: { agentId: 'alpha-coder' },
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
                            to: { agentId: 'alpha-planner' },
                            body: 'supervisor note',
                            status: 'sent',
                            createdAt: '2026-01-01T00:00:02Z',
                            inReplyTo: null,
                            hasReply: false,
                            replyCount: 0,
                        },
                    ],
                    count: 2,
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
    test('R2: AllTab lists every message with route and status', async () => {
        installMockEventSource();
        resetMockSources();
        installFeedMock();
        const { container } = render(<AllTab />);
        await waitFor(() => expect(findByText(container, 'code it')).not.toBeNull());
        expect(findByText(container, 'supervisor note')).not.toBeNull();
        expect(container.querySelector('[data-all-tab]')).not.toBeNull();
        // Sender → recipient route present.
        const route = container.querySelector('[data-message-route]');
        expect(route).not.toBeNull();
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

    test('R3: SupervisorTab filters the feed to supervisor traffic only', async () => {
        installMockEventSource();
        resetMockSources();
        installFeedMock();
        const { container } = render(<SupervisorTab />);
        await waitFor(() => expect(findByText(container, 'supervisor note')).not.toBeNull());
        expect(findByText(container, 'code it')).toBeNull();
        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });
});

describe('Inbox per-agent tabs and timeline (R4, R5, R6)', () => {
    test('R4: InboxShell derives one tab per team member after the two fixed tabs', async () => {
        installMockEventSource();
        resetMockSources();
        installFeedMock();
        const { container } = render(<InboxShell />);
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

    test('R5: AgentTab renders a unified IN/OUT timeline of messages and frames', async () => {
        installMockEventSource();
        resetMockSources();
        setFetchForTesting(
            mockFetch(async (req: Request) => {
                if (req.url.includes('/messages')) {
                    return jsonResponse({
                        messages: [
                            {
                                id: 'in',
                                fromId: 'other',
                                toId: 'alpha-planner',
                                to: { agentId: 'alpha-planner' },
                                body: 'inbound msg',
                                status: 'sent',
                                createdAt: '2026-01-01T00:00:01Z',
                                inReplyTo: null,
                                hasReply: false,
                                replyCount: 0,
                            },
                            {
                                id: 'out',
                                fromId: 'alpha-planner',
                                toId: 'other',
                                to: { agentId: 'other' },
                                body: 'outbound msg',
                                status: 'sent',
                                createdAt: '2026-01-01T00:00:03Z',
                                inReplyTo: null,
                                hasReply: false,
                                replyCount: 0,
                            },
                        ],
                        count: 2,
                    });
                }
                return jsonResponse({ ok: true });
            }),
        );
        const { container } = render(<AgentTab agentId="alpha-planner" />);
        await waitFor(() => expect(findByText(container, 'inbound msg')).not.toBeNull());
        expect(findByText(container, 'outbound msg')).not.toBeNull();

        // Push process frames over the agent's stream.
        const stream = mockSources.find((s) => s.url.includes('/team/processes/alpha-planner/stream'));
        expect(stream).toBeDefined();
        act(() => {
            stream?._push({ stream: 'stdout', ts: '2026-01-01T00:00:02Z', line: 'hello world', seq: 1 });
        });
        await waitFor(() => expect(findByText(container, 'hello world')).not.toBeNull());

        // Message direction badges: inbound IN, outbound OUT.
        const dirs = Array.from(container.querySelectorAll('[data-timeline-direction]')).map((el) => el.textContent);
        expect(dirs).toContain('IN');
        expect(dirs).toContain('OUT');
        // Frame is marked.
        expect(container.querySelector('[data-timeline-frame]')).not.toBeNull();
        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('R6: a boundary marker appears at the oldest frame; no-frames renders a message-only note', async () => {
        installMockEventSource();
        resetMockSources();
        setFetchForTesting(
            mockFetch(async (req: Request) => {
                if (req.url.includes('/messages')) {
                    return jsonResponse({
                        messages: [
                            {
                                id: 'old',
                                fromId: 'other',
                                toId: 'alpha-coder',
                                to: { agentId: 'alpha-coder' },
                                body: 'before history',
                                status: 'sent',
                                createdAt: '2026-01-01T00:00:00Z',
                                inReplyTo: null,
                                hasReply: false,
                                replyCount: 0,
                            },
                        ],
                        count: 1,
                    });
                }
                return jsonResponse({ ok: true });
            }),
        );
        const { container } = render(<AgentTab agentId="alpha-coder" />);
        await waitFor(() => expect(findByText(container, 'before history')).not.toBeNull());

        // No frames yet → message-only note (R6), no boundary.
        expect(container.querySelector('[data-timeline-boundary]')).toBeNull();
        expect(container.querySelector('[data-agent-tab-note]')).not.toBeNull();

        // Frames arrive → boundary marker appears at the oldest frame.
        const stream = mockSources.find((s) => s.url.includes('/team/processes/alpha-coder/stream'));
        act(() => {
            stream?._push({ stream: 'stderr', ts: '2026-01-01T00:00:05Z', line: 'err', seq: 1 });
        });
        await waitFor(() => expect(container.querySelector('[data-timeline-boundary]')).not.toBeNull());
        expect(findByText(container, 'before history')).not.toBeNull();
        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('R14: unmounting AgentTab closes its process stream', async () => {
        installMockEventSource();
        resetMockSources();
        installFeedMock();
        const { unmount } = render(<AgentTab agentId="alpha-coder" />);
        await waitFor(() =>
            expect(mockSources.some((s) => s.url.includes('/team/processes/alpha-coder/stream'))).toBe(true),
        );
        const stream = mockSources.find((s) => s.url.includes('/team/processes/alpha-coder/stream')) as MockEventSource;
        expect(stream._closed).toBe(false);
        unmount();
        expect(stream._closed).toBe(true);
        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });
});

describe('mergeTimeline via the shared helper (R5/R6)', () => {
    test('orders and marks direction on the pure merge', () => {
        const messages = [
            {
                id: 'a',
                fromId: 'agent',
                toId: 'other',
                body: 'x',
                status: 'sent',
                createdAt: '2026-01-01T00:00:00Z',
                inReplyTo: null,
                hasReply: false,
                replyCount: 0,
                to: { agentId: 'other' },
            },
        ];
        const entries = mergeTimeline(
            messages,
            [{ stream: 'stdout', ts: '2026-01-01T00:00:01Z', line: 'l', seq: 1 }],
            'agent',
        );
        expect(entries.map((e) => e.kind)).toEqual(['message', 'boundary', 'frame']);
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
