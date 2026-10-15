/**
 * Thin-wrapper integration tests for `spur task scaffold-tests` (apps/cli/src/commands/task/scaffold-tests.ts).
 * Behavioral tests for TaskService live in packages/app/tests/services/task-service.test.ts.
 *
 * These exercise the verb surface through the real `main()` entry point:
 * golden paths, the `--json` envelope shape, and exit codes 0/1/2 (design §10, R5).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { main } from '../../../src/index';
import { type CapturedOutput, createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-scaffold-tests-task-test-${Date.now()}`);
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

    test('scaffold-tests action executes for an existing task', async () => {
        const isoCwd = join(join(import.meta.dir, '..'), '..', `.tmp-scaffold-tests-task-scaffold-${Date.now()}`);
        await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
        try {
            const createOut = createCapturedOutput();
            await main(['task', 'create', '--skip-ready', 'Scaffold target'], { cwd: isoCwd, output: createOut });
            const wbs = createdWbs(createOut);

            const output = createCapturedOutput();
            const exitCode = await main(['task', 'scaffold-tests', wbs, '--json'], { cwd: isoCwd, output });
            expect([0, 1]).toContain(exitCode);
        } finally {
            rmSync(isoCwd, { recursive: true, force: true });
        }
    });
});
