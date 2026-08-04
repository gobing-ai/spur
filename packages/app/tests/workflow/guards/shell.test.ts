import { describe, expect, test } from 'bun:test';
import type { GuardContext } from '@gobing-ai/ts-dual-workflow-engine';
import {
    NodeProcessExecutor,
    type ProcessExecutor,
    type ProcessOptions,
    type ProcessResult,
} from '@gobing-ai/ts-runtime';
import { EnvShellGuardRunner } from '../../../src/workflow/guards/shell';

function makeCtx(overrides: Partial<GuardContext> = {}): GuardContext {
    return {
        runId: 'run-1',
        current: 'start',
        vars: {},
        ...overrides,
    } as GuardContext;
}

describe('EnvShellGuardRunner', () => {
    test('exports workflow vars as process env (env-var handoff)', async () => {
        let captured: ProcessOptions | undefined;
        const fakeExecutor: ProcessExecutor = {
            run: async (options) => {
                captured = options;
                return { exitCode: 0, stdout: '', stderr: '' } as ProcessResult;
            },
            runStreaming: () => {
                throw new Error('guards use buffered run()');
            },
        };
        const runner = new EnvShellGuardRunner(fakeExecutor);

        await runner.evaluate({ command: 'true' }, makeCtx({ vars: { profile: 'auto', __runId: 'r1' } }));

        expect(captured?.env?.profile).toBe('auto');
        expect(captured?.env?.__runId).toBe('r1');
        // Ambient env is inherited so the guard's shell can still resolve tools.
        expect(captured?.env?.PATH).toBe(process.env.PATH);
    });

    test('passed reflects exit code, preserving guard semantics', async () => {
        const runner = new EnvShellGuardRunner(new NodeProcessExecutor());

        const yes = await runner.evaluate(
            { command: 'test "$profile" = auto' },
            makeCtx({ vars: { profile: 'auto' } }),
        );
        const no = await runner.evaluate(
            { command: 'test "$profile" = auto' },
            makeCtx({ vars: { profile: 'standard' } }),
        );

        expect(yes.passed).toBe(true);
        expect(no.passed).toBe(false);
    });

    test('a var carrying shell metacharacters cannot execute from a guard (0435)', async () => {
        // The pre-fix shape embedded the value in the command string, so a backticked payload ran
        // while the comparison still returned an ordinary boolean — a silent side effect.
        const runner = new EnvShellGuardRunner(new NodeProcessExecutor());
        const payload = '`printf INJECTED` $(printf INJECTED) "dq" \\bs';

        const result = await runner.evaluate(
            { command: 'printf \'%s\' "$probe"' },
            makeCtx({ vars: { probe: payload } }),
        );

        // printf exits 0, so the guard passes; what matters is WHAT it printed.
        expect(result.passed).toBe(true);
        const report = result.report as { stdout: string };
        // Observed literally — had the backticks or $() executed, stdout would contain INJECTED.
        expect(report.stdout).toBe(payload);
        expect(report.stdout).not.toContain('INJECTED\n');
    });

    test('a metacharacter-bearing var does not alter which transition is taken', async () => {
        const runner = new EnvShellGuardRunner(new NodeProcessExecutor());

        // A payload engineered to make a naive `test "<value>" = PASS` succeed via injection.
        const result = await runner.evaluate(
            { command: 'test "$probe" = PASS' },
            makeCtx({ vars: { probe: 'x`printf PASS`' } }),
        );

        expect(result.passed).toBe(false);
    });

    test('explicit args run the command as a program, not via /bin/sh', async () => {
        let captured: ProcessOptions | undefined;
        const fakeExecutor: ProcessExecutor = {
            run: async (options) => {
                captured = options;
                return { exitCode: 0, stdout: '', stderr: '' } as ProcessResult;
            },
            runStreaming: () => {
                throw new Error('guards use buffered run()');
            },
        };
        const runner = new EnvShellGuardRunner(fakeExecutor);

        const result = await runner.evaluate({ command: '/usr/bin/env', args: ['true'] }, makeCtx());

        expect(result.passed).toBe(true);
        expect(captured?.command).toBe('/usr/bin/env');
        expect(captured?.args).toEqual(['true']);
    });

    test('cwd option overrides context.workdir; otherwise workdir is used', async () => {
        const seen: Array<ProcessOptions> = [];
        const fakeExecutor: ProcessExecutor = {
            run: async (options) => {
                seen.push(options);
                return { exitCode: 0, stdout: '', stderr: '' } as ProcessResult;
            },
            runStreaming: () => {
                throw new Error('guards use buffered run()');
            },
        };
        const runner = new EnvShellGuardRunner(fakeExecutor);

        await runner.evaluate({ command: 'true', cwd: '/tmp' }, makeCtx({ workdir: '/work' }));
        await runner.evaluate({ command: 'true' }, makeCtx({ workdir: '/work' }));

        expect(seen[0]?.cwd).toBe('/tmp');
        expect(seen[1]?.cwd).toBe('/work');
    });

    test('guard spawns are buffered and non-throwing on non-zero exit', async () => {
        let captured: ProcessOptions | undefined;
        const fakeExecutor: ProcessExecutor = {
            run: async (options) => {
                captured = options;
                return { exitCode: 3, stdout: 'out', stderr: 'err' } as ProcessResult;
            },
            runStreaming: () => {
                throw new Error('guards use buffered run()');
            },
        };
        const runner = new EnvShellGuardRunner(fakeExecutor);

        const result = await runner.evaluate({ command: 'false' }, makeCtx());

        expect(captured?.rejectOnError).toBe(false);
        expect(captured?.forceBuffered).toBe(true);
        expect(captured?.command).toBe('/bin/sh');
        expect(captured?.args).toEqual(['-c', 'false']);
        expect(result.passed).toBe(false);
        expect(result.report).toEqual({ stdout: 'out', stderr: 'err', exitCode: 3 });
    });

    test('non-string option values are rejected loudly', async () => {
        const runner = new EnvShellGuardRunner(new NodeProcessExecutor());

        await expect(runner.evaluate({}, makeCtx())).rejects.toThrow('Guard option "command" must be a string');
        await expect(runner.evaluate({ command: 'true', args: ['a', 42] }, makeCtx())).rejects.toThrow(
            'Guard option "args" must be a string array',
        );
    });
});
