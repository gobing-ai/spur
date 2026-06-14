/**
 * Thin-wrapper integration tests for apps/cli/src/commands/task.ts.
 * Behavioral tests for TaskService live in packages/app/tests/services/task-service.test.ts.
 *
 * These exercise the verb surface through the real `main()` entry point:
 * golden paths, the `--json` envelope shape, and exit codes 0/1/2 (design §10, R5).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { main } from '../../src/index';
import type { CommandOutput } from '../../src/output';
import { type CapturedOutput, createCapturedOutput } from '../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(import.meta.dir, '..', `.tmp-task-test-${Date.now()}`);
    await mkdir(join(cwd, 'docs', 'tasks'), { recursive: true });
});

afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
});

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

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
    test('unknown subcommand returns 1', async () => {
        const exitCode = await main(['task', 'unknown-cmd'], { cwd, output: nullOutput() });
        expect(exitCode).toBe(1);
    });

    test('noun help lists subcommands', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', '--help'], { cwd, output });
        expect(exitCode).toBe(0);
        const allOut = output.messages.join('');
        expect(allOut).toContain('create');
        expect(allOut).toContain('show');
        expect(allOut).toContain('list');
        expect(allOut).toContain('resolve');
    });

    // ── create ──
    test('create writes a task file and exits 0', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', 'Unit test task'], { cwd, output });
        expect(exitCode).toBe(0);
        const content = await Bun.file(createdPath(output)).text();
        expect(content).toContain('Unit test task');
    });

    test('create --json returns the write-result envelope', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', 'JSON task', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.ref.kind).toBe('task');
        expect(parsed.ref.id).toMatch(/^\d{4}$/);
        expect(parsed.eventName).toBe('task.created');
    });

    test('create with --feature adds feature_id', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', 'Feature task', '--feature', 'A'], { cwd, output });
        expect(exitCode).toBe(0);
        const content = await Bun.file(createdPath(output)).text();
        expect(content).toContain('feature_id: A');
    });

    test('create with --parent adds parent_wbs', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', 'Child task', '--parent', '0042'], { cwd, output });
        expect(exitCode).toBe(0);
        const content = await Bun.file(createdPath(output)).text();
        expect(content).toContain('parent_wbs: "0042"');
    });

    // ── show ──
    test('show prints task content', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Show me'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'show', wbs], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain('Show me');
    });

    test('show --json exposes frontmatter as a top-level field (R4)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Show JSON'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'show', wbs, '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.wbs).toBe(wbs);
        expect(parsed.name).toBe('Show JSON');
        expect(parsed.frontmatter.status).toBe('backlog');
    });

    test('show for non-existent WBS returns 1', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'show', '9999'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.at(-1)).toContain('not found');
    });

    // ── update ──
    test('update --section without --from-file exits 2 (usage error)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Section guard'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--section', 'Solution'], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.at(-1)).toContain('--from-file is required');
    });

    test('update with no status and no --section exits 2 (usage error)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Arg guard'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.at(-1)).toContain('required');
    });

    test('update status transition exits 0 and reports from→to', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Transition me'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'todo'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toContain('backlog → todo');
    });

    test('update --section --from-file replaces the section body', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Section target'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const bodyFile = join(cwd, 'body.md');
        await Bun.write(bodyFile, 'Replacement solution body.\n');

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--section', 'Solution', '--from-file', bodyFile], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toContain("Updated section 'Solution'");
    });

    // ── list ──
    test('list prints all tasks', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'list'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain('backlog');
    });

    test('list --status filters out non-matching tasks via --json', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'list', '--status', 'no-such-status', '--json'], { cwd, output });
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

    // ── resolve ──
    test('resolve maps a task file path to its WBS', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Resolve me'], { cwd, output: cOut });
        const taskPath = createdPath(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'resolve', taskPath], { cwd, output });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toMatch(/\d{4}/);
    });

    test('resolve --json returns structured output', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Resolve JSON'], { cwd, output: cOut });
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
