import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import {
    applyCliMigrations,
    MEMBER_SESSION_EVENT,
    MEMBER_SESSION_RESET_EVENT,
    readMemberSessions,
    recordMemberSession,
    SystemEventDao,
} from '../../src/index';

/** Migrated in-memory adapter — the shape every project db carries. */
async function makeDb() {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    return adapter;
}

describe('member session state (0897)', () => {
    test('record then read returns the session per member actor', async () => {
        const db = await makeDb();
        await recordMemberSession(db, 'proj-worker-1', { mode: 'resume', id: 'sess-abc' });
        await recordMemberSession(db, 'proj-planner-1', { mode: 'persistent' });

        const sessions = await readMemberSessions(db, ['proj-worker-1', 'proj-planner-1']);
        expect(sessions.get('proj-worker-1')).toEqual({ mode: 'resume', id: 'sess-abc' });
        expect(sessions.get('proj-planner-1')).toEqual({ mode: 'persistent' });
    });

    test('the newest row wins; a reset row clears the resume id but keeps the mode', async () => {
        const db = await makeDb();
        await recordMemberSession(db, 'm', { mode: 'resume', id: 'old' });
        await recordMemberSession(db, 'm', { mode: 'resume', id: 'new' });
        expect((await readMemberSessions(db, ['m'])).get('m')).toEqual({ mode: 'resume', id: 'new' });

        await new SystemEventDao(db).insert({
            id: crypto.randomUUID(),
            event_name: MEMBER_SESSION_RESET_EVENT,
            occurred_at: new Date().toISOString(),
            actor: 'm',
            payload_json: JSON.stringify({ reason: 'failed-drains', mode: 'resume', failedDrains: 3 }),
        });
        expect((await readMemberSessions(db, ['m'])).get('m')).toEqual({ mode: 'resume' });
    });

    test('malformed rows are skipped in favor of the newest valid one', async () => {
        const db = await makeDb();
        await recordMemberSession(db, 'm', { mode: 'one-shot' });
        const dao = new SystemEventDao(db);
        await dao.insert({
            id: crypto.randomUUID(),
            event_name: MEMBER_SESSION_EVENT,
            occurred_at: new Date().toISOString(),
            actor: 'm',
            payload_json: 'not-json{',
        });
        await dao.insert({
            id: crypto.randomUUID(),
            event_name: MEMBER_SESSION_EVENT,
            occurred_at: new Date().toISOString(),
            actor: 'm',
            payload_json: JSON.stringify({ mode: 'holographic' }),
        });
        expect((await readMemberSessions(db, ['m'])).get('m')).toEqual({ mode: 'one-shot' });
    });

    test('unknown actors and empty input yield no entries; missing table reads as empty', async () => {
        const db = await makeDb();
        expect((await readMemberSessions(db, ['never-ran'])).size).toBe(0);
        expect((await readMemberSessions(db, [])).size).toBe(0);

        const bare = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        expect((await readMemberSessions(bare, ['m'])).size).toBe(0);
    });
});
