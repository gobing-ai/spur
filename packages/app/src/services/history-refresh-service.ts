import type { SpurConfig } from '@gobing-ai/spur-config';
import { type HistoryRefreshTriggerConfig, resolveHistoryRefreshTrigger } from '@gobing-ai/spur-config';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import { enqueueCoalesced } from '@gobing-ai/spur-domain';
import type { Job } from '@gobing-ai/ts-infra';
import type { ProcessExecutor } from '@gobing-ai/ts-runtime';
import { splitLaunchCommand } from '../workflow/split-launch-command';

/**
 * Completion-triggered history refresh (task 0549).
 *
 * `spur history daily` is bound to a clock; this adds a second trigger bound to **work
 * completing** (task → done, pipeline run reaching terminal status). The trigger never
 * runs the refresh inline — it puts ONE coalesced job on the feature-A2 embedded job
 * queue and returns (R1). Bursts inside the debounce window join the pending job instead
 * of adding a second (R2), the trigger is opt-in config with observable firing (R3), the
 * debounce default follows task 0548's measured figures (R4), and since task 0717 the job
 * body runs `spur history daily` in an isolated child process (import fan-out + analyze +
 * artifact write) instead of executing `HistoryService.daily` in the server process.
 */

/** Built-in queue job kind for the coalesced completion-triggered history refresh. */
export const HISTORY_REFRESH_JOB = 'history.refresh';

/** Named completion points that may fire the trigger — never "every CLI invocation".
 * `'schedule'` is retired as a live trigger (task 0750) but stays in the union so
 * queue rows and System Events persisted by the old interval path still validate. */
export type HistoryRefreshTriggerPoint = 'task-done' | 'pipeline-run' | 'manual' | 'schedule';

/** Payload of a `history.refresh` queue job. */
export interface HistoryRefreshPayload {
    /** Which completion point first fired the trigger for this burst. */
    trigger: HistoryRefreshTriggerPoint;
    /** WBS or run id of that completion — informational only. */
    triggerId: string | null;
    /** Epoch ms of the EARLIEST completion in the coalesced burst. */
    windowStart: number;
    /** Epoch ms of the LATEST completion in the coalesced burst. */
    windowEnd: number;
    /** Manual board refresh mode; completion-triggered refreshes default to incremental. */
    importMode?: 'full' | 'incremental';
}

/** Outcome of {@link enqueueHistoryRefresh}. */
export type HistoryRefreshEnqueueResult =
    | { status: 'disabled' }
    | { status: 'enqueued'; jobId: string; payload: HistoryRefreshPayload }
    | { status: 'coalesced'; jobId: string; payload: HistoryRefreshPayload }
    | { status: 'already-running'; jobId: string; payload: HistoryRefreshPayload };

/** Options for {@link enqueueHistoryRefresh}. */
export interface HistoryRefreshEnqueueOptions {
    /** Raw project config (`history.refresh` resolved through schema defaults). */
    config: Pick<SpurConfig, 'history'> | null;
    /** Completion point that fired. */
    trigger: HistoryRefreshTriggerPoint;
    /** WBS (task-done) or run id (pipeline-run) — informational. */
    triggerId?: string;
    /** Explicit import mode for manual/schedule refreshes; omitted → job default (incremental). */
    importMode?: 'full' | 'incremental';
    /** Clock seam for deterministic tests (default `Date.now`). */
    now?: () => number;
}

function parsePayload(raw: unknown): HistoryRefreshPayload {
    const candidate = (typeof raw === 'string' ? safeJsonParse(raw) : raw) as Partial<HistoryRefreshPayload> | null;
    const trigger: HistoryRefreshTriggerPoint =
        candidate?.trigger === 'task-done' ||
        candidate?.trigger === 'pipeline-run' ||
        candidate?.trigger === 'manual' ||
        candidate?.trigger === 'schedule'
            ? candidate.trigger
            : 'task-done';
    return {
        trigger,
        triggerId: typeof candidate?.triggerId === 'string' ? candidate.triggerId : null,
        windowStart: typeof candidate?.windowStart === 'number' ? candidate.windowStart : 0,
        windowEnd: typeof candidate?.windowEnd === 'number' ? candidate.windowEnd : 0,
        ...(candidate?.importMode === 'full' || candidate?.importMode === 'incremental'
            ? { importMode: candidate.importMode }
            : {}),
    };
}

function safeJsonParse(raw: string): Partial<HistoryRefreshPayload> | null {
    try {
        return JSON.parse(raw) as Partial<HistoryRefreshPayload>;
    } catch {
        return null;
    }
}

/** Env var carrying the validated refresh payload across the child-process boundary (task 0717). */
export const HISTORY_REFRESH_CONTEXT_ENV = 'SPUR_HISTORY_REFRESH_CONTEXT';

