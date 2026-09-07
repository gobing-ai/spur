import type { Job } from '@gobing-ai/ts-infra';
import type { ProcessExecutor } from '@gobing-ai/ts-runtime';

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
}

/** Collaborators for {@link handleSchedulerCustomJob}. */
export interface SchedulerCustomJobDeps {
    /** Project root; the command's working directory. */
    cwd: string;
    /** Process seam — one shared `NodeProcessExecutor` in the server. */
    executor: ProcessExecutor;
    /** Override the per-command timeout; defaults to {@link SCHEDULER_CUSTOM_TIMEOUT_MS}. */
    timeoutMs?: number;
}

/**
 * One hour — comfortably under the server queue's two-hour visibility timeout, so a hung
 * command fails its own attempt instead of being re-delivered while still running.
 */
export const SCHEDULER_CUSTOM_TIMEOUT_MS = 3_600_000;

/** Output cap. Buffered, so an unbounded-output command cannot exhaust server memory. */
const SCHEDULER_CUSTOM_MAX_OUTPUT = 1_000_000;

/** Bounded tail of child output used as failure detail on queue events. */
function outputTail(text: string): string {
    const trimmed = text.trim();
    if (trimmed === '') return '';
    return `: ${trimmed.length > 400 ? `…${trimmed.slice(-400)}` : trimmed}`;
}

/**
 * Strict validation at the queue boundary. A drifted or malformed payload must fail the
 * attempt loudly — never fall back to running a defaulted or partially-decoded command.
 */
export function validateSchedulerCustomJobPayload(raw: unknown): SchedulerCustomJobPayload {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('scheduler.custom payload must be a JSON object');
    }
    const { name, command } = raw as Record<string, unknown>;
    if (typeof name !== 'string' || name.trim() === '') {
        throw new Error('scheduler.custom payload name must be a non-empty string');
    }
    if (typeof command !== 'string' || command.trim() === '') {
        // Deliberately does not echo the value — an invalid command is still operator input.
        throw new Error(`scheduler.custom payload for "${name}" must carry a non-empty command string`);
    }
    return { name, command };
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
 */
export async function handleSchedulerCustomJob(deps: SchedulerCustomJobDeps, job: Job<unknown>): Promise<void> {
    const payload = validateSchedulerCustomJobPayload(job.payload);
    if (activeJobs.has(payload.name)) {
        throw new Error(
            `scheduler job "${payload.name}" is already running in this process; skipping duplicate execution`,
        );
    }
    activeJobs.add(payload.name);
    try {
        const result = await deps.executor.run({
            command: '/bin/sh',
            args: ['-c', payload.command],
            cwd: deps.cwd,
            timeout: deps.timeoutMs ?? SCHEDULER_CUSTOM_TIMEOUT_MS,
            maxOutput: SCHEDULER_CUSTOM_MAX_OUTPUT,
            forceBuffered: true,
            // The handler owns the failure message so the command text stays out of it.
            rejectOnError: false,
        });
        // stderr leads; stdout is the fallback for commands that report failure on stdout only.
        const detail = outputTail(result.stderr) || outputTail(result.stdout);
        if (result.exitCode === null) {
            const signalDetail = result.signal === undefined ? '' : ` (${result.signal})`;
            throw new Error(`scheduler job "${payload.name}" terminated before a normal exit${signalDetail}${detail}`);
        }
        if (result.exitCode !== 0) {
            throw new Error(`scheduler job "${payload.name}" exited ${result.exitCode}${detail}`);
        }
    } finally {
        activeJobs.delete(payload.name);
    }
}
