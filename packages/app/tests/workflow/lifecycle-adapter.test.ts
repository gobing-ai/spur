import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { applyCliMigrations, type DbAdapter, TaskRunLinkDao } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import type { EntityRef } from '../../src/services/planning-write-service';
import {
    LifecycleAdapter,
    type LifecycleAdapterOptions,
    TASK_LIFECYCLE_PROFILE,
} from '../../src/workflow/lifecycle-adapter';

// The real task-lifecycle state-machine the adapter drives (repo-root config).
const WORKFLOW_PATH = resolve(import.meta.dir, '..', '..', '..', '..', 'config', 'workflows', 'task-lifecycle.yaml');

const makeRef = (wbs: string): EntityRef => ({
    kind: 'task',
    id: wbs,
    filePath: `/tasks/${wbs}.md`,
    folder: '/tasks',
});

async function makeAdapter(): Promise<{ adapter: LifecycleAdapter; db: DbAdapter }> {
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(db);
    const opts: LifecycleAdapterOptions = {
        profile: TASK_LIFECYCLE_PROFILE,
        getDb: async () => db,
        taskRunLinkDao: (adapter) => new TaskRunLinkDao(adapter),
        workflowPath: WORKFLOW_PATH,
        cwd: process.cwd(),
        spurBin: 'spur',
    };
    return { adapter: new LifecycleAdapter(opts), db };
}

