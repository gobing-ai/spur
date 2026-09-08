import type { ProcessExecutor, ProcessResult } from '@gobing-ai/ts-runtime';

/**
 * Caller-owned child containment (task 0806 R1/R5).
 *
 * The 2026-09-08 history-daily-report incident showed that a buffered `executor.run`
 * carrying only `timeout` cannot contain a `/bin/sh -c` chain: the executor's
 * timeout-only path signals the direct child, while a descendant that inherits the
 * output pipes keeps the await alive far past the deadline and holds the SQLite
 * write lock. The released ts-runtime facade (0.4.57) takes the isolated process
 * group path ONLY when an `AbortSignal` is supplied — and its abort escalation is a
 * single group SIGTERM, which a TERM-resistant descendant survives.
 *
 * This module therefore composes the verified shared semantics at the caller:
 *
 * 1. deadline    — an `AbortController` aborts at `timeoutMs`; the executor signals
 *                  the child's whole process group with SIGTERM (detached group).
 * 2. escalation  — `killGraceMs` after the deadline, a group SIGKILL (negative pid)
 *                  reaps descendants that ignored SIGTERM.
 * 3. honesty     — the result carries the configured deadline, the measured elapsed
 *                  time, and the termination reason separately, so a timeout is never
 *                  reported as the configured deadline and child exit codes are never
 *                  read as the chain verdict.
 *
 * ts-runtime owns process-tree facts; this module owns only the job policy of WHEN to
 * abort and escalate. No process engine is duplicated here.
 */

/**
 * Default SIGTERM→SIGKILL escalation grace (task 0806 R1). Five seconds — enough for
 * well-behaved children to flush and exit, short enough that deadline+grace stays
 * inside every queue visibility budget. Documented as the termination grace in
 * `docs/04_DESIGN.md` (scheduler surfaces).
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

/** Options for {@link runBoundedChild} — the command plus its containment policy. */
export interface BoundedChildOptions {
    /** Executable, handed to the executor unchanged. */
    command: string;
    /** Arguments, handed to the executor unchanged. */
    args?: string[];
    /** Child working directory. */
    cwd?: string;
    /** Partial child environment (merged over the parent by the executor). */
    env?: Record<string, string>;
    /** Configured deadline in ms. The abort fires at exactly this boundary. */
    timeoutMs: number;
    /** SIGTERM→SIGKILL escalation grace in ms (default {@link CHILD_KILL_GRACE_MS}). */
    killGraceMs?: number;
    /** Buffered-output cap in bytes. */
    maxOutput?: number;
}

/** Outcome of a bounded child run — result facts plus the containment verdict. */
export interface BoundedChildResult {
    /** The executor's buffered result (exit code, signal, bounded output, duration). */
    result: ProcessResult;
    /** True when the run was still alive at the deadline and was killed by containment. */
    timedOut: boolean;
    /** Configured deadline in ms — what the policy promised. */
    deadlineMs: number;
    /** Measured wall-clock elapsed in ms — what actually happened. */
    elapsedMs: number;
    /** Why the child stopped: normal exit, signal, or the containment kill. */
    terminationReason: 'exit' | 'signal' | 'timeout';
}

/**
 * Kill the detached process group led by `pid` with SIGKILL (task 0806 R1). The
 * negative-pid signal reaches descendants that ignored SIGTERM; when the leader has
 * already been reaped, fall back to the direct pid, then give up silently — a killed
 * group must not turn the escalation itself into an error.
 */
function escalateGroupKill(pid: number | undefined): void {
    if (pid === undefined || process.platform === 'win32') return;
    try {
        process.kill(-pid, 'SIGKILL');
    } catch {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // The group is already gone; nothing left to escalate.
        }
    }
}

/**
 * Run one child under the composed containment policy. See the module comment for
 * why the caller — not the executor's `timeout` option alone — owns the deadline:
 * the executor's timeout path cannot reach detached descendants holding the pipes.
 */
export async function runBoundedChild(
    executor: ProcessExecutor,
    options: BoundedChildOptions,
): Promise<BoundedChildResult> {
    const killGraceMs = options.killGraceMs ?? CHILD_KILL_GRACE_MS;
    const controller = new AbortController();
    let pid: number | undefined;
    let timedOut = false;

    const deadline = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, options.timeoutMs);
    // Escalation is armed only once the abort has fired; a child that exits at the
    // deadline boundary keeps its grace window without delaying a healthy run.
    let escalation: NodeJS.Timeout | undefined;
    controller.signal.addEventListener(
        'abort',
        () => {
            escalation = setTimeout(() => escalateGroupKill(pid), killGraceMs);
        },
        { once: true },
    );

    try {
        const result = await executor.run({
            command: options.command,
            ...(options.args !== undefined ? { args: options.args } : {}),
            ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
            ...(options.env !== undefined ? { env: options.env } : {}),
            timeout: options.timeoutMs,
            ...(options.maxOutput !== undefined ? { maxOutput: options.maxOutput } : {}),
            forceBuffered: true,
            signal: controller.signal,
            onSpawn: (spawned) => {
                pid = spawned;
            },
        });
        const elapsedMs = result.durationMs;
        let terminationReason: BoundedChildResult['terminationReason'];
        if (timedOut) {
            terminationReason = 'timeout';
        } else if (result.exitCode === null) {
            terminationReason = 'signal';
        } else {
            terminationReason = 'exit';
        }
        return { result, timedOut, deadlineMs: options.timeoutMs, elapsedMs, terminationReason };
    } finally {
        clearTimeout(deadline);
        if (escalation !== undefined) clearTimeout(escalation);
    }
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
