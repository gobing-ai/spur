/**
 * Thin-wrapper integration tests for `spur task deps` (apps/cli/src/commands/task/deps.ts).
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
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-deps-task-test-${Date.now()}`);
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
    test('deps set replaces the dependency array and exits 0', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Deps parent'], { cwd, output: cOut });
        const parentWbs = createdWbs(cOut);
        const cOut2 = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Deps child'], { cwd, output: cOut2 });
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
        await main(['task', 'create', '--skip-ready', 'Add parent'], { cwd, output: cOut });
        const parentWbs = createdWbs(cOut);
        const cOutB = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Add child b'], { cwd, output: cOutB });
        const bWbs = createdWbs(cOutB);
        const cOutC = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Add child c'], { cwd, output: cOutC });
        const cWbs = createdWbs(cOutC);

        await main(['task', 'deps', parentWbs, 'set', bWbs], { cwd, output: createCapturedOutput() });
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'deps', parentWbs, 'add', bWbs, cWbs], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages[0] ?? '').toContain(`${bWbs}`);
        expect(output.messages[0] ?? '').toContain(`${cWbs}`);
    });
    test('deps add onto a deprecated task exits 3 and leaves the file unwritten', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Freeze parent'], { cwd, output: cOut });
        const parentWbs = createdWbs(cOut);
        const cOut2 = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Freeze child'], { cwd, output: cOut2 });
        const childWbs = createdWbs(cOut2);

        const deprecate = createCapturedOutput();
        expect(await main(['task', 'update', childWbs, 'deprecated'], { cwd, output: deprecate })).toBe(0);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'deps', parentWbs, 'add', childWbs], { cwd, output });
        expect(exitCode).toBe(3);
        expect(output.errors.some((e) => e.includes('deprecated (frozen)'))).toBe(true);
        expect(output.errors.some((e) => e.includes(`spur task update ${childWbs} todo`))).toBe(true);

        const content = await Bun.file(join(cwd, 'docs', 'tasks', `${parentWbs}_freeze-parent.md`)).text();
        expect(content).not.toContain('dependencies:');
    });
    test('deps remove drops a listed value', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Rem parent'], { cwd, output: cOut });
        const parentWbs = createdWbs(cOut);
        const cOutB = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Rem child b'], { cwd, output: cOutB });
        const bWbs = createdWbs(cOutB);
        const cOutC = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Rem child c'], { cwd, output: cOutC });
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
        await main(['task', 'create', '--skip-ready', 'Clr parent'], { cwd, output: cOut });
        const parentWbs = createdWbs(cOut);
        const cOutB = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Clr child b'], { cwd, output: cOutB });
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
        await main(['task', 'create', '--skip-ready', 'JSON parent'], { cwd, output: cOut });
        const parentWbs = createdWbs(cOut);
        const cOutB = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'JSON child b'], { cwd, output: cOutB });
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
        await main(['task', 'create', '--skip-ready', 'Bad op parent'], { cwd, output: cOut });
        const parentWbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'deps', parentWbs, 'frobnicate', '0001'], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.some((e) => e.includes('Unknown op'))).toBe(true);
    });
    test('deps clear with values exits 2 (usage)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Clr misuse'], { cwd, output: cOut });
        const parentWbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'deps', parentWbs, 'clear', '0001'], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.some((e) => e.includes('usage'))).toBe(true);
    });
    test('deps with non-existent target WBS exits 3 (not-found)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Nf parent'], { cwd, output: cOut });
        const parentWbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'deps', parentWbs, 'set', '8888'], { cwd, output });
        expect(exitCode).toBe(3);
        expect(output.errors.some((e) => e.includes('not-found'))).toBe(true);
    });
    test('deps with self-edge exits 3 (self-edge)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Self-edge'], { cwd, output: cOut });
        const parentWbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'deps', parentWbs, 'set', parentWbs], { cwd, output });
        expect(exitCode).toBe(3);
        expect(output.errors.some((e) => e.includes('self-edge'))).toBe(true);
    });
    test('deps with a direct cycle exits 3 (cycle)', async () => {
        const cOutA = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Cycle a'], { cwd, output: cOutA });
        const aWbs = createdWbs(cOutA);
        const cOutB = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Cycle b'], { cwd, output: cOutB });
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
});