describe('LifecycleAdapter (engine integration)', () => {
    test('R2: allows a transition declared in the task-lifecycle graph (backlog → todo)', async () => {
        const { adapter, db } = await makeAdapter();
        const result = await adapter.requestTransition(makeRef('0001'), 'backlog', 'todo');
        expect(result.allowed).toBe(true);
        expect(result.from).toBe('backlog');
        expect(result.to).toBe('todo');
        db.close();
    });

    test('R2: denies a transition the graph does not declare (backlog → wip)', async () => {
        const { adapter, db } = await makeAdapter();
        const result = await adapter.requestTransition(makeRef('0002'), 'backlog', 'wip');
        expect(result.allowed).toBe(false);
        if (result.allowed) throw new Error('expected denial');
        expect(result.report ?? '').toContain('No transition');
        db.close();
    });

    test('R2: a shell guard denies the transition with its report (wip → testing, no task file)', async () => {
        // wip→testing is guarded by `spur task check ${vars.wbs}`. With no real
        // task file on disk the guard command fails, so the transition is denied
        // and the guard report flows back through the port.
        const { adapter, db } = await makeAdapter();
        const result = await adapter.requestTransition(makeRef('9999'), 'wip', 'testing');
        expect(result.allowed).toBe(false);
        if (result.allowed) throw new Error('expected guard denial');
        expect(result.report ?? '').toMatch(/guard/i);
        db.close();
    });

    test('R1+R4: create-or-attach binds run task:<wbs> and writes one lifecycle link', async () => {
        const { adapter, db } = await makeAdapter();
        const ref = makeRef('0003');
        await adapter.requestTransition(ref, 'backlog', 'todo');

        // R4: exactly one task_run_links row of kind=lifecycle for this wbs.
        const links = await new TaskRunLinkDao(db).listByWbs('0003', 10);
        expect(links).toHaveLength(1);
        expect(links[0]?.kind).toBe('lifecycle');
        expect(links[0]?.run_id).toMatch(/^run_/);

        // R1: a second transition attaches to the SAME run — no duplicate link.
        await adapter.requestTransition(ref, 'todo', 'wip');
        const after = await new TaskRunLinkDao(db).listByWbs('0003', 10);
        expect(after).toHaveLength(1);
        expect(after[0]?.run_id).toBe(links[0]?.run_id);
        db.close();
    });

    test('R3 (DD-04): file wins — engine self-heals from a disagreeing state', async () => {
        const { adapter, db } = await makeAdapter();
        const ref = makeRef('0004');

        // First transition seeds the run at backlog → todo (engine now at "todo").
        await adapter.requestTransition(ref, 'backlog', 'todo');

        // The file SSOT later says the task is at "wip" (engine disagrees: "todo").
        // A transition from the FILE status must succeed because the adapter
        // re-seeds the engine from the file before transitioning.
        const result = await adapter.requestTransition(ref, 'wip', 'blocked');
        expect(result.allowed).toBe(true);
        expect(result.from).toBe('wip');
        expect(result.to).toBe('blocked');
        db.close();
    });

    test('R3 (DD-04): re-seed makes a fresh run transition from the file status, not the initial state', async () => {
        // A brand-new run would start unseeded; the file says "testing". The
        // adapter re-seeds to "testing" so a testing→blocked transition is valid
        // even though the graph's initialState is "backlog".
        const { adapter, db } = await makeAdapter();
        const result = await adapter.requestTransition(makeRef('0005'), 'testing', 'blocked');
        expect(result.allowed).toBe(true);
        expect(result.from).toBe('testing');
        expect(result.to).toBe('blocked');
        db.close();
    });

    // ── P2: Provenance gate — tasks → done must have a pipeline run ──

    test('P2: provenance gate blocks testing→done when no pipeline run is recorded', async () => {
        const { adapter, db } = await makeAdapter();
        const result = await adapter.requestTransition(makeRef('0010'), 'testing', 'done');
        expect(result.allowed).toBe(false);
        if (result.allowed) throw new Error('expected provenance denial');
        expect(result.report ?? '').toContain('No pipeline run recorded');
        db.close();
    });

    test('P2: provenance gate passes when a pipeline run is recorded (shell guard fires)', async () => {
        const { adapter, db } = await makeAdapter();
        // Insert a pipeline link — simulates a task-pipeline.yaml run.
        await new TaskRunLinkDao(db).insert({
            id: 'trl_pipe',
            wbs: '9998',
            run_id: 'run_pipe',
            kind: 'pipeline',
            created_at: new Date().toISOString(),
        });
        const result = await adapter.requestTransition(makeRef('9998'), 'testing', 'done');
        // Provenance passes; the shell guard (spur task check --strict-core) fires.
        expect(result.allowed).toBe(false);
        if (result.allowed) throw new Error('expected guard denial');
        expect(result.report ?? '').toMatch(/guard/i);
        db.close();
    });

    test('P2: SPUR_PROVENANCE_OVERRIDE=1 allows done and records provenance_bypass', async () => {
        const { adapter, db } = await makeAdapter();
        const saved = process.env.SPUR_PROVENANCE_OVERRIDE;
        process.env.SPUR_PROVENANCE_OVERRIDE = '1';
        try {
            const result = await adapter.requestTransition(makeRef('9997'), 'testing', 'done');
            // Provenance bypass recorded; shell guard fires.
            expect(result.allowed).toBe(false);
            if (result.allowed) throw new Error('expected guard denial');
            expect(result.report ?? '').toMatch(/guard/i);
            // The bypass row was inserted.
            const links = await new TaskRunLinkDao(db).listByWbs('9997', 20);
            const bypass = links.filter((l) => l.kind === 'provenance_bypass');
            expect(bypass).toHaveLength(1);
            expect(bypass[0]?.run_id).toBe('manual');
        } finally {
            if (saved === undefined) delete process.env.SPUR_PROVENANCE_OVERRIDE;
            else process.env.SPUR_PROVENANCE_OVERRIDE = saved;
        }
        db.close();
    });

    test('P2: prior provenance_bypass allows done without inserting a new bypass', async () => {
        const { adapter, db } = await makeAdapter();
        // Insert a prior bypass — simulates a previous override.
        await new TaskRunLinkDao(db).insert({
            id: 'trl_prior',
            wbs: '9996',
            run_id: 'manual',
            kind: 'provenance_bypass',
            created_at: new Date().toISOString(),
        });
        const result = await adapter.requestTransition(makeRef('9996'), 'testing', 'done');
        // Provenance passes (prior bypass); shell guard fires.
        expect(result.allowed).toBe(false);
        if (result.allowed) throw new Error('expected guard denial');
        expect(result.report ?? '').toMatch(/guard/i);
        // No NEW bypass row inserted — still just the one.
        const links = await new TaskRunLinkDao(db).listByWbs('9996', 20);
        const bypass = links.filter((l) => l.kind === 'provenance_bypass');
        expect(bypass).toHaveLength(1);
        db.close();
    });

    // ── 0278 R1–R2: Review L3 content gate on testing→done ──

    test('0278 R1: denies done when Review is prose-only (no populated P1–P4 table)', async () => {
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);
        await new TaskRunLinkDao(db).insert({
            id: 'trl_r1',
            wbs: '0278a',
            run_id: 'run_pipe',
            kind: 'pipeline',
            created_at: new Date().toISOString(),
        });
        const proseOnly = [
            '---',
            'status: testing',
            '---',
            '### Review',
            'Looks good. No structured findings table here.',
            '### Testing',
            'n/a',
        ].join('\n');
        const adapter = new LifecycleAdapter({
            profile: TASK_LIFECYCLE_PROFILE,
            getDb: async () => db,
            taskRunLinkDao: (a) => new TaskRunLinkDao(a),
            workflowPath: WORKFLOW_PATH,
            cwd: process.cwd(),
            spurBin: 'spur',
            readTaskMarkdown: async () => proseOnly,
        });
        const result = await adapter.requestTransition(makeRef('0278a'), 'testing', 'done');
        expect(result.allowed).toBe(false);
        if (result.allowed) throw new Error('expected Review L3 denial');
        expect(result.report ?? '').toMatch(/Review L3 gate|P1–P4|strict-core/i);
        db.close();
    });

    test('0278 R2: allows past Review gate when P1–P4 table is populated (shell may still deny)', async () => {
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);
        await new TaskRunLinkDao(db).insert({
            id: 'trl_r2',
            wbs: '0278b',
            run_id: 'run_pipe',
            kind: 'pipeline',
            created_at: new Date().toISOString(),
        });
        const withTable = [
            '---',
            'status: testing',
            '---',
            '### Review',
            '| Priority | Dimension | Location | Finding |',
            '|----------|-----------|----------|---------|',
            '| P4 | — | — | No P1–P3 findings; verify PASS |',
            '### Testing',
            'Coverage: N/A',
        ].join('\n');
        const adapter = new LifecycleAdapter({
            profile: TASK_LIFECYCLE_PROFILE,
            getDb: async () => db,
            taskRunLinkDao: (a) => new TaskRunLinkDao(a),
            workflowPath: WORKFLOW_PATH,
            cwd: process.cwd(),
            spurBin: 'spur',
            readTaskMarkdown: async () => withTable,
        });
        const result = await adapter.requestTransition(makeRef('0278b'), 'testing', 'done');
        // Review L3 passes in-process; shell guard still runs against a non-file wbs → deny via guard.
        expect(result.allowed).toBe(false);
        if (result.allowed) throw new Error('expected shell guard denial after Review pass');
        expect(result.report ?? '').toMatch(/guard/i);
        expect(result.report ?? '').not.toMatch(/Review L3 gate/i);
        db.close();
    });
});

