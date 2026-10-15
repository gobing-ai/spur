/**
 * Thin-wrapper tests for `spur task preflight` (apps/cli/src/commands/task/preflight.ts; script-absorption PR-5). Behavior
 * lives in `@gobing-ai/spur-app/pipeline-steps` (packages/app tests); golden parity against the retired
 * plugin script is apps/cli/tests/script-absorption-pr5-parity. These pin the flag → request mapping,
 * the corpus reads and the exit codes through `main()`.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(import.meta.dir, '..', '..', `.tmp-task-preflight-test-${Date.now()}`);
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

describe('spur task preflight', () => {
    let first = '';
    let second = '';

    beforeAll(async () => {
        const a = await run(['task', 'create', '--skip-ready', 'Preflight dependency']);
        const b = await run(['task', 'create', '--skip-ready', 'Preflight dependent']);
        first = a.out.match(/Created task (\d{4})/)?.[1] ?? '';
        second = b.out.match(/Created task (\d{4})/)?.[1] ?? '';
        expect((await run(['task', 'deps', second, 'add', first])).exitCode).toBe(0);
    });

    test('reads status, dependencies and their statuses from the corpus (A2 skip, exit 2)', async () => {
        const r = await run(['task', 'preflight', second, '--json']);
        expect(r.exitCode).toBe(2);
        expect(JSON.parse(r.out)).toMatchObject({ action: 'skip', code: 'A2', unmetDeps: [first] });
    });

    test('explicit --deps / --dep-status override the corpus reads', async () => {
        expect((await run(['task', 'preflight', second, '--deps', ''])).out).toContain('run: preflight clear');
        const satisfied = await run(['task', 'preflight', second, '--dep-status', `${first}:done`]);
        expect(satisfied.exitCode).toBe(0);
        const blocked = await run(['task', 'preflight', second, '--deps', first, '--dep-status', `${first}:wip`]);
        expect(blocked.exitCode).toBe(2);
    });

    test('an unresolvable dependency stays unknown, which the policy treats as unmet', async () => {
        // `task deps add` refuses a missing task, so write the dangling id straight into the file.
        const path = (await run(['task', 'path', second])).out.trim();
        const text = readFileSync(path, 'utf8');
        await writeFile(path, text.replace(`dependencies: ["${first}"]`, `dependencies: ["${first}", "9998"]`));
        try {
            const r = await run(['task', 'preflight', second, '--dep-status', `${first}:done`, '--json']);
            expect(r.exitCode).toBe(2);
            expect(JSON.parse(r.out)).toMatchObject({ unmetDeps: ['9998'] });
        } finally {
            await writeFile(path, text);
        }
    });

    test('--status skips the corpus; --operation runs quick readiness', async () => {
        const r = await run(['task', 'preflight', '0999', '--status', 'todo', '--operation', 'run', '--json']);
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(r.out)).toMatchObject({ action: 'runnable' });
        const unknownOp = await run(['task', 'preflight', '0999', '--status', 'done', '--operation', 'bogus']);
        expect(unknownOp.out).toContain('skip A8');
        const counted = await run([
            'task',
            'preflight',
            '0999',
            '--status',
            'todo',
            '--operation',
            'run',
            '--filtered-count',
            '0',
            '--required-sections',
            'Plan',
            '--present-sections',
            'Plan',
            '--force',
        ]);
        expect(counted.exitCode).toBe(2);
    });

    test('recovery, classification and the usage / missing-task errors', async () => {
        expect((await run(['task', 'preflight', '0042', '--status', 'testing', '--recovery'])).out).toContain(
            '/sp:dev-verify 0042',
        );
        const ok = await run(['task', 'preflight', '--classify-feature', '[]']);
        expect(ok.exitCode).toBe(0);
        expect(JSON.parse(ok.out)).toMatchObject({ shouldAbort: false });
        const usage = await run(['task', 'preflight']);
        expect(usage.exitCode).toBe(1);
        expect(usage.err).toContain('spur task preflight <wbs>');
        const missing = await run(['task', 'preflight', '9999']);
        expect(missing.exitCode).toBe(1);
        expect(missing.err).toContain('task preflight: cannot read task 9999');
    });
});
