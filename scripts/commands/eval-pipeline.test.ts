import { Database } from 'bun:sqlite';
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    baselineKeyForPipeline,
    createEvalRun,
    describeBreakdown,
    diffRecords,
    diffSnapshot,
    type EvalRecord,
    type EvalRun,
    evalPipeline,
    extractHistoryCost,
    loadBaselineFacts,
    parseVerdict,
    readGateOutcomes,
    removeEvalRun,
} from './eval-pipeline';

describe('isolated eval project', () => {
    const runs: EvalRun[] = [];

    afterAll(async () => {
        for (const run of runs) await removeEvalRun(run);
    });

    test('uses real, isolated worktrees with a run-local fixture floor', async () => {
        const first = await createEvalRun();
        const second = await createEvalRun();
        runs.push(first, second);

        expect(first.projectDir).not.toBe(second.projectDir);
        expect(first.tasksDir).not.toBe(second.tasksDir);
        expect(first.tasksDir).toContain(`${first.projectDir}/tests/fixtures/pipeline-eval/tasks`);

        const localConfig = await Bun.file(join(first.projectDir, '.spur/config.yaml')).text();
        const repositoryConfig = await Bun.file('.spur/config.yaml').text();
        expect(localConfig).toContain('tests/fixtures/pipeline-eval/tasks:');
        expect(localConfig).toContain('baseCounter: 9499');
        expect(repositoryConfig).not.toContain('tests/fixtures/pipeline-eval/tasks:');

        await writeFile(join(first.tasksDir, '9500_fixture.md'), 'first\n');
        expect(await Bun.file(join(second.tasksDir, '9500_fixture.md')).exists()).toBeFalse();

        await writeFile(join(first.projectDir, 'tests/fixtures/pipeline-eval/scratch/9500.md'), 'fixture 9500 ok\n');
        const status = Bun.spawnSync(['git', 'status', '--porcelain'], { cwd: first.projectDir });
        expect(status.exitCode).toBe(0);
        expect(status.stdout.toString()).toContain('tests/fixtures/pipeline-eval/scratch/');
    });
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

            expect(extractHistoryCost(dbPath, '2026-08-20T00:00:00Z', '2026-08-20T00:00:59Z')).toBeCloseTo(0.0163, 4);
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
            expect(extractHistoryCost(dbPath, '2026-08-20T00:00:00Z', '2026-08-20T00:00:02Z')).toBeNull();
        } finally {
            db.close();
            await rm(dir, { recursive: true, force: true });
        }
    });
});

describe('baseline facts (0607 R1/R4)', () => {
    test('loadBaselineFacts reads modelQueries + action keys from the frozen baseline', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'eval-baseline-'));
        const p = join(dir, 'baseline.json');
        await writeFile(
            p,
            JSON.stringify({
                workflows: {
                    'task-pipeline': {
                        definition: 'config/workflows/task-pipeline.yaml',
                        modelQueries: ['implement', 'test-fix', 'review', 'verify'],
                        actions: {
                            'test:onEnter:0': {},
                            'test-recheck:onEnter:0': {},
                            'review:onEnter:0': {},
                            'done:onEnter:0': {},
                        },
                    },
                },
            }),
        );
        const facts = await loadBaselineFacts(p);
        expect(facts['task-pipeline'].modelQueries).toEqual(['implement', 'test-fix', 'review', 'verify']);
        expect(facts['task-pipeline'].actions).toHaveLength(4);
        await rm(dir, { recursive: true, force: true });
    });

    test('baselineKeyForPipeline maps a definition path to its workflow name', () => {
        expect(baselineKeyForPipeline('config/workflows/task-pipeline.yaml')).toBe('task-pipeline');
        expect(baselineKeyForPipeline('config/workflows/pr-review.yaml')).toBe('pr-review');
    });

    test('describeBreakdown counts model hops, deterministic actions, and gate states', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'eval-baseline-'));
        const p = join(dir, 'baseline.json');
        await writeFile(
            p,
            JSON.stringify({
                workflows: {
                    'task-pipeline': {
                        modelQueries: ['implement', 'test-fix', 'review', 'verify'],
                        actions: {
                            'precheck:onEnter:0': {},
                            'test:onEnter:0': {},
                            'test-recheck:onEnter:0': {},
                            'review:onEnter:0': {},
                            'approve:onEnter:0': {},
                            'done:onEnter:0': {},
                        },
                    },
                },
            }),
        );
        const facts = await loadBaselineFacts(p);
        const b = describeBreakdown(facts, 'config/workflows/task-pipeline.yaml');
        expect(b.modelHops).toBe(4);
        // 6 total actions − 4 model states = 2 deterministic.
        expect(b.deterministicActions).toBe(2);
        // test, test-recheck, approve match the gate regex.
        expect(b.gateStates).toBe(3);
        await rm(dir, { recursive: true, force: true });
    });

    test('unknown pipeline reports zeros, never a guess', async () => {
        const facts = await loadBaselineFacts('/nonexistent/baseline.json');
        expect(describeBreakdown(facts, 'config/workflows/unknown.yaml')).toEqual({
            modelHops: 0,
            deterministicActions: 0,
            gateStates: 0,
        });
    });
});

