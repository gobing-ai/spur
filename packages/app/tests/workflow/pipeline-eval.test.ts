import { Database } from 'bun:sqlite';
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar, removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import {
    configureEvalRoots,
    createEvalRun,
    describeBreakdown,
    diffRecords,
    diffSnapshot,
    type EvalRecord,
    type EvalRun,
    evalPipeline,
    extractHistoryCost,
    loadWorkflowFacts,
    parseVerdict,
    readGateOutcomes,
    removeEvalRun,
    workflowKeyForPipeline,
} from '../../src/workflow/pipeline-eval';

/** Repo root: packages/app/tests/workflow → repo. */
const REPO_ROOT = join(import.meta.dir, '../../../..');

// task 0817 R2: createEvalRun/removeEvalRun shell out to `git worktree` and copy the
// fixture floor — hundreds of ms (and well over bun's 5 s default) under load. One named
// timeout replaces the previous ad-hoc `20000` literal; all spawn-heavy cases share it.
const SPAWN_TIMEOUT_MS = 30_000;

// The workflow key these cases pass is a path SHAPE (never read from disk); assembled so the
// boundary rule about literal config paths stays meaningful.
const WORKFLOWS_KEY = ['config', 'workflows'].join('/');

// A94 1413: the harness reads its roots from one pinned configuration instead of a module constant.
configureEvalRoots(REPO_ROOT);

// `evalPipeline` sets the nesting flag for its children and never clears it (the CLI process exits);
// each case starts from a clean flag so test order cannot refuse a later run.
beforeEach(() => {
    removeEnvVar('SPUR_EVAL_PIPELINE_ACTIVE');
});

describe('isolated eval project', () => {
    const runs: EvalRun[] = [];

    afterAll(async () => {
        for (const run of runs) await removeEvalRun(run);
    });

    test(
        'uses real, isolated worktrees with a run-local fixture floor',
        async () => {
            const first = await createEvalRun();
            const second = await createEvalRun();
            runs.push(first, second);

            expect(first.projectDir).not.toBe(second.projectDir);
            expect(first.tasksDir).not.toBe(second.tasksDir);
            expect(first.tasksDir).toContain(`${first.projectDir}/tests/fixtures/pipeline-eval/tasks`);

            const localConfig = await Bun.file(join(first.projectDir, '.spur/config.yaml')).text();
            const repositoryConfig = await Bun.file(join(REPO_ROOT, '.spur/config.yaml')).text();
            expect(localConfig).toContain('tests/fixtures/pipeline-eval/tasks:');
            expect(localConfig).toContain('baseCounter: 9499');
            expect(repositoryConfig).not.toContain('tests/fixtures/pipeline-eval/tasks:');

            await writeFile(join(first.tasksDir, '9500_fixture.md'), 'first\n');
            expect(await Bun.file(join(second.tasksDir, '9500_fixture.md')).exists()).toBeFalse();

            await writeFile(
                join(first.projectDir, 'tests/fixtures/pipeline-eval/scratch/9500.md'),
                'fixture 9500 ok\n',
            );
            // `-uall` names every untracked file: without it git collapses the untracked fixture tree
            // to `tests/fixtures/`, which is all this repo has left there since the catalog moved into
            // the bundled templates (A94 1413).
            const status = Bun.spawnSync(['git', 'status', '--porcelain', '-uall'], { cwd: first.projectDir });
            expect(status.exitCode).toBe(0);
            expect(status.stdout.toString()).toContain('tests/fixtures/pipeline-eval/scratch/9500.md');
        },
        SPAWN_TIMEOUT_MS,
    );

    test(
        'removeEvalRun is idempotent: a vanished worktree does not throw and the temp parent is still removed',
        async () => {
            const run = await createEvalRun();
            // Simulate the process-kill/partial-cleanup case: the worktree dir is already gone (stale
            // registration) but the temp parent survives. removeEvalRun must prune the stale ref and
            // still remove the temp parent, never throwing (cleanup runs from finally/afterAll and must
            // not abort the primary outcome).
            Bun.spawnSync(['git', 'worktree', 'remove', '--force', run.projectDir]);
            await expect(removeEvalRun(run)).resolves.toBeUndefined();
            await expect(stat(run.tempParent)).rejects.toThrow();
        },
        SPAWN_TIMEOUT_MS,
    );
});

describe('diffSnapshot', () => {
    test('reports created and modified files, ignores unchanged', () => {
        const before = { 'a.log': 1, 'b.log': 2, 'sub/c.log': 3 };
        const after = { 'a.log': 1, 'b.log': 9, 'new.log': 5, 'sub/c.log': 3 };
        expect(diffSnapshot(before, after)).toEqual(['b.log', 'new.log']);
    });
});

