/**
 * Thin-wrapper tests for `spur task batch-plan` (apps/cli/src/commands/task/batch-plan.ts; script-absorption PR-5). The
 * projections are pinned by packages/app tests and the golden parity test; this pins the file reads
 * and flag mapping through `main()`.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(import.meta.dir, '..', '..', `.tmp-task-batch-plan-test-${Date.now()}`);
    await mkdir(join(cwd, 'docs', 'tasks'), { recursive: true });
});

afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
});

async function run(argv: string[], env?: Record<string, string | undefined>) {
    const output = createCapturedOutput();
    const exitCode = await main(argv, { cwd, output, ...(env ? { env } : {}) });
    return { exitCode, output, out: output.messages.join('\n'), err: output.errors.join('\n') };
}

describe('spur task batch-plan', () => {
    test('reads input files relative to the project and maps every flag', async () => {
        await writeFile(join(cwd, 'tasks.json'), JSON.stringify([{ wbs: '0101', name: 'First', dependencies: [] }]));
        await writeFile(join(cwd, 'plan.json'), JSON.stringify({ plan: [] }));
        const waves = await run(['task', 'batch-plan', 'waves', '--tasks', 'tasks.json']);
        expect(waves.exitCode).toBe(0);
        expect(JSON.parse(waves.out)).toHaveProperty('waves');
        const order = await run(['task', 'batch-plan', 'order', '--tasks', 'tasks.json', '--concurrency', '1']);
        expect(JSON.parse(order.out)).toMatchObject({ order: ['0101'] });
        const children = await run(['task', 'batch-plan', 'task-children', '--letter', 'B', '--plan', 'plan.json']);
        expect(children.out).toBe('[]');
        const missing = await run(['task', 'batch-plan', 'waves', '--tasks', 'nope.json']);
        expect(missing.exitCode).toBe(1);
        expect(missing.err).toContain('batch-plan: cannot read nope.json');
        const usage = await run(['task', 'batch-plan', 'bogus']);
        expect(usage.exitCode).toBe(2);
        expect(usage.err).toStartWith('usage: spur task batch-plan');
    });
});
