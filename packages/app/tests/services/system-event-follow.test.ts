import { afterEach, describe, expect, test } from 'bun:test';
import type { SystemEventDao } from '@gobing-ai/spur-domain';
import { SystemEventDao as DaoImpl } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { followSystemEventsAfter } from '../../src/services/system-event-follow';
import { createMigratedDb } from '../helpers';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until `pred` or timeout — real-timer helper for stream tests. */
async function waitUntil(pred: () => boolean, timeoutMs = 2000): Promise<void> {
    const start = Date.now();
    while (!pred()) {
        if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
        await sleep(10);
    }
}

/**
 * Snapshot-then-follow (G4 R8, task 0531): rows with `sequence > afterSequence`
 * arrive in ascending order, nothing is lost or duplicated across poll gaps,
 * and the `match` predicate (e.g. a pinned runId) filters other runs' rows.
 */
describe('followSystemEventsAfter', () => {
    let db: Awaited<ReturnType<typeof createMigratedDb>>;
    let dao: SystemEventDao;

    afterEach(async () => {
        await db.close();
    });

    const insert = (sequence: number, over: { runId?: string; eventName?: string } = {}) =>
        dao.insert({
            id: `evt-${sequence}-${over.runId ?? 'R'}`,
            event_name: over.eventName ?? 'agent.invoke.start',
            occurred_at: new Date().toISOString(),
            run_id: over.runId ?? 'R',
            sequence,
        });

    const collect = async (
        opts: { afterSequence: number; match: (row: Awaited<ReturnType<typeof dao.query>>[number]) => boolean },
        untilCount: number,
    ) => {
        const seen: number[] = [];
        const controller = new AbortController();
        const stream = (async () => {
            for await (const row of followSystemEventsAfter(() => db, {
                afterSequence: opts.afterSequence,
                match: opts.match,
                signal: controller.signal,
            })) {
                seen.push(row.sequence ?? 0);
                if (seen.length >= untilCount) controller.abort();
            }
        })();
        await stream;
        return seen;
    };

    test('yields only rows after the snapshot, in ascending sequence order (replay after snapshot)', async () => {
        db = await createMigratedDb();
        dao = new DaoImpl(db);
        await insert(1);
        await insert(2);
        await insert(3);

        const fromZero = await collect({ afterSequence: 0, match: () => true }, 3);
        expect(fromZero).toEqual([1, 2, 3]);

        // A fresh follow from a later snapshot replays only rows after it.
        const fromTwo = await collect({ afterSequence: 2, match: () => true }, 1);
        expect(fromTwo).toEqual([3]);
    });

    test('empty follow-set: afterSequence at/above the ledger head yields nothing', async () => {
        db = await createMigratedDb();
        dao = new DaoImpl(db);
        await insert(1);
        await insert(2);

        const seen: number[] = [];
        const controller = new AbortController();
        // No rows > 2 ever arrive; abort after two poll cycles to end the stream.
        const timer = setTimeout(() => controller.abort(), 250);
        for await (const row of followSystemEventsAfter(() => db, {
            afterSequence: 2,
            match: () => true,
            signal: controller.signal,
        })) {
            seen.push(row.sequence ?? 0);
        }
        clearTimeout(timer);
        expect(seen).toEqual([]);
    });

    test('gap/reconnect: rows written during a poll gap are delivered with no loss or duplicates', async () => {
        db = await createMigratedDb();
        dao = new DaoImpl(db);
        await insert(1);
        await insert(2);

        const seen: number[] = [];
        const controller = new AbortController();
        const stream = (async () => {
            for await (const row of followSystemEventsAfter(() => db, {
                afterSequence: 0,
                match: () => true,
                signal: controller.signal,
            })) {
                seen.push(row.sequence ?? 0);
            }
        })();

        await waitUntil(() => seen.length === 2);
        // A full poll cycle with no writes (the "gap"), then more rows arrive.
        await sleep(150);
        await insert(3);
        await insert(4);
        await waitUntil(() => seen.length === 4);
        controller.abort();
        await stream;
        expect(seen).toEqual([1, 2, 3, 4]);
    });

    test('pin break: match filters out rows from a replaced occupant run', async () => {
        db = await createMigratedDb();
        dao = new DaoImpl(db);
        await insert(1, { runId: 'R1', eventName: 'agent.invoke.start' });
        await insert(2, { runId: 'R2', eventName: 'agent.invoke.start' }); // new occupant run
        await insert(3, { runId: 'R1', eventName: 'agent.invoke.exit' });

        const seen = await collect({ afterSequence: 0, match: (row) => row.run_id === 'R1' }, 2);
        expect(seen).toEqual([1, 3]);
    });

    test('abort terminates the stream cleanly between rows', async () => {
        db = await createMigratedDb();
        dao = new DaoImpl(db);
        await insert(1);

        const seen: number[] = [];
        const controller = new AbortController();
        const stream = (async () => {
            for await (const row of followSystemEventsAfter(() => db, {
                afterSequence: 0,
                match: () => true,
                signal: controller.signal,
            })) {
                seen.push(row.sequence ?? 0);
                controller.abort(); // stop right after the first row
            }
        })();
        await stream;
        expect(seen).toEqual([1]);
    });

    test('missing ledger (unmigrated DB) terminates instead of throwing', async () => {
        db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        dao = new DaoImpl(db);

        const seen: number[] = [];
        const controller = new AbortController();
        // No system_events table — the follow must end quietly (like SystemEventDao.query).
        const timer = setTimeout(() => controller.abort(), 150);
        for await (const row of followSystemEventsAfter(() => db, {
            afterSequence: 0,
            match: () => true,
            signal: controller.signal,
        })) {
            seen.push(row.sequence ?? 0);
        }
        clearTimeout(timer);
        expect(seen).toEqual([]);
    });

    test('production shape: rows persisted without an explicit sequence get a global cursor and are followed', async () => {
        // Regression guard (0531 review P1): producers never pass `sequence`;
        // the DAO auto-assigns a global monotonic cursor at insert. If it did
        // not, `sequence > ?` would exclude every production row and waits
        // would stall — the seeded-sequence tests cannot catch that.
        db = await createMigratedDb();
        dao = new DaoImpl(db);
        await dao.insert({
            id: 'evt-1',
            event_name: 'agent.invoke.start',
            occurred_at: new Date().toISOString(),
            run_id: 'R',
        });
        await dao.insert({
            id: 'evt-2',
            event_name: 'agent.invoke.exit',
            occurred_at: new Date().toISOString(),
            run_id: 'R',
        });

        const seen: number[] = [];
        const controller = new AbortController();
        const stream = (async () => {
            for await (const row of followSystemEventsAfter(() => db, {
                afterSequence: 0,
                match: (r) => r.run_id === 'R' && r.event_name.startsWith('agent.invoke.'),
                signal: controller.signal,
            })) {
                seen.push(row.sequence ?? 0);
                if (seen.length >= 2) controller.abort();
            }
        })();
        await stream;
        expect(seen).toEqual([1, 2]);
    });
});
