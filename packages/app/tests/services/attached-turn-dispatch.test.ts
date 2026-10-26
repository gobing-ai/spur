/**
 * Task 1282 — the attached-occupant turn dispatcher (design `fleet-attached-occupants` §5–6).
 *
 * Failure-first: every test pins one way an attached stage could silently corrupt a keyed run
 * — an unparseable or plain reply certifying a turn, a foreign request/stale attempt/stale pin
 * promoting someone else's completion, or a deadline/abort inventing a definite outcome. The
 * reply correlation is the ONLY completion authority here (R3); the artifact/contract check
 * stays downstream (1275), so these tests assert correlation semantics, not contracts.
 */

import { describe, expect, test } from 'bun:test';
import type { WarmTurnContext, WarmTurnDispatch } from '../../src/observability/agent-execution';
import { type AttachedTurnReceipt, createAttachedTurnDispatcher } from '../../src/services/attached-turn-dispatch';
import type { InboxMessage } from '../../src/services/inbox-service';

const BINDING = { memberId: 'proj-coder', ownerEpoch: 3, occupantGeneration: 4 };

function turnContext(overrides: Partial<WarmTurnContext> = {}): WarmTurnContext {
    return {
        agent: 'pi',
        prompt: '/sp:dev-run 0042 --auto',
        cwd: '/tmp/project',
        role: 'coder',
        correlation: { runId: 'run-1', executionId: 'exec-1', requestId: 'req-1', attempt: 1 },
        ...overrides,
    } as WarmTurnContext;
}

/** A reply row as `message reply` would produce it: linked back to the dispatch. */
function reply(messageId: string, body: string): InboxMessage {
    return {
        id: `reply-${Math.random().toString(36).slice(2)}`,
        fromId: BINDING.memberId,
        toId: 'orchestrator',
        body,
        kind: 'request',
        status: 'queued',
        claimedAt: null,
        attempts: 0,
        error: null,
        deliveredAt: null,
        readAt: null,
        inReplyTo: messageId,
        threadId: messageId,
        requestKey: null,
        taskId: null,
        parentRunId: null,
        createdAt: 0,
        updatedAt: 0,
    };
}

interface Rig {
    diagnostics: Array<{ event: string; reason: string; turn: AttachedTurnReceipt }>;
    enqueued: Array<{ member: string; requestKey: string; body: string }>;
    dispatch(context: WarmTurnContext): Promise<WarmTurnDispatch>;
    /** Queue one reply row for the next (or a later) poll. */
    queue(message: InboxMessage): void;
    abort(): void;
    lastTurn(): AttachedTurnReceipt | undefined;
}

function rig(): Rig {
    let clock = 0;
    let messageId = 0;
    const pending: InboxMessage[] = [];
    const diagnostics: Rig['diagnostics'] = [];
    const enqueued: Rig['enqueued'] = [];
    const controller = new AbortController();
    const dispatcher = createAttachedTurnDispatcher({
        dispatcher: {
            enqueue: async (req) => {
                messageId += 1;
                enqueued.push({ member: req.member, requestKey: req.requestKey, body: req.body });
                return { messageId: `msg-${messageId}`, replayed: false };
            },
        },
        replies: async (id) => {
            const mine = pending.filter((row) => row.inReplyTo === id);
            for (const row of mine) pending.splice(pending.indexOf(row), 1);
            return mine;
        },
        binding: BINDING,
        now: () => clock,
        sleep: async (ms) => {
            clock += ms;
        },
        diagnose: (detail) => diagnostics.push(detail),
    });
    return {
        diagnostics,
        enqueued,
        dispatch: (context) => dispatcher.dispatchTurn(context),
        queue: (message) => pending.push(message),
        abort: () => controller.abort(),
        lastTurn: dispatcher.lastTurn,
    };
}

const MATCHING = JSON.stringify({
    requestId: 'req-1',
    attempt: 1,
    ownerEpoch: BINDING.ownerEpoch,
    occupancyGeneration: BINDING.occupantGeneration,
    artifact: 'docs/tasks5/0042_done.md',
});

