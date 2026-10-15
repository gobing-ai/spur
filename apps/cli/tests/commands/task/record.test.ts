/**
 * Thin-wrapper integration tests for `spur task record` (apps/cli/src/commands/task/record.ts).
 * Behavioral tests for TaskService live in packages/app/tests/services/task-service.test.ts.
 *
 * These exercise the verb surface through the real `main()` entry point:
 * golden paths, the `--json` envelope shape, and exit codes 0/1/2 (design §10, R5).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MarkdownDocument } from '@gobing-ai/spur-domain';
import { main } from '../../../src/index';
import { type CapturedOutput, createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-record-task-test-${Date.now()}`);
    await mkdir(join(cwd, 'docs', 'tasks'), { recursive: true });
    // Materialize the file the fixtures cite as their evidence anchor. Since the 0994
    // follow-up a live record's Testing/Solution `file:line` anchor must RESOLVE at the
    // `--as done` guard (`L4.anchor-unresolved` is an error there), so a fixture citing a
    // path that does not exist would be denied by the anchor gate before the behaviour
    // each test below exists to exercise. Every fixture cites line 1 of this file.
    const evidenceTarget = join(cwd, 'apps', 'cli', 'src', 'commands', 'task.ts');
    await mkdir(join(evidenceTarget, '..'), { recursive: true });
    await writeFile(evidenceTarget, '// fixture evidence target (no real code)\nexport {};\n', 'utf-8');
});

afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
});

/** The file path printed by `task create` ("Created task NNNN: <path>"). */
function createdPath(output: CapturedOutput): string {
    const msg = output.messages.find((m) => m.startsWith('Created task'));
    if (msg === undefined) throw new Error(`no "Created task" line in: ${output.messages.join(' | ')}`);
    const path = msg.split(': ')[1];
    if (path === undefined) throw new Error(`could not parse path from: ${msg}`);
    return path;
}

/** The WBS embedded in the `task create` confirmation line. */
function createdWbs(output: CapturedOutput): string {
    const match = createdPath(output).match(/(\d{4})_/);
    if (match?.[1] === undefined) throw new Error(`no WBS in created path`);
    return match[1];
}

/** The last captured message, or a throwing guard for empty output. */
function lastMessage(output: CapturedOutput): string {
    const msg = output.messages.at(-1);
    if (msg === undefined) throw new Error('no output captured');
    return msg;
}