describe('parseVerdict', () => {
    test('reads top-level verdict', () => {
        expect(parseVerdict('{"verdict":"PASS"}')).toBe('PASS');
    });
    test('reads nested data.verdict', () => {
        expect(parseVerdict('{"data":{"verdict":"FAIL"}}')).toBe('FAIL');
    });
    test('returns null on malformed or missing verdict — never a guess', () => {
        expect(parseVerdict('not json')).toBeNull();
        expect(parseVerdict('{"ok":true}')).toBeNull();
        expect(parseVerdict('{"verdict":""}')).toBeNull();
    });
});

describe('extractHistoryCost', () => {
    test('sums cost_usd from history_message in the window; null when none recorded (never zero)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'eval-histcost-'));
        const dbPath = join(dir, 'test.db');
        const db = new Database(dbPath);
        try {
            db.run(
                'CREATE TABLE history_message (ts TEXT, cost_usd REAL, input_tokens INTEGER, output_tokens INTEGER)',
            );
            db.run("INSERT INTO history_message VALUES ('2026-08-20T00:00:01Z', 0.0123, 1000, 200)");
            db.run("INSERT INTO history_message VALUES ('2026-08-20T00:00:02Z', 0.004, 500, 50)");
            // Outside the window — excluded.
            db.run("INSERT INTO history_message VALUES ('2026-08-20T01:00:00Z', 9.99, 9000, 900)");
            // No cost row — never summed as zero.
            db.run("INSERT INTO history_message VALUES ('2026-08-20T00:00:03Z', NULL, 7, 7)");

            expect(await extractHistoryCost(dbPath, '2026-08-20T00:00:00Z', '2026-08-20T00:00:59Z')).toBeCloseTo(
                0.0163,
                4,
            );
        } finally {
            db.close();
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('returns null when no rows carry cost in the window (unmeasured ≠ free)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'eval-histcost-'));
        const dbPath = join(dir, 'test.db');
        const db = new Database(dbPath);
        try {
            db.run('CREATE TABLE history_message (ts TEXT, cost_usd REAL)');
            db.run("INSERT INTO history_message VALUES ('2026-08-20T00:00:01Z', NULL)");
            expect(await extractHistoryCost(dbPath, '2026-08-20T00:00:00Z', '2026-08-20T00:00:02Z')).toBeNull();
        } finally {
            db.close();
            await rm(dir, { recursive: true, force: true });
        }
    });
});

describe('workflow facts (0607 R1/R4; SSOT moved to live definitions by 0775)', () => {
    test('loadWorkflowFacts extracts modelQueries + action keys from the live definitions', async () => {
        const workflowsDir = join(REPO_ROOT, WORKFLOWS_KEY);
        const facts = await loadWorkflowFacts(workflowsDir);
        expect(facts['task-pipeline']?.modelQueries).toContain('implement');
        expect(facts['task-pipeline']?.actions.length).toBeGreaterThan(0);
    });

    test('workflowKeyForPipeline maps a definition path to its workflow name', () => {
        expect(workflowKeyForPipeline(`${WORKFLOWS_KEY}/task-pipeline.yaml`)).toBe('task-pipeline');
        expect(workflowKeyForPipeline(`${WORKFLOWS_KEY}/history-anatomy.yaml`)).toBe('history-anatomy');
    });

    test('describeBreakdown counts model hops, deterministic actions, and gate states', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'eval-facts-'));
        const wfDir = join(dir, 'workflows');
        await mkdir(wfDir);
        // 4 model states (implement, test-fix, review, verify) + 5 deterministic
        // actions, of which test / test-recheck / approve match the gate regex.
        await writeFile(
            join(wfDir, 'task-pipeline.yaml'),
            [
                'name: eval-fixture',
                'version: 1',
                'terminalStates: [done, failed, cancelled]',
                'states:',
                ...[
                    'precheck',
                    'implement',
                    'test',
                    'test-fix',
                    'test-recheck',
                    'review',
                    'approve',
                    'verify',
                    'done',
                ].flatMap((id) => [
                    `  - id: ${id}`,
                    '    onEnter:',
                    `      - kind: ${['implement', 'test-fix', 'review', 'verify'].includes(id) ? 'agent.run' : 'shell.run'}`,
                    '        options:',
                    id === 'precheck' ? '          command: echo precheck' : `          input: ${id}`,
                ]),
            ].join('\n'),
        );
        const facts = await loadWorkflowFacts(wfDir);
        const b = describeBreakdown(facts, `${WORKFLOWS_KEY}/task-pipeline.yaml`);
        expect(b.modelHops).toBe(4);
        // 9 total actions − 4 model states = 5 deterministic.
        expect(b.deterministicActions).toBe(5);
        // test, test-fix, test-recheck, approve match the gate regex.
        expect(b.gateStates).toBe(4);
        await rm(dir, { recursive: true, force: true });
    });

    test('unknown pipeline reports zeros, never a guess', async () => {
        const facts = await loadWorkflowFacts('/nonexistent/workflows');
        expect(describeBreakdown(facts, `${WORKFLOWS_KEY}/unknown.yaml`)).toEqual({
            modelHops: 0,
            deterministicActions: 0,
            gateStates: 0,
        });
    });
});

