/**
 * Thin-wrapper tests for `spur task wrapup` (apps/cli/src/commands/task/wrapup.ts; script-absorption PR-5). The steps are
 * pinned by packages/app/tests/workflow/wrapup and the golden parity test; this pins the flag → env
 * mapping and the exit codes through `main()`.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(import.meta.dir, '..', '..', `.tmp-task-wrapup-test-${Date.now()}`);
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

/** Capture the steps' direct process writes (the app steps echo, not the output seam). */
async function captureProcess<T>(body: () => Promise<T>): Promise<{ result: T; stderr: string }> {
    let stderr = '';
    const errSpy = spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        stderr += String(chunk);
        return true;
    });
    const outSpy = spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
        return { result: await body(), stderr };
    } finally {
        errSpy.mockRestore();
        outSpy.mockRestore();
    }
}
describe('spur task wrapup', () => {
    test('an unknown op prints the usage line and exits 2', async () => {
        const r = await run(['task', 'wrapup', 'bogus']);
        expect(r.exitCode).toBe(2);
        expect(r.err).toContain('usage: spur task wrapup <resolve|');
        expect(r.err).toContain('|drift-probe>');
    });

    test('flags override the workflow env names the steps read', async () => {
        const { result, stderr } = await captureProcess(() =>
            run(
                [
                    'task',
                    'wrapup',
                    'resolve',
                    '--run-id',
                    'w1',
                    '--tasks',
                    '[]',
                    '--mode',
                    'fast',
                    '--spur-bin',
                    'false',
                ],
                {
                    __runId: 'ignored',
                },
            ),
        );
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe('');
        expect(readFileSync(join(cwd, '.spur/run/w1-wrapup-resolve.status'), 'utf8')).toBe('PASS\n');
        expect(readFileSync(join(cwd, '.spur/run/w1-wrapup-tasks.json'), 'utf8')).toBe('[]\n');
        const route = await captureProcess(() =>
            run(['task', 'wrapup', 'route-reason', '--run-id', 'w1', '--mode', 'fast']),
        );
        expect(route.result.exitCode).toBe(0);
        expect(readFileSync(join(cwd, '.spur/run/w1-route-reason.txt'), 'utf8')).toBe('skipped:empty task list\n');
    });

    test('1249: validation failure exits 1 and the removed feature operation is refused', async () => {
        const { result } = await captureProcess(() =>
            run(['task', 'wrapup', 'resolve', '--run-id', 'invalid', '--tasks', '{broken']),
        );
        expect(result.exitCode).toBe(1);
        expect(readFileSync(join(cwd, '.spur/run/invalid-wrapup-resolve.status'), 'utf8')).toBe('FAIL\n');
        expect((await run(['task', 'wrapup', 'feature-transition'])).exitCode).toBe(2);
    });

    test('drift-probe runs with the default spur bin and fails safe without a capture', async () => {
        const { result, stderr } = await captureProcess(() => run(['task', 'wrapup', 'drift-probe', '--run-id', 'w3']));
        expect(result.exitCode).toBe(0);
        expect(stderr).toContain('normalized task capture is missing or corrupted');
        expect(JSON.parse(readFileSync(join(cwd, '.spur/run/w3-drift-probe.json'), 'utf8'))).toMatchObject({
            clean: false,
        });
        expect(existsSync(join(cwd, '.spur/run/w3-mode.txt'))).toBe(true);
    });
});
