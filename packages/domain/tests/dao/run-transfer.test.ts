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

    test('external-key-conflict: non-terminal source lifecycle run with child rows stays fail-closed', async () => {
        const source = await setup();
        const target = await setup();
        await insertRun(source, 'run_new', {
            workflowName: 'task-lifecycle',
            externalKey: 'task-0975',
            status: 'running',
        });
        // The source run OWNS provenance, and is non-terminal, so refusing teardown is required
        // (1090 follow-up + 1149 R1: a non-terminal duplicate stays fail-closed).
        await insertChild(source, 'action_runs', 'act_0975', 'run_new', 'm');
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

    test('1149 R1: terminal source lifecycle row with child rows is graded as bookkeeping (AC1)', async () => {
        const source = await setup();
        const target = await setup();
        await insertRun(source, 'run_wt', {
            workflowName: 'task-lifecycle',
            externalKey: 'task:1138',
            status: 'done',
        });
        await insertChild(source, 'transition_runs', 'tr_1', 'run_wt', 'done');
        await insertChild(source, 'workflow_states', 'ws_1', 'run_wt', 'done');

        // Target holds an interrupted lifecycle row for the same task
        await insertRun(target, 'run_inv', {
            workflowName: 'task-lifecycle',
            externalKey: 'task:1138',
            status: 'interrupted',
        });

        const result = await transferRunTables(source, target);
        expect(result.persistedIds).toEqual([]);
        expect(result.skipped).toEqual([{ id: 'run_wt', reason: 'external-key-conflict-bookkeeping' }]);

        // Target row is untouched; child rows were not copied
        expect(await count(target, 'runs')).toBe(1);
        expect(await count(target, 'transition_runs')).toBe(0);
        expect(await count(target, 'workflow_states')).toBe(0);
        const row = await target.queryFirst<{ id: string; status: string }>(
            'SELECT id, status FROM runs WHERE external_key = ?',
            'task:1138',
        );
        expect(row).toEqual({ id: 'run_inv', status: 'interrupted' });
        source.close();
        target.close();
    });

    test('1149 R1: terminal target x terminal source lifecycle row is graded as bookkeeping', async () => {
        const source = await setup();
        const target = await setup();
        await insertRun(source, 'run_wt', {
            workflowName: 'feature-lifecycle',
            externalKey: 'feature:E71',
            status: 'done',
        });
        await insertChild(source, 'transition_runs', 'tr_2', 'run_wt', 'done');
        await insertRun(target, 'run_inv', {
            workflowName: 'feature-lifecycle',
            externalKey: 'feature:E71',
            status: 'failed',
        });

        const result = await transferRunTables(source, target);
        expect(result.skipped).toEqual([{ id: 'run_wt', reason: 'external-key-conflict-bookkeeping' }]);
        expect(await count(target, 'runs')).toBe(1);
        expect(await count(target, 'transition_runs')).toBe(0);
        source.close();
        target.close();
    });

    test('1149 R1: non-lifecycle workflow name with child rows keeps fail-closed external-key-conflict (AC3)', async () => {
        const source = await setup();
        const target = await setup();
        await insertRun(source, 'run_wt_pipeline', {
            workflowName: 'task-pipeline',
            externalKey: 'task-1138-pipe',
            status: 'done',
        });
        await insertChild(source, 'action_runs', 'act_pipe', 'run_wt_pipeline', 'implement');
        await insertRun(target, 'run_inv_pipeline', {
            workflowName: 'task-pipeline',
            externalKey: 'task-1138-pipe',
            status: 'interrupted',
        });

        const result = await transferRunTables(source, target);
        expect(result.skipped).toEqual([{ id: 'run_wt_pipeline', reason: 'external-key-conflict' }]);
        expect(await count(target, 'runs')).toBe(1);
        expect(await count(target, 'action_runs')).toBe(0);
        source.close();
        target.close();
    });

    test('external-key-conflict with a CHILDLESS source run is graded as bookkeeping (1090 follow-up)', async () => {
        // The identity belongs to the target row either way, so a bare bookkeeping row — the
        // pipeline precheck's auto-profile feature reopen creates one in the execution tree
        // while the invoking tree already owns that key — has nothing to orphan. It is still
        // reported, but teardown is not refused for it.
        const source = await setup();
        const target = await setup();
        await insertRun(source, 'run_bookkeeping', {
            workflowName: 'feature-lifecycle',
            externalKey: 'feature:H1',
            status: 'running',
        });
        await insertRun(target, 'run_owner', {
            workflowName: 'feature-lifecycle',
            externalKey: 'feature:H1',
            status: 'failed',
        });

        const result = await transferRunTables(source, target);
        expect(result.skipped).toEqual([{ id: 'run_bookkeeping', reason: 'external-key-conflict-bookkeeping' }]);
        // Nothing was written, and the owning row stands.
        expect(await count(target, 'runs')).toBe(1);
        const row = await target.queryFirst<{ id: string }>('SELECT id FROM runs WHERE external_key = ?', 'feature:H1');
        expect(row).toEqual({ id: 'run_owner' });
        source.close();
        target.close();
    });

    test("1262 R2: a worktree run's ledger rows reach the target ledger above its cursor (AC2)", async () => {
        const source = await setup();
        const target = await setup();
        await insertRun(source, 'run_wt', { workflowName: 'task-pipeline', externalKey: null });
        await insertChild(source, 'action_runs', 'act_wt', 'run_wt', 'gate');
        for (const [id, name, seq] of [
            ['ev_1', 'decision.start', 11],
            ['ev_2', 'decision.failure', 12],
            ['ev_3', 'decision.end', 13],
        ] as const) {
            await source.run(
                `INSERT INTO system_events (id, event_name, occurred_at, run_id, sequence)
                 VALUES (?, ?, '2026-10-19T00:00:00Z', 'run_wt', ?)`,
                id,
                name,
                seq,
            );
        }
        await source.run(
            `INSERT INTO decision_logs (id, decision_id, caller, run_id, outcome, started_at, ended_at, duration_ms)
             VALUES ('dl_1', 'failure-class', 'workflow', 'run_wt', 'fallback', '2026-10-19T00:00:00Z', '2026-10-19T00:00:01Z', 10)`,
        );
        // The target ledger already owns events of its own, with its own cursor (99).
        await target.run(
            `INSERT INTO system_events (id, event_name, occurred_at, run_id, sequence)
             VALUES ('ev_tgt', 'workflow.start', '2026-10-18T00:00:00Z', 'run_inv', 99)`,
        );

        const result = await transferRunTables(source, target);
        expect(result.persistedIds).toEqual(['run_wt']);
        expect(await count(target, 'decision_logs')).toBe(1);
        // Copied events keep source order and land above the target's previous maximum.
        const events = await target.queryAll<{ id: string; sequence: number }>(
            'SELECT id, sequence FROM system_events WHERE run_id = ? ORDER BY sequence',
            'run_wt',
        );
        expect(events).toEqual([
            { id: 'ev_1', sequence: 100 },
            { id: 'ev_2', sequence: 101 },
            { id: 'ev_3', sequence: 102 },
        ]);

        // Idempotent: a second persist adds nothing and moves no cursor.
        await transferRunTables(source, target);
        expect(await count(target, 'system_events')).toBe(4);
        expect(await count(target, 'decision_logs')).toBe(1);
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

// ─── Task 1324 R1: worktree provenance merge with origin markers ──────────

describe('transferRunTables worktree provenance merge (task 1324 R1)', () => {
    test('merges runs, phase_runs, task_run_links and run_sessions with ids preserved and worktree-origin markers', async () => {
        const source = await setup();
        const target = await setup();
        await insertRun(source, 'wt_run_1', { workflowName: 'task-pipeline', externalKey: null });
        await insertChild(source, 'phase_runs', 'wt_ph_1', 'wt_run_1', 'implement');
        await source.run(
            `INSERT INTO task_run_links (id, wbs, run_id, kind, created_at)
             VALUES ('wt_link_1', '0345', 'wt_run_1', 'pipeline', 1)`,
        );
        await source.run(
            `INSERT INTO history_run_session (run_id, source, session_id, exactness, mechanism, resolved_at)
             VALUES ('wt_run_1', 'agy', 'sess_wt_1', 'exact', 'observed', '2026-11-10T10:00:00.000Z')`,
        );

        const result = await transferRunTables(source, target);
        expect(result.persistedIds).toEqual(['wt_run_1']);
        expect(result.skipped).toEqual([]);

        // Ids preserved on every merged row.
        const run = await target.queryFirst<{ id: string; metadata_json: string }>(
            'SELECT id, metadata_json FROM runs WHERE id = ?',
            'wt_run_1',
        );
        expect(run?.id).toBe('wt_run_1');
        // Worktree-origin marker stamped into the run metadata.
        const meta = JSON.parse(run?.metadata_json ?? '{}') as Record<string, unknown>;
        expect(meta.worktree_origin).toBe(true);

        expect(await count(target, 'phase_runs')).toBe(1);
        const phase = await target.queryFirst<{ id: string }>("SELECT id FROM phase_runs WHERE id = 'wt_ph_1'");
        expect(phase?.id).toBe('wt_ph_1');

        const link = await target.queryFirst<{ id: string; wbs: string; run_id: string }>(
            'SELECT id, wbs, run_id FROM task_run_links WHERE id = ?',
            'wt_link_1',
        );
        expect(link).toEqual({ id: 'wt_link_1', wbs: '0345', run_id: 'wt_run_1' });

        // The run→session mapping carries the worktree-merge mechanism marker; exactness
        // and the mapping itself are preserved so cost attribution keeps the exact row.
        const session = await target.queryFirst<{
            run_id: string;
            source: string;
            session_id: string;
            exactness: string;
            mechanism: string;
        }>('SELECT run_id, source, session_id, exactness, mechanism FROM history_run_session');
        expect(session).toEqual({
            run_id: 'wt_run_1',
            source: 'agy',
            session_id: 'sess_wt_1',
            exactness: 'exact',
            mechanism: 'worktree-merge',
        });
        source.close();
        target.close();
    });

    test('re-merge is idempotent: second pass changes no rows', async () => {
        const source = await setup();
        const target = await setup();
        await insertRun(source, 'wt_run_2', { workflowName: 'task-pipeline', externalKey: null });
        await insertChild(source, 'phase_runs', 'wt_ph_2', 'wt_run_2', 'verify');
        await source.run(
            `INSERT INTO task_run_links (id, wbs, run_id, kind, created_at)
             VALUES ('wt_link_2', '0346', 'wt_run_2', 'pipeline', 1)`,
        );
        await source.run(
            `INSERT INTO history_run_session (run_id, source, session_id, exactness, mechanism, resolved_at)
             VALUES ('wt_run_2', 'pi', 'sess_wt_2', 'exact', 'observed', '2026-11-10T11:00:00.000Z')`,
        );

        await transferRunTables(source, target);
        const snapshot = async (): Promise<{ runs: number; phases: number; links: number; sessions: number }> => ({
            runs: await count(target, 'runs'),
            phases: await count(target, 'phase_runs'),
            links: await count(target, 'task_run_links'),
            sessions: await count(target, 'history_run_session'),
        });
        const before = await snapshot();

        const second = await transferRunTables(source, target);
        expect(second.persistedIds).toEqual([]);
        expect(second.skipped).toEqual([{ id: 'wt_run_2', reason: 'id-exists' }]);
        expect(await snapshot()).toEqual(before);
        source.close();
        target.close();
    });

    test('tolerates a pre-0013 worktree DB without history_run_session', async () => {
        const source = await setup();
        const target = await setup();
        await source.exec('DROP TABLE history_run_session');
        await insertRun(source, 'wt_run_3', { workflowName: 'wf-old', externalKey: null });

        const result = await transferRunTables(source, target);
        expect(result.persistedIds).toEqual(['wt_run_3']);
        expect(await count(target, 'history_run_session')).toBe(0);
        source.close();
        target.close();
    });
});
