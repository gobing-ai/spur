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
        expect(await dao.list('proj-coder', 'in', 10)).toEqual([]);
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
        expect(await dao.settle([{ id: row.id, attempts: 1 }], 'delivered', 10, event('message.delivered'))).toEqual(
            [],
        );
        expect(await dao.release([{ id: row.id, attempts: 1 }], 10, event('message.requeued'))).toEqual([]);
        expect(await new SystemEventDao(db).query({ prefix: 'message', limit: 10 })).toHaveLength(1);
    });

    test('a failed settle stamps no delivered_at', async () => {
        const row = await seed();
        await dao.claim('proj-coder', 10, 100, event('message.claimed'));

        const [failed] = await dao.settle(
            [{ id: row.id, attempts: 1 }],
            'failed',
            200,
            event('message.failed'),
            'boom',
        );
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

describe('1271 — transaction isolation and claim ownership', () => {
    test('a failed inbox transaction cannot absorb an unrelated concurrent write', async () => {
        await db.exec('CREATE TABLE unrelated_write (id TEXT PRIMARY KEY)');
        await db.exec(`CREATE TRIGGER fail_isolated_event BEFORE INSERT ON system_events
            WHEN NEW.event_name = 'message.sent' BEGIN SELECT RAISE(ABORT, 'event failed'); END;`);
        const failed = seed().catch((error: unknown) => error);
        await Promise.resolve();
        await db.run('INSERT INTO unrelated_write VALUES (?)', 'other-request');
        expect(await failed).toBeInstanceOf(Error);
        expect(await db.queryAll('SELECT id FROM unrelated_write')).toEqual([{ id: 'other-request' }]);
        expect(await dao.list('proj-coder', 'in', 10)).toEqual([]);
    });

    test('a rolled-back bracket releases the write lock for the next mutation', async () => {
        // ts-db 0.8.1 removed the sync transaction facade; the inbox now owns BEGIN IMMEDIATE …
        // COMMIT/ROLLBACK, so what matters is that a failure unwinds the bracket instead of leaving
        // the connection mid-transaction (the next insert would otherwise fail on BEGIN).
        await db.exec(`CREATE TRIGGER fail_sent_event BEFORE INSERT ON system_events
            WHEN NEW.event_name = 'message.sent' BEGIN SELECT RAISE(ABORT, 'event failed'); END;`);
        await expect(seed()).rejects.toThrow();
        await db.exec('DROP TRIGGER fail_sent_event');
        await expect(seed()).resolves.toBeDefined();
        expect((await dao.list('proj-coder', 'in', 10)).length).toBe(1);
    });

    test('stale settlement and release never affect a replacement claim or emit events', async () => {
        await seed();
        const [first] = await dao.claim('proj-coder', 1, 100, event('message.claimed'));
        if (first === undefined) throw new Error('missing claim');
        await dao.release([first], 200, event('message.requeued'));
        const [second] = await dao.claim('proj-coder', 1, 300, (row) => ({
            ...event('message.claimed')(row),
            id: `sev_claim_2_${row.id}`,
        }));
        expect(second?.attempts).toBe(2);
        const before = (await new SystemEventDao(db).query({ prefix: 'message', limit: 20 })).length;
        expect(await dao.settle([first], 'failed', 400, event('message.failed'))).toEqual([]);
        expect(await dao.release([first], 400, event('message.requeued'))).toEqual([]);
        expect((await dao.get(first.id))?.status).toBe('claimed');
        expect((await new SystemEventDao(db).query({ prefix: 'message', limit: 20 })).length).toBe(before);
    });

    test('claim returns creation order even when timestamps differ from insertion order', async () => {
        const later = await seed({ createdAt: 300 });
        const first = await seed({ createdAt: 100 });
        const tied = await seed({ createdAt: 100 });
        expect((await dao.claim('proj-coder', 10, 500, event('message.claimed'))).map((row) => row.id)).toEqual([
            first.id,
            tied.id,
            later.id,
        ]);
    });
});

test('1271 — an adapter without a synchronous client fails before inbox writes', async () => {
    // ts-db 0.8.1 has no `DbAdapter.transaction`; the capability the DAO needs is the synchronous
    // `bun:sqlite` client behind `adapter.db.$client`. Strip it and the guard must fire before any
    // statement runs (a driver without a sync connection cannot deliver the atomic bracket).
    const unsupported = new InboxDao(
        new Proxy(db, {
            get(target, property) {
                if (property === 'db') {
                    const inner = Reflect.get(target, property) as unknown as Record<string, unknown>;
                    return { ...inner, $client: undefined };
                }
                const value = Reflect.get(target, property);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        }),
    );
    await expect(unsupported.claim('proj-coder', 1, 100, event('message.claimed'))).rejects.toThrow(
        'require the atomic synchronous transaction capability',
    );
});

describe('1334 R3 — claim-by-id and the remaining inbox read seams', () => {
    test('claimById claims exactly one queued row once and leaves siblings untouched', async () => {
        const first = await seed();
        const second = await seed();
        const claimed = await dao.claimById(second.id, 100, event('message.claimed'));
        expect(claimed).toMatchObject({ id: second.id, status: 'claimed', attempts: 1, claimedAt: 100 });
        expect(await dao.claimById(second.id, 101, event('message.claimed'))).toBeNull();
        expect((await dao.get(first.id))?.status).toBe('queued');
        expect(await new SystemEventDao(db).query({ name: 'message.claimed', limit: 5 })).toHaveLength(1);
    });

    test('expired claims, directional keyset reads, threads, requests and task reads share one row model', async () => {
        const root = await seed({ kind: 'request', taskId: '1334', createdAt: 1, updatedAt: 1 });
        const reply = await seed({ threadId: root.id, inReplyTo: root.id, createdAt: 2, updatedAt: 2 });
        const outbound = await seed({ fromId: 'proj-coder', toId: 'operator', createdAt: 3, updatedAt: 3 });
        const claimed = await dao.claimById(root.id, 10, event('message.claimed'));
        expect(claimed).not.toBeNull();
        expect((await dao.listExpiredClaims(11)).map((row) => row.id)).toEqual([root.id]);
        expect((await dao.list('proj-coder', 'in', 2)).map((row) => row.id)).toEqual([reply.id, root.id]);
        expect((await dao.list('proj-coder', 'out', 2)).map((row) => row.id)).toEqual([outbound.id]);
        expect((await dao.list('proj-coder', 'both', 3)).map((row) => row.id)).toEqual([
            outbound.id,
            reply.id,
            root.id,
        ]);
        expect(
            (await dao.list('proj-coder', 'both', 3, { createdAt: 3, id: outbound.id })).map((row) => row.id),
        ).toEqual([reply.id, root.id]);
        expect((await dao.thread(root.id)).map((row) => row.id)).toEqual([root.id, reply.id]);
        expect((await dao.requests()).map((row) => row.id)).toEqual([root.id]);
        expect((await dao.requests(['proj-coder'], reply.id)).map((row) => row.id)).toEqual([reply.id]);
        expect(await dao.requests([])).toEqual([]);
        expect(await dao.countQueued('proj-coder')).toBe(1);
        expect((await dao.listByTask('1334')).map((row) => row.id)).toEqual([root.id]);
    });
});

describe('A821 R2/R5 — the project-scoped timeline read', () => {
    test('orders every address oldest first and pages forward without gaps or repeats', async () => {
        const a = await seed({ fromId: 'operator', toId: 'proj-coder', createdAt: 10 });
        const b = await seed({ fromId: 'proj-coder', toId: 'proj-reviewer', createdAt: 20 });
        const c = await seed({ fromId: 'proj-reviewer', toId: 'operator', createdAt: 20 });
        const d = await seed({ fromId: 'peer-external', toId: 'proj-coder', createdAt: 30 });

        const first = await dao.timeline({}, 2);
        // `limit + 1` rows are read so the caller can tell whether a next page exists — same
        // contract as `list`; the service is what slices the page.
        expect(first.map((row) => row.id)).toEqual([a.id, b.id, c.id]);
        const last = first[1];
        if (last === undefined) throw new Error('missing row');

        const second = await dao.timeline({}, 2, { createdAt: last.createdAt, id: last.id });
        expect(second.slice(0, 2).map((row) => row.id)).toEqual([c.id, d.id]);
    });

    test('narrows by member direction, kind, status, thread and an inclusive time window', async () => {
        const outbound = await seed({ fromId: 'proj-coder', toId: 'proj-peer', createdAt: 10 });
        const inbound = await seed({ fromId: 'proj-peer', toId: 'proj-coder', createdAt: 20 });
        const request = await seed({
            fromId: 'operator',
            toId: 'proj-coder',
            kind: 'request',
            status: 'delivered',
            createdAt: 20,
        });
        const other = await seed({ fromId: 'operator', toId: 'proj-reviewer', createdAt: 40 });

        const onlyOut = await dao.timeline({ members: ['proj-coder'], direction: 'out' }, 10);
        expect(onlyOut.map((row) => row.id)).toEqual([outbound.id]);

        const both = await dao.timeline({ members: ['proj-coder'], direction: 'both' }, 10);
        expect(both.map((row) => row.id)).toEqual([outbound.id, inbound.id, request.id]);

        const requests = await dao.timeline({ kind: 'request', status: 'delivered' }, 10);
        expect(requests.map((row) => row.id)).toEqual([request.id]);

        // A member filter with no members narrows nothing (the sequence view's default query).
        expect((await dao.timeline({ members: [], direction: 'in' }, 10)).map((row) => row.id)).toEqual([
            outbound.id,
            inbound.id,
            request.id,
            other.id,
        ]);

        const window = await dao.timeline({ since: 20, until: 20 }, 10);
        expect(window.map((row) => row.id)).toEqual([inbound.id, request.id]);

        const threaded = await dao.timeline({ threadId: inbound.threadId }, 10);
        expect(threaded.map((row) => row.id)).toEqual([inbound.id]);

        const reply = await seed({ inReplyTo: request.id, threadId: request.id, createdAt: 50 });
        expect((await dao.timeline({ threadId: request.id }, 10)).map((row) => row.id)).toEqual([request.id, reply.id]);
    });
});
