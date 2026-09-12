import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { applyCliMigrations, CoordinationRunDao } from '../../src/index';

describe('CoordinationRunDao', () => {
    test('insert start, get by runId, update exit', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new CoordinationRunDao(adapter);

        await dao.insertStart({
            specId: 'reviewer',
            agentKind: 'codex',
            processId: null,
            runId: 'run-1',
            generation: 1,
            startedAt: '2026-08-13T01:00:00.000Z',
        });

        const running = await dao.getByRunId('run-1');
        expect(running?.status).toBe('running');
        expect(running?.spec_id).toBe('reviewer');
        expect(running?.agent_kind).toBe('codex');
        expect(running?.artifact_refs_json).toBe('[]');

        await dao.updateExit(
            'run-1',
            'exited',
            '2026-08-13T01:00:05.000Z',
            '[{"kind":"log","path":".spur/run/run-1.log"}]',
            { messageIds: ['msg-1'], taskId: '0833', outcome: 'run-exit-only' },
        );

        const exited = await dao.getByRunId('run-1');
        expect(exited?.status).toBe('exited');
        expect(exited?.completed_at).toBe('2026-08-13T01:00:05.000Z');
        expect(exited?.artifact_refs_json).toContain('.spur/run/run-1.log');

        adapter.close();
    });

    test('getByRunId returns null for unknown run', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new CoordinationRunDao(adapter);

        expect(await dao.getByRunId('nope')).toBeNull();
        adapter.close();
    });

    test('maxGeneration is null then climbs monotonically per spec', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new CoordinationRunDao(adapter);

        expect(await dao.maxGeneration('reviewer')).toBeNull();

        await dao.insertStart({
            specId: 'reviewer',
            agentKind: 'codex',
            processId: null,
            runId: 'r1',
            generation: 1,
            startedAt: '2026-08-13T01:00:00.000Z',
        });
        await dao.insertStart({
            specId: 'reviewer',
            agentKind: 'codex',
            processId: null,
            runId: 'r2',
            generation: 3,
            startedAt: '2026-08-13T02:00:00.000Z',
        });
        await dao.insertStart({
            specId: 'reviewer',
            agentKind: 'codex',
            processId: null,
            runId: 'r3',
            generation: 2,
            startedAt: '2026-08-13T03:00:00.000Z',
        });

        expect(await dao.maxGeneration('reviewer')).toBe(3);
        // other spec is independent
        expect(await dao.maxGeneration('coder')).toBeNull();
        adapter.close();
    });

    test('getLatestBySpecId returns highest generation then newest started', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new CoordinationRunDao(adapter);

        await dao.insertStart({
            specId: 'reviewer',
            agentKind: 'codex',
            processId: null,
            runId: 'r1',
            generation: 1,
            startedAt: '2026-08-13T01:00:00.000Z',
        });
        await dao.insertStart({
            specId: 'reviewer',
            agentKind: 'codex',
            processId: null,
            runId: 'r2',
            generation: 1,
            startedAt: '2026-08-13T05:00:00.000Z',
        });

        const latest = await dao.getLatestBySpecId('reviewer');
        expect(latest?.run_id).toBe('r2');
        adapter.close();
    });

    test('0833: receipt round-trips through updateExit and reads back by run id', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new CoordinationRunDao(adapter);

        await dao.insertStart({
            specId: 'reviewer',
            agentKind: 'codex',
            processId: null,
            runId: 'run-r',
            generation: 1,
            startedAt: '2026-09-12T01:00:00.000Z',
        });
        await dao.updateExit('run-r', 'exited', '2026-09-12T01:00:05.000Z', '[]', {
            messageIds: ['m1', 'm2'],
            taskId: '0833',
            outcome: 'run-exit-only',
        });

        const row = await dao.getByRunId('run-r');
        expect(row?.message_ids_json).toBe('["m1","m2"]');
        expect(row?.task_id).toBe('0833');
        // R4: zero exit with no verification result is run-exit-only — a stored
        // value, never inferred later from an absence.
        expect(row?.outcome).toBe('run-exit-only');
        adapter.close();
    });

    test('0833: receipts are queryable by message id, task id, and survive as separate rows', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new CoordinationRunDao(adapter);

        for (const [runId, gen] of [
            ['run-a', 1],
            ['run-b', 2],
        ] as const) {
            await dao.insertStart({
                specId: 'reviewer',
                agentKind: 'codex',
                processId: null,
                runId,
                generation: gen,
                startedAt: `2026-09-12T0${gen}:00:00.000Z`,
            });
        }
        // One message fanned out over two runs (redelivery); one task id per run.
        await dao.updateExit('run-a', 'exited', '2026-09-12T01:00:05.000Z', '[]', {
            messageIds: ['shared-msg'],
            taskId: 'task-a',
            outcome: 'run-exit-only',
        });
        await dao.updateExit('run-b', 'errored', '2026-09-12T02:00:05.000Z', '[]', {
            messageIds: ['other-msg', 'shared-msg'],
            taskId: 'task-b',
            outcome: 'errored',
        });

        const byMessage = await dao.listByMessageId('shared-msg');
        expect(byMessage.map((r) => r.run_id).sort()).toEqual(['run-a', 'run-b']);
        expect(await dao.listByMessageId('nope')).toEqual([]);

        const byTask = await dao.listByTaskId('task-b');
        expect(byTask).toHaveLength(1);
        expect(byTask[0]?.run_id).toBe('run-b');
        expect(byTask[0]?.outcome).toBe('errored');
        expect(await dao.listByTaskId('nope')).toEqual([]);

        // getByRunId covers the third verb (R5).
        expect((await dao.getByRunId('run-a'))?.task_id).toBe('task-a');
        adapter.close();
    });

    test('0833: an empty message list and no task id is a valid receipt (R7)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new CoordinationRunDao(adapter);

        await dao.insertStart({
            specId: 'reviewer',
            agentKind: 'codex',
            processId: null,
            runId: 'run-solo',
            generation: 1,
            startedAt: '2026-09-12T03:00:00.000Z',
        });
        await dao.updateExit('run-solo', 'exited', '2026-09-12T03:00:05.000Z', '[]', {
            messageIds: [],
            outcome: 'run-exit-only',
        });

        const row = await dao.getByRunId('run-solo');
        expect(row?.message_ids_json).toBe('[]');
        expect(row?.task_id).toBeNull();
        expect(row?.outcome).toBe('run-exit-only');
        // The empty list matches no message query — never an invented association.
        expect(await dao.listByMessageId('')).toEqual([]);
        adapter.close();
    });

    test('0833: the receipt migration is idempotent against a pre-0044 table (R6)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        // A pre-0833 database: 0010 was journaled long ago with the wave-1 SQL
        // (no receipt columns, no task index), holding one pre-existing row.
        await applyCliMigrations(adapter, [
            {
                id: '0000_spur_cli_foundation',
                // The proven legacy stub shape (migrations.test.ts): runs must exist
                // so the unguarded 0005 ALTER has a target.
                sql: 'CREATE TABLE IF NOT EXISTS workspaces (id TEXT); CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS history_message (record_hash TEXT PRIMARY KEY, source TEXT NOT NULL, session_id TEXT NOT NULL, provenance TEXT NOT NULL, run_id TEXT);',
            },
            {
                id: '0010_spur_cli_coordination_runs',
                sql: `CREATE TABLE IF NOT EXISTS coordination_runs (
                    spec_id TEXT NOT NULL,
                    agent_kind TEXT NOT NULL,
                    process_id TEXT,
                    run_id TEXT PRIMARY KEY,
                    generation INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    completed_at TEXT,
                    artifact_refs_json TEXT NOT NULL DEFAULT '[]'
                );
                CREATE INDEX IF NOT EXISTS idx_coordination_runs_spec ON coordination_runs (spec_id, generation DESC);`,
            },
        ]);
        await adapter.run(
            `INSERT INTO coordination_runs (spec_id, agent_kind, process_id, run_id, generation, status, started_at, completed_at, artifact_refs_json)
             VALUES ('reviewer', 'codex', NULL, 'run-old', 1, 'running', '2026-09-01T00:00:00.000Z', NULL, '[]')`,
        );

        const applied = await applyCliMigrations(adapter);
        expect(applied).toBeGreaterThan(0);
        expect(await applyCliMigrations(adapter)).toBe(0);

        // Existing row survived, with the defaults the migration promises (R6).
        const row = await adapter.queryFirst<{ message_ids_json: string; task_id: string | null; outcome: string }>(
            'SELECT message_ids_json, task_id, outcome FROM coordination_runs WHERE run_id = ?',
            'run-old',
        );
        expect(row?.message_ids_json).toBe('[]');
        expect(row?.task_id).toBeNull();
        expect(row?.outcome).toBe('run-exit-only');

        // The DAO works against the upgraded table.
        const dao = new CoordinationRunDao(adapter);
        await dao.updateExit('run-old', 'exited', '2026-09-12T04:00:00.000Z', '[]', {
            messageIds: ['late-msg'],
            taskId: '0833',
            outcome: 'run-exit-only',
        });
        expect((await dao.listByMessageId('late-msg')).map((r) => r.run_id)).toEqual(['run-old']);
        adapter.close();
    });

    test('deleteAll clears rows', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new CoordinationRunDao(adapter);

        await dao.insertStart({
            specId: 'reviewer',
            agentKind: 'codex',
            processId: null,
            runId: 'r1',
            generation: 1,
            startedAt: '2026-08-13T01:00:00.000Z',
        });
        await dao.deleteAll();
        expect(await dao.getByRunId('r1')).toBeNull();
        adapter.close();
    });
});
