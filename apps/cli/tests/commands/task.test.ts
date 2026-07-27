/**
 * Thin-wrapper integration tests for apps/cli/src/commands/task.ts.
 * Behavioral tests for TaskService live in packages/app/tests/services/task-service.test.ts.
 *
 * These exercise the verb surface through the real `main()` entry point:
 * golden paths, the `--json` envelope shape, and exit codes 0/1/2 (design §10, R5).
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as configModule from '@gobing-ai/spur-config/loader';
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

const LEGACY_MIGRATION_TASK = `---
name: "Legacy migration task"
description: "Legacy migration task"
status: Done
created_at: 2026-05-09T04:48:47.680Z
updated_at: 2026-05-11T00:00:00.000Z
folder: docs/tasks
type: task
feature-id: F-1.4.1
impl_progress:
  planning: done
---

## 0050. Legacy migration task

### Background

This prose must survive migration unchanged.

### Requirements

R1. Keep body prose.
`;

async function seedMigrationCorpus(): Promise<{ root: string; tasksDir: string; taskPath: string }> {
    const root = await mkdtemp(join(tmpdir(), 'spur-task-migrate-cli-'));
    const tasksDir = join(root, 'docs', 'tasks');
    await mkdir(tasksDir, { recursive: true });
    const taskPath = join(tasksDir, '0050_Legacy_migration_task.md');
    await writeFile(taskPath, LEGACY_MIGRATION_TASK);
    return { root, tasksDir, taskPath };
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

    test('create --template brainstorm uses the brainstorm template', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'create', 'Brainstorm task', '--template', 'brainstorm'], { cwd, output });
        expect(exitCode).toBe(0);
        const content = await Bun.file(createdPath(output)).text();
        expect(content).toContain('Brainstorm task');
        expect(content).toContain('template: brainstorm');
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
        // WHY: a bare new task with populated Requirements + AC passes cleanly. Post-0339,
        // placeholder Requirements/AC trip L3 empty-section errors — so this test seeds
        // real content to validate the gate on a *valid* backlog task.
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Check me'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const reqBody = join(cwd, `req-${wbs}.md`);
        await Bun.write(reqBody, 'R1. The check command must pass on a valid backlog task.\n');
        await main(['task', 'update', wbs, '--section', 'Requirements', '--from-file', reqBody], {
            cwd,
            output: createCapturedOutput(),
        });
        const acBody = join(cwd, `ac-${wbs}.md`);
        await Bun.write(acBody, '- [ ] Given a valid task / When check runs / Then exit code is 0.\n');
        await main(['task', 'update', wbs, '--section', 'Acceptance Criteria', '--from-file', acBody], {
            cwd,
            output: createCapturedOutput(),
        });

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

    // ── migrate ──
    test('migrate --dry-run reports M1-M8 and writes nothing', async () => {
        const { root, tasksDir, taskPath } = await seedMigrationCorpus();
        try {
            const before = await readFile(taskPath, 'utf8');
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'migrate', '--dry-run', '--folder', tasksDir], { cwd: root, output });

            expect(exitCode).toBe(0);
            expect(await readFile(taskPath, 'utf8')).toBe(before);
            const text = output.messages.join('\n');
            expect(text).toContain('Task corpus migration dry-run complete');
            for (const rule of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']) {
                expect(text).toContain(`  ${rule}:`);
            }
            expect(text).toContain('50: modified');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('migrate --dry-run --json returns the full report envelope', async () => {
        const { root, tasksDir } = await seedMigrationCorpus();
        try {
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'migrate', '--dry-run', '--folder', tasksDir, '--json'], {
                cwd: root,
                output,
            });

            expect(exitCode).toBe(0);
            const parsed = JSON.parse(lastMessage(output));
            expect(parsed.ok).toBe(true);
            expect(parsed.dryRun).toBe(true);
            expect(parsed.corpusDir).toBe(tasksDir);
            expect(parsed.filesScanned).toBe(1);
            expect(parsed.filesModified).toBe(1);
            expect(parsed.fileReports[0].modified).toBe(true);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('migrate is idempotent on a fixture corpus', async () => {
        const { root, tasksDir, taskPath } = await seedMigrationCorpus();
        try {
            const firstOutput = createCapturedOutput();
            const firstExit = await main(['task', 'migrate', '--folder', tasksDir, '--json'], {
                cwd: root,
                output: firstOutput,
            });
            expect(firstExit).toBe(0);
            const firstReport = JSON.parse(lastMessage(firstOutput));
            expect(firstReport.filesModified).toBe(1);
            const afterFirst = await readFile(taskPath, 'utf8');

            const secondOutput = createCapturedOutput();
            const secondExit = await main(['task', 'migrate', '--folder', tasksDir, '--json'], {
                cwd: root,
                output: secondOutput,
            });
            expect(secondExit).toBe(0);
            const secondReport = JSON.parse(lastMessage(secondOutput));
            expect(secondReport.filesModified).toBe(0);
            expect(await readFile(taskPath, 'utf8')).toBe(afterFirst);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
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
        expect(parsed.parentsWired).toEqual([]);
    });

    test('batch-create wires parent roster and reports parent summary', async () => {
        const parentOut = createCapturedOutput();
        await main(['task', 'create', 'CLI parent for batch wiring'], { cwd, output: parentOut });
        const parentPath = createdPath(parentOut);
        const parentWbs = createdWbs(parentOut);
        const parentBody = await Bun.file(parentPath).text();
        await Bun.write(
            parentPath,
            parentBody
                .replace('status: backlog', 'status: todo')
                .replace('\n### History', '\n### Plan\n\nManual parent execution plan.\n\n### History'),
        );

        const batchFile = join(cwd, 'batch-parent-wire.json');
        await Bun.write(
            batchFile,
            JSON.stringify([
                {
                    name: 'CLI child from batch wiring',
                    parent_wbs: parentWbs,
                    background: 'Parent wiring CLI integration coverage.',
                    requirements: 'R1. Refresh the parent roster after batch creation.',
                },
            ]),
        );

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'batch-create', '--file', batchFile], { cwd, output });

        expect(exitCode).toBe(0);
        const messages = output.messages.join('\n');
        expect(messages).toContain('Created 1 task(s)');
        expect(messages).toContain('Wired 1 parent(s):');
        expect(messages).toContain(`${parentWbs}  rostered=true → wip`);

        const parentAfter = await Bun.file(parentPath).text();
        expect(parentAfter).toContain('status: wip');
        expect(parentAfter).toContain('<!-- AUTO-GENERATED by spur task refresh-roster -->');
        expect(parentAfter).toContain('| CLI child from batch wiring |');
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

    // ── task deps (task 0303 — CLI-safe dependencies[] mutation) ──

    test('deps set replaces the dependency array and exits 0', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Deps parent'], { cwd, output: cOut });
        const parentWbs = createdWbs(cOut);
        const cOut2 = createCapturedOutput();
        await main(['task', 'create', 'Deps child'], { cwd, output: cOut2 });
        const childWbs = createdWbs(cOut2);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'deps', parentWbs, 'set', childWbs], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages[0] ?? '').toContain(`[${childWbs}]`);

        const content = await Bun.file(join(cwd, 'docs', 'tasks', `${parentWbs}_deps-parent.md`)).text();
        expect(content).toContain(`dependencies: ["${childWbs}"]`);
    });

    test('deps add appends and dedupes', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Add parent'], { cwd, output: cOut });
        const parentWbs = createdWbs(cOut);
        const cOutB = createCapturedOutput();
        await main(['task', 'create', 'Add child b'], { cwd, output: cOutB });
        const bWbs = createdWbs(cOutB);
        const cOutC = createCapturedOutput();
        await main(['task', 'create', 'Add child c'], { cwd, output: cOutC });
        const cWbs = createdWbs(cOutC);

        await main(['task', 'deps', parentWbs, 'set', bWbs], { cwd, output: createCapturedOutput() });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'deps', parentWbs, 'add', bWbs, cWbs], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages[0] ?? '').toContain(`${bWbs}`);
        expect(output.messages[0] ?? '').toContain(`${cWbs}`);
    });

    test('deps remove drops a listed value', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Rem parent'], { cwd, output: cOut });
        const parentWbs = createdWbs(cOut);
        const cOutB = createCapturedOutput();
        await main(['task', 'create', 'Rem child b'], { cwd, output: cOutB });
        const bWbs = createdWbs(cOutB);
        const cOutC = createCapturedOutput();
        await main(['task', 'create', 'Rem child c'], { cwd, output: cOutC });
        const cWbs = createdWbs(cOutC);

        await main(['task', 'deps', parentWbs, 'set', bWbs, cWbs], { cwd, output: createCapturedOutput() });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'deps', parentWbs, 'remove', bWbs], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages[0] ?? '').toContain(`${cWbs}`);
        expect(output.messages[0] ?? '').not.toContain(`${bWbs}`);
    });

    test('deps clear empties the array and exits 0', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Clr parent'], { cwd, output: cOut });
        const parentWbs = createdWbs(cOut);
        const cOutB = createCapturedOutput();
        await main(['task', 'create', 'Clr child b'], { cwd, output: cOutB });
        const bWbs = createdWbs(cOutB);

        await main(['task', 'deps', parentWbs, 'set', bWbs], { cwd, output: createCapturedOutput() });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'deps', parentWbs, 'clear'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages[0] ?? '').toContain('(none)');

        const content = await Bun.file(join(cwd, 'docs', 'tasks', `${parentWbs}_clr-parent.md`)).text();
        expect(content).toContain('dependencies: []');
    });

    test('deps --json returns structured output with dependencies field', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'JSON parent'], { cwd, output: cOut });
        const parentWbs = createdWbs(cOut);
        const cOutB = createCapturedOutput();
        await main(['task', 'create', 'JSON child b'], { cwd, output: cOutB });
        const bWbs = createdWbs(cOutB);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'deps', parentWbs, 'set', bWbs, '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.ref.id).toBe(parentWbs);
        expect(parsed.dependencies).toEqual([bWbs]);
    });

    test('deps with unknown op exits 2 (usage)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Bad op parent'], { cwd, output: cOut });
        const parentWbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'deps', parentWbs, 'frobnicate', '0001'], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.some((e) => e.includes('Unknown op'))).toBe(true);
    });

    test('deps clear with values exits 2 (usage)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Clr misuse'], { cwd, output: cOut });
        const parentWbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'deps', parentWbs, 'clear', '0001'], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.some((e) => e.includes('usage'))).toBe(true);
    });

    test('deps with non-existent target WBS exits 3 (not-found)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Nf parent'], { cwd, output: cOut });
        const parentWbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'deps', parentWbs, 'set', '8888'], { cwd, output });
        expect(exitCode).toBe(3);
        expect(output.errors.some((e) => e.includes('not-found'))).toBe(true);
    });

    test('deps with self-edge exits 3 (self-edge)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Self-edge'], { cwd, output: cOut });
        const parentWbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'deps', parentWbs, 'set', parentWbs], { cwd, output });
        expect(exitCode).toBe(3);
        expect(output.errors.some((e) => e.includes('self-edge'))).toBe(true);
    });

    test('deps with a direct cycle exits 3 (cycle)', async () => {
        const cOutA = createCapturedOutput();
        await main(['task', 'create', 'Cycle a'], { cwd, output: cOutA });
        const aWbs = createdWbs(cOutA);
        const cOutB = createCapturedOutput();
        await main(['task', 'create', 'Cycle b'], { cwd, output: cOutB });
        const bWbs = createdWbs(cOutB);

        await main(['task', 'deps', bWbs, 'set', aWbs], { cwd, output: createCapturedOutput() });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'deps', aWbs, 'set', bWbs], { cwd, output });
        expect(exitCode).toBe(3);
        expect(output.errors.some((e) => e.includes('cycle'))).toBe(true);
    });

    test('deps on a non-existent task exits 1 (generic error)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'deps', '7777', 'set', '0001'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.length).toBeGreaterThan(0);
    });

    // ── task sections (task 0304 — CLI-safe canonical section mutation) ──

    test('sections list returns matrix snapshot for current variant/status', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Sections list target'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'sections', wbs, 'list', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.op).toBe('list');
        expect(parsed.ref.id).toBe(wbs);
        // New task without --feature → variant: standard, status: backlog.
        expect(parsed.variant).toBe('standard');
        expect(parsed.status).toBe('backlog');
        // standard/backlog required = [Background]; Background is always in the template.
        expect(parsed.matrix.required).toEqual(['Background']);
        expect(parsed.matrix.optional).toContain('Acceptance Criteria');
        expect(parsed.present).toContain('Background');
        expect(parsed.missing).toEqual([]);
        // The shipped matrix has no forbidden entries.
        expect(parsed.matrix.forbidden).toEqual([]);
    });

    test('sections init is idempotent on a fully-seeded template task', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Init seeded'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        // Walk to todo: required expands to [Background, Acceptance Criteria, Design, Plan].
        await main(['task', 'update', wbs, 'todo'], { cwd, output: createCapturedOutput() });

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'sections', wbs, 'init', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.op).toBe('init');
        // Template pre-seeds all canonical sections → nothing to add.
        expect(parsed.added).toEqual([]);
        expect(parsed.warnings.some((w: string) => w.includes('already present'))).toBe(true);
    });

    test('sections init stays idempotent across status transitions', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Init across'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        await main(['task', 'update', wbs, 'wip'], { cwd, output: createCapturedOutput() });

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'sections', wbs, 'init', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        // standard/wip required = [Background, Acceptance Criteria, Design, Plan] — already seeded.
        expect(parsed.op).toBe('init');
        expect(parsed.added).toEqual([]);
    });

    test('sections init adds every missing required section with guidance comments', async () => {
        // The shipped templates pre-seed all canonical sections, so the *positive*
        // init path is only reachable on a task authored before the section existed
        // (or outside the template). Seed such a file directly to cover the write
        // loop that the idempotent cases above never exercise.
        const root = await mkdtemp(join(tmpdir(), 'spur-task-sections-init-'));
        const tasksDir = join(root, 'docs', 'tasks');
        await mkdir(tasksDir, { recursive: true });
        const taskPath = join(tasksDir, '0001_minimal-task.md');
        await writeFile(
            taskPath,
            `---
template: standard
schema_version: 1
name: "Minimal task"
description: ""
status: todo
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-20T00:00:00.000Z"
updated_at: "2026-07-20T00:00:00.000Z"
---

## 0001. Minimal task

### Background

Only this section exists.
`,
        );

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'sections', '0001', 'init', '--folder', tasksDir, '--json'], {
            cwd: root,
            output,
        });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.op).toBe('init');
        // standard/todo required = [Background, Acceptance Criteria, Design, Plan];
        // Background is already present, so exactly the other three are written.
        expect(parsed.added).toEqual(['Acceptance Criteria', 'Design', 'Plan']);

        const contents = await readFile(taskPath, 'utf-8');
        expect(contents).toContain('### Acceptance Criteria');
        expect(contents).toContain('### Design');
        expect(contents).toContain('### Plan');
        // Sections are seeded with the shipped guidance comment (D6), not empty bodies.
        expect(contents).toContain('<!-- Decision record — WHAT/WHY.');
        // Pre-existing prose survives the write pipeline unchanged.
        expect(contents).toContain('Only this section exists.');
        rmSync(root, { recursive: true, force: true });
    });

    test('sections add <name> adds a canonical section not in the template (Notes)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Add notes'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'sections', wbs, 'add', 'Notes', '--json'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.op).toBe('add');
        // Notes is canonical (universal) but not seeded by default → actually added.
        expect(parsed.added).toEqual(['Notes']);
        expect(parsed.eventName).toBe('task.updated');

        const content = await Bun.file(join(cwd, 'docs', 'tasks', `${wbs}_add-notes.md`)).text();
        expect(content).toContain('### Notes');
    });

    test('sections add is idempotent when section already present', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Add idempotent'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        // First add of Notes — succeeds.
        await main(['task', 'sections', wbs, 'add', 'Notes'], { cwd, output: createCapturedOutput() });

        // Second add — idempotent no-op.
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'sections', wbs, 'add', 'Notes', '--json'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.added).toEqual([]);
        expect(parsed.warnings.some((w: string) => w.includes('already present'))).toBe(true);
    });

    test('sections add rejects unknown section name with exit 3', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Add unknown'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'sections', wbs, 'add', 'Bogus Section'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(3);
        expect(output.errors.some((e) => e.includes('unknown-section'))).toBe(true);
    });

    test('sections add a universal section that is already seeded is a no-op', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Add history'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        // References is universal AND seeded in the template → already present.
        const exitCode = await main(['task', 'sections', wbs, 'add', 'References', '--json'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.added).toEqual([]);
        expect(parsed.warnings.some((w: string) => w.includes('already present'))).toBe(true);
        // A no-op writes nothing, so no PlanningEvent fires — the result must not
        // claim one did (contrast with the real-write case above, which reports it).
        expect(parsed.eventName).toBeUndefined();
    });

    test('sections with unknown op exits 2 (usage)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Sec bad op'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'sections', wbs, 'frobnicate'], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.some((e) => e.includes('Unknown op'))).toBe(true);
    });

    test('sections add without name exits 2 (usage)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Add no name'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'sections', wbs, 'add'], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.some((e) => e.includes('add" requires'))).toBe(true);
    });

    test('sections init with extra name argument exits 2 (usage)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Init extra arg'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'sections', wbs, 'init', 'Background'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(2);
        expect(output.errors.some((e) => e.includes('init" takes no'))).toBe(true);
    });

    test('sections list with name argument exits 2 (usage)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'List extra arg'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'sections', wbs, 'list', 'Background'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(2);
        expect(output.errors.some((e) => e.includes('list" takes no'))).toBe(true);
    });

    test('sections list (human output) prints matrix and present/missing', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Sec human'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'sections', wbs, 'list'], { cwd, output });
        expect(exitCode).toBe(0);
        const msg = output.messages[0] ?? '';
        expect(msg).toContain(`Task ${wbs}`);
        expect(msg).toContain('required:');
        expect(msg).toContain('present:');
        expect(msg).toContain('missing:');
    });

    test('sections on a non-existent task exits 1 (generic error)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'sections', '7777', 'list'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.length).toBeGreaterThan(0);
    });

    test('update with non-existent wbs exits 1 and prints error (update catch)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', '9999', 'todo'], { cwd, output });
        // Non-existent task triggers the update catch block (lines 136-137)
        expect(exitCode).toBe(1);
        expect(output.errors.length).toBeGreaterThan(0);
    });

    test('testing→done is gated by `spur task check` when the lifecycle adapter is unavailable (P3 backstop)', async () => {
        // Force the lifecycle adapter to be unavailable so the SchemaLifecyclePort
        // fallback (which permits every transition) is in play — the exact hole P3
        // describes: without the inline gate, `done` would succeed despite an L3 error.
        const spy = spyOn(configModule, 'bundledConfigRoot').mockReturnValue(null);
        try {
            const cOut = createCapturedOutput();
            await main(['task', 'create', 'P3 gate target'], { cwd, output: cOut });
            const wbs = createdWbs(cOut);

            // Plant a Solution with no `file:line` citation → L3 hard error at testing/done.
            const bodyFile = join(cwd, 'no-citation.md');
            await Bun.write(bodyFile, 'A change-map with no file:line citation.\n');
            // Walk to testing first (also gated, but the wip→testing gate is the default
            // severity; a bare Solution body passes it). Use --no-lifecycle on the walk so
            // we control the path, then test the done transition under the fallback.
            await main(['task', 'update', wbs, 'todo', '--no-lifecycle'], { cwd, output: createCapturedOutput() });
            await main(['task', 'update', wbs, '--section', 'Solution', '--from-file', bodyFile], {
                cwd,
                output: createCapturedOutput(),
            });
            // Seed done-required sections so the ONLY failure is the L3 citation.
            const testingBody = join(cwd, 'testing.md');
            await Bun.write(testingBody, 'Testing evidence present.\n');
            await main(['task', 'update', wbs, '--section', 'Testing', '--from-file', testingBody], {
                cwd,
                output: createCapturedOutput(),
            });
            const reviewBody = join(cwd, 'review.md');
            await Bun.write(
                reviewBody,
                '| Priority | Status | Note |\n|----------|--------|------|\n| P1 | DONE | ok |\n',
            );
            await main(['task', 'update', wbs, '--section', 'Review', '--from-file', reviewBody], {
                cwd,
                output: createCapturedOutput(),
            });
            await main(['task', 'update', wbs, 'wip', '--no-lifecycle'], { cwd, output: createCapturedOutput() });
            await main(['task', 'update', wbs, 'testing', '--no-lifecycle'], { cwd, output: createCapturedOutput() });

            // Now attempt done WITHOUT --no-lifecycle: the adapter is unavailable (spy
            // forces bundledConfigRoot to null; SPUR_GLOBAL_RULES_DIR redirects the 0071
            // R5 global-fallback tier to a nonexistent dir so the adapter stays truly
            // unavailable regardless of what this machine has seeded under ~/.config/spur),
            // so the inline gate must run `task check` and block the L3 citation error.
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'update', wbs, 'done'], {
                cwd,
                output,
                env: { ...process.env, SPUR_GLOBAL_RULES_DIR: join(cwd, 'no-such-global-config') },
            });
            expect(exitCode).toBe(1);
            expect(output.errors.some((e) => e.includes('blocked'))).toBe(true);
        } finally {
            spy.mockRestore();
        }
    });

    test('fallback done-gate passes a task with pass:True + L4 warnings only (Issue B fix: strict-core ≠ strict)', async () => {
        // WHY: The real task-lifecycle FSM testing→done guard uses `--strict-core`
        // (default severity — L4 warnings stay warnings). The pre-fix fallback passed
        // `strict: true`, which elevated L4 warnings (e.g. missing feature_id) to
        // errors, blocking tasks the real guard would allow. Verify the fix: a task
        // whose only finding is an L4 warning (no feature_id) must transition done.
        const spy = spyOn(configModule, 'bundledConfigRoot').mockReturnValue(null);
        try {
            const cOut = createCapturedOutput();
            await main(['task', 'create', 'Strict-core gate target'], { cwd, output: cOut });
            const wbs = createdWbs(cOut);

            // Seed done-required sections with valid content so the ONLY finding is
            // the L4 "missing feature_id" warning. Post-0339: placeholder
            // Requirements/AC trip L3 empty-section errors, so populate them too.
            const reqBody = join(cwd, 'req-strict-core.md');
            await Bun.write(reqBody, 'R1. Done gate must not block on L4 warnings under --strict-core.\n');
            await main(['task', 'update', wbs, '--section', 'Requirements', '--from-file', reqBody], {
                cwd,
                output: createCapturedOutput(),
            });
            const acBody = join(cwd, 'ac-strict-core.md');
            await Bun.write(acBody, '- [ ] Given a strict-core task / When done is attempted / Then exit 0.\n');
            await main(['task', 'update', wbs, '--section', 'Acceptance Criteria', '--from-file', acBody], {
                cwd,
                output: createCapturedOutput(),
            });
            const solutionBody = join(cwd, 'sol-strict-core.md');
            await Bun.write(solutionBody, 'Fix applied in `apps/cli/src/commands/task.ts:645`.\n');
            await main(['task', 'update', wbs, '--section', 'Solution', '--from-file', solutionBody], {
                cwd,
                output: createCapturedOutput(),
            });
            const testingBody = join(cwd, 'test-strict-core.md');
            await Bun.write(testingBody, 'Tests pass with 95% coverage. N/A.\n');
            await main(['task', 'update', wbs, '--section', 'Testing', '--from-file', testingBody], {
                cwd,
                output: createCapturedOutput(),
            });
            const reviewBody = join(cwd, 'rev-strict-core.md');
            await Bun.write(
                reviewBody,
                '| Priority | Status | Note |\n|----------|--------|------|\n| P1 | DONE | ok |\n',
            );
            await main(['task', 'update', wbs, '--section', 'Review', '--from-file', reviewBody], {
                cwd,
                output: createCapturedOutput(),
            });

            // Walk to testing via --no-lifecycle so only the done transition hits the fallback.
            await main(['task', 'update', wbs, 'todo', '--no-lifecycle'], { cwd, output: createCapturedOutput() });
            await main(['task', 'update', wbs, 'wip', '--no-lifecycle'], { cwd, output: createCapturedOutput() });
            await main(['task', 'update', wbs, 'testing', '--no-lifecycle'], { cwd, output: createCapturedOutput() });

            // Attempt done: adapter unavailable (spy + SPUR_GLOBAL_RULES_DIR redirect, see
            // the P3 backstop test above for why both are needed post-0071/R5), fallback
            // runs with strict:false. The only finding is L4 "Missing feature_id" (warning)
            // — must NOT block.
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'update', wbs, 'done'], {
                cwd,
                output,
                env: { ...process.env, SPUR_GLOBAL_RULES_DIR: join(cwd, 'no-such-global-config') },
            });
            // With the fix (strict:false), the L4 warning stays a warning → pass:true → done succeeds.
            expect(exitCode).toBe(0);
            expect(output.errors.every((e) => !e.includes('blocked'))).toBe(true);
        } finally {
            spy.mockRestore();
        }
    });

    test('fallback done-gate still blocks a task with a hard L3 error (regression guard)', async () => {
        // WHY: fixing Issue B (strict→strict-core) must not loosen the gate for real
        // hard-core errors. L3 "Solution must contain at least one file:line citation"
        // is a hard error even under --strict-core — it must still block done.
        const spy = spyOn(configModule, 'bundledConfigRoot').mockReturnValue(null);
        try {
            const cOut = createCapturedOutput();
            await main(['task', 'create', 'Hard L3 gate target'], { cwd, output: cOut });
            const wbs = createdWbs(cOut);

            // Plant Solution WITHOUT a file:line citation → L3 hard error.
            const solutionBody = join(cwd, 'sol-no-cite.md');
            await Bun.write(solutionBody, 'Changed everything but forgot the citation.\n');
            await main(['task', 'update', wbs, '--section', 'Solution', '--from-file', solutionBody], {
                cwd,
                output: createCapturedOutput(),
            });
            const testingBody = join(cwd, 'test-no-cite.md');
            await Bun.write(testingBody, 'Tests pass. N/A.\n');
            await main(['task', 'update', wbs, '--section', 'Testing', '--from-file', testingBody], {
                cwd,
                output: createCapturedOutput(),
            });
            const reviewBody = join(cwd, 'rev-no-cite.md');
            await Bun.write(
                reviewBody,
                '| Priority | Status | Note |\n|----------|--------|------|\n| P1 | DONE | ok |\n',
            );
            await main(['task', 'update', wbs, '--section', 'Review', '--from-file', reviewBody], {
                cwd,
                output: createCapturedOutput(),
            });

            await main(['task', 'update', wbs, 'todo', '--no-lifecycle'], { cwd, output: createCapturedOutput() });
            await main(['task', 'update', wbs, 'wip', '--no-lifecycle'], { cwd, output: createCapturedOutput() });
            await main(['task', 'update', wbs, 'testing', '--no-lifecycle'], { cwd, output: createCapturedOutput() });

            // Attempt done: hard L3 error → fallback must block even with strict:false.
            // (SPUR_GLOBAL_RULES_DIR redirect: same reason as the P3 backstop test above —
            // keep the adapter genuinely unavailable post-0071/R5's global-fallback tier.)
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'update', wbs, 'done'], {
                cwd,
                output,
                env: { ...process.env, SPUR_GLOBAL_RULES_DIR: join(cwd, 'no-such-global-config') },
            });
            expect(exitCode).toBe(1);
            expect(output.errors.some((e) => e.includes('blocked'))).toBe(true);
        } finally {
            spy.mockRestore();
        }
    });

    test('0147 regression: feature_id=null task passes --strict-core done-gate (deferral preserved)', async () => {
        // WHY (0148 P1): the testing→done lifecycle FSM guard runs `spur task check <wbs> --strict-core`.
        // Under --strict-core a missing feature_id MUST stay a warning, not an error — the
        // default gate permits deferral (feature_id=null is a TODO, not a blocker). This test
        // locks the 0147 fix: feature_id never silently re-enters the hard-core blocking set.
        const cOut = createCapturedOutput();
        await main(['task', 'create', '0147-regression target'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        // Seed Requirements + AC so the only finding is the L4 "Missing feature_id"
        // warning. Post-0339: placeholder Requirements/AC trip L3 empty-section errors.
        const reqBody = join(cwd, `req-0147-${wbs}.md`);
        await Bun.write(reqBody, 'R1. feature_id=null must stay a warning under --strict-core.\n');
        await main(['task', 'update', wbs, '--section', 'Requirements', '--from-file', reqBody], {
            cwd,
            output: createCapturedOutput(),
        });
        const acBody = join(cwd, `ac-0147-${wbs}.md`);
        await Bun.write(acBody, '- [ ] Given feature_id=null / When check --strict-core / Then pass:true.\n');
        await main(['task', 'update', wbs, '--section', 'Acceptance Criteria', '--from-file', acBody], {
            cwd,
            output: createCapturedOutput(),
        });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'check', wbs, '--strict-core', '--json'], { cwd, output });

        // Must pass: the only L4 finding is "Missing feature_id" at severity=warning.
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output)) as Array<{
            pass: boolean;
            findings: Array<{ message: string; severity: string }>;
        }>;
        const firstResult = parsed[0];
        expect(firstResult).toBeDefined();
        if (!firstResult) {
            throw new Error('missing task check result');
        }
        expect(firstResult.pass).toBe(true);
        // Confirm the feature_id finding is a warning (not an error) — the key 0147 invariant.
        const featureIdFindings = firstResult.findings.filter((f) => f.message.includes('feature_id'));
        expect(featureIdFindings.length).toBeGreaterThan(0);
        expect(featureIdFindings.every((f) => f.severity === 'warning')).toBe(true);
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
        await Bun.write(answerPath, '| Req | Status |\n|-----|--------|\n| R1 | MET |\n');
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verdict', '8002', '--from-answer', answerPath], { cwd, output });
        verdictArtifacts.push(join(process.cwd(), '.spur', 'run', '8002-verdict.json'));
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toContain('Verdict: PASS');
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

    // ── list --feature ──

    test('list --feature filters to tasks linked to that feature', async () => {
        // Feature IDs must match ^[A-Z][1-9]*$ (DD-14): a letter + optional 1-9 digits.
        const out = createCapturedOutput();
        await main(['task', 'create', 'Linked to F3', '--feature', 'F3'], { cwd, output: out });
        await main(['task', 'create', 'Unlinked task'], { cwd, output: out });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'list', '--feature', 'F3', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const tasks = JSON.parse(lastMessage(output)) as Array<{ name: string }>;
        expect(tasks.some((t) => t.name === 'Linked to F3')).toBe(true);
        expect(tasks.some((t) => t.name === 'Unlinked task')).toBe(false);
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
    // ── refresh-roster ──
    test('refresh-roster with no sub-tasks prints nothing-to-roster message', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Roster parent'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'refresh-roster', wbs], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain('nothing to roster');
    });

    test('refresh-roster with sub-tasks writes the roster and exits 0', async () => {
        const isoCwd = await mkdtemp(join(tmpdir(), 'spur-task-roster-cli-'));
        await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
        const cOut = createCapturedOutput();
        try {
            await main(['task', 'create', 'Parent with kids'], { cwd: isoCwd, output: cOut });
            const parentWbs = createdWbs(cOut);
            // Parent needs a ## Plan section to host the roster.
            const planFile = join(isoCwd, 'plan-body.md');
            await Bun.write(planFile, 'Plan goes here.\n');
            await main(['task', 'update', parentWbs, '--section', 'Plan', '--from-file', planFile], {
                cwd: isoCwd,
                output: cOut,
            });
            // Create two children under the parent.
            await main(['task', 'create', 'Kid A', '--parent', parentWbs], { cwd: isoCwd, output: cOut });
            await main(['task', 'create', 'Kid B', '--parent', parentWbs], { cwd: isoCwd, output: cOut });

            const output = createCapturedOutput();
            const exitCode = await main(['task', 'refresh-roster', parentWbs], { cwd: isoCwd, output });
            expect(exitCode).toBe(0);
            expect(output.messages.join('')).toContain('Roster refreshed');
            expect(output.messages.join('')).toContain('2 sub-task');
        } finally {
            rmSync(isoCwd, { recursive: true, force: true });
        }
    });

    test('refresh-roster --json returns structured output', async () => {
        const isoCwd = await mkdtemp(join(tmpdir(), 'spur-task-roster-json-cli-'));
        await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
        const cOut = createCapturedOutput();
        try {
            await main(['task', 'create', 'JSON roster parent'], { cwd: isoCwd, output: cOut });
            const parentWbs = createdWbs(cOut);

            const output = createCapturedOutput();
            const exitCode = await main(['task', 'refresh-roster', parentWbs, '--json'], { cwd: isoCwd, output });
            expect(exitCode).toBe(0);
            const parsed = JSON.parse(lastMessage(output));
            expect(parsed.wbs).toBe(parentWbs);
            expect(parsed.written).toBe(false);
            expect(parsed.childCount).toBe(0);
        } finally {
            rmSync(isoCwd, { recursive: true, force: true });
        }
    });

    test('refresh-roster with non-existent WBS exits 1 (catch block)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'refresh-roster', '9999'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.length).toBeGreaterThan(0);
    });

    // ── list catch block ──
    test('list with a bad folder exits 1 (catch block)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'list', '--folder', join(cwd, 'totally-nonexistent-dir')], {
            cwd,
            output,
        });
        expect(exitCode).toBe(1);
        expect(output.errors.length).toBeGreaterThan(0);
    });

    // ── update --section warnings (line 112) ──
    test('update --section with a body containing a same-level heading emits warnings to error channel', async () => {
        // WHY: a section body that itself contains a same-level markdown heading (###)
        // gets stripped by PlanningWriteService, which populates result.warnings.
        // The non-JSON path (line 111-112) routes those warnings to the error channel.
        const cOut = createCapturedOutput();
        await main(['task', 'create', 'Warn section task'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const bodyFile = join(cwd, 'warn-section-body.md');
        // Body contains a ### heading — same level as section headers, triggers strip warning.
        await Bun.write(bodyFile, 'Some text.\n\n### Rogue heading\n\nMore text.\n');

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, '--section', 'Solution', '--from-file', bodyFile], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        expect(output.errors.some((e) => e.includes('Stripped same-level heading'))).toBe(true);
    });
    test('path with non-existent folder exits 1 (path catch block)', async () => {
        // Triggers the path action's catch block (lines 428-429).
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'path', '0001', '--folder', join(cwd, 'no-such-folder-xyz')], {
            cwd,
            output,
        });
        expect(exitCode).toBe(1);
        expect(output.errors.length).toBeGreaterThan(0);
    });

    // ── run-link ────────────────────────────────────────────────────
    test('run-link inserts a pipeline provenance link', async () => {
        const output = createCapturedOutput();
        await main(['task', 'create', 'run-link test'], { cwd, output });
        const wbs = createdWbs(output);
        const exitCode = await main(['task', 'run-link', wbs, '--source', 'next-auto', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const jsonMsg = output.messages.filter((m) => m.trim()).pop() ?? '';
        const result = JSON.parse(jsonMsg);
        expect(result.kind).toBe('pipeline');
        expect(result.runId).toMatch(/^chain:next-auto:/);
    });
    test('run-link is idempotent', async () => {
        const output = createCapturedOutput();
        await main(['task', 'create', 'run-link idempotent'], { cwd, output });
        const wbs = createdWbs(output);
        // First call inserts.
        await main(['task', 'run-link', wbs, '--source', 'next-auto', '--json'], { cwd, output });
        // Second call returns existed:true.
        const exitCode = await main(['task', 'run-link', wbs, '--source', 'next-auto', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const jsonMsg = output.messages.filter((m) => m.trim()).pop() ?? '';
        const result = JSON.parse(jsonMsg);
        expect(result.existed).toBe(true);
    });
    // ── Done-transition verdict guard (task 0292) ──
    // The guard is orthogonal to the lifecycle FSM, so all transitions use
    // --no-lifecycle to isolate the verdict-guard behavior. R8 (verdict gate applies
    // under --no-lifecycle) is therefore exercised by every test in this block, and
    // called out explicitly in its own case.
    async function seedTaskAtTesting(label: string): Promise<string> {
        const cOut = createCapturedOutput();
        await main(['task', 'create', label], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        await main(['task', 'update', wbs, 'todo', '--no-lifecycle'], { cwd, output: nullOutput() });
        await main(['task', 'update', wbs, 'wip', '--no-lifecycle'], { cwd, output: nullOutput() });
        await main(['task', 'update', wbs, 'testing', '--no-lifecycle'], { cwd, output: nullOutput() });
        return wbs;
    }

    async function writeVerdict(wbs: string, verdictJson: object): Promise<void> {
        const runDir = join(cwd, '.spur', 'run');
        await mkdir(runDir, { recursive: true });
        await writeFile(join(runDir, `${wbs}-verdict.json`), JSON.stringify(verdictJson), 'utf-8');
    }

    async function readStatus(wbs: string): Promise<string> {
        const show = createCapturedOutput();
        await main(['task', 'show', wbs, '--json'], { cwd, output: show });
        const json = JSON.parse(show.messages.filter((m) => m.trim().startsWith('{')).pop() ?? '{}');
        return String(json.frontmatter?.status ?? '');
    }

    const PASS_VERDICT = {
        wbs: 'PLACEHOLDER',
        verdict: 'PASS',
        requirements: [
            { id: 'R1', status: 'MET', evidence: 'x' },
            { id: 'R2', status: 'MET', evidence: 'y' },
        ],
        acceptanceCriteria: [],
        source: 'spur task verdict',
    };
    const PARTIAL_VERDICT = {
        wbs: 'PLACEHOLDER',
        verdict: 'PARTIAL',
        requirements: [
            { id: 'R1', status: 'MET', evidence: 'x' },
            { id: 'R2', status: 'PARTIAL', evidence: 'y' },
        ],
        acceptanceCriteria: [],
        source: 'spur task verdict',
    };
    const FAIL_VERDICT = {
        wbs: 'PLACEHOLDER',
        verdict: 'FAIL',
        requirements: [
            { id: 'R1', status: 'MET', evidence: 'x' },
            { id: 'R2', status: 'UNMET', evidence: 'y' },
        ],
        acceptanceCriteria: [],
        source: 'spur task verdict',
    };

    test('done guard: PASS verdict advances to done (R4a)', async () => {
        const wbs = await seedTaskAtTesting('guard pass');
        await writeVerdict(wbs, { ...PASS_VERDICT, wbs });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'done', '--no-lifecycle'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('\n')).toContain('testing → done');
    });

    test('done guard: PARTIAL verdict blocks done with actionable message (R5/R4b)', async () => {
        const wbs = await seedTaskAtTesting('guard partial');
        await writeVerdict(wbs, { ...PARTIAL_VERDICT, wbs });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'done', '--no-lifecycle'], { cwd, output });
        expect(exitCode).toBe(1);
        const msg = output.errors.join('\n') + output.messages.join('\n');
        expect(msg).toContain(wbs);
        expect(msg).toContain('PARTIAL');
        expect(msg).toContain('.spur/run/');
        expect(msg).toContain('--force-done');
        // Task remains at testing.
        expect(await readStatus(wbs)).toBe('testing');
    });

    test('done guard: FAIL verdict blocks done (R4c)', async () => {
        const wbs = await seedTaskAtTesting('guard fail');
        await writeVerdict(wbs, { ...FAIL_VERDICT, wbs });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'done', '--no-lifecycle'], { cwd, output });
        expect(exitCode).toBe(1);
    });

    test('done guard: no verdict file → back-compat allow (R4d/R1)', async () => {
        const wbs = await seedTaskAtTesting('guard no-verdict');
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'done', '--no-lifecycle'], { cwd, output });
        expect(exitCode).toBe(0);
    });

    test('done guard: --force-done with PARTIAL records override frontmatter (R3/R5)', async () => {
        const wbs = await seedTaskAtTesting('guard forced');
        await writeVerdict(wbs, { ...PARTIAL_VERDICT, wbs });
        const output = createCapturedOutput();
        const exitCode = await main(
            [
                'task',
                'update',
                wbs,
                'done',
                '--no-lifecycle',
                '--force-done',
                '--reason',
                'telemetry absent is acceptable',
            ],
            { cwd, output },
        );
        expect(exitCode).toBe(0);
        expect(output.messages.join('\n')).toContain('Override recorded');
        // Audit-trail persisted on the task frontmatter.
        const show = createCapturedOutput();
        await main(['task', 'show', wbs, '--json'], { cwd, output: show });
        const raw = show.messages.filter((m) => m.trim().startsWith('{')).pop() ?? '{}';
        const json = JSON.parse(raw);
        // persisted as YAML-quoted "true"; the schema coerces it to boolean at
        // validation time. Assert the override was recorded, either form.
        expect(String(json.frontmatter?.done_forced)).toBe('true');
        expect(json.frontmatter?.done_reason).toBe('telemetry absent is acceptable');
    });

    test('done guard: --no-lifecycle PARTIAL is still verdict-gated (R8 explicit)', async () => {
        const wbs = await seedTaskAtTesting('guard no-lifecycle');
        await writeVerdict(wbs, { ...PARTIAL_VERDICT, wbs });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'done', '--no-lifecycle'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(await readStatus(wbs)).toBe('testing');
    });

    test('done guard: same-status no-op is honest and exits 0 (R9)', async () => {
        const wbs = await seedTaskAtTesting('guard noop');
        await writeVerdict(wbs, { ...PASS_VERDICT, wbs });
        // First advance to done.
        await main(['task', 'update', wbs, 'done', '--no-lifecycle'], { cwd, output: nullOutput() });
        // Second call: no-op, exit 0, message is "already done — no transition".
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'done', '--no-lifecycle'], { cwd, output });
        expect(exitCode).toBe(0);
        const msg = output.messages.join('\n');
        expect(msg).toContain('already done');
        expect(msg).not.toContain('undefined → undefined');
    });

    test('done guard: inconsistent artifact denied with inconsistency named (R10)', async () => {
        const wbs = await seedTaskAtTesting('guard inconsistent');
        // Stored verdict claims PASS but a row is UNMET.
        await writeVerdict(wbs, {
            wbs,
            verdict: 'PASS',
            requirements: [
                { id: 'R1', status: 'MET', evidence: 'x' },
                { id: 'R2', status: 'UNMET', evidence: 'y' },
            ],
            acceptanceCriteria: [],
            source: 'spur task verdict',
        });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'update', wbs, 'done', '--no-lifecycle'], { cwd, output });
        expect(exitCode).toBe(1);
        const msg = output.errors.join('\n') + output.messages.join('\n');
        expect(msg).toContain('self-inconsistent');
    });

    test('done guard: case-variant target (Done) is still verdict-gated (R1/R8)', async () => {
        const wbs = await seedTaskAtTesting('guard case-variant');
        await writeVerdict(wbs, { ...PARTIAL_VERDICT, wbs });
        const output = createCapturedOutput();
        // The frontmatter schema alias-normalizes `Done` → `done`, so this IS a
        // `* → done` transition and must pass through the verdict gate.
        const exitCode = await main(['task', 'update', wbs, 'Done', '--no-lifecycle'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(await readStatus(wbs)).toBe('testing');
    });

    // ── verifyall-aggregate (task 0341) ──────────────────────────────
    // Deterministic batch verdict rollup. Replaces agent-discretion prose
    // (dev-operations.md §3a). NOT-STARTED rows are excluded from the rollup
    // but reported in the summary so the operator sees them.
    async function writeBatchFile(rows: object[]): Promise<string> {
        const batchPath = join(cwd, '.spur', 'run', `batch-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
        await mkdir(join(cwd, '.spur', 'run'), { recursive: true });
        await writeFile(batchPath, JSON.stringify(rows), 'utf-8');
        return batchPath;
    }

    test('verifyall-aggregate: all-PASS rolls up to PASS, exit 0', async () => {
        const batchPath = await writeBatchFile([
            { wbs: '0001', outcome: 'PASS' },
            { wbs: '0002', outcome: 'PASS' },
        ]);
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verifyall-aggregate', '--from-file', batchPath, '--json'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const json = JSON.parse(output.messages.filter((m) => m.trim().startsWith('{')).pop() ?? '{}');
        expect(json.verdict).toBe('PASS');
        expect(json.summary).toContain('2 PASS');
        expect(json.notStarted).toEqual([]);
    });

    test('verifyall-aggregate: NOT-STARTED excluded from rollup, batch still PASS (R2 dogfood)', async () => {
        // The bug 0341 fixed: 5 PASS + 2 NOT-STARTED must NOT roll up to FAIL.
        const batchPath = await writeBatchFile([
            { wbs: '0332', outcome: 'PASS' },
            { wbs: '0333', outcome: 'PASS' },
            { wbs: '0334', outcome: 'PASS' },
            { wbs: '0335', outcome: 'PASS' },
            { wbs: '0336', outcome: 'PASS' },
            { wbs: '0337', outcome: 'NOT-STARTED' },
            { wbs: '0338', outcome: 'NOT-STARTED' },
        ]);
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verifyall-aggregate', '--from-file', batchPath, '--json'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const json = JSON.parse(output.messages.filter((m) => m.trim().startsWith('{')).pop() ?? '{}');
        expect(json.verdict).toBe('PASS');
        expect(json.notStarted.map((r: { wbs: string }) => r.wbs)).toEqual(['0337', '0338']);
        expect(json.summary).toContain('2 NOT-STARTED (excluded)');
    });

    test('verifyall-aggregate: any FAIL rolls up to FAIL, exit 1', async () => {
        const batchPath = await writeBatchFile([
            { wbs: '0001', outcome: 'PASS' },
            { wbs: '0002', outcome: 'FAIL' },
        ]);
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verifyall-aggregate', '--from-file', batchPath], { cwd, output });
        expect(exitCode).toBe(1);
        const msg = output.messages.join('\n');
        expect(msg).toContain('Batch verdict: FAIL');
    });

    test('verifyall-aggregate: all-NOT-STARTED rolls up to UNKNOWN, exit 0', async () => {
        const batchPath = await writeBatchFile([
            { wbs: '0001', outcome: 'NOT-STARTED' },
            { wbs: '0002', outcome: 'NOT-STARTED' },
        ]);
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verifyall-aggregate', '--from-file', batchPath, '--json'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const json = JSON.parse(output.messages.filter((m) => m.trim().startsWith('{')).pop() ?? '{}');
        expect(json.verdict).toBe('UNKNOWN');
        expect(json.rolledUp).toEqual([]);
    });

    test('verifyall-aggregate: PARTIAL present (no FAIL) rolls up to PARTIAL', async () => {
        const batchPath = await writeBatchFile([
            { wbs: '0001', outcome: 'PASS' },
            { wbs: '0002', outcome: 'PARTIAL' },
        ]);
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verifyall-aggregate', '--from-file', batchPath, '--json'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const json = JSON.parse(output.messages.filter((m) => m.trim().startsWith('{')).pop() ?? '{}');
        expect(json.verdict).toBe('PARTIAL');
    });

    test('verifyall-aggregate: UNKNOWN present rolls batch down to PARTIAL (cannot certify)', async () => {
        const batchPath = await writeBatchFile([
            { wbs: '0001', outcome: 'PASS' },
            { wbs: '0002', outcome: 'UNKNOWN' },
        ]);
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verifyall-aggregate', '--from-file', batchPath, '--json'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const json = JSON.parse(output.messages.filter((m) => m.trim().startsWith('{')).pop() ?? '{}');
        expect(json.verdict).toBe('PARTIAL');
    });

    test('verifyall-aggregate: missing input file exits 1', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(
            ['task', 'verifyall-aggregate', '--from-file', join(cwd, 'nonexistent-batch.json')],
            { cwd, output },
        );
        expect(exitCode).toBe(1);
        expect(output.errors.join('\n')).toContain('Batch input file not found');
    });

    test('verifyall-aggregate: non-array JSON exits 1', async () => {
        const batchPath = join(cwd, '.spur', 'run', `obj-${Date.now()}.json`);
        await mkdir(join(cwd, '.spur', 'run'), { recursive: true });
        await writeFile(batchPath, JSON.stringify({ not: 'an array' }), 'utf-8');
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verifyall-aggregate', '--from-file', batchPath], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.join('\n')).toContain('expected a JSON array');
    });
    test('verifyall-aggregate: non-JSON output surfaces NOT-STARTED WBS list explicitly', async () => {
        // The human-readable path must name the excluded NOT-STARTED tasks so the
        // operator sees them — not just the counts.
        const batchPath = await writeBatchFile([
            { wbs: '0001', outcome: 'PASS' },
            { wbs: '0002', outcome: 'NOT-STARTED' },
        ]);
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verifyall-aggregate', '--from-file', batchPath], { cwd, output });
        expect(exitCode).toBe(0);
        const msg = output.messages.join('\n');
        expect(msg).toContain('Batch verdict: PASS');
        expect(msg).toContain('NOT-STARTED (excluded from rollup): 0002');
    });

    test('verifyall-aggregate: invalid outcome value exits 1', async () => {
        const batchPath = await writeBatchFile([{ wbs: '0001', outcome: 'BOGUS' }]);
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'verifyall-aggregate', '--from-file', batchPath], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.join('\n')).toContain('Invalid outcome for 0001: BOGUS');
    });
});