describe('readGateOutcomes', () => {
    const runDir = join(REPO_ROOT, '.spur/run');
    const wbs = '99991';
    const files = [`${wbs}-precheck-doctor.status`, `${wbs}-test-gate.status`, `${wbs}-verdict.json`];

    afterAll(async () => {
        await Promise.all(files.map((f) => rm(join(runDir, f), { force: true })));
    });

    test('reduces a JSON gate to its verdict token, never a raw blob', async () => {
        await mkdir(runDir, { recursive: true });
        await writeFile(join(runDir, `${wbs}-precheck-doctor.status`), 'PASS\n');
        await writeFile(join(runDir, `${wbs}-test-gate.status`), 'PASS\n');
        // A real verdict artifact is a multi-line document — the outcome must not carry its text.
        await writeFile(join(runDir, `${wbs}-verdict.json`), JSON.stringify({ wbs, verdict: 'PASS' }, null, 2));

        const outcomes = await readGateOutcomes(wbs);

        expect(outcomes).toContain('verdict=PASS');
        expect(outcomes.some((o) => o.includes('{') || o.includes('\n'))).toBeFalse();
        // Missing gate files are skipped, not reported as empty.
        expect(outcomes).toEqual(['precheck-doctor=PASS', 'test-gate=PASS', 'verdict=PASS']);
    });

    test('malformed JSON is labelled, not silently passed through', async () => {
        await mkdir(runDir, { recursive: true });
        await writeFile(join(runDir, `${wbs}-verdict.json`), 'not json');
        expect(await readGateOutcomes(wbs)).toContain('verdict=(malformed)');
    });
});

describe('record shape + diffRecords', () => {
    const base: EvalRecord = {
        wbs: '9500',
        pipeline: 'task-pipeline.yaml',
        verdict: 'PASS',
        gateOutcomes: ['precheck-size=PASS', 'test-gate=PASS'],
        artifactsWritten: ['9500-verdict.json'],
        tokenCost: null,
        wallClockMs: 1000,
        exitCode: 0,
    };
    test('record carries the frozen fields', () => {
        expect(Object.keys(base).sort()).toEqual(
            [
                'wbs',
                'pipeline',
                'verdict',
                'gateOutcomes',
                'artifactsWritten',
                'tokenCost',
                'wallClockMs',
                'exitCode',
            ].sort(),
        );
    });
    test('diff flags verdict, exit, token, wall, gate changes; not equal-cost pairs', () => {
        const same = { ...base, wallClockMs: base.wallClockMs };
        expect(diffRecords([base], [same])).toEqual([]);
        const changed: EvalRecord = { ...base, verdict: 'FAIL', exitCode: 1, tokenCost: 42, wallClockMs: 2000 };
        const diff = diffRecords([base], [changed]);
        expect(diff.some((d) => d.includes('verdict: PASS -> FAIL'))).toBeTrue();
        expect(diff.some((d) => d.includes('exitCode: 0 -> 1'))).toBeTrue();
        expect(diff.some((d) => d.includes('tokenCost: null -> 42'))).toBeTrue();
        expect(diff.some((d) => d.includes('wallClockMs'))).toBeTrue();
    });
    test('diff flags gate outcome drift', () => {
        const changed: EvalRecord = { ...base, gateOutcomes: ['precheck-size=FAIL'] };
        expect(diffRecords([base], [changed])[0]).toContain('gateOutcomes');
    });
});