describe('spur task CLI', () => {
    // ── verdict ──
    // The verdict command reads the answer file and writes .spur/run/<wbs>-verdict.json
    // relative to the process cwd (not the test cwd), so we pass an absolute --from-answer
    // and clean the emitted artifact afterward to keep the repo tree clean.
    const verdictArtifacts: string[] = [];
    afterAll(() => {
        for (const p of verdictArtifacts) rmSync(p, { force: true });
    });

    // Cover the scaffold-tests action (function-coverage gate for task.ts)

    test('record with non-existent WBS exits 1 and prints error', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'record', '9999', '--json'], { cwd, output });
        // Non-existent task → error path (catch block line 226-229)
        expect(exitCode).toBe(1);
        expect(output.errors.length).toBeGreaterThan(0);
    });
    test('record --json returns structured result', async () => {
        const out = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Record JSON test'], { cwd, output: out });
        const wbs = createdWbs(out);
        // Create a minimal verdict so record has something to write.
        const verdictPath = join(cwd, '.spur', 'run', `${wbs}-verdict.json`);
        await mkdir(join(cwd, '.spur', 'run'), { recursive: true });
        await Bun.write(verdictPath, JSON.stringify({ wbs, verdict: 'PASS', requirements: [], checks: [] }));
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'record', wbs, '--verdict-file', verdictPath, '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.testingWritten).toBe(true);
        expect(parsed.reviewWritten).toBe(true);
    });
    test('record (human output) prints summary of written sections', async () => {
        const out = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Record human test'], { cwd, output: out });
        const wbs = createdWbs(out);
        const verdictPath = join(cwd, '.spur', 'run', `${wbs}-verdict.json`);
        await mkdir(join(cwd, '.spur', 'run'), { recursive: true });
        await Bun.write(verdictPath, JSON.stringify({ wbs, verdict: 'PASS', requirements: [], checks: [] }));
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'record', wbs, '--verdict-file', verdictPath], { cwd, output });
        expect(exitCode).toBe(0);
        const summary = output.messages.join(' ');
        expect(summary).toContain('Testing written');
        expect(summary).toContain('Review written');
    });
    test('0980: the pipeline record → done sequence leaves the task done with --no-lifecycle', async () => {
        // WHY: `spur task record --transition testing` used to construct the lifecycle
        // adapter while the pipeline's later `task update done --no-lifecycle` bypassed
        // it — leaving a `running` task-lifecycle row orphaned after every pipeline run
        // (task_run_links empty). This replays the pipeline's exact record and done
        // commands and checks the task status at both hops; the zero-lifecycle-row
        // assertion lives in packages/app/tests/services/task-record.test.ts (0980),
        // which probes the runs/task_run_links rows this sequence must NOT create.
        const out = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Pipeline record 0980'], { cwd, output: out });
        const wbs = createdWbs(out);
        const taskPath = createdPath(out);

        // Seed the sections the target-aware gates require at testing/done. Solution
        // carries a file:line citation (L3 hard rule; the diff backfill is a no-op here
        // because Solution is non-bare). AC box checked: the open-box rule is an error
        // when `--as` names a differing target (0800 R1).
        const writeSection = async (section: string, body: string): Promise<void> => {
            const bodyFile = join(cwd, `0980-${section.toLowerCase()}.md`);
            await Bun.write(bodyFile, body);
            await main(['task', 'update', wbs, '--section', section, '--from-file', bodyFile], {
                cwd,
                output: createCapturedOutput(),
            });
        };
        await writeSection('Requirements', 'R1. The pipeline record stage must not orphan a lifecycle run.\n');
        await writeSection('Acceptance Criteria', '- [x] Scenario: record reaches testing without a lifecycle row.\n');
        await writeSection('Solution', 'Applied in `apps/cli/src/commands/task.ts:1`.\n');

        // Pipeline precheck shape: status hops run with --no-lifecycle.
        await main(['task', 'update', wbs, 'todo', '--no-lifecycle'], { cwd, output: createCapturedOutput() });
        await main(['task', 'update', wbs, 'wip', '--no-lifecycle'], { cwd, output: createCapturedOutput() });

        // The pipeline's record command (task-pipeline.yaml task-record-transition),
        // with the 0980 --no-lifecycle flag.
        await mkdir(join(cwd, '.spur', 'run'), { recursive: true });
        const verdictPath = join(cwd, '.spur', 'run', `${wbs}-verdict.json`);
        await Bun.write(
            verdictPath,
            `${JSON.stringify({
                wbs,
                verdict: 'PASS',
                confidence: 'HIGH',
                requirements: [{ id: 'R1', status: 'MET', evidenceType: '', evidence: 'tests pass' }],
                acceptanceCriteria: [],
                checks: [{ name: 'Security', status: 'P1', evidence: 'no bypass' }],
            })}\n`,
        );
        const recordOutput = createCapturedOutput();
        const recordExit = await main(
            [
                'task',
                'record',
                wbs,
                '--verdict-file',
                verdictPath,
                '--solution-from-diff',
                '--transition',
                'testing',
                '--no-lifecycle',
            ],
            { cwd, output: recordOutput },
        );
        expect(recordExit).toBe(0);
        expect(recordOutput.messages.join(' ')).toContain('testing');

        // Status at the record hop: testing (target-aware gate passed inline).
        expect(MarkdownDocument.parse(await Bun.file(taskPath).text(), 'task').frontmatterData?.status).toBe('testing');

        // The pipeline's done command (task update done --no-lifecycle).
        const doneOutput = createCapturedOutput();
        const doneExit = await main(['task', 'update', wbs, 'done', '--no-lifecycle'], {
            cwd,
            output: doneOutput,
        });
        expect(doneExit).toBe(0);
        expect(doneOutput.errors.every((e) => !e.includes('blocked'))).toBe(true);

        // Status at the done hop — terminal, with no lifecycle machinery involved.
        expect(MarkdownDocument.parse(await Bun.file(taskPath).text(), 'task').frontmatterData?.status).toBe('done');
    });
});
