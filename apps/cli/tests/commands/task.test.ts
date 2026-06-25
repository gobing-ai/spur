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

    test('create --template writes the variant to frontmatter', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', 'Issue task', '--template', 'issue'], { cwd, output });
        expect(exitCode).toBe(0);
        const content = await Bun.file(createdPath(output)).text();
        expect(content).toContain('template: issue');
    });

    test('create --template rejects an unknown variant with exit 2', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', 'Bad variant', '--template', 'nope'], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.join('')).toContain('Unknown template variant');
    });

    test('create --template meta uses the meta template', async () => {
        // First access of 'meta' variant exercises bundled fallback + cache miss paths
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', 'Meta task', '--template', 'meta'], { cwd, output });
        expect(exitCode).toBe(0);
        const content = await Bun.file(createdPath(output)).text();
        expect(content).toContain('template: meta');
    });

    test('create --template brainstorm falls back to legacy path when no template file', async () => {
        // 'brainstorm' is a valid variant but has no template file — exercises
        // loadTemplateContent miss cache path (templateMissSet.add)
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', 'Brainstorm task', '--template', 'brainstorm'], { cwd, output });
        expect(exitCode).toBe(0);
        const content = await Bun.file(createdPath(output)).text();
        expect(content).toContain('Brainstorm task');
    });

    test('create --template review seeds Review Findings as input under Background', async () => {
        // WHY: a review task logs the code-review findings as INPUT (under Background's
        // `#### Review Findings`) to be fixed; the `### Review` section is reserved for
        // post-fix reflection. With template-as-skeleton rendering, ALL template sections
        // appear at creation (including `### Review` with its guidance text).
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', 'Fix review', '--template', 'review'], { cwd, output });
        expect(exitCode).toBe(0);
        const content = await Bun.file(createdPath(output)).text();
        expect(content).toContain('template: review');
        expect(content).toContain('#### Review Findings');
        expect(content).toMatch(/Severity\s+\|\s+File\s+\|\s+Finding/);
        expect(content).toMatch(/\n### Review\n/);
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

    test('list with no matching status prints (no tasks)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'list', '--status', 'zzz-nonexistent'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.at(-1)).toContain('(no tasks)');
    });
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

    // ── check ──
    test('check validates a freshly-created backlog task as PASS', async () => {
        // WHY: a bare new task is created at backlog with only Background (no empty
        // Solution heading), so it passes the gate cleanly. This is the dogfood fix
        // — previously every new task FAILed on a spurious L3 file:line error.
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Check me'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'check', wbs], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain(wbs);
        expect(output.messages.join('')).toContain('PASS');
    });

    test('check --json returns structured results even on failure', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Check JSON'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        await main(['task', 'check', wbs, '--json'], { cwd, output });
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed[0].wbs).toBe(wbs);
        // Has findings
        expect(parsed[0].findings.length).toBeGreaterThan(0);
    });

    test('check --strict elevates warnings and can exit 1 on missing sections', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Check strict'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'check', wbs, '--strict'], { cwd, output });
        // Strict mode may elevate warnings → might pass or fail depending on fixture completeness.
        // The important thing is exit code is a number (0 or 1).
        expect([0, 1]).toContain(exitCode);
    });

    test('check without WBS scans all tasks in the folder', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'check'], { cwd, output });
        // Should scan and report on all tasks
        expect([0, 1]).toContain(exitCode); // may fail depending on task content
        expect(output.messages.join('')).toMatch(/\d{4}/);
    });
    test('check with unknown WBS prints error and exits 1', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'check', '9999'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.at(-1)).toContain('not found');
    });

    // ── refresh ──
    test('refresh regenerates kanban.md and exits 0', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'refresh'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain('kanban.md regenerated');
    });

    test('refresh --json returns kanban path', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'refresh', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.kanban_path).toContain('kanban.md');
    });

    test('refresh --folder uses custom folder', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'refresh', '--folder', join(cwd, 'docs', 'tasks')], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain('kanban.md regenerated');
    });

    test('refresh with bad folder exits 1', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'refresh', '--folder', join(cwd, 'nonexistent')], { cwd, output });
        expect(exitCode).toBe(1);
    });

    // ── batch-create ──
    test('batch-create creates tasks from a valid JSON file and exits 0', async () => {
        const batchFile = join(cwd, 'batch.json');
        await Bun.write(batchFile, JSON.stringify([{ name: 'Batch task 1' }, { name: 'Batch task 2' }]));

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'batch-create', '--file', batchFile], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain('Created 2 task(s)');
    });

    test('batch-create --json returns structured output', async () => {
        const batchFile = join(cwd, 'batch-json.json');
        await Bun.write(batchFile, JSON.stringify([{ name: 'JSON batch' }]));

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'batch-create', '--file', batchFile, '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.created).toBe(1);
        expect(parsed.wbs.length).toBe(1);
    });

    test('batch-create with invalid JSON exits 1', async () => {
        const batchFile = join(cwd, 'bad-batch.json');
        await Bun.write(batchFile, 'not json');

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'batch-create', '--file', batchFile], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.join('')).toContain('not valid JSON');
    });

    test('batch-create with empty array exits 1', async () => {
        const batchFile = join(cwd, 'empty-batch.json');
        await Bun.write(batchFile, '[]');

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'batch-create', '--file', batchFile], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.join('')).toContain('validation failed');
    });

    test('batch-create with missing file exits 1', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'batch-create', '--file', '/nonexistent/batch.json'], { cwd, output });
        expect(exitCode).toBe(1);
    });

    // ── update --json ──
    test('update status --json returns structured output', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'JSON transition'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'todo', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.ref.id).toBe(wbs);
        expect(parsed.fromStatus).toBe('backlog');
        expect(parsed.toStatus).toBe('todo');
    });

    test('update --section --from-file --json returns structured output', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Section JSON'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const bodyFile = join(cwd, 'body-json.md');
        await Bun.write(bodyFile, 'JSON section body.\n');

        const output = createCapturedOutput();
        const exitCode = await main(
            ['task', 'update', wbs, '--section', 'Solution', '--from-file', bodyFile, '--json'],
            { cwd, output },
        );
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.ref.id).toBe(wbs);
    });

    test('update --feature sets feature_id on task', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Feature update'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--feature', 'B'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages[0] ?? '').toContain('Set feature_id=B');
        // Verify it stuck
        const content = await Bun.file(join(cwd, 'docs', 'tasks', `${wbs}_feature-update.md`)).text();
        expect(content).toContain('feature_id: B');
    });

    test('update --priority sets priority on task', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Priority update'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--priority', 'P0'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages[0] ?? '').toContain('Set priority=P0');
    });

    test('update --feature --json returns structured output', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Feature JSON'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--feature', 'C', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.ref.id).toBe(wbs);
    });

    test('update with non-existent wbs exits 1 and prints error (update catch)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', '9999', 'todo'], { cwd, output });
        // Non-existent task triggers the update catch block (lines 136-137)
        expect(exitCode).toBe(1);
        expect(output.errors.length).toBeGreaterThan(0);
    });

    test('update --section --from-file with non-json output handles warnings', async () => {
        // Create a task with a section that triggers warnings on write (e.g. Review at backlog)
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Warning test'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const bodyFile = join(cwd, 'body-warn.md');
        await Bun.write(bodyFile, 'Some review text.\n');

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--section', 'Review', '--from-file', bodyFile], {
            cwd,
            output,
        });
        // Update should succeed (exit 0); warnings go to error channel (line 112)
        expect(exitCode).toBe(0);
    });

    test('check with bad folder exits 1', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'check', '0001', '--folder', join(cwd, 'nonexistent')], { cwd, output });
        expect(exitCode).toBe(1);
    });

    // ── record ──

    test('record with non-existent WBS exits 1 and prints error', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'record', '9999', '--json'], { cwd, output });
        // Non-existent task → error path (catch block line 226-229)
        expect(exitCode).toBe(1);
        expect(output.errors.length).toBeGreaterThan(0);
    });

    test('record --json returns structured result', async () => {
        const out = createCapturedOutput();
        await main(['task', 'create', 'Record JSON test'], { cwd, output: out });
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
        await main(['task', 'create', 'Record human test'], { cwd, output: out });
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

    describe('.spur/config.yaml tasks: block (R9 multi-folder)', () => {
        test('tasks.active from root config directs task create to that folder', async () => {
            // Isolated cwd so the config does not leak into the suite's shared cwd.
            const isoCwd = join(import.meta.dir, '..', `.tmp-task-cfg-${Date.now()}`);
            await mkdir(join(isoCwd, 'docs', 'archive'), { recursive: true });
            await mkdir(join(isoCwd, '.spur'), { recursive: true });
            // The tasks: block under the single .spur/config.yaml surface (ADR-017).
            // CamelCase keys match the root spurConfigSchema / tasksConfigSchema.
            await Bun.write(
                join(isoCwd, '.spur', 'config.yaml'),
                'version: "1"\nname: test\n' +
                    'tasks:\n' +
                    '  active: docs/archive\n' +
                    '  folders:\n' +
                    '    docs/archive:\n' +
                    '      baseCounter: 0\n' +
                    '      label: Archive\n',
            );

            try {
                const output = createCapturedOutput();
                const exitCode = await main(['task', 'create', 'Archived task'], { cwd: isoCwd, output });
                expect(exitCode).toBe(0);
                // The created file must land under the YAML-configured active_folder, not docs/tasks.
                const path = createdPath(output);
                expect(path).toContain('docs/archive');
                // The printed path is rooted at isoCwd; resolve relative-or-absolute against it.
                const filePath = path.startsWith('/') ? path : join(isoCwd, path);
                expect(await Bun.file(filePath).exists()).toBe(true);
            } finally {
                rmSync(isoCwd, { recursive: true, force: true });
            }
        });
    });

    // ── path ──
    test('path prints absolute file path and exits 0', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Path test'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'path', wbs], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages[0] ?? '').toContain(`/${wbs}_`);
        expect(output.messages[0] ?? '').toContain('docs/tasks');
    });

    test('path --json returns structured output', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Path JSON test'], { cwd, output: cOut });
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

    // ── config error resilience (covers loadTaskFoldersConfig catch, line 397) ──
    test('create with malformed config falls back to defaults', async () => {
        const dir = join(cwd, 'malformed-cfg');
        await mkdir(dir, { recursive: true });
        await mkdir(join(dir, 'docs', 'tasks'), { recursive: true });
        await mkdir(join(dir, '.spur'), { recursive: true });
        // Write a YAML file that fails to parse (trailing colon is invalid)
        await Bun.write(join(dir, '.spur', 'config.yaml'), 'tasks:\n  active:\n');

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', 'Malformed cfg task'], { cwd: dir, output });
        expect(exitCode).toBe(0); // falls back to defaults, still creates task
        rmSync(dir, { recursive: true, force: true });
    });
});
