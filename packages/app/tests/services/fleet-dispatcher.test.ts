import { describe, expect, test } from 'bun:test';
import type { CoordinationRunRow } from '@gobing-ai/spur-domain';
import type {
    AgentCoordinationService,
    InboxMessageView,
    SendResult,
} from '../../src/services/agent-coordination-service';
import {
    FleetDispatcher,
    type FleetDispatcherDeps,
    RECEIPT_POLL_INTERVAL_MS,
} from '../../src/services/fleet-dispatcher';

/** One dispatch attempt's request fixture. */
const REQUEST = {
    member: 'proj-coder-1',
    fromId: 'proj-planner-1',
    body: '/sp:dev-run 1073 --auto',
    requestKey: 'fleet:task:1073:1',
};

function runRow(overrides: Partial<CoordinationRunRow> = {}): CoordinationRunRow {
    return {
        spec_id: REQUEST.member,
        agent_kind: 'claude',
        process_id: null,
        run_id: 'run-1',
        generation: 1,
        status: 'running',
        started_at: new Date(0).toISOString(),
        completed_at: null,
        artifact_refs_json: '[]',
        message_ids_json: '["msg-1"]',
        task_id: '1073',
        outcome: 'run-exit-only',
        parent_run_id: null,
        ...overrides,
    };
}

interface Harness {
    dispatcher: FleetDispatcher;
    sends: { fromId: string | null; toId: string; body: string; requestKey: string | undefined }[];
    /** Set what the next {@link AgentCoordinationService.getMessage} read returns. */
    setMessage(message: InboxMessageView | null): void;
    /** Set the run rows {@link CoordinationRunDao.listByMessageId} returns (newest first). */
    setRuns(rows: CoordinationRunRow[]): void;
    /** Number of sleeps performed — proves the poll loop actually waited. */
    sleeps(): number;
    deps: FleetDispatcherDeps;
}

function harness(opts: { replayed?: boolean; onSend?: () => void } = {}): Harness {
    const sends: Harness['sends'] = [];
    let message: InboxMessageView | null = {
        id: 'msg-1',
        toId: REQUEST.member,
        status: 'injected',
        requestKey: REQUEST.requestKey,
    };
    let rows: CoordinationRunRow[] = [];
    let clock = 0;
    let sleepCount = 0;

    const coordination = {
        sendMessage: async (
            fromId: string | null,
            toId: string,
            body: string,
            _replyTo?: string,
            requestKey?: string,
        ): Promise<SendResult> => {
            opts.onSend?.();
            sends.push({ fromId, toId, body, requestKey });
            return {
                msgId: 'msg-1',
                toId,
                status: 'queued',
                injected: false,
                ...(opts.replayed === true ? { replayed: true, requestKey } : {}),
            };
        },
        getMessage: async (): Promise<InboxMessageView | null> => message,
    } as unknown as AgentCoordinationService;

    const runs = {
        listByMessageId: async (): Promise<CoordinationRunRow[]> => rows,
    };

    const deps: FleetDispatcherDeps = {
        coordination,
        runs,
        now: () => clock,
        // Advance the injected clock so a bounded wait terminates without real time.
        sleep: async (ms) => {
            sleepCount++;
            clock += ms;
        },
    };
    return {
        dispatcher: new FleetDispatcher(deps),
        sends,
        setMessage: (next) => {
            message = next;
        },
        setRuns: (next) => {
            rows = next;
        },
        sleeps: () => sleepCount,
        deps,
    };
}

describe('FleetDispatcher.enqueue', () => {
    test('sends through the member occupant with the caller sender and the dispatch key', async () => {
        const h = harness();
        const result = await h.dispatcher.enqueue(REQUEST);
        expect(result).toEqual({ messageId: 'msg-1', replayed: false });
        expect(h.sends).toEqual([
            {
                fromId: 'proj-planner-1',
                toId: 'proj-coder-1',
                body: '/sp:dev-run 1073 --auto',
                requestKey: 'fleet:task:1073:1',
            },
        ]);
    });

    test('a replayed key returns the original message id and is reported as a replay', async () => {
        const h = harness({ replayed: true });
        const result = await h.dispatcher.enqueue(REQUEST);
        expect(result).toEqual({ messageId: 'msg-1', replayed: true });
        expect(h.sends.length).toBe(1);
    });
});

