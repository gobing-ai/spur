/**
 * Thin-wrapper integration tests for `spur task refresh` (apps/cli/src/commands/task/refresh.ts).
 * Behavioral tests for TaskService live in packages/app/tests/services/task-service.test.ts.
 *
 * These exercise the verb surface through the real `main()` entry point:
 * golden paths, the `--json` envelope shape, and exit codes 0/1/2 (design §10, R5).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { main } from '../../../src/index';
import { type CapturedOutput, createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-refresh-task-test-${Date.now()}`);
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

/** The last captured message, or a throwing guard for empty output. */
function lastMessage(output: CapturedOutput): string {
    const msg = output.messages.at(-1);
    if (msg === undefined) throw new Error('no output captured');
    return msg;
}

describe('spur task CLI', () => {
    test('refresh re-scans corpus and exits 0 (kanban.md retired — A17)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'refresh'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain('Corpus scanned');
        // kanban.md is no longer generated.
        expect(existsSync(join(cwd, 'docs', 'tasks', 'kanban.md'))).toBe(false);
    });
    test('refresh --json returns folder and task counts', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'refresh', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.folders).toBeGreaterThan(0);
        expect(parsed.tasks).toBeGreaterThanOrEqual(0);
    });
    test('refresh --folder uses custom folder', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'refresh', '--folder', join(cwd, 'docs', 'tasks')], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain('Corpus scanned');
    });
    test('refresh with bad folder exits 1', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'refresh', '--folder', join(cwd, 'nonexistent')], { cwd, output });
        expect(exitCode).toBe(1);
    });
});
