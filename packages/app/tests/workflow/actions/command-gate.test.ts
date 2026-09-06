import { describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem, type FileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { CommandGateActionRunner } from '../../../src/workflow/actions/command-gate';

describe('CommandGateActionRunner', () => {
    test('rejects sibling prefixes and the run directory before dispatch (0781)', async () => {
        const executor = new NodeProcessExecutor();
        const fs = createNodeFileSystem();
        const run = spyOn(executor, 'run').mockResolvedValue({
            command: 'echo',
            args: [],
            durationMs: 0,
            stdout: '',
            stderr: '',
            exitCode: 0,
        });
        const ensureDir = spyOn(fs, 'ensureDir').mockImplementation(async () => {});
        const write = spyOn(fs, 'writeFile').mockImplementation(async () => {});
        try {
            for (const resultFile of [
                '.spur/run-other/gate.status',
                '.spur/run/../run-other/gate.status',
                '.spur/run',
            ]) {
                const result = await new CommandGateActionRunner(executor, fs).execute(
                    { executable: 'echo', resultFile },
                    { runId: 'r1', stateOrNodeId: 's1', workdir: process.cwd(), vars: {}, env: {} },
                );
                expect(result.ok).toBe(false);
                expect(result.error).toContain('must resolve beneath .spur/run/');
            }
            expect(run).not.toHaveBeenCalled();
            expect(write).not.toHaveBeenCalled();
        } finally {
            run.mockRestore();
            ensureDir.mockRestore();
            write.mockRestore();
        }
    });

    test('rejects a symlink escape beneath .spur/run/ before dispatch or write (0785 R2)', async () => {
        const base = join(tmpdir(), `gate-escape-${crypto.randomUUID()}`);
        const workdir = join(base, 'wt');
        mkdirSync(join(workdir, '.spur', 'run'), { recursive: true });
        const outside = join(base, 'outside');
        mkdirSync(outside);
        writeFileSync(join(outside, 'gate.status'), 'PASS\n');
        symlinkSync(outside, join(workdir, '.spur', 'run', 'link'));
        const executor = new NodeProcessExecutor();
        const run = spyOn(executor, 'run').mockResolvedValue({
            command: 'echo',
            args: [],
            durationMs: 0,
            stdout: '',
            stderr: '',
            exitCode: 0,
        });
        const fs = createNodeFileSystem(workdir);
        const write = spyOn(fs, 'writeFile').mockImplementation(async () => {});
        try {
            const result = await new CommandGateActionRunner(executor, fs).execute(
                { executable: 'echo', resultFile: '.spur/run/link/gate.status' },
                { runId: 'r1', stateOrNodeId: 's1', workdir, vars: {}, env: {} },
            );
            expect(result.ok).toBe(false);
            expect(result.error).toContain('escapes');
            expect(run).not.toHaveBeenCalled();
            expect(write).not.toHaveBeenCalled();
        } finally {
            run.mockRestore();
            write.mockRestore();
            rmSync(base, { recursive: true, force: true });
        }
    });

    test('refuses to skip confinement when the filesystem lacks realPath (0785 R2)', async () => {
        const executor = new NodeProcessExecutor();
        const run = spyOn(executor, 'run').mockResolvedValue({
            command: 'echo',
            args: [],
            durationMs: 0,
            stdout: '',
            stderr: '',
            exitCode: 0,
        });
        // Minimal contract stand-in WITHOUT realPath: confinement cannot be proven, so the gate
        // must fail closed rather than degrade to the 0781 lexical check.
        const fsNoRealPath = { ensureDir: async () => {}, writeFile: async () => {} } as unknown as FileSystem;
        try {
            const result = await new CommandGateActionRunner(executor, fsNoRealPath).execute(
                { executable: 'echo', resultFile: '.spur/run/gate.status' },
                { runId: 'r1', stateOrNodeId: 's1', workdir: process.cwd(), vars: {}, env: {} },
            );
            expect(result.ok).toBe(false);
            expect(result.error).toContain('realPath');
            expect(run).not.toHaveBeenCalled();
        } finally {
            run.mockRestore();
        }
    });

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

    test('softFail records FAIL without failing the action (soft probe)', async () => {
        const workdir = join(tmpdir(), `test-gate-${crypto.randomUUID()}`);
        const fs = createNodeFileSystem(workdir);
        await fs.ensureDir(join(workdir, '.spur', 'run'));

        const runner = new CommandGateActionRunner(undefined, fs);
        const resultFile = '.spur/run/soft.status';
        // A soft probe must keep the run alive so a transition guard can read the status
        // file and route to `failed` itself — the schema exposes no `onError` to do this.
        const res = await runner.execute(
            { executable: 'false', resultFile, softFail: true },
            { runId: 'r1', stateOrNodeId: 's1', workdir, vars: {}, env: {} },
        );

        expect(res.ok).toBe(true);
        expect((res.data as { status: string }).status).toBe('FAIL');
        expect((await fs.readFile(join(workdir, resultFile))).trim()).toBe('FAIL');
    });

    test('without softFail a failing command still fails the action', async () => {
        const workdir = join(tmpdir(), `test-gate-${crypto.randomUUID()}`);
        const fs = createNodeFileSystem(workdir);
        await fs.ensureDir(join(workdir, '.spur', 'run'));

        const runner = new CommandGateActionRunner(undefined, fs);
        const resultFile = '.spur/run/hard.status';
        const res = await runner.execute(
            { executable: 'false', resultFile },
            { runId: 'r1', stateOrNodeId: 's1', workdir, vars: {}, env: {} },
        );

        expect(res.ok).toBe(false);
        expect((await fs.readFile(join(workdir, resultFile))).trim()).toBe('FAIL');
    });

    test('splits a multi-token executable into argv without a shell', async () => {
        const workdir = join(tmpdir(), `test-gate-${crypto.randomUUID()}`);
        const fs = createNodeFileSystem(workdir);
        await fs.ensureDir(join(workdir, '.spur', 'run'));

        const calls: Array<{ command: string; args?: string[] }> = [];
        const executor = {
            run: async (opts: { command: string; args?: string[] }) => {
                calls.push({ command: opts.command, args: opts.args });
                return { stdout: '', stderr: '', exitCode: 0 };
            },
            // biome-ignore lint/suspicious/noExplicitAny: minimal ProcessExecutor stub for argv assertion
        } as any;

        const runner = new CommandGateActionRunner(executor, fs);
        // `resolveSpurBin()` returns "<bun> <mainModule>" when the CLI runs from source, so a
        // single-token rule would make every real gate in the shipped pipelines inexpressible.
        const res = await runner.execute(
            {
                executable: '/usr/bin/bun /repo/apps/cli/src/index.ts',
                args: ['task', 'check', '0604'],
                resultFile: '.spur/run/split.status',
                softFail: true,
            },
            { runId: 'r1', stateOrNodeId: 's1', workdir, vars: {}, env: {} },
        );

        expect(res.ok).toBe(true);
        expect(calls[0]?.command).toBe('/usr/bin/bun');
        expect(calls[0]?.args).toEqual(['/repo/apps/cli/src/index.ts', 'task', 'check', '0604']);
    });

    test('rejects an executable carrying shell metacharacters', async () => {
        const runner = new CommandGateActionRunner();
        // Splitting on whitespace is only safe because no shell is involved; an executable
        // that smuggles shell syntax is the exact abuse this action kind exists to block.
        const res = await runner.execute(
            { executable: 'sh -c "rm -rf /"; echo', resultFile: '.spur/run/evil.status' },
            { runId: 'r1', stateOrNodeId: 's1', workdir: process.cwd(), vars: {}, env: {} },
        );
        expect(res.ok).toBe(false);
        expect(res.error).toContain('shell metacharacters');
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

    // R6 / 0753 R1: A declared timeout must reach the executor under the contract's name
    // (`timeout`) and actually fire. The pre-repair code spread `timeoutMs` into
    // `ProcessOptions`, but the executor contract declares `timeout`
    // (`@gobing-ai/ts-runtime/dist/process-executor.d.ts:58`), so the option was silently
    // dropped and a hung gate ran unbounded. Assert both: the option reaches the executor
    // under the correct key, and a process that exceeds the deadline does not record PASS.
    test('declared timeout reaches the executor under `timeout` and a hung command does not report PASS', async () => {
        const workdir = join(tmpdir(), `test-gate-timeout-${crypto.randomUUID()}`);
        const fs = createNodeFileSystem(workdir);
        await fs.ensureDir(join(workdir, '.spur', 'run'));

        const calls: Array<{ command: string; args?: string[]; timeout?: number; timeoutMs?: number }> = [];
        // Simulate the deadline firing: a real execa run would resolve with
        // { exitCode: null, signal: 'SIGTERM', durationMs: timeout } after `timeout` ms.
        const executor = {
            run: async (opts: { command: string; args?: string[]; timeout?: number; timeoutMs?: number }) => {
                calls.push({
                    command: opts.command,
                    args: opts.args,
                    timeout: opts.timeout,
                    timeoutMs: opts.timeoutMs,
                });
                return {
                    stdout: '',
                    stderr: 'killed by signal SIGTERM',
                    exitCode: null,
                    signal: 'SIGTERM',
                    durationMs: opts.timeout ?? 0,
                };
            },
            // biome-ignore lint/suspicious/noExplicitAny: minimal ProcessExecutor stub for timeout assertion
        } as any;

        const runner = new CommandGateActionRunner(executor, fs);
        const resultFile = '.spur/run/timeout.status';
        const res = await runner.execute(
            {
                id: 'test-gate-timeout',
                executable: 'bun',
                args: ['-e', 'await new Promise(() => {})'],
                resultFile,
                timeoutMs: 50,
                retry: { maxAttempts: 1, delayMs: 0, on: [] },
            },
            { runId: 'r1', stateOrNodeId: 's1', workdir, vars: {}, env: {} },
        );

        // The executor must receive the timeout under `timeout` (the contract name),
        // never `timeoutMs` (the pre-repair bug).
        expect(calls).toHaveLength(1);
        expect(calls[0]?.timeout).toBe(50);
        expect(calls[0]?.timeoutMs).toBeUndefined();
        // The hung gate never reaches PASS — it records FAIL and fails the action.
        expect(res.ok).toBe(false);
        const failData = res.data as { status?: string } | undefined;
        expect(failData?.status).toBe('FAIL');
        expect((await fs.readFile(join(workdir, resultFile))).trim()).toBe('FAIL');
    });
});
