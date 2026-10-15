/**
 * Thin-wrapper integration tests for `spur task resolve` (apps/cli/src/commands/task/resolve.ts).
 * Behavioral tests for TaskService live in packages/app/tests/services/task-service.test.ts.
 *
 * These exercise the verb surface through the real `main()` entry point:
 * golden paths, the `--json` envelope shape, and exit codes 0/1/2 (design §10, R5).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { main } from '../../../src/index';
import { type CapturedOutput, createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-resolve-task-test-${Date.now()}`);
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

/** The last captured message, or a throwing guard for empty output. */
function lastMessage(output: CapturedOutput): string {
    const msg = output.messages.at(-1);
    if (msg === undefined) throw new Error('no output captured');
    return msg;
}

describe('spur task CLI', () => {
    test('resolve maps a task file path to its WBS', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Resolve me'], { cwd, output: cOut });
        const taskPath = createdPath(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'resolve', taskPath], { cwd, output });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toMatch(/\d{4}/);
    });
    test('resolve --json returns structured output', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Resolve JSON'], { cwd, output: cOut });
        const taskPath = createdPath(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'resolve', taskPath, '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.wbs).toMatch(/^\d{4}$/);
        expect(parsed.filePath).toBe(resolve(taskPath));
    });
    test('resolve returns 1 for unknown path', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'resolve', '/nonexistent/file.md'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.at(-1)).toContain('No owning task found');
    });
});
