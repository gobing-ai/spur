/**
 * Thin-wrapper integration tests for `spur task list` (apps/cli/src/commands/task/list.ts).
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
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-list-task-test-${Date.now()}`);
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
    // The board tests need a populated corpus. In the single-file suite they inherited the tasks
    // earlier verbs had created; seed one explicitly now that `task list` runs on its own.
    beforeAll(async () => {
        expect(
            await main(['task', 'create', '--skip-ready', 'List seed task'], { cwd, output: createCapturedOutput() }),
        ).toBe(0);
    });

    test('list renders a status-grouped board with all columns', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'list'], { cwd, output });
        expect(exitCode).toBe(0);
        const board = output.messages.join('');
        // WHY: the human board groups by status with a column per canonical state,
        // so a freshly-created task (status backlog) must surface under the Backlog
        // column header — not as a raw flat row.
        expect(board).toContain('Kanban Board');
        expect(board).toContain('Backlog');
        expect(board).toMatch(/• \d{4}/);
    });
    test('list --status filters out non-matching tasks via --json', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'list', '--status', 'cancelled', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const rows = JSON.parse(lastMessage(output));
        expect(rows).toEqual([]);
    });
    test('list --json returns a JSON array', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'list', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBeGreaterThan(0);
        expect(parsed[0].wbs).toMatch(/^\d{4}$/);
    });
    test('list with no matching status prints (no tasks)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'list', '--status', 'cancelled'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.at(-1)).toContain('(no tasks)');
    });
    test('list board shows every canonical column header, even when empty', async () => {
        // WHY: the board shape must be stable across runs, so every column header is
        // rendered regardless of whether it holds tasks — the old `tasks list` board
        // behavior, minus the redundant blurb/count lines.
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'list'], { cwd, output });
        expect(exitCode).toBe(0);
        const board = output.messages.join('');
        for (const col of ['Backlog', 'Todo', 'WIP', 'Testing', 'Blocked', 'Done', 'Canceled']) {
            expect(board).toContain(col);
        }
    });
    test('list --status collapses the board to only the matching column', async () => {
        // WHY: a status filter should answer "what is in this column", not render the
        // matching section among six empty ones. Fixture tasks are all created at
        // backlog, so --status backlog shows Backlog but none of the other headers.
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'list', '--status', 'backlog'], { cwd, output });
        expect(exitCode).toBe(0);
        const board = output.messages.join('');
        expect(board).toContain('Backlog');
        for (const col of ['Todo', 'WIP', 'Testing', 'Blocked', 'Done', 'Canceled']) {
            expect(board).not.toContain(col);
        }
    });
    test('list --status bogus --json fails with writeJsonError, not an empty array', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'list', '--status', 'bogus', '--json'], { cwd, output });
        expect(exitCode).toBe(1);
        const combined = `${output.errors.join('\n')}\n${output.messages.join('\n')}`;
        expect(combined).toContain('Unknown task status');
        expect(combined).toContain('"bogus"');
        expect(combined).toMatch(/allowed:.*backlog/);
        expect(output.messages.join('').trim()).not.toBe('[]');
    });
    test('list --status backlog,todo --json fails naming the value', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'list', '--status', 'backlog,todo', '--json'], { cwd, output });
        expect(exitCode).toBe(1);
        const combined = `${output.errors.join('\n')}\n${output.messages.join('\n')}`;
        expect(combined).toContain('Unknown task status');
        expect(combined).toContain('backlog,todo');
        expect(output.messages.join('').trim()).not.toBe('[]');
    });
    test('list --phase backlog,todo --json fails naming the value', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'list', '--phase', 'backlog,todo', '--json'], { cwd, output });
        expect(exitCode).toBe(1);
        const combined = `${output.errors.join('\n')}\n${output.messages.join('\n')}`;
        expect(combined).toContain('Unknown task status');
        expect(combined).toContain('backlog,todo');
    });
    test('list --status active --json fails because active is not a task status', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'list', '--status', 'active', '--json'], { cwd, output });
        expect(exitCode).toBe(1);
        const combined = `${output.errors.join('\n')}\n${output.messages.join('\n')}`;
        expect(combined).toContain('Unknown task status');
        expect(combined).toContain('"active"');
    });
    test('list --status in-progress collapses the board to the wip column', async () => {
        await writeFile(
            join(cwd, 'docs/tasks/0904_wip-board.md'),
            '---\nname: "Wip board"\nstatus: wip\n---\n\n## 0904. Wip board\n',
        );
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'list', '--status', 'in-progress'], { cwd, output });
        expect(exitCode).toBe(0);
        const board = output.messages.join('');
        expect(board).toContain('WIP');
        expect(board).toContain('Wip board');
        for (const col of ['Backlog', 'Todo', 'Testing', 'Blocked', 'Done', 'Canceled']) {
            expect(board).not.toContain(col);
        }
    });
    test('list --status TODO and --phase in-progress resolve aliases', async () => {
        await writeFile(
            join(cwd, 'docs/tasks/0902_todo-alias.md'),
            '---\nname: "Todo alias"\nstatus: todo\n---\n\n## 0902. Todo alias\n',
        );
        await writeFile(
            join(cwd, 'docs/tasks/0903_wip-alias.md'),
            '---\nname: "Wip alias"\nstatus: wip\n---\n\n## 0903. Wip alias\n',
        );
        const todoOut = createCapturedOutput();
        expect(await main(['task', 'list', '--status', 'TODO', '--json'], { cwd, output: todoOut })).toBe(0);
        const todoRows = JSON.parse(lastMessage(todoOut));
        expect(todoRows.some((t: { name: string }) => t.name === 'Todo alias')).toBe(true);

        const phaseOut = createCapturedOutput();
        expect(await main(['task', 'list', '--phase', 'in-progress', '--json'], { cwd, output: phaseOut })).toBe(0);
        const wipOut = createCapturedOutput();
        expect(await main(['task', 'list', '--status', 'wip', '--json'], { cwd, output: wipOut })).toBe(0);
        expect(JSON.parse(lastMessage(phaseOut))).toEqual(JSON.parse(lastMessage(wipOut)));
        expect(JSON.parse(lastMessage(wipOut)).some((t: { name: string }) => t.name === 'Wip alias')).toBe(true);
    });
    test('list --feature filters to tasks linked to that feature', async () => {
        // Feature IDs must match ^[A-Z][1-9]*$ (DD-14): a letter + optional 1-9 digits.
        const out = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Linked to F3', '--feature', 'F3'], { cwd, output: out });
        await main(['task', 'create', '--skip-ready', 'Unlinked task'], { cwd, output: out });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'list', '--feature', 'F3', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const tasks = JSON.parse(lastMessage(output)) as Array<{ name: string }>;
        expect(tasks.some((t) => t.name === 'Linked to F3')).toBe(true);
        expect(tasks.some((t) => t.name === 'Unlinked task')).toBe(false);
    });
    test('list with a bad folder exits 1 (catch block)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'list', '--folder', join(cwd, 'totally-nonexistent-dir')], {
            cwd,
            output,
        });
        expect(exitCode).toBe(1);
        expect(output.errors.length).toBeGreaterThan(0);
    });
});
