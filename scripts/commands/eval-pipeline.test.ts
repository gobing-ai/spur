import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
    createEvalRun,
    diffRecords,
    diffSnapshot,
    type EvalRecord,
    type EvalRun,
    evalPipeline,
    extractTokenCost,
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

describe('extractTokenCost', () => {
    test('returns null when no agent.run rows carry token data (never zero)', () => {
        // No agent.run rows exist at unix epoch — guaranteed empty window.
        expect(extractTokenCost('.spur/spur.db', '1970-01-01T00:00:00Z', '1970-01-01T00:00:01Z')).toBeNull();
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
