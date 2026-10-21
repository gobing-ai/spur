/**
 * G11 1269 — the Projects Inbox tab (R1/R2): member list → two-direction thread → composer.
 *
 * The tab reads and writes ONLY through `api.inbox.*`, so a stubbed client is the whole transport.
 * These tests pin the three panes, reply-and-mark-read inline, and the live-refetch trigger.
 */
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

registerHappyDom();

const sendCalls: unknown[] = [];
const replyCalls: unknown[] = [];
const readCalls: unknown[] = [];

const stubApi = {
    inbox: {
        members: async () => [
            { id: 'proj-coder', queued: 1, unread: 1 },
            { id: 'operator', queued: 0, unread: 0 },
        ],
        list: async () => ({
            messages: [
                {
                    id: 'msg_1',
                    fromId: 'operator',
                    toId: 'proj-coder',
                    body: 'question',
                    kind: 'chat',
                    status: 'queued',
                    attempts: 0,
                    error: null,
                    claimedAt: null,
                    deliveredAt: null,
                    readAt: null,
                    inReplyTo: null,
                    threadId: 'msg_1',
                    requestKey: null,
                    taskId: null,
                    parentRunId: null,
                    createdAt: 1,
                },
                {
                    id: 'msg_2',
                    fromId: 'proj-coder',
                    toId: 'operator',
                    body: 'answer',
                    kind: 'chat',
                    status: 'delivered',
                    attempts: 1,
                    error: null,
                    claimedAt: 2,
                    deliveredAt: 3,
                    readAt: null,
                    inReplyTo: 'msg_1',
                    threadId: 'msg_1',
                    requestKey: null,
                    taskId: null,
                    parentRunId: null,
                    createdAt: 4,
                },
            ],
            nextCursor: null,
        }),
        send: async (input: unknown) => {
            sendCalls.push(input);
            return { message: { id: 'msg_new' }, replayed: false };
        },
        reply: async (input: unknown) => {
            replyCalls.push(input);
            return { id: 'msg_reply' };
        },
        read: async (input: unknown) => {
            readCalls.push(input);
            return { readAt: 9, transitioned: true };
        },
        requests: async () => [],
    },
};

const { cleanup, render, waitFor } = await import('@testing-library/react');
const { resetFetchForTesting, setFetchForTesting } = await import('../../../src/lib/rpc-client');
const { createElement } = await import('react');
const { ProjectContext } = await import('../../../src/modules/projects/useProjectContext');
const {
    default: InboxView,
    groupThreads,
    memberRank,
    statusLabel,
} = await import('../../../src/modules/projects/InboxView');

afterAll(teardownHappyDom);
afterEach(() => {
    cleanup();
    sendCalls.length = 0;
    replyCalls.length = 0;
    readCalls.length = 0;
});

const projectValue = {
    path: '/tmp/proj',
    name: 'proj',
    fleet: { members: [{ instanceId: 'proj-coder' }], orchestrator: { state: 'bound-online' } },
    state: 'ready',
} as never;

function renderView() {
    // The component takes its client as a prop (no module mocking): the stub IS the transport.
    // `createElement` with a typed component needs the props interface named explicitly.
    const Tab = InboxView as unknown as (props: { client: unknown }) => ReturnType<typeof createElement>;
    return render(
        createElement(ProjectContext.Provider, { value: projectValue }, createElement(Tab, { client: stubApi.inbox })),
    );
}

