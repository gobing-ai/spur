/**
 * Thin-wrapper integration tests for `spur task path` (apps/cli/src/commands/task/path.ts).
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
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-path-task-test-${Date.now()}`);
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
    test('path prints absolute file path and exits 0', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Path test'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'path', wbs], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages[0] ?? '').toContain(`/${wbs}_`);
        expect(output.messages[0] ?? '').toContain('docs/tasks');
    });
    test('path --json returns structured output', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Path JSON test'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'path', wbs, '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.wbs).toBe(wbs);
        expect(parsed.filePath).toContain(`/${wbs}_`);
    });
    test('path with non-existent wbs exits 1', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'path', '9999'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.some((e) => e.includes('not found'))).toBe(true);
    });
    test('path with non-existent folder exits 1 (path catch block)', async () => {
        // --folder points at a non-existent dir; WBS 9999 exists in no folder.
        // Verifies graceful exit 1 (not a crash) when the folder override is bogus.
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'path', '9999', '--folder', join(cwd, 'no-such-folder-xyz')], {
            cwd,
            output,
        });
        expect(exitCode).toBe(1);
        expect(output.errors.length).toBeGreaterThan(0);
    });
});
