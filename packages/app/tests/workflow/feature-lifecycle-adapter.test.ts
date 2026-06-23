import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { applyCliMigrations, type DbAdapter, TaskRunLinkDao } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import type { EntityRef } from '../../src/services/planning-write-service';
import {
    FEATURE_LIFECYCLE_PROFILE,
    LifecycleAdapter,
    type LifecycleAdapterOptions,
} from '../../src/workflow/lifecycle-adapter';

// The real feature-lifecycle state-machine the adapter drives (repo-root config).
const WORKFLOW_PATH = resolve(import.meta.dir, '../../../../config/workflows/feature-lifecycle.yaml');

const makeRef = (id: string): EntityRef => ({
    kind: 'feature',
    id,
    filePath: `/features/${id}.md`,
    folder: '/features',
});

async function makeAdapter(): Promise<{ adapter: LifecycleAdapter; db: DbAdapter }> {
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(db);
    const opts: LifecycleAdapterOptions = {
        profile: FEATURE_LIFECYCLE_PROFILE,
        getDb: async () => db,
        taskRunLinkDao: (adapter) => new TaskRunLinkDao(adapter),
        workflowPath: WORKFLOW_PATH,
        cwd: process.cwd(),
        spurBin: 'spur',
    };
    return { adapter: new LifecycleAdapter(opts), db };
}

describe('FeatureLifecycleAdapter (engine integration)', () => {
    test('R1: allows a transition declared in the feature-lifecycle graph (backlog → active)', async () => {
        const { adapter, db } = await makeAdapter();
        const result = await adapter.requestTransition(makeRef('F1'), 'backlog', 'active');
        expect(result.allowed).toBe(true);
        expect(result.from).toBe('backlog');
        expect(result.to).toBe('active');
        db.close();
    });

    test('R1: denies a transition the graph does not declare (backlog → done)', async () => {
        const { adapter, db } = await makeAdapter();
        const result = await adapter.requestTransition(makeRef('F2'), 'backlog', 'done');
        expect(result.allowed).toBe(false);
        if (result.allowed) throw new Error('expected denial');
        expect(result.report ?? '').toContain('No transition');
        db.close();
    });

    test('R2: verifying→done shell guard (feature check --strict) denies with its report', async () => {
        // verifying→done is guarded by `spur feature check <id> --strict`. With no
        // real feature file the guard fails → the transition is denied and the
        // guard report flows back through the port.
        const { adapter, db } = await makeAdapter();
        const result = await adapter.requestTransition(makeRef('ZZ'), 'verifying', 'done');
        expect(result.allowed).toBe(false);
        if (result.allowed) throw new Error('expected guard denial');
        expect(result.report ?? '').toMatch(/guard/i);
        db.close();
    });

    test('R1: create-or-attach binds run feature:<id> and writes one feature-lifecycle link', async () => {
        const { adapter, db } = await makeAdapter();
        const ref = makeRef('F3');
        await adapter.requestTransition(ref, 'backlog', 'active');

        const links = await new TaskRunLinkDao(db).listByWbs('F3', 10);
        expect(links).toHaveLength(1);
        expect(links[0]?.kind).toBe('feature-lifecycle');
        expect(links[0]?.run_id).toMatch(/^run_/);

        // A second transition attaches to the SAME run — no duplicate link.
        await adapter.requestTransition(ref, 'active', 'blocked');
        const after = await new TaskRunLinkDao(db).listByWbs('F3', 10);
        expect(after).toHaveLength(1);
        expect(after[0]?.run_id).toBe(links[0]?.run_id);
        db.close();
    });

    test('R2: verifying→active rework path is allowed (always guard)', async () => {
        const { adapter, db } = await makeAdapter();
        const result = await adapter.requestTransition(makeRef('F4'), 'verifying', 'active');
        expect(result.allowed).toBe(true);
        expect(result.from).toBe('verifying');
        expect(result.to).toBe('active');
        db.close();
    });

    test('DD-04: file wins — engine self-heals from a disagreeing state', async () => {
        const { adapter, db } = await makeAdapter();
        const ref = makeRef('F5');
        // Seed at backlog → active (engine now at "active").
        await adapter.requestTransition(ref, 'backlog', 'active');
        // The file SSOT later says "verifying"; a transition from the FILE status
        // must succeed because the adapter re-seeds from the file first.
        const result = await adapter.requestTransition(ref, 'verifying', 'active');
        expect(result.allowed).toBe(true);
        expect(result.from).toBe('verifying');
        expect(result.to).toBe('active');
        db.close();
    });
});