/**
 * Bound on accepted child output; a child that exceeds it fails the attempt instead of
 * growing memory. The child prints the human daily summary (~1 KB), never the `--json`
 * envelope — that one embeds the whole analyze artifact, which grows without bound with
 * the imported corpus (its `loops` section alone passed 2 MB on 2026-08-30) and would be
 * silently truncated here, then rejected as "invalid JSON".
 */
const HISTORY_REFRESH_MAX_OUTPUT = 1_000_000;

/** Bounded tail of child output used as failure detail on queue events. */
function outputTail(text: string): string {
    const trimmed = text.trim();
    if (trimmed === '') return '';
    return `: ${trimmed.length > 400 ? `…${trimmed.slice(-400)}` : trimmed}`;
}

/**
 * Strict validation of the refresh payload at the queue/child boundary. Unlike the
 * enqueue-side `parsePayload` (which silently defaults for payload joins), a drifted
 * or malformed payload must fail the queue attempt loudly instead of refreshing with
 * fabricated trigger/window metadata.
 */
export function validateHistoryRefreshPayload(raw: unknown): HistoryRefreshPayload {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('history refresh payload must be a JSON object');
    }
    const candidate = raw as Record<string, unknown>;
    const { trigger, triggerId, windowStart, windowEnd, importMode } = candidate;
    if (trigger !== 'task-done' && trigger !== 'pipeline-run' && trigger !== 'manual' && trigger !== 'schedule') {
        throw new Error(`history refresh payload has invalid trigger: ${JSON.stringify(trigger)}`);
    }
    if (triggerId !== null && typeof triggerId !== 'string') {
        throw new Error(`history refresh payload has invalid triggerId: ${JSON.stringify(triggerId)}`);
    }
    if (typeof windowStart !== 'number' || !Number.isFinite(windowStart)) {
        throw new Error('history refresh payload windowStart must be a finite number');
    }
    if (typeof windowEnd !== 'number' || !Number.isFinite(windowEnd)) {
        throw new Error('history refresh payload windowEnd must be a finite number');
    }
    if (importMode !== undefined && importMode !== 'full' && importMode !== 'incremental') {
        throw new Error(`history refresh payload has invalid importMode: ${JSON.stringify(importMode)}`);
    }
    return {
        trigger,
        triggerId,
        windowStart,
        windowEnd,
        ...(importMode !== undefined ? { importMode } : {}),
    };
}

/**
 * Parse the internal refresh context handed to a child `history daily` process.
 * Returns null when absent/empty so the interactive CLI path is unchanged; throws on
 * malformed JSON or shape so the child fails BEFORE any import runs (0717 plan step 1).
 */
