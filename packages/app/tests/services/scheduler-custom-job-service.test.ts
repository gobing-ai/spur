import { describe, expect, test } from 'bun:test';
import type { Job } from '@gobing-ai/ts-infra';
import { NodeProcessExecutor, type ProcessExecutor, type ProcessResult } from '@gobing-ai/ts-runtime';
import { HISTORY_PRODUCER_EXCLUSIVE_KEY, isExclusiveJobActive } from '../../src/services/job-exclusion-guard';
import {
    handleSchedulerCustomJob,
    resolveSchedulerCustomTimeoutMs,
    resolveSchedulerJobTimeoutMs,
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
    timeout?: number | null;
    maxOutput?: number;
    forceBuffered?: boolean;
    rejectOnError?: boolean;
    signal?: AbortSignal;
    onSpawn?: (pid: number) => void;
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
        const run = runs[0] as (typeof runs)[number];
        expect(run.command).toBe('/bin/sh');
        expect(run.args).toEqual(['-c', 'bun run load-history && echo done']);
        expect(run.cwd).toBe('/proj');
        expect(run.timeout).toBe(SCHEDULER_CUSTOM_TIMEOUT_MS);
        expect(run.maxOutput).toBe(1_000_000);
        expect(run.forceBuffered).toBe(true);
        // Task 0813 R1: containment is native — the finite timeout arms the executor's
        // own group cleanup, and the caller races no competing watchdog signal.
        expect(run.signal).toBeUndefined();
        expect(run.onSpawn).toBeUndefined();
    });

    test('an explicit timeoutMs overrides the ten-minute default', async () => {
        const { executor, runs } = fakeExecutor({});
        await handleSchedulerCustomJob(
            { cwd: '/proj', executor, timeoutMs: 5_000 },
            jobOf({ name: 'n', command: 'x' }),
        );
        expect(runs[0]?.timeout).toBe(5_000);
    });

    test('task 0813 R2: an explicit unlimited policy forwards null — no hidden ten-minute timer', async () => {
        const { executor, runs } = fakeExecutor({});
        await handleSchedulerCustomJob({ cwd: '/proj', executor, timeoutMs: null }, jobOf({ name: 'n', command: 'x' }));
        expect(runs[0]?.timeout).toBeNull();
    });

    test('task 0813 R2: a per-job resolver may resolve a single job to explicit unlimited', async () => {
        const { executor, runs } = fakeExecutor({});
        await handleSchedulerCustomJob(
            {
                cwd: '/proj',
                executor,
                resolveTimeoutMs: (name) => (name === 'endless' ? null : 1_000),
            },
            jobOf({ name: 'endless', command: 'x' }),
        );
        expect(runs[0]?.timeout).toBeNull();
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

    test('a null exit code (signal/timeout) throws naming the signal and elapsed time', async () => {
        const { executor } = fakeExecutor({ exitCode: null, signal: 'SIGTERM', stderr: 'killed', durationMs: 4_321 });
        await expect(
            handleSchedulerCustomJob({ cwd: '/proj', executor }, jobOf({ name: 'slow', command: 'sleep 99' })),
        ).rejects.toThrow('scheduler job "slow" terminated before a normal exit (SIGTERM) after 4321ms: killed');
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

describe('resolveSchedulerCustomTimeoutMs (task 0803 R1 / 0813 R2)', () => {
    test('defaults to 600000ms — ten minutes, not the one-hour default that wedged the daemon', () => {
        expect(SCHEDULER_CUSTOM_TIMEOUT_MS).toBe(600_000);
        expect(resolveSchedulerCustomTimeoutMs({})).toBe(600_000);
    });

    test('parses a positive integer SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS override', () => {
        expect(resolveSchedulerCustomTimeoutMs({ SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS: '5000' })).toBe(5_000);
    });

    test("an explicit 'none' resolves to unlimited (null)", () => {
        expect(resolveSchedulerCustomTimeoutMs({ SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS: 'none' })).toBeNull();
        expect(resolveSchedulerCustomTimeoutMs({ SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS: ' NONE ' })).toBeNull();
    });

    test('falls back to the default for empty, non-numeric, zero, negative, or fractional values', () => {
        const env = { SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS: '  ' };
        expect(resolveSchedulerCustomTimeoutMs(env)).toBe(600_000);
        expect(resolveSchedulerCustomTimeoutMs({ SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS: 'abc' })).toBe(600_000);
        expect(resolveSchedulerCustomTimeoutMs({ SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS: '0' })).toBe(600_000);
        expect(resolveSchedulerCustomTimeoutMs({ SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS: '-5' })).toBe(600_000);
        expect(resolveSchedulerCustomTimeoutMs({ SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS: '3.5' })).toBe(600_000);
    });
});

describe('resolveSchedulerJobTimeoutMs (task 0806 R3 / 0813 R2)', () => {
    const globalEnv = { SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS: '600000' };

    test("a per-job 'none' overrides a finite global default with explicit unlimited", () => {
        expect(
            resolveSchedulerJobTimeoutMs(
                'nightly',
                { ...globalEnv, SPUR_SCHEDULER_TIMEOUT_NIGHTLY_MS: 'none' },
                600_000,
            ),
        ).toBeNull();
    });

    test('an unlimited global default flows through when the per-job override is absent or invalid', () => {
        expect(resolveSchedulerJobTimeoutMs('n', {}, null)).toBeNull();
        expect(resolveSchedulerJobTimeoutMs('n', { SPUR_SCHEDULER_TIMEOUT_N_MS: 'nope' }, null)).toBeNull();
    });

    test('a valid per-job override beats the global default; invalid keeps it', () => {
        expect(resolveSchedulerJobTimeoutMs('n', { SPUR_SCHEDULER_TIMEOUT_N_MS: '250' }, 600_000)).toBe(250);
        expect(resolveSchedulerJobTimeoutMs('n', { SPUR_SCHEDULER_TIMEOUT_N_MS: '0' }, 600_000)).toBe(600_000);
    });
});

describe('bounded-child timeout containment (task 0803 R1 / 0806 R1 / 0813 R1)', () => {
    // Native contract (task 0813 R1): the executor owns the deadline — this fake
    // simulates that by reporting an `outcome: 'timeout'` result once it observes the
    // forwarded policy, the way the real NodeProcessExecutor reports a deadline kill.
    test('the handler labels the deadline kill in the error and keeps the detail tail', async () => {
        const runs: RecordedRun[] = [];
        const executor = {
            run: async (options: RecordedRun) => {
                runs.push(options);
                return {
                    command: options.command,
                    args: options.args ?? [],
                    exitCode: null,
                    stdout: '',
                    stderr: 'partial output',
                    signal: 'SIGTERM' as const,
                    durationMs: 20,
                    outcome: 'timeout' as const,
                };
            },
        } as unknown as ProcessExecutor;
        await expect(
            handleSchedulerCustomJob(
                { cwd: '/proj', executor, timeoutMs: 20, killGraceMs: 5 },
                jobOf({ name: 'n', command: 'x' }),
            ),
        ).rejects.toThrow(
            /scheduler job "n" timed out after 20ms \(killed after \d+ms elapsed; termination timeout\); shell chain did not complete, so later configured stages did not run and any exit_code in the tail is a subcommand result, not the chain verdict: partial output/,
        );
        // The policy, not a caller watchdog signal, is what the executor received.
        expect(runs[0]?.timeout).toBe(20);
        expect(runs[0]?.signal).toBeUndefined();
    });

    test('a sub-deadline kill keeps the generic terminated message (not a timeout)', async () => {
        const { executor } = fakeExecutor({ exitCode: null, signal: 'SIGTERM', durationMs: 10 });
        const err = (await handleSchedulerCustomJob(
            { cwd: '/proj', executor, timeoutMs: 500, killGraceMs: 5 },
            jobOf({ name: 'n', command: 'x' }),
        ).catch((e: unknown) => e)) as Error;
        expect(err.message).toContain('terminated before a normal exit (SIGTERM)');
        expect(err.message).not.toContain('timed out');
    });
});

describe('handler-level exclusive-key wiring (task 0807 R2)', () => {
    test('two overlapping history producers: the second handler run is rejected naming the first', async () => {
        const gate = Promise.withResolvers<void>();
        const runs: RecordedRun[] = [];
        const executor = {
            run: async (options: RecordedRun) => {
                runs.push(options);
                await gate.promise;
                return {
                    command: options.command,
                    args: options.args ?? [],
                    exitCode: 0,
                    stdout: '',
                    stderr: '',
                    durationMs: 1,
                };
            },
        } as unknown as ProcessExecutor;
        // The first producer holds the key while its child runs.
        const first = handleSchedulerCustomJob(
            { cwd: '/proj', executor },
            jobOf({
                name: 'history-daily-report',
                command: 'bun run x history import',
                exclusiveKey: HISTORY_PRODUCER_EXCLUSIVE_KEY,
            }),
        );
        // The guard acquire is synchronous before the handler's first await, so the
        // key is already held when `first` returns — no yield needed.
        await expect(
            handleSchedulerCustomJob(
                { cwd: '/proj', executor },
                jobOf({
                    name: 'history-nightly',
                    command: 'bun run y history daily',
                    exclusiveKey: HISTORY_PRODUCER_EXCLUSIVE_KEY,
                }),
            ),
        ).rejects.toThrow('history producer "history-daily" is already running (scheduler job "history-daily-report")');
        // The rejected run never spawned a child.
        expect(runs).toHaveLength(1);
        gate.resolve();
        await first;
        // The first run's finally released the key for the next producer.
        expect(isExclusiveJobActive(HISTORY_PRODUCER_EXCLUSIVE_KEY)).toBe(false);
    });
});
