/**
 * Noun-level integration tests for `spur task` (apps/cli/src/commands/task/index.ts); per-verb tests live beside this file.
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
import type { CommandOutput } from '../../../src/output';
import { type CapturedOutput, createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-index-task-test-${Date.now()}`);
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

    // ── show alias (0534 R1) ──

    test('near-miss suggester still fires on a typo (0534 AC2 non-regression)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Suggester'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'shwo', wbs], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.join('')).toContain('Did you mean show?');
    });

    // ── list --feature ──

    describe('.spur/config.yaml tasks: block (R9 multi-folder)', () => {
        test('tasks.active from root config directs task create to that folder', async () => {
            // Isolated cwd so the config does not leak into the suite's shared cwd.
            const isoCwd = join(join(import.meta.dir, '..'), '..', `.tmp-index-task-cfg-${Date.now()}`);
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
                const exitCode = await main(['task', 'create', '--skip-ready', 'Archived task'], {
                    cwd: isoCwd,
                    output,
                });
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
});

describe('spur task CLI — parent-feature-status JSON error (1132)', () => {
    test('create and update --feature on a done parent emit the same ok:false payload on stdout', async () => {
        const isoCwd = join(join(import.meta.dir, '..'), '..', `.tmp-index-task-parent-${Date.now()}`);
        await mkdir(join(isoCwd, 'docs', 'tasks'), { recursive: true });
        await mkdir(join(isoCwd, 'docs', 'features'), { recursive: true });
        await writeFile(
            join(isoCwd, 'docs', 'features', 'P7_closed.md'),
            [
                '---',
                'schema_version: 1',
                'id: "P7"',
                'name: "Closed"',
                'status: done',
                'created_at: 2026-10-01T00:00:00.000Z',
                'updated_at: 2026-10-01T00:00:00.000Z',
                '---',
                '',
                '# P7: Closed',
                '',
                '## Goal',
                '',
                'g',
                '',
            ].join('\n'),
        );
        try {
            const seed = createCapturedOutput();
            expect(
                await main(['task', 'create', '--skip-ready', 'Unlinked', '--json'], { cwd: isoCwd, output: seed }),
            ).toBe(0);
            const wbs = JSON.parse(lastMessage(seed)).ref.id;

            const expected = { ok: false, error: { code: 'parent-feature-status', featureId: 'P7', status: 'done' } };
            const create = createCapturedOutput();
            const createArgs = ['task', 'create', '--skip-ready', 'Linked', '--feature', 'P7', '--json'];
            expect(await main(createArgs, { cwd: isoCwd, output: create })).toBe(1);
            expect(JSON.parse(lastMessage(create))).toMatchObject(expected);

            const update = createCapturedOutput();
            expect(
                await main(['task', 'update', wbs, '--feature', 'P7', '--json'], { cwd: isoCwd, output: update }),
            ).toBe(1);
            expect(update.errors).toEqual([]);
            expect(JSON.parse(lastMessage(update))).toMatchObject(expected);
        } finally {
            rmSync(isoCwd, { recursive: true, force: true });
        }
    });
});
