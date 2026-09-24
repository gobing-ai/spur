import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ArtifactDao, applyCliMigrations, type DbAdapter, TaskRunLinkDao } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { FeatureCheckService } from '../../src/services/feature-check';
import type { EntityRef } from '../../src/services/planning-write-service';
import {
    captureFeatureReceiptDigest,
    completeFeatureVerificationReceipt,
    DEFAULT_FEATURE_VERIFICATION_CMD,
    featureReceiptPaths,
    startFeatureVerificationReceipt,
} from '../../src/workflow/feature-verification-receipt';
import {
    FEATURE_LIFECYCLE_PROFILE,
    LifecycleAdapter,
    type LifecycleAdapterOptions,
} from '../../src/workflow/lifecycle-adapter';
import { resolveWorkflowDefinition } from '../../src/workflow/workflow-resolver';

// The real feature-lifecycle state-machine the adapter drives (repo-root config).
const WORKFLOW_PATH = resolve(import.meta.dir, '..', '..', '..', '..', 'config', 'workflows', 'feature-lifecycle.yaml');

const makeRef = (id: string): EntityRef => ({
    kind: 'feature',
    id,
    filePath: `/features/${id}.md`,
    folder: '/features',
});

/** Minimal git repo: tracked fixture files give the receipt digest a stable tree. */
function initGit(root: string): void {
    const run = (args: string) => {
        Bun.spawnSync(['sh', '-c', args], { cwd: root });
    };
    run('git init -q && git config user.email t@t && git config user.name t');
    run('git add -A && git commit -qm init');
}

/**
 * Mirror the production verification script's recording path (D63 task 0915):
 * digest the current checked inputs, record RUNNING then the terminal receipt,
 * and back it with a `done` run row + registered artifact — the same run-store
 * binding the CLI's receipt port enforces at the completion boundary.
 */
async function recordReceipt(
    fs: FileSystem,
    root: string,
    featuresDir: string,
    fileName: string,
    featureId: string,
    verdict: 'PASS' | 'FAIL' = 'PASS',
): Promise<void> {
    const raw = readFileSync(join(featuresDir, fileName), 'utf8');
    const inputDigest = await captureFeatureReceiptDigest(root, raw);
    const runId = `run-${featureId.toLowerCase()}`;
    const runDir = join(root, '.spur', 'run');
    // Mirror the production script: record the verifier exactly as the workflow
    // resolver selects it in this workdir, or the completion contract check fails.
    const selected = await resolveWorkflowDefinition(root, 'feature-verification');
    const running = await startFeatureVerificationReceipt(fs, runDir, {
        featureId,
        runId,
        workdir: root,
        verifier: {
            name: 'feature-verification',
            sourcePath: selected.path,
            layer: selected.layer,
            definitionDigest: selected.digest,
        },
        verificationCmd: DEFAULT_FEATURE_VERIFICATION_CMD,
        inputDigest,
    });
    await completeFeatureVerificationReceipt(fs, runDir, running, {
        status: verdict,
        inputDigest,
    });
    // Run-store mirror: the CLI's receipt port refuses a receipt whose run row
    // is absent or still running, so the fixture records what the engine would.
    await fs.ensureDir(join(root, '.spur'));
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: join(root, '.spur', 'spur.db') });
    await applyCliMigrations(db);
    const now = new Date().toISOString();
    // Idempotent: R4 (0872) re-records the receipt after the last tree mutation.
    await db.run(
        'INSERT OR REPLACE INTO runs (id, workflow_name, mode, status, started_at, completed_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            runId,
            'feature-verification',
            'state-machine',
            'done',
            now,
            now,
            JSON.stringify({ definitionDigest: selected.digest }),
            Date.now(),
            Date.now(),
        ],
    );
    await db.run('DELETE FROM artifacts WHERE run_id = ?', [runId]);
    await new ArtifactDao(db).record({
        runId,
        path: featureReceiptPaths(runDir, featureId, runId).runScoped,
        kind: 'feature-verification',
    });
}

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

/** A strict-clean single-feature corpus fixture: one done task linked to a P0 feature. */
const featureFixtureFile = (id: string, name: string, wbs: string): string =>
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
        'Fixture feature for the feature-lifecycle guard regression.',
    ].join('\n');

const taskFixtureFile = (wbs: string, featureId: string): string =>
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

