import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { CommandGateActionRunner } from '../../../src/workflow/actions/command-gate';

describe('CommandGateActionRunner', () => {
    test('rejects command option', async () => {
        const runner = new CommandGateActionRunner();
        const res = await runner.execute(
            { command: 'echo hello', resultFile: '.spur/run/test.status' },
            { runId: 'r1', stateOrNodeId: 's1', workdir: process.cwd(), vars: {}, env: {} },
        );
        expect(res.ok).toBe(false);
        expect(res.error).toContain('rejects "command" option');
    });

    test('rejects missing or empty executable', async () => {
        const runner = new CommandGateActionRunner();
        const res = await runner.execute(
            { executable: '', resultFile: '.spur/run/test.status' },
            { runId: 'r1', stateOrNodeId: 's1', workdir: process.cwd(), vars: {}, env: {} },
        );
        expect(res.ok).toBe(false);
        expect(res.error).toContain('must be a non-empty string');
    });

    test('rejects resultFile outside .spur/run/', async () => {
        const runner = new CommandGateActionRunner();
        const res = await runner.execute(
            { executable: 'echo', args: ['hello'], resultFile: 'outside.status' },
            { runId: 'r1', stateOrNodeId: 's1', workdir: process.cwd(), vars: {}, env: {} },
        );
        expect(res.ok).toBe(false);
        expect(res.error).toContain('must resolve beneath .spur/run/');
    });

    test('executes successful command and writes PASS to resultFile', async () => {
        const workdir = join(tmpdir(), `test-gate-${crypto.randomUUID()}`);
        const fs = createNodeFileSystem(workdir);
        await fs.ensureDir(join(workdir, '.spur', 'run'));

        const runner = new CommandGateActionRunner(undefined, fs);
        const resultFile = '.spur/run/gate.status';

        const res = await runner.execute(
            {
                id: 'test-gate',
                executable: 'bun',
                args: ['-e', 'console.log("all good")'],
                resultFile,
            },
            { runId: 'r1', stateOrNodeId: 's1', workdir, vars: {}, env: {} },
        );

        expect(res.ok).toBe(true);
        const data = res.data as { status?: string } | undefined;
        expect(data?.status).toBe('PASS');

        const content = await fs.readFile(join(workdir, resultFile));
        expect(content.trim()).toBe('PASS');
    });

    test('executes failing command, writes FAIL to resultFile, and retries on matching error', async () => {
        const workdir = join(tmpdir(), `test-gate-fail-${crypto.randomUUID()}`);
        const fs = createNodeFileSystem(workdir);
        await fs.ensureDir(join(workdir, '.spur', 'run'));

        const runner = new CommandGateActionRunner(undefined, fs);
        const resultFile = '.spur/run/gate-fail.status';

        const res = await runner.execute(
            {
                id: 'test-gate-retry',
                executable: 'bun',
                args: ['-e', 'console.error("SQLiteError: database is locked"); process.exit(1);'],
                resultFile,
                retry: {
                    maxAttempts: 2,
                    delayMs: 10,
                    on: ['sqlite-busy'],
                },
            },
            { runId: 'r1', stateOrNodeId: 's1', workdir, vars: {}, env: {} },
        );

        expect(res.ok).toBe(false);
        const failData = res.data as { status?: string; attempts?: number } | undefined;
        expect(failData?.status).toBe('FAIL');
        expect(failData?.attempts).toBe(2);

        const content = await fs.readFile(join(workdir, resultFile));
        expect(content.trim()).toBe('FAIL');
    });
});
