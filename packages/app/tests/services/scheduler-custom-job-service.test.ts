import { describe, expect, test } from 'bun:test';
import type { Job } from '@gobing-ai/ts-infra';
import { NodeProcessExecutor, type ProcessExecutor, type ProcessResult } from '@gobing-ai/ts-runtime';
import {
    handleSchedulerCustomJob,
    SCHEDULER_CUSTOM_JOB,
    SCHEDULER_CUSTOM_TIMEOUT_MS,
    validateSchedulerCustomJobPayload,
} from '../../src/services/scheduler-custom-job-service';

/** Full queue job wrapping a payload — the handler's input shape. */
function jobOf(payload: unknown): Job<unknown> {
    return {
        id: 'job-1',
        type: SCHEDULER_CUSTOM_JOB,
        payload,
        status: 'processing',
        attempts: 1,
        maxRetries: 3,
        createdAt: 1,
        updatedAt: 1,
        nextRetryAt: null,
        lastError: null,
        processingAt: 1,
    };
}

/** Process options the fake executor recorded. */
interface RecordedRun {
    command: string;
    args: string[];
    cwd?: string;
    timeout?: number;
    maxOutput?: number;
    forceBuffered?: boolean;
    rejectOnError?: boolean;
}

/** Capturing fake at the ProcessExecutor seam; `result` is merged over a successful default. */
function fakeExecutor(result: Partial<ProcessResult> | Error): { executor: ProcessExecutor; runs: RecordedRun[] } {
    const runs: RecordedRun[] = [];
    const executor = {
        run: async (options: RecordedRun) => {
            runs.push(options);
            if (result instanceof Error) throw result;
            return {
                command: options.command,
                args: options.args ?? [],
                exitCode: 0,
                stdout: '',
                stderr: '',
                durationMs: 1,
                ...result,
            };
        },
    } as unknown as ProcessExecutor;
    return { executor, runs };
}

describe('validateSchedulerCustomJobPayload (task 0734 R6)', () => {
    test('accepts a well-formed payload', () => {
        expect(validateSchedulerCustomJobPayload({ name: 'nightly', command: 'echo hi' })).toEqual({
            name: 'nightly',
            command: 'echo hi',
        });
    });

    test.each([
        ['null', null],
        ['an array', [{ name: 'n', command: 'c' }]],
        ['a string', 'nightly'],
        ['a missing name', { command: 'echo hi' }],
        ['a blank name', { name: '   ', command: 'echo hi' }],
        ['a missing command', { name: 'nightly' }],
        ['a blank command', { name: 'nightly', command: '  ' }],
        ['a non-string command', { name: 'nightly', command: 42 }],
    ])('rejects %s', (_label, raw) => {
        expect(() => validateSchedulerCustomJobPayload(raw)).toThrow();
    });

    test('an invalid-command error names the job but never echoes the command value', () => {
        // The command is operator input that may carry a credential; only the name is safe.
        expect(() => validateSchedulerCustomJobPayload({ name: 'nightly', command: '' })).toThrow(
            /scheduler\.custom payload for "nightly"/,
        );
    });
});