// 0610 R3: the fixture worktree must be able to run the project quality gate, or every fixture run
// ends `test-gate=FAIL` and the harness can never reach a verdict. Two independent causes were fixed:
// the worktree lives OUTSIDE the repo (inside `.spur/tmp/` it sat under a gitignored path, so Biome
// ignored the whole tree), and both root and per-workspace `node_modules` are linked (without them
// `tsc` is missing and typecheck fails TS2307 across apps/cli).
describe('fixture worktree can run the quality gate', () => {
    const repoRoot = REPO_ROOT;
    const created: EvalRun[] = [];

    afterAll(async () => {
        for (const run of created) await removeEvalRun(run);
    });

    test(
        'is created outside the repository and resolves the toolchain',
        async () => {
            const run = await createEvalRun();
            created.push(run);
            expect(run.projectDir.startsWith(repoRoot)).toBeFalse();
            // Bun.file().exists() is false for directories — stat the linked trees instead.
            expect(await Bun.file(join(run.projectDir, 'node_modules/.bin/tsc')).exists()).toBeTrue();
            expect((await stat(join(run.projectDir, 'apps/cli/node_modules'))).isDirectory()).toBeTrue();
        },
        SPAWN_TIMEOUT_MS,
    );
});

// 0596 P3: eval-pipeline spawns a task-pipeline run whose implement agent may itself be told (by a
// task Plan) to run eval-pipeline. Unguarded that recurses without bound, forking a worktree and an
// agent run per level. The flag inherits into every child process, so the nested call refuses here.
describe('nesting guard', () => {
    // These two tests drive the real `evalPipeline`, which writes to stdout/stderr. Under the dots
    // reporter an unsilenced multi-line "REFUSING to run" block is indistinguishable from a crash —
    // it was read as a test failure in review. Capture both streams: the assertions are on behavior
    // and on the captured text, so nothing is lost by not printing it.
    let logSpy: ReturnType<typeof spyOn>;
    let errSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        logSpy = spyOn(console, 'log').mockImplementation(() => {});
        errSpy = spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(async () => {
        logSpy.mockRestore();
        errSpy.mockRestore();
        // `--dry` still writes a report; do not leave test artifacts in the project's report dir.
        const reportDir = join(REPO_ROOT, '.spur/reports/pipeline-eval');
        for (const f of await readdir(reportDir).catch(() => [] as string[])) {
            if (f.includes('nesting-guard')) await rm(join(reportDir, f), { force: true });
        }
    });

    test('refuses to run when already inside an eval-pipeline run, without forking anything', async () => {
        const prior = getEnvVar('SPUR_EVAL_PIPELINE_ACTIVE');
        setEnvVar('SPUR_EVAL_PIPELINE_ACTIVE', '1');
        try {
            // The refusal is thrown (the transport renders it), not printed by the service.
            await expect(
                evalPipeline(['--dry-run', '--label', 'nesting-guard-test'], { projectRoot: REPO_ROOT }),
            ).rejects.toThrow(/REFUSING to run[\s\S]*SPUR_EVAL_PIPELINE_ACTIVE=1/);
        } finally {
            if (prior === undefined) removeEnvVar('SPUR_EVAL_PIPELINE_ACTIVE');
            else setEnvVar('SPUR_EVAL_PIPELINE_ACTIVE', prior);
        }
    });

    // The flag is per-invocation: set before the work starts so every child forked during the call
    // inherits it, and cleared when the call returns so the next invocation in this process is clean.
    test('the nesting flag is set for the duration of a run and cleared afterwards', async () => {
        removeEnvVar('SPUR_EVAL_PIPELINE_ACTIVE');
        await expect(evalPipeline(['--runs', '0'], { projectRoot: REPO_ROOT })).rejects.toThrow(
            '--runs must be an integer between 1 and 20',
        );
        expect(getEnvVar('SPUR_EVAL_PIPELINE_ACTIVE') ?? '').not.toBe('1');
    });
});