export function parseHistoryRefreshContext(raw: string | undefined): HistoryRefreshPayload | null {
    if (raw === undefined || raw === '') return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(
            `${HISTORY_REFRESH_CONTEXT_ENV} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
    return validateHistoryRefreshPayload(parsed);
}

/**
 * The trigger itself (R1/R2/R3): check the opt-in config, then enqueue ONE coalesced
 * job through the embedded queue and return — never run the refresh here. This is two
 * queue-table statements (one lookup, one insert/update); the firing operation's
 * elapsed time is unaffected. Disabled config short-circuits before any DB access.
 */
export async function enqueueHistoryRefresh(
    db: DbAdapter,
    options: HistoryRefreshEnqueueOptions,
): Promise<HistoryRefreshEnqueueResult> {
    const triggerConfig = resolveHistoryRefreshTrigger(options.config);
    // Manual refreshes are explicit user intent — never gated; completion triggers
    // stay behind the on_completion opt-in. One gate, before any DB access. Periodic
    // refreshes are no longer a trigger here (task 0750): they are declared as a
    // `bootstrap.scheduler.jobs` entry that runs `spur history daily` directly.
    // `'schedule'` survives only as a payload value so persisted rows still validate.
    let enabled = triggerConfig.onCompletion;
    if (options.trigger === 'manual') enabled = true;
    if (!enabled) return { status: 'disabled' };
    const now = options.now?.() ?? Date.now();
    // Manual and scheduled refreshes are user-facing "run it now" requests: a fresh
    // job becomes due immediately, and joining one only SHORTENS the pending due
    // time — a due burst is never delayed behind the debounce window (0716 R2).
    const immediate = options.trigger === 'manual' || options.trigger === 'schedule';
    const incoming: HistoryRefreshPayload = {
        trigger: options.trigger,
        triggerId: options.triggerId ?? null,
        windowStart: now,
        windowEnd: now,
        ...(options.importMode !== undefined ? { importMode: options.importMode } : {}),
    };
    const result = await enqueueCoalesced(db, {
        type: HISTORY_REFRESH_JOB,
        payload: incoming,
        debounceMs: triggerConfig.debounceMs,
        immediate,
        now: options.now,
        // Join the burst: keep the earliest windowStart, extend windowEnd to the latest
        // completion so the covered window spans the whole burst (R2). Trigger identity
        // stays with the FIRST producer; `full` dominates the import mode, and an
        // explicit mode on either side survives a join with a payload that lacks one.
        mergePayload: (existing, next) => {
            const prev = parsePayload(existing);
            const curr = parsePayload(next);
            const importMode =
                prev.importMode === 'full' || curr.importMode === 'full'
                    ? 'full'
                    : (prev.importMode ?? curr.importMode);
            return {
                trigger: prev.trigger,
                triggerId: prev.triggerId,
                windowStart: Math.min(prev.windowStart, curr.windowStart),
                windowEnd: Math.max(prev.windowEnd, curr.windowEnd),
                ...(importMode !== undefined ? { importMode } : {}),
            };
        },
    });
    // P3 review fix: `enqueueCoalesced` now returns the POST-merge payload, so an
    // enqueue-time observable carries the merged burst window (not just the current
    // completion's [now, now]) when this call joined a pending job. For 0716 the
    // same shape covers `already-running`: the IN-FLIGHT job's id and payload.
    return { status: result.status, jobId: result.jobId, payload: parsePayload(result.payload) };
}

/** Dependencies for {@link handleHistoryRefreshJob}. */
export interface HistoryRefreshJobDeps {
    /** Project root the child `spur history daily` runs in (DB + artifact live here). */
    cwd: string;
    /** Exact database URL used by the server; keeps `serve --cwd` children on the same database. */
    databaseUrl?: string;
    /** PATH-independent Spur invocation; the CLI `serve` bootstrap passes `resolveSpurBin()`. */
    invocation: string;
    /** Process seam — the real server wires `NodeProcessExecutor`. */
    executor: ProcessExecutor;
}

/**
 * Queue-job body (task 0717): run the refresh as an isolated child process —
 * `<invocation> --no-logo history daily` in the project root — and only await its exit,
 * so a long import never blocks the server event loop (R1) and the entrypoint is
 * PATH-independent (R2). Only `job.payload` crosses the boundary: it is validated,
 * serialized into `SPUR_HISTORY_REFRESH_CONTEXT`, and the child owns every `history.*`
 * business event — the parent emits nothing here.
 *
 * Failure policy (R4): spawn failure and non-zero exit are queue-attempt failures — this
 * throws so the queue's `failOrRetry` records the retry/failure state and emits
 * `queue.job.*` truthfully. The child's exit code is the verdict; its stdout is failure
 * detail only, never a payload the parent parses.
 */
export async function handleHistoryRefreshJob(deps: HistoryRefreshJobDeps, job: Job<unknown>): Promise<void> {
    // Strict payload validation at the boundary: envelope/payload drift must fail the
    // attempt, not silently refresh with defaulted trigger/window fields. The queue
    // registry hands Job<unknown>; this validation is the payload type gate.
    const payload = validateHistoryRefreshPayload(job.payload);
    const split = splitLaunchCommand(deps.invocation, 'history refresh "invocation"');
    if ('error' in split) throw new Error(split.error);
    const result = await deps.executor.run({
        command: split.command,
        // Human summary, not `--json`: the child's exit code is the whole success contract
        // here (it owns every `history.*` event and writes the artifact itself), while the
        // JSON envelope would ship the entire analyze artifact through the pipe for nothing.
        // `--no-logo` keeps the startup banner off now that `--json` no longer suppresses it.
        args: [...split.leadingArgs, '--no-logo', 'history', 'daily'],
        cwd: deps.cwd,
        env: {
            [HISTORY_REFRESH_CONTEXT_ENV]: JSON.stringify(payload),
            ...(deps.databaseUrl !== undefined ? { DATABASE_URL: deps.databaseUrl } : {}),
        },
        maxOutput: HISTORY_REFRESH_MAX_OUTPUT,
    });
    // Bounded child output as failure detail for queue events: last 400 chars. The daily
    // summary reports the failing sources on stdout, so it leads; stderr is the fallback.
    const stderrDetail = outputTail(result.stderr);
    if (result.exitCode === null) {
        const signalDetail = result.signal === undefined ? '' : ` (${result.signal})`;
        throw new Error(`history refresh child terminated before a normal exit${signalDetail}${stderrDetail}`);
    }
    if (result.exitCode !== 0) {
        throw new Error(`history daily exited ${result.exitCode}${outputTail(result.stdout) || stderrDetail}`);
    }
}

/** Re-export so trigger call sites can resolve config without a second import hop. */
export type { HistoryRefreshTriggerConfig };