// ── F16/F17 (0622 R2): finalizeRun maps entity status → durable run status ──

async function runStatus(db: DbAdapter): Promise<string> {
    const row = await db.queryFirst<{ status: string }>('SELECT status FROM runs');
    if (!row) throw new Error('no runs row');
    return row.status;
}

test('F16/F17: cancelled transition finalizes the run as failed', async () => {
    const { adapter, db } = await makeAdapter();
    const result = await adapter.requestTransition(makeRef('f161'), 'backlog', 'cancelled');
    expect(result.allowed).toBe(true);
    expect(await runStatus(db)).toBe('failed');
    db.close();
});

test('F16/F17: non-terminal allowed transition leaves the run running', async () => {
    const { adapter, db } = await makeAdapter();
    const result = await adapter.requestTransition(makeRef('f162'), 'todo', 'blocked');
    expect(result.allowed).toBe(true);
    expect(await runStatus(db)).toBe('running');
    db.close();
});

test('F16/F17: done→wip reopen flips a finalized run back to running', async () => {
    const { adapter, db } = await makeAdapter();
    const first = await adapter.requestTransition(makeRef('f163'), 'todo', 'wip');
    expect(first.allowed).toBe(true);
    // Simulate the run having been finalized done earlier in its life.
    await db.run("UPDATE runs SET status = 'done'");
    const reopen = await adapter.requestTransition(makeRef('f163'), 'done', 'wip');
    expect(reopen.allowed).toBe(true);
    expect(await runStatus(db)).toBe('running');
    db.close();
});