/** Build a feature-lifecycle adapter against a fixture project at `root`. */
function makeFixtureAdapter(root: string, db: DbAdapter): LifecycleAdapter {
    const repoRoot = resolve(import.meta.dir, '..', '..', '..', '..');
    const opts: LifecycleAdapterOptions = {
        profile: FEATURE_LIFECYCLE_PROFILE,
        getDb: async () => db,
        taskRunLinkDao: (adapter) => new TaskRunLinkDao(adapter),
        workflowPath: WORKFLOW_PATH,
        cwd: root,
        spurBin: `${process.execPath} ${join(repoRoot, 'apps', 'cli', 'src', 'index.ts')}`,
        // These fixtures assert guards. The real verifying onEnter is the repo-wide
        // pass; leave it off so a hop into verifying does not start that pass.
        runEnterActions: false,
    };
    return new LifecycleAdapter(opts);
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

    test('R3 (0692): active→done denial names the legal path and the feature sync command', async () => {
        const { adapter, db } = await makeAdapter();
        const result = await adapter.requestTransition(makeRef('F9'), 'active', 'done');
        expect(result.allowed).toBe(false);
        if (result.allowed) throw new Error('expected denial');
        expect(result.report ?? '').toContain('Legal path(s) from active');
        expect(result.report ?? '').toContain('spur feature sync');
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

        writeFileSync(join(featuresDir, 'F2_second.md'), featureFixtureFile('F2', 'Second P0', '9901'));
        writeFileSync(join(featuresDir, 'F4_fourth.md'), featureFixtureFile('F4', 'Fourth P0', '9902'));
        writeFileSync(join(tasksDir, '9901_done.md'), taskFixtureFile('9901', 'F2'));
        writeFileSync(join(tasksDir, '9902_done.md'), taskFixtureFile('9902', 'F4'));
        // Real repos ignore `.spur/` — without it `git add -A` in the digest
        // capture would pull the receipt itself into the tree (self-referential
        // instability). Same for the 0872 fixture below.
        writeFileSync(join(root, '.gitignore'), '.spur/\n');
        initGit(root);

        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);
        // The dev CLI entry is the spur binary the FSM shell guards invoke — it
        // carries the `--as` support this fix adds. `cwd` points at the fixture
        // project so the spawned check resolves docs/features + docs/tasks there.
        const adapter = makeFixtureAdapter(root, db);

        // The adapter is the write service's LifecyclePort: it validates and
        // re-seeds engine state but never writes frontmatter. Mirror what the
        // write path does after each allowed transition so the file SSOT (and the
        // guard's file-wins re-seed) stays in sync with the requested state.
        const writeStatus = (file: string, status: string): void => {
            const path = join(featuresDir, file);
            const raw = readFileSync(path, 'utf8').replace(/^status: .*$/m, `status: ${status}`);
            writeFileSync(path, raw);
        };

        // Relieving transition: F2 leaves active — the guard (`--as verifying`)
        // must not deny the exit the rule would otherwise relieve.
        const hop1 = await adapter.requestTransition(makeRef('F2'), 'active', 'verifying');
        expect(hop1.allowed, hop1.report ?? 'no report').toBe(true);
        if (!hop1.allowed) throw new Error(`expected relieving transition allowed: ${hop1.report}`);
        writeStatus('F2_second.md', 'verifying');

        // Terminal hop: F2 → done — the done boundary requires CURRENT bound
        // verification evidence (D63 task 0915): the strict check (`--as done`)
        // validates a receipt digest-chained to the checked inputs. Mirror the
        // pass recording it after the last tree mutation, before the hop.
        mkdirSync(join(root, '.spur', 'run'), { recursive: true });
        await recordReceipt(createNodeFileSystem(), root, featuresDir, 'F2_second.md', 'F2');

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

    test('R4 (0872): verifying→done refuses until the feature-scoped pass records PASS', async () => {
        // ADR-119 (task 0872): a feature cannot reach done while its repo-wide
        // verification pass is failing. The verifying→done shell guard reads
        // `.spur/run/<id>-feature-verification.status` and only proceeds to the
        // strict check when it is exactly PASS. A missing or FAIL verdict must
        // deny the hop even though the feature itself is strict-clean.
        const root = mkdtempSync(join(tmpdir(), 'spur-0872-r4-'));
        const featuresDir = join(root, 'docs', 'features');
        const tasksDir = join(root, 'docs', 'tasks');
        mkdirSync(featuresDir, { recursive: true });
        mkdirSync(tasksDir, { recursive: true });
        writeFileSync(join(featuresDir, 'F6_sixth.md'), featureFixtureFile('F6', 'Sixth', '9903'));
        writeFileSync(join(tasksDir, '9903_done.md'), taskFixtureFile('9903', 'F6'));
        writeFileSync(join(root, '.gitignore'), '.spur/\n');
        initGit(root);

        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);
        const adapter = makeFixtureAdapter(root, db);

        const writeStatus = (file: string, status: string): void => {
            const path = join(featuresDir, file);
            const raw = readFileSync(path, 'utf8').replace(/^status: .*$/m, `status: ${status}`);
            writeFileSync(path, raw);
        };

        const hop1 = await adapter.requestTransition(makeRef('F6'), 'active', 'verifying');
        expect(hop1.allowed, hop1.report ?? 'no report').toBe(true);
        if (!hop1.allowed) throw new Error(`expected active→verifying allowed: ${hop1.report}`);
        writeStatus('F6_sixth.md', 'verifying');

        // 1. No recorded verdict → denied (fail-closed).
        const missing = await adapter.requestTransition(makeRef('F6'), 'verifying', 'done');
        expect(missing.allowed).toBe(false);
        if (missing.allowed) throw new Error('expected denial while the pass verdict is missing');

        // 2. A FAIL verdict → denied, even on a strict-clean feature: the receipt
        // is recorded with verdict FAIL (the coarse `.status` alone no longer
        // satisfies anything — the receipt is the completion evidence, 0915).
        const runDir = join(root, '.spur', 'run');
        mkdirSync(runDir, { recursive: true });
        const fs = createNodeFileSystem();
        await recordReceipt(fs, root, featuresDir, 'F6_sixth.md', 'F6', 'FAIL');
        const failing = await adapter.requestTransition(makeRef('F6'), 'verifying', 'done');
        expect(failing.allowed).toBe(false);
        if (failing.allowed) throw new Error('expected denial while the pass verdict is FAIL');

        // 3. A current PASS receipt → the strict check runs and the hop is allowed.
        await recordReceipt(fs, root, featuresDir, 'F6_sixth.md', 'F6', 'PASS');
        const passing = await adapter.requestTransition(makeRef('F6'), 'verifying', 'done');
        expect(passing.allowed, passing.report ?? 'no report').toBe(true);
        if (!passing.allowed)
            throw new Error(`expected verifying→done allowed once PASS is recorded: ${passing.report}`);

        db.close();
        rmSync(root, { recursive: true, force: true });
    });

    test('0948 AC1: an allowed hop runs the target onEnter shell with vars as environment', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-0948-enter-'));
        const marker = join(root, 'entered.txt');
        const workflowPath = join(root, 'enter.yaml');
        const spurBin = 'bun $(echo pwned)';
        writeFileSync(
            workflowPath,
            [
                '$schema: "@gobing-ai/spur/schemas/state-machine-workflow.schema.json"',
                'kind: state-machine',
                'name: enter-probe',
                'version: "1"',
                'description: 0948 onEnter probe',
                'initialState: active',
                'vars:',
                '  spurBin: spur',
                '  featureId: X',
                'states:',
                '  - id: active',
                '    description: start',
                '  - id: verifying',
                '    description: caller runs on entry',
                '    onEnter:',
                '      - kind: shell',
                '        options:',
                '          command: \'printf %s "$spurBin" > entered.txt\'',
                'transitions:',
                '  - from: active',
                '    to: verifying',
                '    description: enter',
                '    guard:',
                '      kind: always',
                '',
            ].join('\n'),
        );
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);
        const adapter = new LifecycleAdapter({
            profile: FEATURE_LIFECYCLE_PROFILE,
            getDb: async () => db,
            taskRunLinkDao: (inner) => new TaskRunLinkDao(inner),
            workflowPath,
            cwd: root,
            spurBin,
        });
        const result = await adapter.requestTransition(makeRef('E7'), 'active', 'verifying');
        expect(result.allowed, result.report ?? 'no report').toBe(true);
        expect(readFileSync(marker, 'utf8')).toBe(spurBin);

        const skipped = new LifecycleAdapter({
            profile: FEATURE_LIFECYCLE_PROFILE,
            getDb: async () => db,
            taskRunLinkDao: (inner) => new TaskRunLinkDao(inner),
            workflowPath,
            cwd: root,
            spurBin,
            runEnterActions: false,
        });
        writeFileSync(marker, 'stale');
        const skippedResult = await skipped.requestTransition(makeRef('E8'), 'active', 'verifying');
        expect(skippedResult.allowed, skippedResult.report ?? 'no report').toBe(true);
        expect(readFileSync(marker, 'utf8')).toBe('stale');

        db.close();
        rmSync(root, { recursive: true, force: true });
    });

    test('0948 AC1: a failing onEnter shell denies the hop', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-0948-enter-fail-'));
        const workflowPath = join(root, 'enter.yaml');
        writeFileSync(
            workflowPath,
            [
                '$schema: "@gobing-ai/spur/schemas/state-machine-workflow.schema.json"',
                'kind: state-machine',
                'name: enter-probe-fail',
                'version: "1"',
                'description: 0948 onEnter failure probe',
                'initialState: active',
                'vars:',
                '  spurBin: spur',
                '  featureId: X',
                'states:',
                '  - id: active',
                '    description: start',
                '  - id: verifying',
                '    description: caller fails',
                '    onEnter:',
                '      - kind: shell',
                '        options:',
                "          command: 'printf fail >&2; exit 9'",
                'transitions:',
                '  - from: active',
                '    to: verifying',
                '    description: enter',
                '    guard:',
                '      kind: always',
                '',
            ].join('\n'),
        );
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);
        const adapter = new LifecycleAdapter({
            profile: FEATURE_LIFECYCLE_PROFILE,
            getDb: async () => db,
            taskRunLinkDao: (inner) => new TaskRunLinkDao(inner),
            workflowPath,
            cwd: root,
            spurBin: 'spur',
        });
        const result = await adapter.requestTransition(makeRef('E9'), 'active', 'verifying');
        expect(result.allowed).toBe(false);
        expect(result.report ?? '').toContain('exit 9');
        expect(result.report ?? '').toContain('fail');
        db.close();
        rmSync(root, { recursive: true, force: true });
    });
});