describe('FleetDispatcher.receipt', () => {
    test('an exited run row is completed and carries the run id', async () => {
        const h = harness();
        h.setRuns([runRow({ status: 'exited' })]);
        expect(await h.dispatcher.receipt('msg-1', REQUEST.member)).toEqual({
            status: 'completed',
            messageId: 'msg-1',
            runId: 'run-1',
        });
    });

    test('an errored run row is failed', async () => {
        const h = harness();
        h.setRuns([runRow({ status: 'errored' })]);
        expect(await h.dispatcher.receipt('msg-1', REQUEST.member)).toEqual({
            status: 'failed',
            messageId: 'msg-1',
            runId: 'run-1',
        });
    });

    test('a running run row is still pending — null, never a failure', async () => {
        const h = harness();
        h.setRuns([runRow({ status: 'running' })]);
        expect(await h.dispatcher.receipt('msg-1', REQUEST.member)).toBeNull();
    });

    test('a settled-failed inbox row with no run row is not-started', async () => {
        const h = harness();
        h.setRuns([]);
        h.setMessage({ id: 'msg-1', toId: REQUEST.member, status: 'failed', requestKey: REQUEST.requestKey });
        expect(await h.dispatcher.receipt('msg-1', REQUEST.member)).toEqual({
            status: 'not-started',
            messageId: 'msg-1',
        });
    });

    test('a queued inbox row with no run row is pending', async () => {
        const h = harness();
        h.setRuns([]);
        h.setMessage({ id: 'msg-1', toId: REQUEST.member, status: 'queued', requestKey: REQUEST.requestKey });
        expect(await h.dispatcher.receipt('msg-1', REQUEST.member)).toBeNull();
    });

    test('a run row for a DIFFERENT occupant is ignored', async () => {
        const h = harness();
        h.setRuns([runRow({ spec_id: 'proj-coder-2', status: 'exited' })]);
        expect(await h.dispatcher.receipt('msg-1', REQUEST.member)).toBeNull();
    });

    test('the pinned occupant wins over a newer row from another member', async () => {
        const h = harness();
        h.setRuns([runRow({ spec_id: 'proj-coder-2', status: 'exited' }), runRow({ status: 'errored' })]);
        expect(await h.dispatcher.receipt('msg-1', REQUEST.member)).toEqual({
            status: 'failed',
            messageId: 'msg-1',
            runId: 'run-1',
        });
    });
});

describe('FleetDispatcher.awaitReceipt', () => {
    test('a deadline that passes with no receipt is outcome-unknown', async () => {
        const h = harness();
        h.setRuns([]);
        const receipt = await h.dispatcher.awaitReceipt('msg-1', REQUEST.member, {
            timeoutMs: RECEIPT_POLL_INTERVAL_MS * 3,
        });
        expect(receipt).toEqual({ status: 'outcome-unknown', messageId: 'msg-1' });
        expect(h.sleeps()).toBe(3);
    });

    test('a receipt arriving mid-wait is returned without burning the whole deadline', async () => {
        const h = harness();
        let reads = 0;
        h.setRuns([runRow({ status: 'running' })]);
        const original = h.deps.runs.listByMessageId.bind(h.deps.runs);
        h.deps.runs.listByMessageId = async (messageId: string) => {
            reads++;
            if (reads >= 3) return [runRow({ status: 'exited' })];
            return original(messageId);
        };
        const receipt = await h.dispatcher.awaitReceipt('msg-1', REQUEST.member, {
            timeoutMs: RECEIPT_POLL_INTERVAL_MS * 10,
        });
        expect(receipt).toEqual({ status: 'completed', messageId: 'msg-1', runId: 'run-1' });
        expect(h.sleeps()).toBe(2);
    });

    test('the DEFAULT poll cadence waits and resolves a receipt that arrives later', async () => {
        // Exercises the real `now`/`sleep` defaults (no injected clock), so the shipped
        // poll cadence is the one under test rather than a test double.
        let reads = 0;
        const dispatcher = new FleetDispatcher({
            coordination: {
                sendMessage: async (): Promise<SendResult> => ({
                    msgId: 'msg-1',
                    toId: REQUEST.member,
                    status: 'queued',
                    injected: false,
                }),
                getMessage: async () => null,
            } as unknown as AgentCoordinationService,
            runs: {
                listByMessageId: async () => {
                    reads++;
                    return reads >= 2 ? [runRow({ status: 'exited' })] : [runRow({ status: 'running' })];
                },
            },
        });
        const started = Date.now();
        const receipt = await dispatcher.awaitReceipt('msg-1', REQUEST.member, {
            timeoutMs: RECEIPT_POLL_INTERVAL_MS * 5,
        });
        expect(receipt).toEqual({ status: 'completed', messageId: 'msg-1', runId: 'run-1' });
        expect(Date.now() - started).toBeGreaterThanOrEqual(RECEIPT_POLL_INTERVAL_MS - 10);
    });

    test('an aborted wait stops immediately as outcome-unknown', async () => {
        const h = harness();
        h.setRuns([]);
        const controller = new AbortController();
        controller.abort();
        const receipt = await h.dispatcher.awaitReceipt('msg-1', REQUEST.member, {
            timeoutMs: RECEIPT_POLL_INTERVAL_MS * 10,
            signal: controller.signal,
        });
        expect(receipt).toEqual({ status: 'outcome-unknown', messageId: 'msg-1' });
        expect(h.sleeps()).toBe(0);
    });
});

describe('FleetDispatcher.dispatch', () => {
    test('enqueues once and resolves the receipt for the pinned member', async () => {
        const h = harness();
        h.setRuns([runRow({ status: 'exited' })]);
        const receipt = await h.dispatcher.dispatch(REQUEST, { timeoutMs: 1000 });
        expect(receipt).toEqual({ status: 'completed', messageId: 'msg-1', runId: 'run-1' });
        expect(h.sends.length).toBe(1);
    });

    test('a timeout is outcome-unknown — never failed, never not-started (R2)', async () => {
        const h = harness();
        h.setRuns([]);
        const receipt = await h.dispatcher.dispatch(REQUEST, { timeoutMs: RECEIPT_POLL_INTERVAL_MS });
        expect(receipt).toEqual({ status: 'outcome-unknown', messageId: 'msg-1' });
        expect(h.sends.length).toBe(1);
    });
});
