import type { Job } from '@gobing-ai/ts-infra';
import type { ProcessExecutor } from '@gobing-ai/ts-runtime';
import {
    type BoundedChildResult,
    CHILD_KILL_GRACE_MS,
    describeBoundedFailure,
    runBoundedChild,
} from './bounded-child-run';
import { normalizeLegacyTimeoutMs, type TimeoutPolicyMs } from './execution-policy';
import { acquireExclusiveJob, releaseExclusiveJob } from './job-exclusion-guard';

export type { BoundedChildResult };
// Re-exported so server wiring and tests resolve the containment policy from one module.
export { CHILD_KILL_GRACE_MS, describeBoundedFailure, runBoundedChild };

/**
 * Configured scheduler command execution (task 0734).
 *
 * `bootstrap.scheduler.jobs` entries are validated upstream by ts-infra and registered
 * in `spur serve` as ordinary scheduler entries. A tick does not run anything itself —
 * it enqueues one `scheduler.custom` job carrying `{ name, command }` (R5), and this
 * handler is the queue-side consumer that actually spawns the command (R6).
 *
 * The command is trusted operator input from the project's own config file, so it is
 * handed to `/bin/sh -c` verbatim rather than tokenized. It is never logged: only the
 * job name and a bounded output tail reach queue events, so a command carrying a
 * credential does not leak into System Events.
 */

/** Queue job kind for a configured `bootstrap.scheduler.jobs` entry. */
export const SCHEDULER_CUSTOM_JOB = 'scheduler.custom';

/** Payload of a `scheduler.custom` queue job. */
export interface SchedulerCustomJobPayload {
    /** Configured job name — the only command-identifying value safe to report. */
    name: string;
    /** Shell command line, run through `/bin/sh -c`. Never logged. */
    command: string;
    /**
     * Cross-kind exclusion key (task 0806 R6): when a configured command touches a
     * shared producer (e.g. `history daily`/`history import`), the enqueue side
     * stamps `history-daily` so the handler cannot overlap the completion-triggered
     * `history.refresh` importer. Advisory, same-process; validated strictly.
     */
    exclusiveKey?: string;
}

/** Collaborators for {@link handleSchedulerCustomJob}. */
export interface SchedulerCustomJobDeps {
    /** Project root; the command's working directory. */
    cwd: string;
    /** Process seam — one shared `NodeProcessExecutor` in the server. */
    executor: ProcessExecutor;
    /**
     * Per-command execution policy: a finite deadline, or `null` for explicit
     * unlimited (task 0813 R2 — no hidden ten-minute timer is restored).
     * Defaults to {@link SCHEDULER_CUSTOM_TIMEOUT_MS}.
     */
    timeoutMs?: TimeoutPolicyMs;
    /**
     * Per-job policy resolver (task 0806 R3): receives the configured job name and
     * returns the effective deadline or explicit unlimited. The server wires
     * {@link resolveSchedulerJobTimeoutMs} over the boot environment; omitted → every
     * job gets `timeoutMs`.
     */
    resolveTimeoutMs?: (name: string) => TimeoutPolicyMs;
    /** SIGTERM→SIGKILL escalation grace; defaults to {@link CHILD_KILL_GRACE_MS}. */
    killGraceMs?: number;
}

/**
 * Ten minutes (task 0803 R1) — ~6× the observed healthy `history daily` runtime (83–110s), and
 * comfortably under the server queue's two-hour visibility timeout, so a hung command fails its
 * own attempt instead of being re-delivered while still running. A wedged child is killed at the
 * deadline (SIGTERM, then SIGKILL after the executor's grace) instead of pinning the shared
 * SQLite write lock for an hour.
 */
export const SCHEDULER_CUSTOM_TIMEOUT_MS = 600_000;

/**
 * Resolve the scheduler.custom child execution policy from the environment (task 0803 R1;
 * `none` → explicit unlimited since task 0813 R2). Accepted: a positive integer number of
 * milliseconds, or `none`. Absent or invalid values fall back to
 * {@link SCHEDULER_CUSTOM_TIMEOUT_MS} — a bad override must never disable the deadline by
 * accident. Resolved once at daemon boot; follows the ad-hoc env convention
 * (`SPUR_TEAM_AUTOSTART`, `SPUR_SKIP_GLOBAL_CONFIG`).
 */
export function resolveSchedulerCustomTimeoutMs(env: Record<string, string | undefined>): TimeoutPolicyMs {
    return normalizeLegacyTimeoutMs(env.SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS, SCHEDULER_CUSTOM_TIMEOUT_MS);
}

/**
 * Env var name for a per-job scheduler.custom budget (task 0806 R3):
 * `SPUR_SCHEDULER_TIMEOUT_<JOB_NAME_SNAKE>_MS`, e.g. `history-daily-report` →
 * `SPUR_SCHEDULER_TIMEOUT_HISTORY_DAILY_REPORT_MS`. The GLOBAL
 * `SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS` stays the default for every other configured
 * job (including the 15-minute `history-refresh` entry, which must keep its short
 * watchdog); only a named long chain gets a larger validated total. Reconciling at
 * the existing env-override ownership — not by raising the global constant — is the
 * task 0806 R3 ruling.
 */
export function schedulerJobTimeoutEnvName(name: string): string {
    const snake = name
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([^A-Za-z0-9]+)/g, '_')
        .toUpperCase()
        .replace(/^_+|_+$/g, '');
    return `SPUR_SCHEDULER_TIMEOUT_${snake}_MS`;
}

