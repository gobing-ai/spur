import { describe, expect, test } from 'bun:test';
import { NodeProcessExecutor, type ProcessExecutor, type ProcessResult } from '@gobing-ai/ts-runtime';
import {
    type BoundedChildResult,
    CHILD_KILL_GRACE_MS,
    describeBoundedFailure,
    resolveKillGraceMs,
    runBoundedChild,
} from '../../src/services/bounded-child-run';

function fakeExecutor(
    run: (options: { signal: AbortSignal; onSpawn?: (pid: number) => void }) => Promise<ProcessResult>,
): ProcessExecutor {
    return {
        run: (options: { signal: AbortSignal }) => run(options),
    } as unknown as ProcessExecutor;
}

function result(overrides: Partial<ProcessResult> = {}): ProcessResult {
    return {
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        durationMs: 5,
        ...overrides,
    } as ProcessResult;
}

describe('runBoundedChild (task 0806 R1)', () => {
    test('normal exit reports exit termination with the promised deadline', async () => {
        const outcome = await runBoundedChild(
            fakeExecutor((options) => {
                expect(options.signal.aborted).toBe(false);
                return Promise.resolve(result({ durationMs: 4 }));
            }),
            { command: 'true', timeoutMs: 500, killGraceMs: 5 },
        );
        expect(outcome.timedOut).toBe(false);
        expect(outcome.terminationReason).toBe('exit');
        expect(outcome.deadlineMs).toBe(500);
        expect(outcome.elapsedMs).toBe(4);
    });

    test('deadline abort fires the signal and classifies the run as a timeout', async () => {
        const outcome = await runBoundedChild(
            fakeExecutor(
                (options) =>
                    new Promise<ProcessResult>((resolve) => {
                        const t0 = Date.now();
                        options.signal.addEventListener(
                            'abort',
                            () => resolve(result({ exitCode: null, signal: 'SIGTERM', durationMs: Date.now() - t0 })),
                            { once: true },
                        );
                    }),
            ),
            { command: 'sleep', args: ['30'], timeoutMs: 20, killGraceMs: 5 },
        );
        expect(outcome.timedOut).toBe(true);
        expect(outcome.terminationReason).toBe('timeout');
        expect(outcome.deadlineMs).toBe(20);
        expect(outcome.elapsedMs).toBeGreaterThanOrEqual(20);
    });

    test('a child killed by an external signal is reported as signal, not timeout', async () => {
        const outcome = await runBoundedChild(
            fakeExecutor(() => Promise.resolve(result({ exitCode: null, signal: 'SIGKILL' }))),
            { command: 'sleep', args: ['30'], timeoutMs: 500, killGraceMs: 5 },
        );
        expect(outcome.timedOut).toBe(false);
        expect(outcome.terminationReason).toBe('signal');
    });

    test('describeBoundedFailure separates deadline, elapsed, and reason, and flags the tail', () => {
        const outcome = {
            result: result({ exitCode: 0 }),
            timedOut: true,
            deadlineMs: 300,
            elapsedMs: 302,
            terminationReason: 'timeout',
        } as BoundedChildResult;
        expect(describeBoundedFailure({ subject: 'scheduler job "x"', outcome, outputTail: '' })).toBe(
            'scheduler job "x" timed out after 300ms (killed after 302ms elapsed; termination timeout)',
        );
        const withTail = describeBoundedFailure({ subject: 'job', outcome, outputTail: 'exit_code: 0' });
        expect(withTail).toContain('exit_code in the tail is a subcommand result, not the chain verdict: exit_code: 0');
    });
});

describe('resolveKillGraceMs (task 0806 R1)', () => {
    test('falls back to the default for absent, blank, and invalid overrides', () => {
        expect(resolveKillGraceMs({})).toBe(CHILD_KILL_GRACE_MS);
        expect(resolveKillGraceMs({ SPUR_SCHEDULER_KILL_GRACE_MS: '' })).toBe(CHILD_KILL_GRACE_MS);
        expect(resolveKillGraceMs({ SPUR_SCHEDULER_KILL_GRACE_MS: 'nope' })).toBe(CHILD_KILL_GRACE_MS);
        expect(resolveKillGraceMs({ SPUR_SCHEDULER_KILL_GRACE_MS: '-1' })).toBe(CHILD_KILL_GRACE_MS);
        expect(resolveKillGraceMs({ SPUR_SCHEDULER_KILL_GRACE_MS: '250' })).toBe(250);
    });
});

describe('runBoundedChild escalation (task 0806 R1)', () => {
    test('SIGTERM-resistant descendant is reaped by the group SIGKILL escalation', async () => {
        // Real child that ignores SIGTERM: only the negative-pid escalation can stop it.
        const resistant = ['-e', "process.on('SIGTERM', () => {}); setTimeout(() => {}, 60_000);"];
        const outcome = await runBoundedChild(new NodeProcessExecutor(), {
            command: process.execPath,
            args: resistant,
            timeoutMs: 20,
            killGraceMs: 30,
        });
        expect(outcome.timedOut).toBe(true);
        expect(outcome.terminationReason).toBe('timeout');
        expect(outcome.deadlineMs).toBe(20);
        // Deadline + SIGTERM + grace escalation all fit well under a second.
        expect(outcome.elapsedMs).toBeLessThan(1000);
    });
});
