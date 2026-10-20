/**
 * G11 task 1266 — `InboxDao` owns every statement over `inbox_messages` (ADR-143 R2).
 *
 * The service tests cover the product contract; these pin the DAO's own seams: the
 * row-and-event transaction, `RETURNING`-driven event sets, the guarded transitions, the
 * single joined request read, and the serialization that keeps two consumers on one
 * connection from interleaving `BEGIN IMMEDIATE`.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { createMigratedDb, type DbAdapter, InboxDao, SystemEventDao } from '../../src/index';

let db: DbAdapter;
let dao: InboxDao;

const event = (name: string) => (row: { id: string; createdAt?: number }) => ({
    id: `sev_${name}_${row.id}`,
    event_name: name,
    occurred_at: new Date(row.createdAt ?? Date.now()).toISOString(),
});

beforeEach(async () => {
    db = await createMigratedDb({ url: ':memory:' });
    dao = new InboxDao(db);
});

let seq = 0;
async function seed(overrides: Partial<Parameters<InboxDao['insert']>[0]> = {}) {
    seq += 1;
    const id = `msg_${seq}`;
    return dao.insert(
        {
            id,
            fromId: 'operator',
            toId: 'proj-coder',
            body: `body ${seq}`,
            kind: 'chat',
            status: 'queued',
            requestKey: null,
            taskId: null,
            parentRunId: null,
            inReplyTo: null,
            threadId: id,
            createdAt: seq,
            updatedAt: seq,
            ...overrides,
        },
        event('message.sent') as never,
    );
}

describe('1266 R2 — InboxDao is the single inbox writer', () => {
    test('insert stores the row and one event in one transaction', async () => {
        const row = await seed();
        expect(row.fromId).toBe('operator');
        expect(row.kind).toBe('chat');

        const events = await new SystemEventDao(db).query({ prefix: 'message', limit: 10 });
        expect(events.map((e) => e.event_name)).toEqual(['message.sent']);
    });

    test('an event failure rolls the row back — neither exists', async () => {
        await db.exec(
            `CREATE TRIGGER fail_event BEFORE INSERT ON system_events
             WHEN NEW.event_name = 'message.sent'
             BEGIN SELECT RAISE(ABORT, 'boom'); END;`,
        );
        await expect(seed()).rejects.toThrow('boom');
        expect(await dao.list('proj-coder', 'in', 10, 0)).toEqual([]);
    });

    test('a repeated request key violates the partial unique index', async () => {
        await seed({ requestKey: 'k1' });
        await expect(seed({ requestKey: 'k1' })).rejects.toThrow();
        expect(await dao.findByRequestKey('k1')).not.toBeNull();
    });
});

describe('1266 R3/R4 — guarded transitions emit exactly the changed set', () => {
    test('claim takes only queued rows, oldest first, and charges the budget', async () => {
        const first = await seed();
        const second = await seed();

        const claimed = await dao.claim('proj-coder', 10, 100, event('message.claimed'));
        expect(claimed.map((row) => row.id)).toEqual([first.id, second.id]);
        expect(claimed.every((row) => row.status === 'claimed' && row.attempts === 1)).toBe(true);
        expect(claimed.every((row) => row.claimedAt === 100)).toBe(true);

        // A second claim finds nothing queued, and writes no event.
        expect(await dao.claim('proj-coder', 10, 101, event('message.claimed'))).toEqual([]);
        expect(await new SystemEventDao(db).query({ name: 'message.claimed', limit: 10 })).toHaveLength(2);
    });

    test('settle and release are no-ops on a row outside their prior status', async () => {
        const row = await seed();
        // queued → settle: guard miss, no write, no event.
        expect(await dao.settle([row.id], 'delivered', 10, event('message.delivered'))).toEqual([]);
        expect(await dao.release([row.id], 10, event('message.requeued'))).toEqual([]);
        expect(await new SystemEventDao(db).query({ prefix: 'message', limit: 10 })).toHaveLength(1);
    });

    test('a failed settle stamps no delivered_at', async () => {
        const row = await seed();
        await dao.claim('proj-coder', 10, 100, event('message.claimed'));

        const [failed] = await dao.settle([row.id], 'failed', 200, event('message.failed'), 'boom');
        expect(failed?.status).toBe('failed');
        expect(failed?.error).toBe('boom');
        expect(failed?.deliveredAt).toBeNull();
    });

    test('markRead transitions once and reports a repeat without writing', async () => {
        const row = await seed({ toId: 'operator' });
        const first = await dao.markRead(row.id, 'operator', 500, event('message.read'));
        expect(first?.transitioned).toBe(true);
        expect(first?.message.readAt).toBe(500);

        const second = await dao.markRead(row.id, 'operator', 900, event('message.read'));
        expect(second?.transitioned).toBe(false);
        expect(second?.message.readAt).toBe(500);
        expect(await new SystemEventDao(db).query({ name: 'message.read', limit: 10 })).toHaveLength(1);
    });

    test('markRead answers null for a non-recipient', async () => {
        const row = await seed({ toId: 'operator' });
        expect(await dao.markRead(row.id, 'proj-coder', 500, event('message.read'))).toBeNull();
    });
});

describe('1266 R8 — the request read is one join over requests only', () => {
    test('chat rows never appear, and each request carries its newest receipt', async () => {
        const chat = await seed({ kind: 'chat' });
        const request = await seed({ kind: 'request', taskId: '1266' });
        await db.run(
            `INSERT INTO coordination_runs (spec_id, agent_kind, process_id, run_id, generation, status,
                started_at, completed_at, artifact_refs_json, message_ids_json, task_id, outcome, parent_run_id)
             VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
            'proj-coder',
            'claude',
            'run-1',
            1,
            'exited',
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:01:00.000Z',
            '[]',
            JSON.stringify([request.id]),
            '1266',
            'verified',
        );

        const rows = await dao.requests(['proj-coder']);
        expect(rows.map((row) => row.id)).toEqual([request.id]);
        expect(rows[0]?.runId).toBe('run-1');
        expect(rows[0]?.runOutcome).toBe('verified');
        expect(rows[0]?.runTaskId).toBe('1266');
        expect(chat.kind).toBe('chat');
    });

    test('an empty recipient list asks for nothing; an omitted list scans every address', async () => {
        await seed({ kind: 'request' });
        expect(await dao.requests([])).toEqual([]);
        expect(await dao.requests()).toHaveLength(1);
    });
});

describe('1266 R8/R9 — addresses and task linkage', () => {
    test('distinctRecipients reports queued and unread counts per address', async () => {
        await seed({ toId: 'operator' });
        const read = await seed({ toId: 'operator' });
        await dao.markRead(read.id, 'operator', 10, event('message.read'));

        const members = await dao.distinctRecipients();
        expect(members).toEqual([{ id: 'operator', queued: 2, unread: 1 }]);
    });

    test('attemptsForTask reads the task_id column', async () => {
        await seed({ kind: 'request', taskId: '1266', requestKey: 'fleet:task:1266:1' });
        const second = await seed({ kind: 'request', taskId: '1266', requestKey: 'fleet:task:1266:2' });

        const attempts = await dao.attemptsForTask('1266');
        expect(attempts.count).toBe(2);
        expect(attempts.latest?.id).toBe(second.id);
        expect(attempts.latest?.requestKey).toBe('fleet:task:1266:2');
    });
});

describe('1266 R1 — transactions stay atomic under concurrent consumers', () => {
    test('two claimers on one connection serialize instead of nesting BEGIN', async () => {
        // Two services over the same adapter is the real shape (two consumers, one process).
        await seed();
        await seed();
        const other = new InboxDao(db);

        const [left, right] = await Promise.all([
            dao.claim('proj-coder', 10, 100, event('message.claimed')),
            other.claim('proj-coder', 10, 100, event('message.claimed')),
        ]);

        const claimed = [...left, ...right];
        expect(claimed).toHaveLength(2);
        expect(new Set(claimed.map((row) => row.id)).size).toBe(2);
    });
});