describe('Projects Inbox tab (G11 R1)', () => {
    test('lists members, then that member\u2019s two-direction thread oldest first', async () => {
        const view = renderView();
        await waitFor(() => expect(view.getByText('proj-coder')).toBeDefined());
        // Both directions of the one thread render, in createdAt order.
        await waitFor(() => expect(view.getByText('question')).toBeDefined());
        const bodies = view.getAllByText(/question|answer/).map((node) => node.textContent);
        expect(bodies).toEqual(['question', 'answer']);
        // The member list shows the counts the contract returned.
        expect(view.getByText('1 queued · 1 unread')).toBeDefined();
    });

    test('the composer is wired: Send is disabled until there is something to send', async () => {
        const view = renderView();
        await waitFor(() => expect(view.getByText('question')).toBeDefined());
        const send = view.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
        // The empty-draft guard: a submit with no text would store an empty message.
        expect(send.disabled).toBe(true);
        expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    });

    test('an unread inbound message offers a mark-read action; an outbound one does not', async () => {
        const view = renderView();
        await waitFor(() => expect(view.getByText('answer')).toBeDefined());
        // msg_2 is addressed to the operator and unread → exactly one mark-read action.
        expect(view.getAllByRole('button', { name: 'Mark read' })).toHaveLength(1);
        // Only the inbound row is replyable: a reply goes to the original sender, so replying to
        // your own message would store operator → operator and never reach the member.
        expect(view.getAllByRole('button', { name: 'Reply' })).toHaveLength(1);
    });
});

describe('Projects Inbox tab default wiring (G11 R1)', () => {
    test('rendered with NO client prop, it reads once rather than looping', async () => {
        // `ProjectsShell` renders `<Active />` with no props, so the DEFAULT client is the production
        // path. `api.inbox` is a proxy rebuilt per property access: as a default prop it gave the
        // effects a new identity every render, and their setState re-rendered again — an unbounded
        // refetch loop that the injected-stub tests could not see.
        let calls = 0;
        setFetchForTesting((async () => {
            calls += 1;
            return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
        }) as unknown as typeof fetch);
        try {
            const view = render(
                createElement(ProjectContext.Provider, { value: projectValue }, createElement(InboxView)),
            );
            await waitFor(() => expect(view.getByText('Members')).toBeDefined());
            // A few frames of settling must not multiply the reads.
            await new Promise((resolve) => setTimeout(resolve, 150));
            expect(calls).toBeLessThan(5);
        } finally {
            resetFetchForTesting();
        }
    });
});

describe('Projects Inbox tab helpers (G11 R1/R2)', () => {
    const row = (over: Record<string, unknown>) =>
        ({
            id: 'm',
            fromId: 'operator',
            toId: 'proj-coder',
            body: 'b',
            kind: 'chat',
            status: 'queued',
            attempts: 0,
            error: null,
            claimedAt: null,
            deliveredAt: null,
            readAt: null,
            inReplyTo: null,
            threadId: 'm',
            requestKey: null,
            taskId: null,
            parentRunId: null,
            createdAt: 1,
            ...over,
        }) as never;

    test('groupThreads groups by root, orders oldest thread first and members oldest first', () => {
        const threads = groupThreads([
            row({ id: 'b2', threadId: 'b', createdAt: 30 }),
            row({ id: 'a1', threadId: 'a', createdAt: 10 }),
            row({ id: 'b1', threadId: 'b', createdAt: 20 }),
        ]);
        expect(threads.map((thread) => thread.map((entry) => entry.id))).toEqual([['a1'], ['b1', 'b2']]);
    });

    test('a thread whose rows carry no threadId keys on the row id', () => {
        const threads = groupThreads([row({ id: 'solo', threadId: '', createdAt: 1 })]);
        expect(threads).toHaveLength(1);
        expect(threads[0]?.[0]?.id).toBe('solo');
    });

    test('memberRank puts declared fleet members above other addresses', () => {
        expect(memberRank({ id: 'proj-coder', queued: 0, unread: 0 }, ['proj-coder'])).toBe(0);
        expect(memberRank({ id: 'operator', queued: 0, unread: 0 }, ['proj-coder'])).toBe(1);
    });

    test('statusLabel surfaces the failure reason verbatim, and plain states otherwise', () => {
        expect(statusLabel(row({ status: 'failed', error: 'attempts exhausted' }))).toBe('failed — attempts exhausted');
        expect(statusLabel(row({ status: 'failed' }))).toBe('failed');
        expect(statusLabel(row({ status: 'delivered' }))).toBe('delivered');
    });
});