describe('handleSchedulerCustomJob (task 0734 R6)', () => {
    test('runs the command through /bin/sh -c with the exact bounded ProcessExecutor options', async () => {
        const { executor, runs } = fakeExecutor({});
        await handleSchedulerCustomJob(
            { cwd: '/proj', executor },
            jobOf({ name: 'nightly', command: 'bun run load-history && echo done' }),
        );
        expect(runs).toHaveLength(1);
        expect(runs[0]).toEqual({
            command: '/bin/sh',
            args: ['-c', 'bun run load-history && echo done'],
            cwd: '/proj',
            timeout: SCHEDULER_CUSTOM_TIMEOUT_MS,
            maxOutput: 1_000_000,
            forceBuffered: true,
            rejectOnError: false,
        });
    });

    test('an explicit timeoutMs overrides the one-hour default', async () => {
        const { executor, runs } = fakeExecutor({});
        await handleSchedulerCustomJob(
            { cwd: '/proj', executor, timeoutMs: 5_000 },
            jobOf({ name: 'n', command: 'x' }),
        );
        expect(runs[0]?.timeout).toBe(5_000);
    });

    test('exit 0 resolves and emits nothing from successful output', async () => {
        const { executor } = fakeExecutor({ stdout: 'secret-looking output', exitCode: 0 });
        await expect(
            handleSchedulerCustomJob({ cwd: '/proj', executor }, jobOf({ name: 'n', command: 'x' })),
        ).resolves.toBeUndefined();
    });

    test('a non-zero exit throws naming the job, the exit code, and the stderr tail', async () => {
        const { executor } = fakeExecutor({ exitCode: 2, stderr: 'boom' });
        await expect(
            handleSchedulerCustomJob({ cwd: '/proj', executor }, jobOf({ name: 'nightly', command: 'exit 2' })),
        ).rejects.toThrow('scheduler job "nightly" exited 2: boom');
    });

    test('a failure message never carries the command text', async () => {
        const { executor } = fakeExecutor({ exitCode: 1, stderr: 'failed' });
        const err = (await handleSchedulerCustomJob(
            { cwd: '/proj', executor },
            jobOf({ name: 'nightly', command: 'curl -H "Authorization: Bearer s3cret" https://x' }),
        ).catch((e: unknown) => e)) as Error;
        expect(err.message).not.toContain('s3cret');
        expect(err.message).not.toContain('curl');
    });

    test('stdout is the failure detail only when stderr is empty', async () => {
        const { executor } = fakeExecutor({ exitCode: 1, stderr: '   ', stdout: 'reported on stdout' });
        await expect(
            handleSchedulerCustomJob({ cwd: '/proj', executor }, jobOf({ name: 'n', command: 'x' })),
        ).rejects.toThrow('scheduler job "n" exited 1: reported on stdout');
    });

    test('the failure detail is bounded to the final 400 characters', async () => {
        const { executor } = fakeExecutor({ exitCode: 1, stderr: 'A'.repeat(5_000) });
        const err = (await handleSchedulerCustomJob(
            { cwd: '/proj', executor },
            jobOf({ name: 'n', command: 'x' }),
        ).catch((e: unknown) => e)) as Error;
        expect(err.message).toContain('…');
        expect(err.message.length).toBeLessThan(500);
    });

    test('a null exit code (signal/timeout) throws naming the signal', async () => {
        const { executor } = fakeExecutor({ exitCode: null, signal: 'SIGTERM', stderr: 'killed' });
        await expect(
            handleSchedulerCustomJob({ cwd: '/proj', executor }, jobOf({ name: 'slow', command: 'sleep 99' })),
        ).rejects.toThrow('scheduler job "slow" terminated before a normal exit (SIGTERM): killed');
    });

    test('a spawn failure propagates to the queue as a failed attempt', async () => {
        const { executor } = fakeExecutor(new Error('spawn ENOENT'));
        await expect(
            handleSchedulerCustomJob({ cwd: '/proj', executor }, jobOf({ name: 'n', command: 'x' })),
        ).rejects.toThrow('spawn ENOENT');
    });

    test('payload drift fails the attempt instead of running a defaulted command', async () => {
        const { executor, runs } = fakeExecutor({});
        // The whole envelope handed in as the payload — a realistic queue-registry drift.
        await expect(
            handleSchedulerCustomJob({ cwd: '/proj', executor }, jobOf(jobOf({ name: 'n', command: 'x' }))),
        ).rejects.toThrow();
        expect(runs).toHaveLength(0);
    });

    test('smoke: a real child runs the command in cwd and reports its exit code', async () => {
        const executor = new NodeProcessExecutor();
        const deps = { cwd: process.cwd(), executor };
        await expect(
            handleSchedulerCustomJob(deps, jobOf({ name: 'smoke-ok', command: 'test -f package.json' })),
        ).resolves.toBeUndefined();
        await expect(handleSchedulerCustomJob(deps, jobOf({ name: 'smoke-fail', command: 'exit 7' }))).rejects.toThrow(
            'scheduler job "smoke-fail" exited 7',
        );
    });
});