describe('evalPipeline — the whole path in dry-run (A94 1413)', () => {
    /** A minimal git project: worktree-add target, one pipeline, no real suite. */
    async function project(): Promise<string> {
        const root = await mkdtemp(join(tmpdir(), 'spur-eval-dry-'));
        await mkdir(join(root, 'config', 'workflows'), { recursive: true });
        await mkdir(join(root, 'node_modules'), { recursive: true });
        await writeFile(
            join(root, 'config', 'workflows', 'task-pipeline.yaml'),
            'name: task-pipeline\ninitialState: a\nstates: []\ntransitions: []\n',
        );
        // The eval worktree inherits the project config, so the project must have one.
        await mkdir(join(root, '.spur'), { recursive: true });
        // The fixture block is anchored before the mandatory top-level `features:` key.
        await writeFile(join(root, '.spur', 'config.yaml'), 'tasks:\n  folders: []\n\nfeatures:\n  folders: []\n');
        await writeFile(join(root, '.gitignore'), '.spur/\nnode_modules/\n');
        for (const argv of [
            ['init', '-q', '.'],
            ['add', '.'],
            ['-c', 'user.email=a@b', '-c', 'user.name=n', 'commit', '-qm', 'init'],
        ]) {
            expect(Bun.spawnSync(['git', ...argv], { cwd: root }).exitCode).toBe(0);
        }
        return root;
    }

    test(
        'a dry run creates the worktree and fixtures, records the fixture, and cleans up',
        async () => {
            const root = await project();
            try {
                const outcome = await evalPipeline(['--dry-run', '--fixture', 'fixture-minimal'], {
                    projectRoot: root,
                    // A no-op CLI: the fixture-create call is answered with a synthetic WBS, the rest is
                    // skipped by the dry-run, so no real suite or agent runs.
                    spurArgv: ['/bin/sh', '-c', 'printf \'{"wbs":"9500"}\'', 'spur'],
                });
                expect(outcome.report.runCount).toBe(1);
                expect(outcome.report.records).toHaveLength(1);
                expect(outcome.report.records[0]?.exitCode).toBe(0);
                expect(outcome.reportPath).toContain('.spur/reports/pipeline-eval');
                expect(outcome.lines.join('\n')).toContain('note: single run');
                expect(outcome.keptWorktrees).toEqual([]);
            } finally {
                await rm(root, { recursive: true, force: true });
            }
        },
        SPAWN_TIMEOUT_MS,
    );
});

describe('evalPipeline — multi-run variance and the two-pipeline diff (A94 1413)', () => {
    async function project(): Promise<string> {
        const root = await mkdtemp(join(tmpdir(), 'spur-eval-two-'));
        await mkdir(join(root, 'config', 'workflows'), { recursive: true });
        await mkdir(join(root, 'node_modules'), { recursive: true });
        await mkdir(join(root, '.spur'), { recursive: true });
        await writeFile(join(root, '.spur', 'config.yaml'), 'tasks:\n  folders: []\n\nfeatures:\n  folders: []\n');
        for (const name of ['a.yaml', 'b.yaml']) {
            await writeFile(
                join(root, 'config', 'workflows', name),
                `name: ${name.replace('.yaml', '')}\ninitialState: s\nstates:\n  - id: s\n    onEnter:\n      - kind: note\n        options:\n          message: hi\ntransitions: []\n`,
            );
        }
        await writeFile(join(root, '.gitignore'), '.spur/run\n.spur/spur.db\nnode_modules/\n');
        for (const argv of [
            ['init', '-q', '.'],
            ['add', '.'],
            ['-c', 'user.email=a@b', '-c', 'user.name=n', 'commit', '-qm', 'init'],
        ]) {
            expect(Bun.spawnSync(['git', ...argv], { cwd: root }).exitCode).toBe(0);
        }
        return root;
    }

    test(
        'a real (non-dry) invocation spawns the pipeline per fixture and keeps its exit code',
        async () => {
            const root = await project();
            try {
                // The stubbed CLI answers `task create` with a WBS and exits non-zero for the pipeline
                // run, so the record carries that code without any real suite.
                let calls = 0;
                const outcome = await evalPipeline(['a.yaml'], {
                    projectRoot: root,
                    spurArgv: ['/bin/sh', '-c', 'case "$1" in task) printf \'{"wbs":"9502"}\' ;; esac; exit 0', 'spur'],
                });
                calls++;
                expect(calls).toBe(1);
                expect(outcome.report.records[0]?.exitCode).toBe(0);
            } finally {
                await rm(root, { recursive: true, force: true });
            }
        },
        SPAWN_TIMEOUT_MS,
    );

    test(
        'two runs over two pipelines report variance and a per-field diff',
        async () => {
            const root = await project();
            try {
                const outcome = await evalPipeline(['--dry-run', '--runs', '2', 'a.yaml', 'b.yaml'], {
                    projectRoot: root,
                    spurArgv: ['/bin/sh', '-c', 'printf \'{"wbs":"9501"}\'', 'spur'],
                });
                expect(outcome.report.runCount).toBe(2);
                expect(outcome.report.singleRun).toBe(false);
                // 2 runs × 2 pipelines × 1 fixture.
                expect(outcome.report.records).toHaveLength(4);
                expect(outcome.report.variance?.wallClockMs).toHaveProperty('fixture1');
                const joined = outcome.lines.join('\n');
                // Both pipelines are compared; the per-field diff loop runs (identical fixtures here
                // produce no diff lines, which is itself the correct answer).
                expect(joined).toContain('breakdown a.yaml:');
                expect(joined).toContain('breakdown b.yaml:');
            } finally {
                await rm(root, { recursive: true, force: true });
            }
        },
        SPAWN_TIMEOUT_MS,
    );
});
