/**
 * Thin-wrapper integration tests for `spur task sections` (apps/cli/src/commands/task/sections.ts).
 * Behavioral tests for TaskService live in packages/app/tests/services/task-service.test.ts.
 *
 * These exercise the verb surface through the real `main()` entry point:
 * golden paths, the `--json` envelope shape, and exit codes 0/1/2 (design §10, R5).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../../src/index';
import { type CapturedOutput, createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-sections-task-test-${Date.now()}`);
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

    test('sections list returns matrix snapshot for current variant/status', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Sections list target'], { cwd, output: cOut });
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
        await main(['task', 'create', '--skip-ready', 'Init seeded'], { cwd, output: cOut });
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
        await main(['task', 'create', '--skip-ready', 'Init across'], { cwd, output: cOut });
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
        await main(['task', 'create', '--skip-ready', 'Add notes'], { cwd, output: cOut });
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
        await main(['task', 'create', '--skip-ready', 'Add idempotent'], { cwd, output: cOut });
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
        await main(['task', 'create', '--skip-ready', 'Add unknown'], { cwd, output: cOut });
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
        await main(['task', 'create', '--skip-ready', 'Add history'], { cwd, output: cOut });
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
        await main(['task', 'create', '--skip-ready', 'Sec bad op'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'sections', wbs, 'frobnicate'], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.some((e) => e.includes('Unknown op'))).toBe(true);
    });
    test('sections add without name exits 2 (usage)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Add no name'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'sections', wbs, 'add'], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.some((e) => e.includes('add" requires'))).toBe(true);
    });
    test('sections init with extra name argument exits 2 (usage)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Init extra arg'], { cwd, output: cOut });
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
        await main(['task', 'create', '--skip-ready', 'List extra arg'], { cwd, output: cOut });
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
        await main(['task', 'create', '--skip-ready', 'Sec human'], { cwd, output: cOut });
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
});
