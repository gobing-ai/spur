registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import ConversationView from '../../../src/modules/projects/ConversationView';
import {
    ConversationDraftProvider,
    DRAFT_STORAGE_KEY,
    saveDraft,
    useConversationDraft,
} from '../../../src/modules/projects/drafts';
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

/** DOM input events never reach React under happy-dom — invoke the captured onChange like new-task-panel does. */
function typeInto(input: HTMLTextAreaElement, text: string): void {
    const holder = input as unknown as Record<string, Record<string, unknown> | undefined>;
    const key = Object.keys(holder).find((k) => k.startsWith('__reactProps$'));
    const props = key ? holder[key] : undefined;
    const onChange = props?.onChange as ((e: { target: { value: string } }) => void) | undefined;
    if (!onChange) throw new Error('textarea has no onChange');
    act(() => {
        onChange({ target: { value: text } });
    });
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

    test('orchestrator missing → exactly ONE inbox fetch (operator side) and the named composer state', async () => {
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
        expect(view.container.querySelector('[data-conversation-orchestrator-missing]')?.textContent).toContain(
            'no orchestrator instance is bound',
        );
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

// ── R2/R5: drafts ──

describe('per-project draft (0841 R2/R5)', () => {
    test('corrupt storage degrades to an empty draft — view renders, no error state (ST-1)', async () => {
        globalThis.localStorage?.setItem(DRAFT_STORAGE_KEY, '{corrupt json!!!');
        setFetchForTesting(inboxByAgent({}));
        const view = harness(ctx());
        await act(async () => {});
        const input = view.container.querySelector('[data-conversation-draft-input]') as HTMLTextAreaElement;
        expect(input.value).toBe('');
        expect(view.container.querySelectorAll('[data-conversation-entry]')).toHaveLength(0);
        expect(view.container.querySelector('[data-conversation-fetch-failed]')).toBeNull();
        view.unmount();
    });

    test('typing persists the draft with a bumped revision', async () => {
        setFetchForTesting(inboxByAgent({}));
        const view = harness(ctx());
        await act(async () => {});
        const input = view.container.querySelector('[data-conversation-draft-input]') as HTMLTextAreaElement;
        typeInto(input, 'draft for this project only');
        await act(async () => {});
        const stored = JSON.parse(globalThis.localStorage?.getItem(DRAFT_STORAGE_KEY) ?? 'null');
        expect(stored).toEqual({ path: '/repo/wt', text: 'draft for this project only', refs: [], revision: 1 });
        view.unmount();
    });

    test('a project switch restores the stored draft; the draft never leaks across projects (R2)', async () => {
        setFetchForTesting(inboxByAgent({}));
        // Seed through the save contract, then arrive at the project — the path guard restores it.
        saveDraft({ path: '/repo/wt-a', text: 'project A draft', refs: [], revision: 1 });
        const view = render(
            <ProjectContext.Provider value={ctx({ path: '/repo/wt-a' }) as never}>
                <ConversationDraftProvider>
                    <ConversationView />
                </ConversationDraftProvider>
            </ProjectContext.Provider>,
        );
        await act(async () => {});
        const input = () => view.container.querySelector('[data-conversation-draft-input]') as HTMLTextAreaElement;
        expect(input().value).toBe('project A draft');
        // Switch to project B (same origin, different served path — the port-reuse hazard)
        await act(async () => {
            view.rerender(
                <ProjectContext.Provider value={ctx({ path: '/repo/wt-b' }) as never}>
                    <ConversationDraftProvider>
                        <ConversationView />
                    </ConversationDraftProvider>
                </ProjectContext.Provider>,
            );
        });
        expect(input().value).toBe(''); // B never sees A's draft
        // Single-slot record (0841 Draft model): serving B overwrote A's stale record, so no
        // cross-project residue can resurrect on a later mount.
        const stored = JSON.parse(globalThis.localStorage?.getItem(DRAFT_STORAGE_KEY) ?? 'null');
        expect(stored.path).toBe('/repo/wt-b');
        expect(stored.text).toBe('');
        view.unmount();
    });

    test('addRef dedupes, chips render removable, removeRef updates draft + revision (R3)', async () => {
        setFetchForTesting(inboxByAgent({}));
        const probeCalls: string[] = [];
        function Probe() {
            const { addRef } = useConversationDraft();
            return (
                <button
                    type="button"
                    data-probe-add
                    onClick={() => {
                        addRef({ kind: 'task', wbs: '0843' });
                        addRef({ kind: 'task', wbs: '0843' }); // duplicate — deduped
                        addRef({ kind: 'feature', id: 'G63' });
                        probeCalls.push('added');
                    }}
                >
                    add refs
                </button>
            );
        }
        const view = render(
            <ProjectContext.Provider value={ctx() as never}>
                <ConversationDraftProvider>
                    <Probe />
                    <ConversationView />
                </ConversationDraftProvider>
            </ProjectContext.Provider>,
        );
        await act(async () => {});
        (view.container.querySelector('[data-probe-add]') as HTMLButtonElement).click();
        await act(async () => {});
        const chips = view.container.querySelectorAll('[data-draft-ref]');
        expect(chips).toHaveLength(2); // deduplicated
        expect(view.container.textContent).toContain('task 0843');
        expect(view.container.textContent).toContain('feature G63');
        (view.container.querySelector('[data-draft-ref="task"]') as HTMLButtonElement).click();
        await act(async () => {});
        expect(view.container.querySelectorAll('[data-draft-ref]')).toHaveLength(1);
        const stored = JSON.parse(globalThis.localStorage?.getItem(DRAFT_STORAGE_KEY) ?? 'null');
        expect(stored.refs).toEqual([{ kind: 'feature', id: 'G63' }]);
        expect(stored.revision).toBe(3); // two effective adds (+2) and one remove (+1)
        view.unmount();
    });
});
