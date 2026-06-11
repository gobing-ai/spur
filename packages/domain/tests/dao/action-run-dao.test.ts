import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { ActionRunDao, type ActionRunRow } from '../../src/dao/action-run-dao';
import { applyCliMigrations } from '../../src/migrations';

describe('ActionRunDao', () => {
    /** Create an in-memory database with migrations applied. */
    async function setup() {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        return adapter;
    }

    /** Insert a synthetic run row (idempotent — no-op if runId already exists). */
    async function insertRunRow(db: Awaited<ReturnType<typeof setup>>, runId: string) {
        const now = Date.now();
        await db.run(
            `INSERT OR IGNORE INTO runs (id, workflow_name, mode, status, started_at, metadata_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            runId,
            'test-wf',
            'state-machine',
            'done',
            new Date(now).toISOString(),
            '{}',
            now,
            now,
        );
    }
    /** Insert a synthetic action row directly for test setup. */
    async function insertActionRow(
        db: Awaited<ReturnType<typeof setup>>,
        overrides: Partial<ActionRunRow> & { id: string; run_id: string },
    ): Promise<{ row: ActionRunRow; runId: string }> {
        const { run_id, ...rowOverrides } = overrides;

        await insertRunRow(db, run_id);
        const now = Date.now();
        const row: ActionRunRow = {
            node: 'start',
            kind: 'agent.run',
            status: 'done',
            duration_ms: 120,
            ok: 1,
            result_json: '{"ok":true}',
            started_at: new Date(now - 120).toISOString(),
            completed_at: new Date(now).toISOString(),
            created_at: now,
            ...rowOverrides,
        };
        await db.run(
            `INSERT INTO action_runs (id, run_id, node, kind, status, duration_ms, ok, result_json, started_at, completed_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            row.id,
            run_id,
            row.node,
            row.kind,
            row.status,
            row.duration_ms,
            row.ok,
            row.result_json,
            row.started_at,
            row.completed_at,
            row.created_at,
        );
        return { row, runId: run_id };
    }

    test('returns empty array when table does not exist', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        // No migrations applied — action_runs table does not exist
        const dao = new ActionRunDao(adapter);
        const rows = await dao.actionRowsByRunId('nonexistent');
        expect(rows).toEqual([]);
        adapter.close();
    });

    test('does not hide non-schema database errors', async () => {
        const dao = new ActionRunDao({
            queryAll: () => {
                throw new Error('database is locked');
            },
        } as Pick<Awaited<ReturnType<typeof setup>>, 'queryAll'> as Awaited<ReturnType<typeof setup>>);

        expect(dao.actionRowsByRunId('r1')).rejects.toThrow('database is locked');
    });

    test('returns rows ordered by created_at for a given run_id', async () => {
        const adapter = await setup();
        const dao = new ActionRunDao(adapter);

        const now = Date.now();
        const { row: r1 } = await insertActionRow(adapter, {
            id: 'a1',
            run_id: 'r1',
            node: 'first',
            created_at: now - 2000,
        });
        const { row: r2 } = await insertActionRow(adapter, {
            id: 'a2',
            run_id: 'r1',
            node: 'second',
            created_at: now - 1000,
        });
        const { row: r3 } = await insertActionRow(adapter, { id: 'a3', run_id: 'r1', node: 'third', created_at: now });

        // Another run's action — should not appear
        await insertActionRow(adapter, { id: 'a4', run_id: 'r2', node: 'other', created_at: now - 500 });

        const rows = await dao.actionRowsByRunId('r1');
        expect(rows).toHaveLength(3);
        expect(rows[0]?.id).toBe(r1.id);
        expect(rows[1]?.id).toBe(r2.id);
        expect(rows[2]?.id).toBe(r3.id);

        adapter.close();
    });

    test('returns empty array for a run_id with no actions', async () => {
        const adapter = await setup();
        const dao = new ActionRunDao(adapter);
        await insertActionRow(adapter, { id: 'a5', run_id: 'r10', node: 'only' });

        const rows = await dao.actionRowsByRunId('r-other');
        expect(rows).toEqual([]);
        adapter.close();
    });

    test('maps all columns correctly', async () => {
        const adapter = await setup();
        const dao = new ActionRunDao(adapter);

        const { row: inserted } = await insertActionRow(adapter, { id: 'a-full', run_id: 'r-full' });
        const [row] = await dao.actionRowsByRunId('r-full');

        expect(row).toBeDefined();
        expect(row?.id).toBe(inserted.id);
        expect(row?.node).toBe(inserted.node);
        expect(row?.kind).toBe(inserted.kind);
        expect(row?.status).toBe(inserted.status);
        expect(row?.duration_ms).toBe(inserted.duration_ms);
        expect(row?.ok).toBe(inserted.ok);
        expect(row?.result_json).toBe(inserted.result_json);
        expect(row?.started_at).toBe(inserted.started_at);
        expect(row?.completed_at).toBe(inserted.completed_at);
        expect(row?.created_at).toBe(inserted.created_at);
        expect(row?.node).toBe(inserted.node);
        adapter.close();
    });

    test('handles null fields correctly', async () => {
        const adapter = await setup();
        const dao = new ActionRunDao(adapter);

        await insertActionRow(adapter, {
            id: 'a-null',
            run_id: 'r-null',
            duration_ms: null,
            ok: null,
            result_json: null,
            started_at: null,
            completed_at: null,
        });
        const [row] = await dao.actionRowsByRunId('r-null');

        expect(row).toBeDefined();
        expect(row?.duration_ms).toBeNull();
        expect(row?.ok).toBeNull();
        expect(row?.result_json).toBeNull();
        expect(row?.started_at).toBeNull();
        expect(row?.completed_at).toBeNull();
        adapter.close();
    });
});
