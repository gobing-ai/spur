/**
 * Thin-wrapper integration tests for `spur task batch-create` (apps/cli/src/commands/task/batch-create.ts).
 * Behavioral tests for TaskService live in packages/app/tests/services/task-service.test.ts.
 *
 * These exercise the verb surface through the real `main()` entry point:
 * golden paths, the `--json` envelope shape, and exit codes 0/1/2 (design §10, R5).
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FINDING_CODES, TaskCandidateInvalidError, TaskService, WbsCollisionError } from '@gobing-ai/spur-app';
import { main } from '../../../src/index';
import { type CapturedOutput, createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-batch-create-task-test-${Date.now()}`);
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
    // F21 task 0787 R4/AC-R3: the create/batch-create failure surface emits ONE
    // parseable result via writeCreateJsonError — raw `--json` gets the ADR-091
    // `ok:false` payload on stdout, `--json --json-envelope` the canonical
    // apiErrorSchema envelope (CLI-local code carried in details.cliCode), and
    // non-JSON invocations keep stderr prose. candidate-invalid exits 1 and
    // carries the checker findings. (The JSON-mode duplicate-WBS push is covered
    // by the 0416 R6 test above.)
    const candidateFindings = [
        {
            layer: 'L3' as const,
            code: FINDING_CODES.L3_AC_EMPTY,
            severity: 'error' as const,
            section: 'Acceptance Criteria',
            message: 'Acceptance Criteria has no criteria.',
        },
    ];

    test('batch-create creates tasks from a valid JSON file and exits 0', async () => {
        const batchFile = join(cwd, 'batch.json');
        await Bun.write(batchFile, JSON.stringify([{ name: 'Batch task 1' }, { name: 'Batch task 2' }]));

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'batch-create', '--skip-ready', '--file', batchFile], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain('Created 2 task(s)');
    });
    test('batch-create --json returns structured output', async () => {
        const batchFile = join(cwd, 'batch-json.json');
        await Bun.write(batchFile, JSON.stringify([{ name: 'JSON batch' }]));

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'batch-create', '--skip-ready', '--file', batchFile, '--json'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.created).toBe(1);
        expect(parsed.wbs.length).toBe(1);
        expect(parsed.parentsWired).toEqual([]);
    });
    test('batch-create wires parent roster and reports parent summary', async () => {
        const parentOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'CLI parent for batch wiring'], { cwd, output: parentOut });
        const parentPath = createdPath(parentOut);
        const parentWbs = createdWbs(parentOut);
        const parentBody = await Bun.file(parentPath).text();
        await Bun.write(
            parentPath,
            parentBody
                .replace('status: backlog', 'status: todo')
                // Fill the template's existing `### Plan` section (inserting a second
                // Plan would be a duplicate-section doc, which guarded writes refuse).
                .replace('\n### Plan\n', '\n### Plan\n\nManual parent execution plan.\n'),
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
        const exitCode = await main(['task', 'batch-create', '--skip-ready', '--file', batchFile], { cwd, output });

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
        const exitCode = await main(['task', 'batch-create', '--skip-ready', '--file', batchFile], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.join('')).toContain('not valid JSON');
    });
    test('batch-create with empty array exits 1', async () => {
        const batchFile = join(cwd, 'empty-batch.json');
        await Bun.write(batchFile, '[]');

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'batch-create', '--skip-ready', '--file', batchFile], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.join('')).toContain('validation failed');
    });
    test('batch-create with missing file exits 1', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'batch-create', '--skip-ready', '--file', '/nonexistent/batch.json'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(1);
    });
    test('batch-create exits 3 with wbs-collision JSON on WbsCollisionError (0416 R1)', async () => {
        const batchFile = join(cwd, 'batch-collision.json');
        await Bun.write(batchFile, JSON.stringify([{ name: 'Colliding batch task' }]));

        const spy = spyOn(TaskService.prototype, 'batchCreate').mockImplementation(async () => {
            throw new WbsCollisionError(
                '0001',
                join(cwd, 'docs', 'tasks', '0001_existing.md'),
                join(cwd, 'docs', 'tasks', '0001_new.md'),
            );
        });
        try {
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'batch-create', '--skip-ready', '--file', batchFile, '--json'], {
                cwd,
                output,
            });
            expect(exitCode).toBe(3);
            expect(output.errors).toEqual([]);
            expect(JSON.parse(lastMessage(output))).toMatchObject({
                ok: false,
                error: {
                    code: 'wbs-collision',
                    wbs: '0001',
                },
            });
        } finally {
            spy.mockRestore();
        }
    });
    test('batch-create exits 3 and writes human-readable error on WbsCollisionError without --json (0416 R1)', async () => {
        const batchFile = join(cwd, 'batch-collision-nojson.json');
        await Bun.write(batchFile, JSON.stringify([{ name: 'Colliding batch task' }]));

        const spy = spyOn(TaskService.prototype, 'batchCreate').mockImplementation(async () => {
            throw new WbsCollisionError(
                '0003',
                join(cwd, 'docs', 'tasks', '0003_existing.md'),
                join(cwd, 'docs', 'tasks', '0003_new.md'),
            );
        });
        try {
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'batch-create', '--skip-ready', '--file', batchFile], { cwd, output });
            expect(exitCode).toBe(3);
            expect(output.errors.length).toBeGreaterThan(0);
            expect(output.errors.join('')).toContain('wbs-collision');
            expect(output.errors.join('')).toContain('0003');
        } finally {
            spy.mockRestore();
        }
    });
    test('batch-create exits 1 with candidate-invalid JSON carrying findings (F21 0787 R4)', async () => {
        const batchFile = join(cwd, 'batch-candidate-invalid.json');
        await Bun.write(batchFile, JSON.stringify([{ name: 'Bad batch item' }]));
        const spy = spyOn(TaskService.prototype, 'batchCreate').mockImplementation(async () => {
            throw new TaskCandidateInvalidError('Bad batch item', candidateFindings, 'batch item 1/1');
        });
        try {
            const output = createCapturedOutput();
            const exitCode = await main(['task', 'batch-create', '--skip-ready', '--file', batchFile, '--json'], {
                cwd,
                output,
            });
            expect(exitCode).toBe(1);
            expect(JSON.parse(lastMessage(output))).toMatchObject({
                ok: false,
                error: { code: 'candidate-invalid', findings: candidateFindings },
            });
        } finally {
            spy.mockRestore();
        }
    });
});
