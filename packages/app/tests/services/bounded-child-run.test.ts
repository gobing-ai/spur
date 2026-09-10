import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import {
    createInMemoryProcessRegistry,
    NodeProcessExecutor,
    type ProcessExecutor,
    type ProcessOptions,
    type ProcessResult,
} from '@gobing-ai/ts-runtime';
import {
    type BoundedChildResult,
    CHILD_KILL_GRACE_MS,
    describeBoundedFailure,
    resolveKillGraceMs,
    runBoundedChild,
    terminateJobChildren,
} from '../../src/services/bounded-child-run';

interface RecordedRun {
    timeout: number | null | undefined;
    killGraceMs: number | undefined;
    signal: AbortSignal | undefined;
    forceBuffered: boolean | undefined;
}

function fakeExecutor(run: (options: ProcessOptions, recorded: RecordedRun) => Promise<ProcessResult>): {
    executor: ProcessExecutor;
    runs: RecordedRun[];
    requireRun: (index: number) => RecordedRun;
} {
    const runs: RecordedRun[] = [];
    const executor = {
        run: (options: ProcessOptions) => {
            const recorded: RecordedRun = {
                timeout: options.timeout,
                killGraceMs: options.killGraceMs,
                signal: options.signal,
                forceBuffered: options.forceBuffered,
            };
            runs.push(recorded);
            return run(options, recorded);
        },
    } as unknown as ProcessExecutor;
    return {
        executor,
        runs,
        // Typed accessor: noUncheckedIndexedAccess keeps runs[i] possibly undefined;
        // tests want a loud failure, not a non-null assertion.
        requireRun(index: number): RecordedRun {
            const run = runs[index];
            if (run === undefined) throw new Error(`expected a recorded run at index ${index}`);
            return run;
        },
    };
}

function result(overrides: Partial<ProcessResult> = {}): ProcessResult {
    return {
        command: 'true',
        args: [],
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 5,
        outcome: 'exit',
        ...overrides,
    } as ProcessResult;
}

describe('runBoundedChild native policy forwarding (task 0813 R1)', () => {
    test('forwards the configured policy to the executor and never arms a caller signal', async () => {
        const { executor, runs, requireRun } = fakeExecutor(() => Promise.resolve(result({ durationMs: 4 })));
        const outcome = await runBoundedChild(executor, {
            command: 'true',
            timeoutMs: 500,
            killGraceMs: 5,
        });
        expect(runs).toHaveLength(1);
        expect(requireRun(0).timeout).toBe(500);
        expect(requireRun(0).killGraceMs).toBe(5);
        expect(requireRun(0).forceBuffered).toBe(true);
        // The caller watchdog is gone: no AbortSignal is raced against the native timer.
        expect(requireRun(0).signal).toBeUndefined();
        expect(outcome.timedOut).toBe(false);
        expect(outcome.terminationReason).toBe('exit');
        expect(outcome.deadlineMs).toBe(500);
        expect(outcome.elapsedMs).toBe(4);
    });

    test('an explicit unlimited policy forwards timeout null — never an inherited default', async () => {
        const { executor, requireRun } = fakeExecutor(() => Promise.resolve(result()));
        const outcome = await runBoundedChild(executor, { command: 'true', timeoutMs: null });
        // Explicit null (not undefined) so the executor runs without a deadline instead of
        // inheriting ProcessExecutorConfig.defaultTimeout — the hidden-timer regression.
        expect(requireRun(0).timeout).toBeNull();
        // killGraceMs omitted → the executor's own 5000ms default applies.
        expect(requireRun(0).killGraceMs).toBeUndefined();
        expect(outcome.timedOut).toBe(false);
        expect(outcome.deadlineMs).toBeNull();
        expect(outcome.terminationReason).toBe('exit');
    });

    test('classifies an outcome-timeout result as a timeout without any caller timing', async () => {
        const { executor } = fakeExecutor(() => Promise.resolve(result({ outcome: 'timeout', durationMs: 25 })));
        const outcome = await runBoundedChild(executor, {
            command: 'sleep',
            args: ['30'],
            timeoutMs: 20,
            killGraceMs: 5,
        });
        expect(outcome.timedOut).toBe(true);
        expect(outcome.terminationReason).toBe('timeout');
        expect(outcome.deadlineMs).toBe(20);
        expect(outcome.elapsedMs).toBe(25);
    });

    test('classifies a legacy-shaped signal result (no outcome field) as signal, not timeout', async () => {
        const { executor } = fakeExecutor(() =>
            Promise.resolve(result({ exitCode: null, signal: 'SIGKILL', outcome: undefined })),
        );
        const outcome = await runBoundedChild(executor, { command: 'sleep', args: ['30'], timeoutMs: 500 });
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

describe('runBoundedChild native containment (task 0806 R1 / 0813 R1)', () => {
    test('SIGTERM-resistant descendant is reaped by the executor-owned group SIGKILL escalation', async () => {
        // Real child that ignores SIGTERM: only the executor's negative-pid escalation
        // (armed by its own finite timeout) can stop it — the native replacement for the
        // removed caller watchdog.
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

describe('terminateJobChildren (Sep 2026 orphan fix)', () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const assertDead = (pid: number): void => {
        let alive = true;
        try {
            process.kill(pid, 0);
        } catch {
            alive = false;
        }
        expect(alive).toBe(false);
    };

    test('kills a group-owned child (finite deadline → detached) via its process group', async () => {
        const registry = createInMemoryProcessRegistry();
        const executor = new NodeProcessExecutor({ registry });
        // Finite timeout → the executor spawns detached/group-owned, exactly like
        // every scheduler.custom / history-refresh job run in production.
        const run = executor.run({ command: 'sh', args: ['-c', 'sleep 30'], cwd: tmpdir(), timeout: 60_000 });
        await sleep(300);
        const running = registry.listExecutions({ running: true });
        expect(running).toHaveLength(1);
        const pid = running[0]?.pid;
        if (pid === undefined) throw new Error('child never registered a pid');

        expect(terminateJobChildren(registry, 'SIGTERM')).toEqual([pid]);
        await run;
        assertDead(pid as number);
    });

    test('signals a plain (non-group) child directly when no process group exists', async () => {
        const registry = createInMemoryProcessRegistry();
        const executor = new NodeProcessExecutor({ registry });
        // No timeout → not detached → shares our group → kill(-pid) must not be
        // attempted; the pid itself is signaled. `exec` pins the pid to the sleeper:
        // without it, whether the shell tail-execs or forks+waits is implementation-
        // defined, and a forked shell leaves `sleep` orphaned holding the inherited
        // stdio pipes, so the run promise never settles (CI hang, Sep 2026).
        const run = executor.run({ command: 'sh', args: ['-c', 'exec sleep 30'], cwd: tmpdir() });
        await sleep(300);
        const pid = registry.listExecutions({ running: true })[0]?.pid;
        if (pid === undefined) throw new Error('child never registered a pid');

        expect(terminateJobChildren(registry, 'SIGTERM')).toEqual([pid]);
        await run;
        assertDead(pid as number);
    });

    test('returns [] when nothing is running (no phantom pids)', () => {
        const registry = createInMemoryProcessRegistry();
        expect(terminateJobChildren(registry, 'SIGTERM')).toEqual([]);
    });
});
