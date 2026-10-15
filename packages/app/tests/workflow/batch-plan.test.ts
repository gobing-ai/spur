/**
 * `spur task batch-plan` request contract (script-absorption PR-5; task 1104). The projections
 * themselves are pinned by plan-projection tests — these pin the input validation and the
 * exit/stdout/stderr contract the retired `plugins/sp/scripts/batch-plan.ts` carried.
 */
import { describe, expect, test } from 'bun:test';
import { BATCH_PLAN_MODES, BATCH_PLAN_USAGE, type ReadInputFile, runBatchPlan } from '../../src/workflow/batch-plan';

/** In-memory reader: a missing key throws like a missing file. */
function files(map: Record<string, unknown>): ReadInputFile {
    return (path) => {
        if (!(path in map)) throw new Error(`ENOENT: ${path}`);
        const value = map[path];
        return typeof value === 'string' ? value : JSON.stringify(value);
    };
}

const USAGE = { exitCode: 2, stdout: '', stderr: `${BATCH_PLAN_USAGE}\n` };

describe('runBatchPlan', () => {
    test('declares the three modes in help order', () => {
        expect([...BATCH_PLAN_MODES]).toEqual(['waves', 'order', 'task-children']);
    });

    test('waves projects the letters-first plan from {wbs, name} rows', async () => {
        const out = await runBatchPlan(
            { mode: 'waves', tasks: 't.json' },
            files({ 't.json': [{ wbs: '0101', name: 'First' }] }),
        );
        expect(out.exitCode).toBe(0);
        expect(out.stderr).toBe('');
        const labels = (JSON.parse(out.stdout) as { waves: Array<Array<{ label: string }>> }).waves[0]?.map(
            (r) => r.label,
        );
        expect(labels).toEqual(['A', 'A1', 'A2', 'A3', 'A4', 'B', 'Z']);
        expect(out.stdout.endsWith('}\n')).toBe(true);
    });

    test('waves rejects a missing flag (usage), bad rows and unreadable input', async () => {
        expect(await runBatchPlan({ mode: 'waves' }, files({}))).toEqual(USAGE);
        expect(await runBatchPlan({ mode: 'waves', tasks: '' }, files({}))).toEqual(USAGE);
        expect(await runBatchPlan({ mode: 'waves', tasks: 't.json' }, files({ 't.json': [{ wbs: 1 }] }))).toEqual({
            exitCode: 1,
            stdout: '',
            stderr: 'batch-plan: --tasks file must be a JSON array of {wbs, name}\n',
        });
        const missing = await runBatchPlan({ mode: 'waves', tasks: 'gone.json' }, files({}));
        expect(missing.exitCode).toBe(1);
        expect(missing.stderr).toBe('batch-plan: cannot read gone.json — ENOENT: gone.json\n');
        const broken = await runBatchPlan({ mode: 'waves', tasks: 'b.json' }, files({ 'b.json': '{' }));
        expect(broken.exitCode).toBe(1);
        expect(broken.stderr).toStartWith('batch-plan: cannot read b.json — ');
        const thrown = await runBatchPlan({ mode: 'waves', tasks: 'x' }, () => {
            throw 'plain string';
        });
        expect(thrown.stderr).toBe('batch-plan: cannot read x — plain string\n');
    });

    test('order schedules dependencies and validates concurrency', async () => {
        const read = files({
            't.json': [{ wbs: '0101' }, { wbs: '0102', dependencies: ['0101'], files: ['a.ts'] }],
        });
        const out = await runBatchPlan({ mode: 'order', tasks: 't.json', concurrency: '3' }, read);
        expect(out.exitCode).toBe(0);
        expect(JSON.parse(out.stdout)).toMatchObject({ order: ['0101', '0102'], cycle: null });
        expect((await runBatchPlan({ mode: 'order', tasks: 't.json' }, read)).exitCode).toBe(0);
        for (const concurrency of ['0', '1.5', 'x']) {
            expect(await runBatchPlan({ mode: 'order', tasks: 't.json', concurrency }, read)).toEqual(USAGE);
        }
        expect(await runBatchPlan({ mode: 'order' }, read)).toEqual(USAGE);
        expect((await runBatchPlan({ mode: 'order', tasks: 'gone' }, read)).exitCode).toBe(1);
        expect(await runBatchPlan({ mode: 'order', tasks: 'bad' }, files({ bad: [{ wbs: '1', files: [3] }] }))).toEqual(
            {
                exitCode: 1,
                stdout: '',
                stderr: 'batch-plan: --tasks file must be a JSON array of {wbs, dependencies?, files?}\n',
            },
        );
        expect((await runBatchPlan({ mode: 'order', tasks: 'bad' }, files({ bad: [null] }))).exitCode).toBe(1);
        expect(
            (await runBatchPlan({ mode: 'order', tasks: 'bad' }, files({ bad: [{ wbs: '1', dependencies: 'x' }] })))
                .exitCode,
        ).toBe(1);
    });

    test('task-children accepts a bare plan or a todo payload and validates the letter', async () => {
        const plan = [
            { id: 'task.0101', label: 'B', outcome: 'active', title: '0101 x' },
            { id: 'phase.plan', label: 'B1', parent: 'B', outcome: 'completed', title: 'Plan' },
        ];
        const read = files({ 'bare.json': plan, 'todo.json': { plan }, 'bad.json': { nope: true } });
        for (const file of ['bare.json', 'todo.json']) {
            const out = await runBatchPlan({ mode: 'task-children', letter: 'D', plan: file }, read);
            expect(out.exitCode).toBe(0);
            expect(Array.isArray(JSON.parse(out.stdout))).toBe(true);
        }
        expect(await runBatchPlan({ mode: 'task-children', letter: 'bad.json', plan: 'bad.json' }, read)).toEqual(
            USAGE,
        );
        expect(await runBatchPlan({ mode: 'task-children', letter: 'D' }, read)).toEqual(USAGE);
        expect(await runBatchPlan({ mode: 'task-children', plan: 'bare.json' }, read)).toEqual(USAGE);
        expect(await runBatchPlan({ mode: 'task-children', letter: 'D', plan: 'bad.json' }, read)).toEqual({
            exitCode: 1,
            stdout: '',
            stderr: 'batch-plan: --plan file must be a plan array or a todo --json payload with a `plan` field\n',
        });
        expect((await runBatchPlan({ mode: 'task-children', letter: 'D', plan: 'gone' }, read)).exitCode).toBe(1);
    });

    test('an unknown mode is a usage error', async () => {
        expect(await runBatchPlan({ mode: 'bogus' }, files({}))).toEqual(USAGE);
    });
});
