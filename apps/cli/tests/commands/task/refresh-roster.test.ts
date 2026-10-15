/**
 * Thin-wrapper integration tests for `spur task refresh-roster` (apps/cli/src/commands/task/refresh-roster.ts).
 * Behavioral tests for TaskService live in packages/app/tests/services/task-service.test.ts.
 *
 * These exercise the verb surface through the real `main()` entry point:
 * golden paths, the `--json` envelope shape, and exit codes 0/1/2 (design §10, R5).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../../src/index';
import { type CapturedOutput, createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-refresh-roster-task-test-${Date.now()}`);
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

    test('refresh-roster with no sub-tasks prints nothing-to-roster message', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Roster parent'], { cwd, output: cOut });
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
            await main(['task', 'create', '--skip-ready', 'Parent with kids'], { cwd: isoCwd, output: cOut });
            const parentWbs = createdWbs(cOut);
            // Parent needs a ## Plan section to host the roster.
            const planFile = join(isoCwd, 'plan-body.md');
            await Bun.write(planFile, 'Plan goes here.\n');
            await main(['task', 'update', parentWbs, '--section', 'Plan', '--from-file', planFile], {
                cwd: isoCwd,
                output: cOut,
            });
            // Create two children under the parent.
            await main(['task', 'create', '--skip-ready', 'Kid A', '--parent', parentWbs], {
                cwd: isoCwd,
                output: cOut,
            });
            await main(['task', 'create', '--skip-ready', 'Kid B', '--parent', parentWbs], {
                cwd: isoCwd,
                output: cOut,
            });

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
            await main(['task', 'create', '--skip-ready', 'JSON roster parent'], { cwd: isoCwd, output: cOut });
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
});
