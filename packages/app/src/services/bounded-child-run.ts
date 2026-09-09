import type { ProcessExecutor, ProcessResult } from '@gobing-ai/ts-runtime';
import type { TimeoutPolicyMs } from './execution-policy';

/**
 * Native execution policy adoption (task 0813 R1, feature A21, ADR-112).
 *
 * This module owns only the JOB POLICY facts around one child run — the
 * configured deadline, the measured elapsed time, and the termination verdict.
 * The deadline itself is native: the released `@gobing-ai/ts-runtime` facade
 * (0.4.59, task 0810) activates owned process-group containment for any finite
 * `timeout` — it arms its own timer, signals the whole owned group with SIGTERM
 * at expiry, and escalates to a group SIGKILL after `killGraceMs`, reaping
 * detached descendants that inherited the output pipes. Explicit `null` runs
 * without a deadline. Callers must not race a second watchdog: the historical
 * caller-side AbortController + negative-pid escalation composition is removed
 * because the executor's 0.4.57 timeout-only path it worked around no longer
 * exists.
 *
 * Honesty stays a caller concern: the result carries the configured deadline,
 * the measured elapsed time, and the termination reason separately (from the
 * executor's `outcome` classification), so a timeout is never reported as the
 * configured deadline and child exit codes are never read as the chain verdict.
 */

/**
 * Default SIGTERM→SIGKILL escalation grace (task 0806 R1). Five seconds — enough for
 * well-behaved children to flush and exit, short enough that deadline+grace stays
 * inside every queue visibility budget. Documented as the termination grace in
 * `docs/04_DESIGN.md` (scheduler surfaces). Forwarded to the executor's native
 * escalation; the runtime validates the value before spawn.
 */
export const CHILD_KILL_GRACE_MS = 5_000;

/**
 * Resolve the termination grace from the environment (task 0806 R1). Accepted: a
 * positive integer number of milliseconds. Absent or invalid values fall back to
 * {@link CHILD_KILL_GRACE_MS} — a bad override must never disable the escalation.
 */
export function resolveKillGraceMs(env: Record<string, string | undefined>): number {
    const raw = env.SPUR_SCHEDULER_KILL_GRACE_MS;
    if (raw === undefined || raw.trim() === '') return CHILD_KILL_GRACE_MS;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : CHILD_KILL_GRACE_MS;
}

/** Options for {@link runBoundedChild} — the command plus its execution policy. */
export interface BoundedChildOptions {
    /** Executable, handed to the executor unchanged. */
    command: string;
    /** Arguments, handed to the executor unchanged. */
    args?: string[];
    /** Child working directory. */
    cwd?: string;
    /** Partial child environment (merged over the parent by the executor). */
    env?: Record<string, string>;
    /**
     * Native execution deadline in ms, or `null` for explicit unlimited (task
     * 0813 R2 — no hidden default timer is restored). Forwarded to the
     * executor's `timeout` option, which validates it before spawn and owns
     * group containment when finite.
     */
    timeoutMs: TimeoutPolicyMs;
    /** SIGTERM→SIGKILL escalation grace in ms (default {@link CHILD_KILL_GRACE_MS}). */
    killGraceMs?: number;
    /** Buffered-output cap in bytes. */
    maxOutput?: number;
}

/** Outcome of a bounded child run — result facts plus the termination verdict. */
export interface BoundedChildResult {
    /** The executor's buffered result (exit code, signal, bounded output, duration). */
    result: ProcessResult;
    /** True when the run was still alive at the deadline and native containment killed it. */
    timedOut: boolean;
    /** Configured deadline in ms — what the policy promised (`null` when unlimited). */
    deadlineMs: TimeoutPolicyMs;
    /** Measured wall-clock elapsed in ms — what actually happened. */
    elapsedMs: number;
    /** Why the child stopped: normal exit, signal, or the native containment kill. */
    terminationReason: 'exit' | 'signal' | 'timeout';
}

/**
 * Run one child under the resolved native execution policy. The executor's
 * `timeout`/`killGraceMs` options own the deadline and process-tree cleanup;
 * this wrapper classifies the outcome so a timeout, an outside signal, and a
 * normal exit stay distinguishable in job verdicts.
 */
export async function runBoundedChild(
    executor: ProcessExecutor,
    options: BoundedChildOptions,
): Promise<BoundedChildResult> {
    const result = await executor.run({
        command: options.command,
        ...(options.args !== undefined ? { args: options.args } : {}),
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        ...(options.env !== undefined ? { env: options.env } : {}),
        // Native policy (task 0813 R1): the executor validates and owns the
        // deadline — explicit null is unlimited; a finite value activates owned
        // process-group containment with killGraceMs escalation.
        timeout: options.timeoutMs,
        ...(options.killGraceMs !== undefined ? { killGraceMs: options.killGraceMs } : {}),
        ...(options.maxOutput !== undefined ? { maxOutput: options.maxOutput } : {}),
        forceBuffered: true,
    });
    const elapsedMs = result.durationMs;
    let terminationReason: BoundedChildResult['terminationReason'];
    if (result.outcome === 'timeout') {
        terminationReason = 'timeout';
    } else if (result.exitCode === null) {
        terminationReason = 'signal';
    } else {
        terminationReason = 'exit';
    }
    return {
        result,
        timedOut: terminationReason === 'timeout',
        deadlineMs: options.timeoutMs,
        elapsedMs,
        terminationReason,
    };
}

/**
 * Build the bounded failure detail for a killed or failed scheduler-style job
 * (task 0806 R5): the configured deadline, the measured elapsed time, and the
 * termination reason are named separately, and the tail carries an explicit note
 * that child exit codes inside a timed-out chain are subcommand results — never
 * the whole-job verdict (the incident's misleading `exit_code: 0`).
 */
export function describeBoundedFailure(parts: {
    subject: string;
    outcome: BoundedChildResult;
    outputTail: string;
}): string {
    const { subject, outcome, outputTail } = parts;
    const base =
        `${subject} timed out after ${outcome.deadlineMs}ms ` +
        `(killed after ${Math.round(outcome.elapsedMs)}ms elapsed; ` +
        `termination ${outcome.terminationReason})`;
    if (outputTail === '') return base;
    return (
        `${base}; shell chain did not complete, so later configured stages did not run ` +
        `and any exit_code in the tail is a subcommand result, not the chain verdict: ${outputTail}`
    );
}
