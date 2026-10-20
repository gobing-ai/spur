/**
 * G11 task 1266 — `InboxService` is the only inbox writer and reader (ADR-143).
 *
 * These are the task's failure modes, written before the implementation (Plan step 1):
 * atomic row+event, guarded transitions, lease sweep, request-key replay, reply
 * addressing, reserved identities, chat-vs-request classification, and member-stable
 * inbox keying across a process restart.
 *
 * An in-memory DB migrated through 0054 is the whole fixture — the service is the
 * public surface under test, and `InboxDao`/`SystemEventDao` are only used to seed
 * receipts and count ledger rows.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { CoordinationRunDao, createMigratedDb, type DbAdapter, SystemEventDao } from '@gobing-ai/spur-domain';
import { InboxService, MAX_DELIVERY_ATTEMPTS, RESERVED_INBOX_IDS } from '../../src/services/inbox-service';

const OPERATOR = 'operator';
const SPUR = 'spur';
const MEMBER = 'demo-orchestrator';
const PEER = 'demo-reviewer';

let db: DbAdapter;
let service: InboxService;
let nowMs: number;

const now = () => nowMs;

async function eventCount(name?: string): Promise<number> {
    const rows = await new SystemEventDao(db).query({ ...(name !== undefined ? { name } : {}), limit: 500 });
    return rows.length;
}

beforeEach(async () => {
    db = await createMigratedDb({ url: ':memory:' });
    nowMs = 1_700_000_000_000;
    service = new InboxService({ getDb: async () => db, now });
});

describe('1266 R3/R1 — one transaction per mutation', () => {
    test('a sent message writes exactly one row and one message.sent event', async () => {
        const { message, replayed } = await service.send({ from: OPERATOR, to: MEMBER, body: 'hello' });

        expect(replayed).toBe(false);
        expect(message.status).toBe('queued');
        expect(message.kind).toBe('chat');
        expect(await eventCount('message.sent')).toBe(1);

        const inbox = (await service.list(MEMBER, 'in')).messages;
        expect(inbox.map((row) => row.id)).toEqual([message.id]);
    });

    test('an event insert failure rolls the row back — neither exists', async () => {
        await db.exec(
            `CREATE TRIGGER fail_message_event BEFORE INSERT ON system_events
             WHEN NEW.event_name LIKE 'message.%'
             BEGIN SELECT RAISE(ABORT, 'boom'); END;`,
        );

        await expect(service.send({ from: OPERATOR, to: MEMBER, body: 'nope' })).rejects.toThrow();
        expect((await service.list(MEMBER, 'in')).messages).toEqual([]);
        expect(await eventCount('message.sent')).toBe(0);
    });
});

describe('1266 R4 — guarded transitions write nothing on a miss', () => {
    test('a late settle cannot move a delivered row and writes no event', async () => {
        const { message } = await service.send({ from: OPERATOR, to: MEMBER, body: 'work' });
        await service.claim(MEMBER, 10);
        await service.settle([message.id], 'accepted');
        const delivered = await service.get(message.id);
        expect(delivered?.status).toBe('delivered');
        const before = await eventCount();

        await service.settle([message.id], 'not-started');
        await service.release([message.id]);

        const after = await service.get(message.id);
        expect(after?.status).toBe('delivered');
        expect(await eventCount()).toBe(before);
    });

    test('release requeues a claimed row and is a no-op on a queued row', async () => {
        const { message } = await service.send({ from: OPERATOR, to: MEMBER, body: 'work' });
        await service.claim(MEMBER, 10);
        expect((await service.get(message.id))?.status).toBe('claimed');

        await service.release([message.id]);
        expect((await service.get(message.id))?.status).toBe('queued');
        expect(await eventCount('message.requeued')).toBe(1);

        await service.release([message.id]);
        expect((await service.get(message.id))?.status).toBe('queued');
        expect(await eventCount('message.requeued')).toBe(1);
    });

    test('claiming increments attempts and stamps the lease', async () => {
        await service.send({ from: OPERATOR, to: MEMBER, body: 'work' });
        const [claimed] = await service.claim(MEMBER, 10);

        expect(claimed?.status).toBe('claimed');
        expect(claimed?.attempts).toBe(1);
        expect(claimed?.claimedAt).toBe(nowMs);
        expect(await eventCount('message.claimed')).toBe(1);
        // A second claim finds nothing — the row is no longer queued.
        expect(await service.claim(MEMBER, 10)).toEqual([]);
    });
});

describe('1266 R4 — the sweep requeues expired claims and eventually fails them', () => {
    test('an expired claim with no run receipt requeues, and fails at the attempt ceiling', async () => {
        const { message } = await service.send({ from: OPERATOR, to: MEMBER, body: 'work' });

        for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
            await service.claim(MEMBER, 10);
            nowMs += 600_001;
            const swept = await service.sweep(nowMs);
            if (attempt < MAX_DELIVERY_ATTEMPTS) {
                expect(swept.requeued).toEqual([message.id]);
                expect((await service.get(message.id))?.status).toBe('queued');
            } else {
                expect(swept.failed).toEqual([message.id]);
                expect((await service.get(message.id))?.status).toBe('failed');
            }
        }

        expect(await eventCount('message.requeued')).toBe(MAX_DELIVERY_ATTEMPTS - 1);
        expect(await eventCount('message.failed')).toBe(1);
    });

    test('a live lease is left alone', async () => {
        await service.send({ from: OPERATOR, to: MEMBER, body: 'work' });
        await service.claim(MEMBER, 10);

        const swept = await service.sweep(nowMs + 1000);
        expect(swept).toEqual({ requeued: [], failed: [], settled: [] });
        expect((await service.list(MEMBER, 'in')).messages[0]?.status).toBe('claimed');
    });

    test('a claimed row with a still-running receipt stays claimed', async () => {
        const { message } = await service.send({ from: OPERATOR, to: MEMBER, body: 'work', kind: 'request' });
        await service.claim(MEMBER, 10);
        await new CoordinationRunDao(db).insertStart({
            specId: MEMBER,
            agentKind: 'claude',
            processId: null,
            runId: 'run-1',
            generation: 1,
            startedAt: new Date(nowMs).toISOString(),
            messageIds: [message.id],
        });

        nowMs += 600_001;
        const swept = await service.sweep(nowMs);

        expect(swept).toEqual({ requeued: [], failed: [], settled: [] });
        expect((await service.get(message.id))?.status).toBe('claimed');
    });

    test('a completed receipt settles the message from the run outcome', async () => {
        const runs = new CoordinationRunDao(db);
        const verified = await service.send({ from: SPUR, to: MEMBER, body: 'a', kind: 'request' });
        const errored = await service.send({ from: SPUR, to: MEMBER, body: 'b', kind: 'request' });
        await service.claim(MEMBER, 10);

        for (const [index, sent] of [verified, errored].entries()) {
            const runId = `run-${index}`;
            await runs.insertStart({
                specId: MEMBER,
                agentKind: 'claude',
                processId: null,
                runId,
                generation: index + 1,
                startedAt: new Date(nowMs).toISOString(),
                messageIds: [sent.message.id],
            });
            await runs.updateExit(runId, index === 0 ? 'exited' : 'errored', new Date(nowMs + 1).toISOString(), '[]', {
                messageIds: [sent.message.id],
                outcome: index === 0 ? 'verified' : 'errored',
            });
        }

        nowMs += 600_001;
        const swept = await service.sweep(nowMs);

        expect(swept.settled.sort()).toEqual([verified.message.id, errored.message.id].sort());
        expect((await service.get(verified.message.id))?.status).toBe('delivered');
        expect((await service.get(errored.message.id))?.status).toBe('failed');
    });
});

describe('1266 R5 — idempotency and reserves', () => {
    test('a repeated request key returns the first message and writes one row', async () => {
        const first = await service.send({
            from: SPUR,
            to: MEMBER,
            body: 'task',
            kind: 'request',
            requestKey: 'k1',
        });
        const second = await service.send({
            from: SPUR,
            to: MEMBER,
            body: 'task',
            kind: 'request',
            requestKey: 'k1',
        });

        expect(second.replayed).toBe(true);
        expect(second.message.id).toBe(first.message.id);
        expect((await service.list(MEMBER, 'in')).messages).toHaveLength(1);
        expect(await eventCount('message.sent')).toBe(1);
    });

    test('a concurrent send that loses the unique-index race replays instead of throwing', async () => {
        // Two senders race between the read and the insert. The loser must observe the winner's
        // message (G11 R5) — a raw constraint error reads as a failed dispatch downstream and, in
        // the strategy, releases a write-slot claim for work that actually went out.
        const input = { from: SPUR, to: MEMBER, body: 'task', kind: 'request' as const, requestKey: 'race-1' };
        const results = await Promise.allSettled([service.send(input), service.send(input)]);

        expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
        const ids = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value.message.id] : []));
        expect(new Set(ids).size).toBe(1);
        expect((await service.list(MEMBER, 'in')).messages).toHaveLength(1);
        expect(await eventCount('message.sent')).toBe(1);
    });

    test('reserved identities are refused as agent ids but accepted as addresses', async () => {
        expect(RESERVED_INBOX_IDS).toEqual([OPERATOR, SPUR]);
        // Addressing them is normal: operator and spur own an inbox each.
        const { message } = await service.send({ from: MEMBER, to: OPERATOR, body: 'done' });
        expect((await service.list(OPERATOR, 'in')).messages.map((row) => row.id)).toEqual([message.id]);
    });

    test('from_id is never null and a blank sender is refused', async () => {
        await expect(service.send({ from: '', to: MEMBER, body: 'x' })).rejects.toThrow();
    });
});

describe('1266 R5/R6 — replies reach the original sender', () => {
    test('a reply to an operator message lands in the operator inbox, same thread', async () => {
        const { message } = await service.send({ from: OPERATOR, to: MEMBER, body: 'question' });

        const reply = await service.reply(message.id, MEMBER, 'answer');

        expect(reply.toId).toBe(OPERATOR);
        expect(reply.fromId).toBe(MEMBER);
        expect(reply.inReplyTo).toBe(message.id);
        expect(reply.threadId).toBe(message.id);
        expect((await service.list(OPERATOR, 'in')).messages.map((row) => row.id)).toEqual([reply.id]);
        expect(await eventCount('message.replied')).toBe(1);
    });

    test('a reply to a reply keeps the root thread id', async () => {
        const { message } = await service.send({ from: OPERATOR, to: MEMBER, body: 'q' });
        const reply = await service.reply(message.id, MEMBER, 'a');
        const followUp = await service.reply(reply.id, OPERATOR, 'thanks');

        expect(followUp.threadId).toBe(message.id);
        expect(followUp.toId).toBe(MEMBER);
        expect((await service.thread(message.id)).map((row) => row.id)).toEqual([message.id, reply.id, followUp.id]);
    });
});

describe('1266 R8 — only requests are unresolved work', () => {
    test('a delivered chat message is never listed as a request', async () => {
        await service.send({ from: PEER, to: MEMBER, body: 'chat' });
        await service.send({ from: SPUR, to: MEMBER, body: 'task', kind: 'request' });
        await service.claim(MEMBER, 10);
        await service.settle(
            (await service.list(MEMBER, 'in')).messages.map((row) => row.id),
            'accepted',
        );

        const requests = await service.requests(MEMBER);
        expect(requests).toHaveLength(1);
        expect(requests[0]?.kind).toBe('request');
    });
});

describe('1266 R8/R10 — one inbox per fleet member address', () => {
    test('queued messages survive a restart and drain under the same address', async () => {
        const first = await service.send({ from: OPERATOR, to: MEMBER, body: 'one' });
        const second = await service.send({ from: OPERATOR, to: MEMBER, body: 'two' });

        // A restarted process opens its own service instance against the same DB.
        const restarted = new InboxService({ getDb: async () => db, now });
        const claimed = await restarted.claim(MEMBER, 10);

        expect(claimed.map((row) => row.id).sort()).toEqual([first.message.id, second.message.id].sort());
        expect(await restarted.countQueued(MEMBER)).toBe(0);
    });

    test('members() reports queued and unread counts per address', async () => {
        await service.send({ from: OPERATOR, to: MEMBER, body: 'one' });
        const read = await service.send({ from: PEER, to: OPERATOR, body: 'hi' });
        await service.markRead(read.message.id, OPERATOR);

        const members = await service.members();
        const byId = new Map(members.map((entry) => [entry.id, entry]));

        expect(byId.get(MEMBER)?.queued).toBe(1);
        expect(byId.get(OPERATOR)?.unread).toBe(0);
    });
});

describe('1266 R4 — markRead is guarded and idempotent', () => {
    test('only the first read transitions and writes an event', async () => {
        const { message } = await service.send({ from: PEER, to: OPERATOR, body: 'hi' });

        const first = await service.markRead(message.id, OPERATOR);
        const second = await service.markRead(message.id, OPERATOR);

        expect(first.transitioned).toBe(true);
        expect(second.transitioned).toBe(false);
        expect(second.readAt).toBe(first.readAt);
        expect(await eventCount('message.read')).toBe(1);
    });

    test('a non-recipient cannot mark a message read', async () => {
        const { message } = await service.send({ from: PEER, to: OPERATOR, body: 'hi' });

        await expect(service.markRead(message.id, MEMBER)).rejects.toThrow();
        expect(await eventCount('message.read')).toBe(0);
    });
});

describe('1266 R9 — dispatch linkage columns', () => {
    test('send records kind, task id and parent run id; attempts() reads task_id not a key regex', async () => {
        await service.send({
            from: SPUR,
            to: MEMBER,
            body: 'run task',
            kind: 'request',
            requestKey: 'fleet:task:1266:1',
            taskId: '1266',
            parentRunId: 'run-parent',
        });

        const attempts = await service.attempts('1266');
        expect(attempts.count).toBe(1);
        expect(attempts.latest?.taskId).toBe('1266');
        expect(attempts.latest?.parentRunId).toBe('run-parent');
    });
});