/**
 * Resolve the effective policy for one configured job (task 0806 R3): the per-job
 * override when present and valid, else the global default. `none` maps to explicit
 * unlimited (task 0813 R2); invalid values fall back rather than disabling the
 * deadline, mirroring {@link resolveSchedulerCustomTimeoutMs}.
 */
export function resolveSchedulerJobTimeoutMs(
    name: string,
    env: Record<string, string | undefined>,
    fallbackMs: TimeoutPolicyMs,
): TimeoutPolicyMs {
    return normalizeLegacyTimeoutMs(env[schedulerJobTimeoutEnvName(name)], fallbackMs);
}

/** Output cap. Buffered, so an unbounded-output command cannot exhaust server memory. */
const SCHEDULER_CUSTOM_MAX_OUTPUT = 1_000_000;

/** Bounded tail of child output used as failure detail on queue events (no
 * separator — call sites compose their own `: ` so the timeout path can embed
 * the tail verbatim in {@link describeBoundedFailure}). */
function outputTail(text: string): string {
    const trimmed = text.trim();
    if (trimmed === '') return '';
    return trimmed.length > 400 ? `…${trimmed.slice(-400)}` : trimmed;
}

/**
 * Strict validation at the queue boundary. A drifted or malformed payload must fail the
 * attempt loudly — never fall back to running a defaulted or partially-decoded command.
 */
export function validateSchedulerCustomJobPayload(raw: unknown): SchedulerCustomJobPayload {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('scheduler.custom payload must be a JSON object');
    }
    const { name, command, exclusiveKey } = raw as Record<string, unknown>;
    if (typeof name !== 'string' || name.trim() === '') {
        throw new Error('scheduler.custom payload name must be a non-empty string');
    }
    if (typeof command !== 'string' || command.trim() === '') {
        // Deliberately does not echo the value — an invalid command is still operator input.
        throw new Error(`scheduler.custom payload for "${name}" must carry a non-empty command string`);
    }
    if (exclusiveKey !== undefined && (typeof exclusiveKey !== 'string' || exclusiveKey.trim() === '')) {
        throw new Error(`scheduler.custom payload for "${name}" carries an invalid exclusiveKey`);
    }
    return {
        name,
        command,
        ...(exclusiveKey !== undefined ? { exclusiveKey } : {}),
    };
}

/**
 * In-process concurrency guard: prevents two queue workers from executing the same
 * scheduler job name concurrently. Without this, duplicate queue rows (which the
 * single-flight enqueue guard now prevents, but may exist from prior runs) would
 * spawn parallel child processes competing for the SQLite write lock.
 */
const activeJobs = new Set<string>();

/**
 * Run one configured scheduler command. Exit code is the entire success verdict: a spawn
 * failure, timeout, signal, or non-zero exit throws so the queue records a failed attempt
 * and applies its existing retry policy. Success returns silently — no output is emitted.
 *
 * Containment is native (task 0813 R1): the executor's finite `timeout` owns
 * process-group containment — SIGTERM at the deadline, group SIGKILL after the
 * termination grace — while {@link runBoundedChild} preserves deadline vs.
 * measured elapsed vs. termination reason in the failure message (R5).
 */
export async function handleSchedulerCustomJob(deps: SchedulerCustomJobDeps, job: Job<unknown>): Promise<void> {
    const payload = validateSchedulerCustomJobPayload(job.payload);
    if (activeJobs.has(payload.name)) {
        throw new Error(
            `scheduler job "${payload.name}" is already running in this process; skipping duplicate execution`,
        );
    }
    const exclusiveKey = payload.exclusiveKey;
    if (exclusiveKey !== undefined) {
        acquireExclusiveJob(exclusiveKey, `scheduler job "${payload.name}"`);
    }
    activeJobs.add(payload.name);
    // Task 0813 R2: ABSENT (undefined) falls through the chain; EXPLICIT UNLIMITED
    // (null) must survive it — `??` would silently restore the ten-minute default
    // timer the operator turned off.
    const resolvedPerJob = deps.resolveTimeoutMs?.(payload.name);
    const timeoutMs: TimeoutPolicyMs =
        resolvedPerJob !== undefined
            ? resolvedPerJob
            : deps.timeoutMs !== undefined
              ? deps.timeoutMs
              : SCHEDULER_CUSTOM_TIMEOUT_MS;
    try {
        const outcome = await runBoundedChild(deps.executor, {
            command: '/bin/sh',
            args: ['-c', payload.command],
            cwd: deps.cwd,
            timeoutMs,
            ...(deps.killGraceMs !== undefined ? { killGraceMs: deps.killGraceMs } : {}),
            maxOutput: SCHEDULER_CUSTOM_MAX_OUTPUT,
        });
        const { result } = outcome;
        // stderr leads; stdout is the fallback for commands that report failure on stdout only.
        const detail = outputTail(result.stderr) || outputTail(result.stdout);
        if (outcome.timedOut) {
            throw new Error(
                describeBoundedFailure({ subject: `scheduler job "${payload.name}"`, outcome, outputTail: detail }),
            );
        }
        if (result.exitCode === null) {
            const signalDetail = result.signal === undefined ? '' : ` (${result.signal})`;
            throw new Error(
                `scheduler job "${payload.name}" terminated before a normal exit${signalDetail} ` +
                    `after ${Math.round(outcome.elapsedMs)}ms${detail && `: ${detail}`}`,
            );
        }
        if (result.exitCode !== 0) {
            throw new Error(`scheduler job "${payload.name}" exited ${result.exitCode}${detail && `: ${detail}`}`);
        }
    } finally {
        activeJobs.delete(payload.name);
        if (exclusiveKey !== undefined) releaseExclusiveJob(exclusiveKey, `scheduler job "${payload.name}"`);
    }
}
