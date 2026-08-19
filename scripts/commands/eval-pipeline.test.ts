import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
    createEvalRun,
    diffRecords,
    diffSnapshot,
    type EvalRecord,
    type EvalRun,
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