describe('readGateOutcomes', () => {
    const runDir = join(new URL('../../', import.meta.url).pathname, '.spur/run');
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
    const repoRoot = new URL('../../', import.meta.url).pathname;
    const created: EvalRun[] = [];

    afterAll(async () => {
        for (const run of created) await removeEvalRun(run);
    });

    test('is created outside the repository and resolves the toolchain', async () => {
        const run = await createEvalRun();
        created.push(run);
        expect(run.projectDir.startsWith(repoRoot)).toBeFalse();
        // Bun.file().exists() is false for directories — stat the linked trees instead.
        expect(await Bun.file(join(run.projectDir, 'node_modules/.bin/tsc')).exists()).toBeTrue();
        expect((await stat(join(run.projectDir, 'apps/cli/node_modules'))).isDirectory()).toBeTrue();
    });
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
        const reportDir = join(new URL('../../', import.meta.url).pathname, '.spur/reports/pipeline-eval');
        for (const f of await readdir(reportDir).catch(() => [] as string[])) {
            if (f.includes('nesting-guard')) await rm(join(reportDir, f), { force: true });
        }
    });

    test('refuses to run when already inside an eval-pipeline run, without forking anything', async () => {
        const prior = process.env.SPUR_EVAL_PIPELINE_ACTIVE;
        process.env.SPUR_EVAL_PIPELINE_ACTIVE = '1';
        try {
            // --dry would still create a worktree if the guard did not fire first.
            expect(await evalPipeline(['--dry', '--label', 'nesting-guard-test'])).toBe(1);
            // Assert on the captured refusal rather than letting it print.
            const refusal = errSpy.mock.calls.flat().join('\n');
            expect(refusal).toContain('REFUSING to run');
            expect(refusal).toContain('SPUR_EVAL_PIPELINE_ACTIVE=1');
        } finally {
            if (prior === undefined) delete process.env.SPUR_EVAL_PIPELINE_ACTIVE;
            else process.env.SPUR_EVAL_PIPELINE_ACTIVE = prior;
        }
    });

    test('a first-level run sets the flag so children inherit it', async () => {
        const prior = process.env.SPUR_EVAL_PIPELINE_ACTIVE;
        delete process.env.SPUR_EVAL_PIPELINE_ACTIVE;
        try {
            await evalPipeline(['--dry', '--label', 'nesting-guard-sets-flag']);
            expect(process.env.SPUR_EVAL_PIPELINE_ACTIVE).toBe('1');
        } finally {
            if (prior === undefined) delete process.env.SPUR_EVAL_PIPELINE_ACTIVE;
            else process.env.SPUR_EVAL_PIPELINE_ACTIVE = prior;
        }
    });
});
