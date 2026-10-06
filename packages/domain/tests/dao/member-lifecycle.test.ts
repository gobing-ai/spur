/**
 * Task 1080 R1/R2 — the fleet member lifecycle ledger.
 *
 * The state IS the ledger row (G73 Q&A, CLOSED): the newest accepted
 * `agent.lifecycle.changed` row for an actor is the member's current state, so
 * these tests drive `recordLifecycle`/`readLifecycle` against a migrated
 * in-memory db and pin the two behaviors the strategy and the Board depend on:
 * a stale sequence never overwrites, and a malformed row never renders as a state.
 */
import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import {
    AGENT_LIFECYCLE_EVENT,
    applyCliMigrations,
    readLifecycle,
    recordLifecycle,
    SystemEventDao,
} from '../../src/index';

/** Migrated in-memory adapter — the shape every project db carries. */
async function makeDb() {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    return adapter;
}

describe('member lifecycle state (1080)', () => {
    test('an accepted report is readable as the member state, and its row is the cataloged event', async () => {
        const db = await makeDb();
        const result = await recordLifecycle(db, 'proj-worker-1', { state: 'working', seq: 3 });

        expect(result.accepted).toBe(true);
        expect(result.observation?.state).toBe('working');
        expect((await readLifecycle(db, ['proj-worker-1'])).get('proj-worker-1')).toMatchObject({
            state: 'working',
            seq: 3,
        });

        // The row itself carries the ADR-066 catalog name — that is the emitter.
        const rows = await new SystemEventDao(db).query({ names: [AGENT_LIFECYCLE_EVENT], limit: 1 });
        expect(rows[0]?.actor).toBe('proj-worker-1');
        // The payload names the member too, so the presenter renders it without the row projection.
        expect(JSON.parse(rows[0]?.payload_json ?? '{}')).toMatchObject({ member: 'proj-worker-1', state: 'working' });
    });

    test('a stale sequence (3 then 2) leaves the state from 3 — and writes no row', async () => {
        const db = await makeDb();
        await recordLifecycle(db, 'member', { state: 'working', seq: 3 });
        const stale = await recordLifecycle(db, 'member', { state: 'idle', seq: 2 });

        expect(stale.accepted).toBe(false);
        expect(stale.observation?.state).toBe('working');
        expect((await readLifecycle(db, ['member'])).get('member')).toMatchObject({ state: 'working', seq: 3 });
        // A dropped report is not a transition: exactly one row exists.
        expect(await new SystemEventDao(db).query({ names: [AGENT_LIFECYCLE_EVENT], limit: 10 })).toHaveLength(1);
    });

    test('an equal sequence is a drop too (ties lose under the strict > rule)', async () => {
        const db = await makeDb();
        await recordLifecycle(db, 'member', { state: 'idle', seq: 7 });
        const tie = await recordLifecycle(db, 'member', { state: 'blocked', seq: 7 });

        expect(tie.accepted).toBe(false);
        expect((await readLifecycle(db, ['member'])).get('member')).toMatchObject({ state: 'idle' });
    });

    test('states are per actor, and an unknown actor reads as no entry', async () => {
        const db = await makeDb();
        await recordLifecycle(db, 'a', { state: 'blocked', seq: 1 });
        await recordLifecycle(db, 'b', { state: 'idle', seq: 1 });

        const states = await readLifecycle(db, ['a', 'b', 'c']);
        expect(states.get('a')).toMatchObject({ state: 'blocked' });
        expect(states.get('b')).toMatchObject({ state: 'idle' });
        expect(states.get('c')).toBeUndefined();
    });

    test('a malformed or unknown-state payload is skipped, never rendered as a state', async () => {
        const db = await makeDb();
        const dao = new SystemEventDao(db);
        await dao.insert({
            id: crypto.randomUUID(),
            event_name: AGENT_LIFECYCLE_EVENT,
            occurred_at: new Date().toISOString(),
            actor: 'broken',
            payload_json: '{"state":"flying","seq":9}',
        });
        await dao.insert({
            id: crypto.randomUUID(),
            event_name: AGENT_LIFECYCLE_EVENT,
            occurred_at: new Date().toISOString(),
            actor: 'unparseable',
            payload_json: 'not json',
        });

        const states = await readLifecycle(db, ['broken', 'unparseable']);
        expect(states.size).toBe(0);
    });

    test('two racing reports that both pass the guard resolve to the higher seq, whatever lands last', async () => {
        const db = await makeDb();
        // Detached hook processes can interleave read-then-insert: seq 5 then seq 3 both land.
        const events = new SystemEventDao(db);
        for (const seq of [5, 3]) {
            await events.insert({
                id: crypto.randomUUID(),
                event_name: AGENT_LIFECYCLE_EVENT,
                occurred_at: new Date().toISOString(),
                actor: 'proj-worker-1',
                payload_json: JSON.stringify({
                    member: 'proj-worker-1',
                    state: seq === 5 ? 'blocked' : 'working',
                    seq,
                }),
            });
        }
        expect((await readLifecycle(db, ['proj-worker-1'])).get('proj-worker-1')).toMatchObject({
            state: 'blocked',
            seq: 5,
        });
        expect((await recordLifecycle(db, 'proj-worker-1', { state: 'idle', seq: 4 })).accepted).toBe(false);
    });

    test('an empty actor list reads no rows and writes nothing', async () => {
        const db = await makeDb();
        await recordLifecycle(db, 'member', { state: 'working', seq: 1 });
        expect((await readLifecycle(db, [])).size).toBe(0);
    });
});
