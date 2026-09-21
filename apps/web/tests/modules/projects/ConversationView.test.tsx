registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import ConversationView from '../../../src/modules/projects/ConversationView';
import { ConversationDraftProvider, DRAFT_STORAGE_KEY } from '../../../src/modules/projects/drafts';
import { ProjectContext, type ProjectFleetSnapshot } from '../../../src/modules/projects/useProjectContext';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

afterAll(teardownHappyDom);

afterEach(() => {
    cleanup();
    resetFetchForTesting();
    localStorage.clear();
});

// ── fixtures ──

function fleet(orchestrator: Partial<ProjectFleetSnapshot['orchestrator']> = {}): ProjectFleetSnapshot {
    return {
        path: '/repo/wt',
        enabled: true,
        strategy: { name: 'gtd', version: 1 },
        orchestrator: { state: 'bound-online', instanceId: 'lead', ...orchestrator },
        members: [],
        capacity: { total: 1, enabled: 1, writeCapable: 1, missing: [] },
    };
}

function ctx(overrides: Record<string, unknown> = {}) {
    return { path: '/repo/wt', name: 'spur', fleet: fleet(), state: 'ready' as const, ...overrides };
}

/** Canned inbox payloads served per agent id. */
function inboxByAgent(rows: Record<string, unknown[]>): typeof fetch {
    return ((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const agent = new URL(url).searchParams.get('agent') ?? '';
        const body = JSON.stringify({ messages: rows[agent] ?? [], count: (rows[agent] ?? []).length });
        return Promise.resolve(new Response(body, { status: 200 }));
    }) as typeof fetch;
}

function harness(projectValue: Record<string, unknown>) {
    return render(
        <ProjectContext.Provider value={projectValue as never}>
            <ConversationDraftProvider>
                <ConversationView />
            </ConversationDraftProvider>
        </ProjectContext.Provider>,
    );
}

// ── R4: rehydration from the server only ──

describe('ConversationView rehydration (0841 R4/R6)', () => {
    test('remount rebuilds the thread from the fetch response alone; storage keeps only the draft', async () => {
        setFetchForTesting(
            inboxByAgent({
                lead: [
                    {
                        id: 'r1',
                        fromId: 'board-operator',
                        toId: 'lead',
                        body: 'request text',
                        status: 'injected',
                        createdAt: '2026-09-12T10:00:00.000Z',
                        inReplyTo: null,
                    },
                ],
                'board-operator': [
                    {
                        id: 'p1',
                        fromId: 'lead',
                        toId: 'board-operator',
                        body: 'response text',
                        status: 'queued',
                        createdAt: '2026-09-12T10:00:05.000Z',
                        inReplyTo: 'r1',
                    },
                ],
            }),
        );
        const first = harness(ctx());
        await act(async () => {});
        expect(first.container.querySelectorAll('[data-conversation-entry]')).toHaveLength(2);
        first.unmount();
        globalThis.localStorage?.clear();
        // Second mount with a DIFFERENT server response — the thread follows the fetch, not storage.
        setFetchForTesting(
            inboxByAgent({
                lead: [],
                'board-operator': [
                    {
                        id: 'p2',
                        fromId: 'lead',
                        toId: 'board-operator',
                        body: 'fresh response',
                        status: 'queued',
                        createdAt: '2026-09-12T11:00:00.000Z',
                        inReplyTo: null,
                    },
                ],
            }),
        );
        const second = harness(ctx());
        await act(async () => {});
        const ids = [...second.container.querySelectorAll('[data-conversation-entry]')].map((n) => n.textContent);
        expect(ids).toHaveLength(1);
        expect(ids[0]).toContain('fresh response');
        expect(globalThis.localStorage?.getItem(DRAFT_STORAGE_KEY)).toBeNull(); // no cached thread in storage
        second.unmount();
    });

    test('envelope-decoded request renders refs and verbatim deliveryStatus', async () => {
        setFetchForTesting(
            inboxByAgent({
                lead: [
                    {
                        id: 'r1',
                        fromId: 'board-operator',
                        toId: 'lead',
                        body: 'SPUR-REQUEST/1 {"refs":[{"kind":"task","wbs":"0844"}]}\n\nplease run',
                        status: 'queued',
                        createdAt: '2026-09-12T10:00:00.000Z',
                        inReplyTo: null,
                    },
                ],
                'board-operator': [],
            }),
        );
        const view = harness(ctx());
        await act(async () => {});
        const row = view.container.querySelector('[data-conversation-kind="request"]');
        expect(row?.textContent).toContain('please run');
        expect(row?.textContent).not.toContain('SPUR-REQUEST/1');
        expect(row?.querySelector('[data-conversation-ref="task"]')?.textContent).toContain('task 0844');
        expect(row?.querySelector('[data-conversation-delivery]')?.textContent).toBe('queued');
        view.unmount();
    });

    test('orchestrator missing → exactly ONE inbox fetch (operator side)', async () => {
        const fetched: string[] = [];
        setFetchForTesting(((input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            fetched.push(new URL(url).searchParams.get('agent') ?? '');
            return Promise.resolve(new Response(JSON.stringify({ messages: [], count: 0 }), { status: 200 }));
        }) as typeof fetch);
        const view = harness(ctx({ fleet: fleet({ state: 'missing', instanceId: undefined }) }));
        await act(async () => {});
        // 0844 adds a /project/requests read (no agent param) when unbound — none: filter to inbox reads.
        expect(fetched.filter((a) => a !== '')).toEqual(['board-operator']);
        view.unmount();
    });

    test('request entries join the durable results feed: receipt state rendered per entry (0844 R5)', async () => {
        // Route BOTH the inbox reads and the results feed.
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            const u = new URL(url);
            if (u.pathname === '/api/project/requests') {
                return new Response(
                    JSON.stringify({
                        requests: [
                            {
                                messageId: 'r1',
                                requestKey: 'rk-1',
                                deliveryStatus: 'injected',
                                injectAttempts: 1,
                                injectError: null,
                                runId: 'run-1',
                                taskId: '0844',
                                outcome: null,
                                reason: null,
                                hold: null,
                            },
                        ],
                    }),
                    { status: 200 },
                );
            }
            const agent = u.searchParams.get('agent') ?? '';
            const body = JSON.stringify({
                messages:
                    agent === 'lead'
                        ? [
                              {
                                  id: 'r1',
                                  fromId: 'board-operator',
                                  toId: 'lead',
                                  body: 'request text',
                                  status: 'injected',
                                  createdAt: '2026-09-12T10:00:00.000Z',
                                  inReplyTo: null,
                              },
                          ]
                        : [],
                count: agent === 'lead' ? 1 : 0,
            });
            return new Response(body, { status: 200 });
        }) as typeof fetch);
        try {
            const view = harness(ctx());
            await act(async () => {});
            const row = view.container.querySelector('[data-conversation-kind="request"]');
            expect(row?.querySelector('[data-conversation-receipt-state="accepted-working"]')).not.toBeNull();
            expect(row?.textContent).toContain('accepted · executor working');
            view.unmount();
        } finally {
            resetFetchForTesting();
        }
    });
});
