import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { transferRunTables } from '../../src/dao/run-transfer';
import { applyCliMigrations } from '../../src/migrations';

/**
 * Task 0975 R1 — worktree → invoking-tree run provenance transfer.
 *
 * The persist-out step copies run rows and their children from the worktree DB before
 * WT-4 removes the tree. Contract: fresh runs persist with their children atomically;
 * an `id-exists` or `external-key-conflict` target row is skipped unmodified; and a
 * second persist of the same source leaves every invoking-tree row count unchanged
 * (idempotent, child rows included).
 */

async function setup(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    return adapter;
}

/** Insert one engine-shaped run row (TEXT timestamps, as the engine writes them). */
async function insertRun(
    db: DbAdapter,
    id: string,
    overrides: { workflowName?: string; status?: string; externalKey?: string | null } = {},
): Promise<void> {
    await db.run(
        `INSERT INTO runs (id, workflow_name, mode, status, agent, external_key, started_at, completed_at,
                           metadata_json, created_at, updated_at)
         VALUES (?, ?, 'state-machine', ?, NULL, ?, '2026-09-26T00:00:00Z', NULL, '{}', 1, 1)`,
        id,
        overrides.workflowName ?? 'wf',
        overrides.status ?? 'done',
        overrides.externalKey === undefined ? null : overrides.externalKey,
    );
}

async function insertChild(db: DbAdapter, table: string, id: string, runId: string, marker: string): Promise<void> {
    const columns: Record<string, string> = {
        action_runs: 'id, run_id, node, kind, status, duration_ms, ok, created_at, updated_at',
        phase_runs: 'id, run_id, phase, status, created_at, updated_at',
        transition_runs: 'id, run_id, from_state, to_state, status, created_at, updated_at',
        workflow_states: 'id, run_id, state, data_json, created_at, updated_at',
    };
    const values: Record<string, unknown[]> = {
        action_runs: [id, runId, 'implement', 'agent.run', 'done', 5, 1, 1, 1],
        phase_runs: [id, runId, marker, 'done', 1, 1],
        transition_runs: [id, runId, marker, 'done', 'done', 1, 1],
        workflow_states: [id, runId, marker, '{}', 1, 1],
    };
    const cols = columns[table];
    if (!cols) throw new Error(`unknown table: ${table}`);
    await db.run(
        `INSERT INTO ${table} (${cols}) VALUES (${cols
            .split(', ')
            .map(() => '?')
            .join(', ')})`,
        ...((values[table] ?? []) as unknown[]),
    );
}

async function count(db: DbAdapter, table: string): Promise<number> {
    const row = await db.queryFirst<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
    return row?.n ?? 0;
}

describe('transferRunTables (task 0975 R1)', () => {
    test('persists fresh runs with their child rows, values verbatim', async () => {
        const source = await setup();
        const target = await setup();
        await insertRun(source, 'run_a', { workflowName: 'wf-a', externalKey: null });
        await insertRun(source, 'run_b', { workflowName: 'wf-b', externalKey: 'task-0975' });
        await insertChild(source, 'action_runs', 'act_1', 'run_a', 'm');
        await insertChild(source, 'phase_runs', 'ph_1', 'run_a', 'implement');

        const result = await transferRunTables(source, target);
        expect(result.persistedIds).toEqual(['run_a', 'run_b']);
        expect(result.skipped).toEqual([]);

        expect(await count(target, 'runs')).toBe(2);
        expect(await count(target, 'action_runs')).toBe(1);
        expect(await count(target, 'phase_runs')).toBe(1);
        const action = await target.queryFirst<{ run_id: string; duration_ms: number; ok: number }>(
            'SELECT run_id, duration_ms, ok FROM action_runs WHERE id = ?',
            'act_1',
        );
        expect(action).toEqual({ run_id: 'run_a', duration_ms: 5, ok: 1 });
        source.close();
        target.close();
    });

    test('id-exists: a pre-existing target row is skipped unmodified, children not merged', async () => {
        const source = await setup();
        const target = await setup();
        await insertRun(source, 'run_a', { status: 'done' });
        await insertChild(source, 'action_runs', 'act_src', 'run_a', 'm');
        // Target already owns a run_a with different content — the transfer must not touch it.
        await insertRun(target, 'run_a', { status: 'running' });
        await insertChild(target, 'action_runs', 'act_tgt', 'run_a', 'm');

        const result = await transferRunTables(source, target);
        expect(result.persistedIds).toEqual([]);
        expect(result.skipped).toEqual([{ id: 'run_a', reason: 'id-exists' }]);

        const row = await target.queryFirst<{ status: string }>('SELECT status FROM runs WHERE id = ?', 'run_a');
        expect(row?.status).toBe('running');
        const child = await target.queryFirst<{ id: string }>('SELECT id FROM action_runs WHERE run_id = ?', 'run_a');
        expect(child?.id).toBe('act_tgt');
        expect(await count(target, 'action_runs')).toBe(1);
        source.close();
        target.close();
    });

    test('external-key-conflict: same (workflow_name, external_key) under a different id is skipped', async () => {
        const source = await setup();
        const target = await setup();
        await insertRun(source, 'run_new', { workflowName: 'task-lifecycle', externalKey: 'task-0975' });
        await insertRun(target, 'run_old', {
            workflowName: 'task-lifecycle',
            externalKey: 'task-0975',
            status: 'failed',
        });

        const result = await transferRunTables(source, target);
        expect(result.skipped).toEqual([{ id: 'run_new', reason: 'external-key-conflict' }]);

        // The live invoking-tree row stands, never clobbered by the worktree copy.
        const row = await target.queryFirst<{ id: string; status: string }>(
            'SELECT id, status FROM runs WHERE external_key = ?',
            'task-0975',
        );
        expect(row).toEqual({ id: 'run_old', status: 'failed' });
        source.close();
        target.close();
    });

    test('re-persisting the same worktree is idempotent: counts unchanged, rows unmodified', async () => {
        const source = await setup();
        const target = await setup();
        await insertRun(source, 'run_a', { externalKey: 'k1' });
        await insertChild(source, 'workflow_states', 'st_1', 'run_a', 'implement');

        const first = await transferRunTables(source, target);
        expect(first.persistedIds).toEqual(['run_a']);
        const before = await count(target, 'workflow_states');

        const second = await transferRunTables(source, target);
        expect(second.persistedIds).toEqual([]);
        expect(second.skipped).toEqual([{ id: 'run_a', reason: 'id-exists' }]);
        expect(await count(target, 'runs')).toBe(1);
        expect(await count(target, 'workflow_states')).toBe(before);

        // ON CONFLICT DO NOTHING left the pre-existing child row byte-identical.
        const state = await target.queryFirst<{ state: string }>(
            'SELECT state FROM workflow_states WHERE id = ?',
            'st_1',
        );
        expect(state?.state).toBe('implement');
        source.close();
        target.close();
    });
});
