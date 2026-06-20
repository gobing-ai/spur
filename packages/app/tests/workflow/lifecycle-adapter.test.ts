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
const WORKFLOW_PATH = resolve(import.meta.dir, '../../../../config/workflows/task-lifecycle.yaml');

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

    test('R2: denies a transition the graph does not declare (backlog → done)', async () => {
        const { adapter, db } = await makeAdapter();
        const result = await adapter.requestTransition(makeRef('0002'), 'backlog', 'done');
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
});
