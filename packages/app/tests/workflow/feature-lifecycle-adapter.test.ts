import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { applyCliMigrations, type DbAdapter, TaskRunLinkDao } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { FeatureCheckService } from '../../src/services/feature-check';
import type { EntityRef } from '../../src/services/planning-write-service';
import {
    FEATURE_LIFECYCLE_PROFILE,
    LifecycleAdapter,
    type LifecycleAdapterOptions,
} from '../../src/workflow/lifecycle-adapter';

// The real feature-lifecycle state-machine the adapter drives (repo-root config).
const WORKFLOW_PATH = resolve(import.meta.dir, '..', '..', '..', '..', 'config', 'workflows', 'feature-lifecycle.yaml');

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

    test('R4 (0418): a two-P0-active corpus is recoverable through the CLI guard chain', async () => {
        // The deadlock fixture: F2 + F4 both P0 `active`, both finished (linked
        // tasks all done). Driving F2 active→verifying→done through the real FSM
        // shell guards (which pass `--as verifying` / `--as done`) must succeed,
        // leaving F4 as the single active goal. Removing the direction-aware fix
        // (or the `--as` guard wiring) makes the first transition fail → this test
        // fails, which is the mutation check R4 requires.
        const root = mkdtempSync(join(tmpdir(), 'spur-0418-recovery-'));
        const featuresDir = join(root, 'docs', 'features');
        const tasksDir = join(root, 'docs', 'tasks');
        mkdirSync(featuresDir, { recursive: true });
        mkdirSync(tasksDir, { recursive: true });

        const featureFile = (id: string, name: string, wbs: string): string =>
            [
                '---',
                'schema_version: 1',
                `id: "${id}"`,
                `name: "${name}"`,
                'status: active',
                'priority: P0',
                'created_at: 2026-08-02T00:00:00.000Z',
                'updated_at: 2026-08-02T00:00:00.000Z',
                '---',
                '',
                `# ${id}: ${name}`,
                '',
                '## Goal',
                '',
                'Finish the fixture goal.',
                '',
                '## Scope',
                '',
                'In: fixture',
                'Out: nothing',
                '',
                '## Acceptance Criteria',
                '',
                '- [ ] fixture item',
                '',
                '## Tasks',
                '',
                '| WBS | Task | Status |',
                '| --- | ---- | ------ |',
                `| ${wbs} | done task | done |`,
                '',
                '## Notes',
                '',
                'Fixture feature for the 0418 deadlock-recovery regression.',
            ].join('\n');
        const taskFile = (wbs: string, featureId: string): string =>
            [
                '---',
                'schema_version: 1',
                `wbs: "${wbs}"`,
                `name: "Task ${wbs}"`,
                'status: done',
                `feature_id: "${featureId}"`,
                'created_at: 2026-08-02T00:00:00.000Z',
                'updated_at: 2026-08-02T00:00:00.000Z',
                '---',
                '',
                `# ${wbs}: Task ${wbs}`,
                '',
                '### Solution',
                '',
                'Done.',
            ].join('\n');

        writeFileSync(join(featuresDir, 'F2_second.md'), featureFile('F2', 'Second P0', '9901'));
        writeFileSync(join(featuresDir, 'F4_fourth.md'), featureFile('F4', 'Fourth P0', '9902'));
        writeFileSync(join(tasksDir, '9901_done.md'), taskFile('9901', 'F2'));
        writeFileSync(join(tasksDir, '9902_done.md'), taskFile('9902', 'F4'));

        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);
        // The dev CLI entry is the spur binary the FSM shell guards invoke — it
        // carries the `--as` support this fix adds. `cwd` points at the fixture
        // project so the spawned check resolves docs/features + docs/tasks there.
        const repoRoot = resolve(import.meta.dir, '..', '..', '..', '..');
        const opts: LifecycleAdapterOptions = {
            profile: FEATURE_LIFECYCLE_PROFILE,
            getDb: async () => db,
            taskRunLinkDao: (adapter) => new TaskRunLinkDao(adapter),
            workflowPath: WORKFLOW_PATH,
            cwd: root,
            spurBin: `${process.execPath} ${join(repoRoot, 'apps', 'cli', 'src', 'index.ts')}`,
        };
        const adapter = new LifecycleAdapter(opts);

        // The adapter is the write service's LifecyclePort: it validates and
        // re-seeds engine state but never writes frontmatter. Mirror what the
        // write path does after each allowed transition so the file SSOT (and the
        // guard's file-wins re-seed) stays in sync with the requested state.
        const writeStatus = (file: string, status: string): void => {
            const path = join(featuresDir, file);
            const raw = readFileSync(path, 'utf8').replace(/^status: .*$/m, `status: ${status}`);
            writeFileSync(path, raw);
        };

        const execPath = process.execPath;
        const cliIndex = join(repoRoot, 'apps', 'cli', 'src', 'index.ts');
        const diagCmd = `${execPath} ${cliIndex} feature check F2 --as verifying`;
        const { nodeBunFactory } = await import('@gobing-ai/ts-runtime');
        try {
            const diagRes = await nodeBunFactory.createProcessExecutor().run({
                command: '/bin/sh',
                args: ['-c', diagCmd],
                cwd: root,
                rejectOnError: true,
            });
            console.log('DIAG_RES:', JSON.stringify(diagRes, null, 2));
        } catch (err: unknown) {
            const e = err as Record<string, unknown>;
            console.log('DIAG_CATCH_KEYS:', Object.keys(e ?? {}));
            console.log('DIAG_CATCH_MSG:', e?.message);
            console.log('DIAG_CATCH_CODE:', e?.code);
            console.log('DIAG_CATCH_ERR:', String(err));
            console.log('DIAG_CATCH_FULL:', JSON.stringify(err, Object.getOwnPropertyNames(err as object), 2));
        }

        // Relieving transition: F2 leaves active — the guard (`--as verifying`)
        // must not deny the exit the rule would otherwise relieve.
        const hop1 = await adapter.requestTransition(makeRef('F2'), 'active', 'verifying');
        expect(hop1.allowed, hop1.report ?? 'no report').toBe(true);
        if (!hop1.allowed) throw new Error(`expected relieving transition allowed: ${hop1.report}`);
        writeStatus('F2_second.md', 'verifying');

        // Terminal hop: F2 → done — strict guard (`--as done`) passes because the
        // fixture is strict-clean and the goal rule no longer counts a done target.
        const hop2 = await adapter.requestTransition(makeRef('F2'), 'verifying', 'done');
        expect(hop2.allowed, hop2.report ?? 'no report').toBe(true);
        if (!hop2.allowed) throw new Error(`expected terminal transition allowed: ${hop2.report}`);
        writeStatus('F2_second.md', 'done');

        // Corpus is back to a single active goal: static checks drop the goal error.
        const fs = createNodeFileSystem();
        for (const [id, file] of [
            ['F2', 'F2_second.md'],
            ['F4', 'F4_fourth.md'],
        ] as const) {
            const res = await new FeatureCheckService(fs).check(`${featuresDir}/${file}`, id, {
                featuresDir,
                tasksDir,
            });
            const goalErrors = res.findings.filter((f) => f.message.includes('One-active-goal'));
            expect(goalErrors).toHaveLength(0);
        }

        db.close();
        rmSync(root, { recursive: true, force: true });
    });
});
