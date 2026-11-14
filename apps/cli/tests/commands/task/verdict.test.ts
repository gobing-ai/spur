/**
 * Thin-wrapper integration tests for `spur task verdict` (apps/cli/src/commands/task/verdict.ts).
 * Behavioral tests for TaskService live in packages/app/tests/services/task-service.test.ts.
 *
 * These exercise the verb surface through the real `main()` entry point:
 * golden paths, the `--json` envelope shape, and exit codes 0/1/2 (design §10, R5).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { main } from '../../../src/index';
import { type CapturedOutput, createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-verdict-task-test-${Date.now()}`);
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

    test('verdict derives PASS from an all-MET answer table and writes the artifact', async () => {
        const answerPath = join(cwd, '8001-verify-answer.txt');
        await Bun.write(answerPath, '| Req | Status | Evidence |\n|-----|--------|----------|\n| R1 | MET | done |\n');
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verdict', '8001', '--from-answer', answerPath, '--json'], {
            cwd,
            output,
        });
        verdictArtifacts.push(join(process.cwd(), '.spur', 'run', '8001-verdict.json'));
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.verdict).toBe('PASS');
        expect(parsed.wbs).toBe('8001');
        expect(parsed.source).toBe('spur-task-verdict');
    });
    test('verdict (human output) prints a verdict summary line', async () => {
        const answerPath = join(cwd, '8002-verify-answer.txt');
        await Bun.write(answerPath, '| Req | Status | Evidence |\n|-----|--------|----------|\n| R1 | MET | done |\n');
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verdict', '8002', '--from-answer', answerPath], { cwd, output });
        verdictArtifacts.push(join(process.cwd(), '.spur', 'run', '8002-verdict.json'));
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toContain('Verdict: PASS');
    });
    test('verdict fails closed on a hollow MET row (0721): PARTIAL + exit 1', async () => {
        // An evidence-less requirement table parses but records nothing — the
        // aggregate must be PARTIAL (exit 1), never PASS.
        const answerPath = join(cwd, '8002b-verify-answer.txt');
        await Bun.write(answerPath, '| Req | Status | Evidence |\n|-----|--------|----------|\n| R1 | MET |  |\n');
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verdict', '8002b', '--from-answer', answerPath], { cwd, output });
        verdictArtifacts.push(join(process.cwd(), '.spur', 'run', '8002b-verdict.json'));
        expect(exitCode).toBe(1);
        expect(lastMessage(output)).toContain('Verdict: PARTIAL');
    });
    test('verdict downgrades behavior-bearing AC without executable evidence', async () => {
        const answerPath = join(cwd, '8005-verify-answer.txt');
        await Bun.write(
            answerPath,
            [
                '| Req | Status | Evidence |',
                '|-----|--------|----------|',
                '| R1 | MET | `apps/cli/src/commands/task.ts:1` |',
                '',
                '| AC | Status | Evidence Type | Evidence |',
                '|----|--------|---------------|----------|',
                '| Scenario: CLI emits JSON | MET | static-ref | `apps/cli/src/commands/task.ts:1` |',
            ].join('\n'),
        );
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verdict', '8005', '--from-answer', answerPath, '--json'], {
            cwd,
            output,
        });
        verdictArtifacts.push(join(process.cwd(), '.spur', 'run', '8005-verdict.json'));
        expect(exitCode).toBe(1);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.verdict).toBe('PARTIAL');
        expect(parsed.acceptanceCriteria[0].status).toBe('PARTIAL');
        expect(parsed.checks.some((check: { name: string }) => check.name === 'evidence-rule-failed')).toBe(true);
    });
    test('verdict honors an AC exemption tag only when the task file carries it (P2)', async () => {
        const createOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Exemption fixture'], { cwd, output: createOut });
        const wbs = createdWbs(createOut);
        const acFile = join(cwd, `${wbs}-ac.md`);
        const answerPath = join(cwd, `${wbs}-verify-answer.txt`);
        const reqFile = join(cwd, `${wbs}-req.md`);
        await Bun.write(reqFile, 'R1. The help text must name the verb.\n');
        await main(['task', 'update', wbs, '--section', 'Requirements', '--from-file', reqFile], {
            cwd,
            output: createCapturedOutput(),
        });
        const answer = (tag: string) =>
            [
                'Verdict: PASS',
                'Confidence: MEDIUM',
                '',
                '| Req | Status | Evidence |',
                '|-----|--------|----------|',
                '| R1 | MET | `apps/cli/src/commands/task.ts:1` |',
                '',
                '| AC | Status | Evidence Type | Evidence |',
                '|----|--------|---------------|----------|',
                `| ${tag}The help text names the verb | MET | static-ref | \`apps/cli/src/commands/task.ts:1\` |`,
            ].join('\n');
        const runVerdict = async (taskItem: string): Promise<{ verdict: string; checks: { name: string }[] }> => {
            await Bun.write(acFile, `- [x] ${taskItem}\n`);
            await main(['task', 'update', wbs, '--section', 'Acceptance Criteria', '--from-file', acFile], {
                cwd,
                output: createCapturedOutput(),
            });
            await Bun.write(answerPath, answer('[docs-only] '));
            const output = createCapturedOutput();
            await main(['task', 'verdict', wbs, '--from-answer', answerPath, '--json'], { cwd, output });
            return JSON.parse(lastMessage(output));
        };
        verdictArtifacts.push(join(process.cwd(), '.spur', 'run', `${wbs}-verdict.json`));

        const untagged = await runVerdict('The help text names the verb');
        expect(untagged.verdict).toBe('PARTIAL');
        expect(untagged.checks.some((c) => c.name === 'ac-exemption-not-in-task')).toBe(true);

        const tagged = await runVerdict('[docs-only] The help text names the verb');
        expect(tagged.checks.some((c) => c.name === 'ac-exemption-not-in-task')).toBe(false);
        expect(tagged.checks.some((c) => c.name === 'evidence-rule-pass')).toBe(true);
    });
    test('verdict exits 1 on UNKNOWN when the answer has no parseable requirements', async () => {
        const answerPath = join(cwd, '8003-verify-answer.txt');
        await Bun.write(answerPath, 'no requirements table here\n');
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verdict', '8003', '--from-answer', answerPath, '--json'], {
            cwd,
            output,
        });
        verdictArtifacts.push(join(process.cwd(), '.spur', 'run', '8003-verdict.json'));
        expect(exitCode).toBe(1);
        expect(JSON.parse(lastMessage(output)).verdict).toBe('UNKNOWN');
    });
    test('verdict exits 1 with an error when the answer file is missing', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verdict', '8004', '--from-answer', join(cwd, 'nope.txt')], {
            cwd,
            output,
        });
        expect(exitCode).toBe(1);
        expect(output.errors.some((e) => e.includes('Answer file not found'))).toBe(true);
    });

    // 1319 R4 through the real verb: `--replay` must be opt-in, and a cited test file that does
    // not hold up must downgrade PASS to PARTIAL inside the durable artifact. A missing file is
    // the deterministic failure here — nothing is spawned.
    test('--replay downgrades PASS to PARTIAL when a cited test file is missing; without it nothing replays', async () => {
        const answerPath = join(cwd, '8090-verify-answer.txt');
        const artifact = join(process.cwd(), '.spur', 'run', '8090-verdict.json');
        await Bun.write(
            answerPath,
            '| Req | Status | Evidence |\n|-----|--------|----------|\n| R1 | MET | `apps/cli/tests/gone.test.ts:3` |\n',
        );

        try {
            const plain = createCapturedOutput();
            expect(
                await main(['task', 'verdict', '8090', '--from-answer', answerPath, '--json'], { cwd, output: plain }),
            ).toBe(0);
            expect(JSON.parse(lastMessage(plain)).replay).toBeUndefined();

            const replayed = createCapturedOutput();
            const exitCode = await main(
                ['task', 'verdict', '8090', '--from-answer', answerPath, '--replay', '--json'],
                {
                    cwd,
                    output: replayed,
                },
            );
            expect(exitCode).toBe(1);
            const parsed = JSON.parse(await readFile(artifact, 'utf-8'));
            expect(parsed.verdict).toBe('PARTIAL');
            expect(parsed.replay.findings).toEqual([
                { anchor: 'apps/cli/tests/gone.test.ts:3', file: 'apps/cli/tests/gone.test.ts', missing: true },
            ]);
        } finally {
            rmSync(artifact, { force: true });
        }
    });
});