describe('attached turn dispatch — the only completion is a correlated reply with a valid pin (R3)', () => {
    test('a matching reply certifies the turn and pins the receipt (AC3)', async () => {
        const r = rig();
        const pending = r.dispatch(turnContext());
        r.queue(reply('msg-1', MATCHING));
        const result = await pending;
        expect(result.kind).toBe('warm');
        if (result.kind !== 'warm') return;
        expect(result.outcome.kind).toBe('success');
        expect(result.outcome.finalText).toBe('docs/tasks5/0042_done.md');
        expect(r.lastTurn()).toEqual({
            mode: 'attached',
            occupant: 'attached',
            requestId: 'req-1',
            attempt: 1,
            memberId: 'proj-coder',
            ownerEpoch: 3,
            occupantGeneration: 4,
            replyMessageId: expect.any(String),
        });
        // The keyed request goes through the single enqueue path with the correlation key.
        expect(r.enqueued).toEqual([
            { member: 'proj-coder', requestKey: 'fleet:task:req-1:1', body: '/sp:dev-run 0042 --auto' },
        ]);
    });

    test('an unparseable reply body is diagnostic evidence only', async () => {
        const r = rig();
        const pending = r.dispatch(turnContext());
        r.queue(reply('msg-1', 'done, see the file'));
        r.queue(reply('msg-1', MATCHING));
        const result = await pending;
        expect(result.kind).toBe('warm');
        expect(r.diagnostics.map((d) => d.reason)).toEqual(['unparseable-reply']);
    });

    test('a structurally-typed body with a non-numeric correlation field is unparseable', async () => {
        const r = rig();
        const pending = r.dispatch(turnContext());
        r.queue(reply('msg-1', JSON.stringify({ ...JSON.parse(MATCHING), attempt: 'first' })));
        r.queue(reply('msg-1', MATCHING));
        const result = await pending;
        expect(result.kind).toBe('warm');
        expect(r.diagnostics.map((d) => d.reason)).toEqual(['unparseable-reply']);
    });

    test('the default clock and sleep resolve after one poll cycle', async () => {
        const pending: InboxMessage[] = [];
        let polls = 0;
        const dispatcher = createAttachedTurnDispatcher({
            dispatcher: {
                enqueue: async () => ({ messageId: 'msg-1', replayed: false }),
            },
            replies: async (id) => {
                polls += 1;
                return polls >= 2 ? pending.filter((row) => row.inReplyTo === id) : [];
            },
            binding: BINDING,
            pollMs: 5,
        });
        const settled = reply('msg-1', MATCHING);
        pending.push(settled);
        const result = await dispatcher.dispatchTurn(turnContext());
        expect(polls).toBe(2);
        expect(result.kind).toBe('warm');
        if (result.kind !== 'warm') return;
        expect(result.outcome.kind).toBe('success');
        expect(dispatcher.lastTurn()?.replyMessageId).toBe(settled.id);
    });

    test('a foreign requestId never completes this turn', async () => {
        const r = rig();
        const pending = r.dispatch(turnContext());
        r.queue(reply('msg-1', JSON.stringify({ ...JSON.parse(MATCHING), requestId: 'req-OTHER' })));
        r.queue(reply('msg-1', MATCHING));
        const result = await pending;
        expect(result.kind).toBe('warm');
        expect(r.diagnostics.map((d) => d.reason)).toEqual(['foreign-request']);
    });

    test('a stale attempt never completes this turn', async () => {
        const r = rig();
        const pending = r.dispatch(turnContext());
        r.queue(reply('msg-1', JSON.stringify({ ...JSON.parse(MATCHING), attempt: 99 })));
        r.queue(reply('msg-1', MATCHING));
        const result = await pending;
        expect(result.kind).toBe('warm');
        expect(r.diagnostics.map((d) => d.reason)).toEqual(['stale-attempt']);
    });

    test('a stale occupancy generation fences the reply off (R4)', async () => {
        const r = rig();
        const pending = r.dispatch(turnContext());
        r.queue(reply('msg-1', JSON.stringify({ ...JSON.parse(MATCHING), occupancyGeneration: 5 })));
        r.queue(reply('msg-1', MATCHING));
        const result = await pending;
        expect(result.kind).toBe('warm');
        expect(r.diagnostics.map((d) => d.reason)).toEqual(['stale-pin']);
        // The fenced evidence never promoted a receipt: only the matching reply did.
        expect(r.lastTurn()?.replyMessageId).not.toBe(r.diagnostics[0]?.turn.replyMessageId);
    });

    test('an aborted wait is outcome-unknown, never a definite failure (R2)', async () => {
        const r = rig();
        const pending = r.dispatch(turnContext());
        r.abort();
        const result = await pending;
        if (result.kind !== 'warm') throw new Error('expected a warm outcome');
        expect(result.outcome.kind).toBe('outcome-unknown');
        expect(r.lastTurn()?.replyMessageId).toBeUndefined();
    });

    test('a deadline without any reply is outcome-unknown (the occupant may still be working)', async () => {
        const r = rig();
        const result = await r.dispatch(turnContext());
        if (result.kind !== 'warm') throw new Error('expected a warm outcome');
        expect(result.outcome.kind).toBe('outcome-unknown');
        expect(result.outcome.reason).toBe('attached turn deadline passed without a correlated reply');
    });

    test('a reply to a DIFFERENT message is invisible to this turn (a delivered message never completes a stage)', async () => {
        const r = rig();
        const pending = r.dispatch(turnContext());
        // Queue for a message id this dispatch never sent — the replies seam never returns it.
        r.queue(reply('msg-other', MATCHING));
        r.queue(reply('msg-1', MATCHING));
        const result = await pending;
        expect(result.kind).toBe('warm');
        expect(r.diagnostics).toEqual([]);
    });
});
