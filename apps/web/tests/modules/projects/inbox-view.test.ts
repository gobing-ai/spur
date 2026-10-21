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
const listCalls: Array<{ cursor?: string }> = [];
/** The newest page's `nextCursor`; a test sets it to offer older history. */
let newestCursor: string | null = null;

const olderRow = {
    id: 'msg_0',
    fromId: 'operator',
    toId: 'proj-coder',
    body: 'older question',
    kind: 'chat',
    status: 'delivered',
    attempts: 1,
    error: null,
    claimedAt: null,
    deliveredAt: null,
    readAt: null,
    inReplyTo: null,
    threadId: 'msg_0',
    requestKey: null,
    taskId: null,
    parentRunId: null,
    createdAt: 0,
};

function newestPage() {
    return {
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
        nextCursor: newestCursor,
    };
}

const stubApi = {
    inbox: {
        members: async () => [
            { id: 'proj-coder', queued: 1, unread: 1 },
            { id: 'operator', queued: 0, unread: 0 },
        ],
        list: async (input: { cursor?: string }) => {
            listCalls.push(input);
            if (input.cursor !== undefined) return { messages: [olderRow], nextCursor: null };
            return newestPage();
        },
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

const { cleanup, fireEvent, render, waitFor } = await import('@testing-library/react');
const { resetFetchForTesting, setFetchForTesting } = await import('../../../src/lib/rpc-client');
const { createElement } = await import('react');
const { ProjectContext } = await import('../../../src/modules/projects/useProjectContext');
const {
    default: InboxView,
    frameTargets,
    groupThreads,
    mergePages,
    memberRank,
    statusLabel,
} = await import('../../../src/modules/projects/InboxView');

afterAll(teardownHappyDom);
afterEach(() => {
    cleanup();
    sendCalls.length = 0;
    replyCalls.length = 0;
    readCalls.length = 0;
    listCalls.length = 0;
    newestCursor = null;
});

const projectValue = {
    path: '/tmp/proj',
    name: 'proj',
    fleet: { members: [{ instanceId: 'proj-coder' }], orchestrator: { state: 'bound-online' } },
    state: 'ready',
} as never;

/**
 * Type into a controlled field. `tests/happy-dom.ts` imports testing-library statically, so react-dom
 * evaluates before `window` exists and wires its legacy input polyfill (focusin + keyup value
 * check) instead of native `input` events; a bare `fireEvent.change` never reaches `onChange`.
 */
function type(field: HTMLTextAreaElement, value: string): void {
    fireEvent.focusIn(field);
    fireEvent.change(field, { target: { value } });
    fireEvent.keyUp(field);
}

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

describe('Projects Inbox tab actions reach the contract (G11 R1/R2)', () => {
    test('typing and submitting sends to the selected member as operator, scoped to the project', async () => {
        const view = renderView();
        await waitFor(() => expect(view.getByText('question')).toBeDefined());
        const box = view.getByRole('textbox') as HTMLTextAreaElement;
        type(box, '  hello coder  ');
        fireEvent.submit(box.closest('form') as HTMLFormElement);
        await waitFor(() => expect(sendCalls).toHaveLength(1));
        expect(sendCalls[0]).toEqual({ to: 'proj-coder', projectPath: '/tmp/proj', body: 'hello coder' });
        expect(replyCalls).toHaveLength(0);
        await waitFor(() => expect(box.value).toBe(''));
    });

    test('Reply on an inbound row turns the composer into a reply to that message', async () => {
        const view = renderView();
        await waitFor(() => expect(view.getByText('answer')).toBeDefined());
        fireEvent.click(view.getByRole('button', { name: 'Reply' }));
        await waitFor(() => expect(view.getByText(/Replying to proj-coder/)).toBeDefined());
        const box = view.getByRole('textbox') as HTMLTextAreaElement;
        type(box, 'got it');
        fireEvent.submit(box.closest('form') as HTMLFormElement);
        await waitFor(() => expect(replyCalls).toHaveLength(1));
        expect(replyCalls[0]).toEqual({ id: 'msg_2', from: 'operator', body: 'got it' });
        expect(sendCalls).toHaveLength(0);
    });

    test('Mark read marks the inbound row read as the operator', async () => {
        const view = renderView();
        await waitFor(() => expect(view.getByText('answer')).toBeDefined());
        fireEvent.click(view.getByRole('button', { name: 'Mark read' }));
        await waitFor(() => expect(readCalls).toHaveLength(1));
        expect(readCalls[0]).toEqual({ id: 'msg_2', reader: 'operator' });
    });

    test('Load older appears only with a cursor and appends the older page', async () => {
        newestCursor = 'cur_1';
        const view = renderView();
        await waitFor(() => expect(view.getByText('question')).toBeDefined());
        fireEvent.click(view.getByRole('button', { name: 'Load older' }));
        await waitFor(() => expect(view.getByText('older question')).toBeDefined());
        expect(listCalls.some((call) => call.cursor === 'cur_1')).toBe(true);
        // The older page carried no cursor, so the affordance is gone.
        await waitFor(() => expect(view.queryByRole('button', { name: 'Load older' })).toBeNull());
    });

    test('no cursor, no Load older', async () => {
        const view = renderView();
        await waitFor(() => expect(view.getByText('question')).toBeDefined());
        expect(view.queryByRole('button', { name: 'Load older' })).toBeNull();
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

    test('frameTargets: members always refetch; the thread only for the selected member or an id-less frame', () => {
        const frame = (data: unknown) => ({ eventName: 'message.sent', payload: { data } });
        expect(frameTargets(frame({ fromId: 'operator', toId: 'proj-coder' }), 'proj-coder')).toEqual({
            members: true,
            thread: true,
        });
        expect(frameTargets(frame({ fromId: 'operator', toId: 'proj-other' }), 'proj-coder')).toEqual({
            members: true,
            thread: false,
        });
        expect(frameTargets(frame(undefined), 'proj-coder')).toEqual({ members: true, thread: true });
        expect(frameTargets({ eventName: 'task.updated', payload: {} }, 'proj-coder')).toEqual({
            members: false,
            thread: false,
        });
        expect(frameTargets(null, 'proj-coder')).toEqual({ members: false, thread: false });
    });

    test('mergePages keeps loaded older rows and lets the fresh copy of a row win', () => {
        const merged = mergePages(
            [row({ id: 'a', status: 'delivered' }), row({ id: 'b' })],
            [row({ id: 'a', status: 'queued' }), row({ id: 'z' })],
        ) as unknown as Array<{ id: string; status: string }>;
        expect(merged.map((entry) => entry.id)).toEqual(['a', 'b', 'z']);
        expect(merged[0]?.status).toBe('delivered');
    });

    test('statusLabel surfaces the failure reason verbatim, and plain states otherwise', () => {
        expect(statusLabel(row({ status: 'failed', error: 'attempts exhausted' }))).toBe('failed — attempts exhausted');
        expect(statusLabel(row({ status: 'failed' }))).toBe('failed');
        expect(statusLabel(row({ status: 'delivered' }))).toBe('delivered');
    });
});
