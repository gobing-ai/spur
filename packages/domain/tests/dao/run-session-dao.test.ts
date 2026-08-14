import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { applyCliMigrations, RunSessionDao } from '../../src/index';

describe('RunSessionDao (feature E6 / task 0557)', () => {
    test('insert + forward lookup by run_id (R4)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new RunSessionDao(adapter);

        await dao.insert({
            runId: 'run-1',
            source: 'pi',
            sessionId: 'session-1',
            exactness: 'exact',
            mechanism: 'observed',
            resolvedAt: '2026-08-14T01:00:00.000Z',
        });
        await dao.insert({
            runId: 'run-1',
            source: 'claude',
            sessionId: null,
            exactness: 'unresolved',
            mechanism: 'observed',
            resolvedAt: '2026-08-14T01:00:01.000Z',
        });

        const rows = await dao.getByRunId('run-1');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            run_id: 'run-1',
            source: 'pi',
            session_id: 'session-1',
            exactness: 'exact',
            mechanism: 'observed',
            resolved_at: '2026-08-14T01:00:00.000Z',
        });
        expect(rows[1]?.session_id).toBeNull();

        await dao.deleteAll();
        expect(await dao.getByRunId('run-1')).toHaveLength(0);
    });

    test('reverse lookup by (source, session_id) (R4)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new RunSessionDao(adapter);

        await dao.insert({
            runId: 'run-2',
            source: 'codex',
            sessionId: 'rollout-uuid',
            exactness: 'exact',
            mechanism: 'supplied',
            resolvedAt: '2026-08-14T02:00:00.000Z',
        });

        const rows = await dao.getBySession('codex', 'rollout-uuid');
        expect(rows).toHaveLength(1);
        expect(rows[0]?.run_id).toBe('run-2');
        expect(rows[0]?.mechanism).toBe('supplied');
        expect(await dao.getBySession('codex', 'other')).toHaveLength(0);
        expect(await dao.getBySession('pi', 'rollout-uuid')).toHaveLength(0);
    });

    test('missing table reads as empty (unmigrated DB)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const dao = new RunSessionDao(adapter);
        expect(await dao.getByRunId('run-x')).toEqual([]);
        expect(await dao.getBySession('pi', 's')).toEqual([]);
    });

    test('insertInferred — writes an estimated/inferred row when no exact or identical row exists (task 0558 R1)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new RunSessionDao(adapter);

        const written = await dao.insertInferred({
            runId: 'run-r',
            source: 'pi',
            sessionId: 'session-s',
            resolvedAt: '2026-08-14T03:00:00.000Z',
        });
        expect(written).toBe(true);

        const rows = await dao.getByRunId('run-r');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            run_id: 'run-r',
            source: 'pi',
            session_id: 'session-s',
            exactness: 'estimated',
            mechanism: 'inferred',
        });
    });

    test('insertInferred — an exact mapping for the run blocks the estimated write (task 0558 R2)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new RunSessionDao(adapter);
        await dao.insert({
            runId: 'run-e',
            source: 'pi',
            sessionId: 'session-exact',
            exactness: 'exact',
            mechanism: 'observed',
            resolvedAt: '2026-08-14T02:00:00.000Z',
        });

        const written = await dao.insertInferred({
            runId: 'run-e',
            source: 'pi',
            sessionId: 'session-other',
            resolvedAt: '2026-08-14T03:00:00.000Z',
        });
        expect(written).toBe(false);

        const rows = await dao.getByRunId('run-e');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ session_id: 'session-exact', exactness: 'exact' });
    });

    test('insertInferred — identical estimated row blocks the re-write (task 0558 R4 idempotency)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new RunSessionDao(adapter);

        const first = await dao.insertInferred({
            runId: 'run-i',
            source: 'pi',
            sessionId: 'session-i',
            resolvedAt: '2026-08-14T03:00:00.000Z',
        });
        const second = await dao.insertInferred({
            runId: 'run-i',
            source: 'pi',
            sessionId: 'session-i',
            resolvedAt: '2026-08-14T03:00:01.000Z',
        });
        expect(first).toBe(true);
        expect(second).toBe(false);
        expect(await dao.getByRunId('run-i')).toHaveLength(1);
    });

    test('insertInferred — a distinct estimated row for the same run is allowed (workflow run, several sessions)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new RunSessionDao(adapter);

        await dao.insertInferred({
            runId: 'run-w',
            source: 'pi',
            sessionId: 's1',
            resolvedAt: '2026-08-14T03:00:00.000Z',
        });
        const second = await dao.insertInferred({
            runId: 'run-w',
            source: 'pi',
            sessionId: 's2',
            resolvedAt: '2026-08-14T03:00:01.000Z',
        });
        expect(second).toBe(true);
        expect(await dao.getByRunId('run-w')).toHaveLength(2);
    });
});

describe('RunSessionDao.alignMessageProvenance (feature E6 / task 0559 R5)', () => {
    async function insertMessage(
        adapter: DbAdapter,
        m: { record_hash: string; session_id: string; provenance: string },
    ): Promise<void> {
        await adapter.run(
            `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
                 role, record_type, disposition, ts, provenance, imported_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            m.record_hash,
            'claude',
            'test.jsonl',
            1,
            m.session_id,
            1,
            'user',
            'message',
            'conversation',
            '2026-08-14T00:00:00.000Z',
            m.provenance,
            '2026-08-14T00:00:00.000Z',
        );
    }

    test('two-way: mapped sessions become spur-run, unmapped spur-run rows become ambient', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new RunSessionDao(adapter);
        await dao.insert({
            runId: 'run-a',
            source: 'claude',
            sessionId: 'sess-mapped',
            exactness: 'exact',
            mechanism: 'observed',
            resolvedAt: '2026-08-14T01:00:00.000Z',
        });
        await insertMessage(adapter, { record_hash: 'mapped', session_id: 'sess-mapped', provenance: 'ambient' });
        await insertMessage(adapter, { record_hash: 'unmapped', session_id: 'sess-other', provenance: 'spur-run' });

        await dao.alignMessageProvenance();

        const rows = await adapter.queryAll<{ record_hash: string; provenance: string }>(
            'SELECT record_hash, provenance FROM history_message ORDER BY record_hash',
        );
        expect(rows).toEqual([
            { record_hash: 'mapped', provenance: 'spur-run' },
            { record_hash: 'unmapped', provenance: 'ambient' },
        ]);
    });

    test('idempotent on re-run', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new RunSessionDao(adapter);
        await insertMessage(adapter, { record_hash: 'm1', session_id: 's1', provenance: 'ambient' });

        await dao.alignMessageProvenance();
        await dao.alignMessageProvenance();
        const rows = await adapter.queryAll<{ provenance: string }>('SELECT provenance FROM history_message');
        expect(rows).toEqual([{ provenance: 'ambient' }]);
    });

    test('missing history_message table is a no-op, never a throw', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        // history_run_session exists (migrated) but history_message does not — the
        // raw-DDL-only fixture would need the full import schema; an empty DB covers
        // the unmigrated no-op path instead.
        await adapter.exec('CREATE TABLE history_run_session (run_id TEXT NOT NULL)');
        const dao = new RunSessionDao(adapter);
        await expect(dao.alignMessageProvenance()).resolves.toBeUndefined();
    });
});
