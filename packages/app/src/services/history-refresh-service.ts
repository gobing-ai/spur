import type { SpurConfig } from '@gobing-ai/spur-config';
import { type HistoryRefreshTriggerConfig, resolveHistoryRefreshTrigger } from '@gobing-ai/spur-config';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import { enqueueCoalesced } from '@gobing-ai/spur-domain';
import type { Job } from '@gobing-ai/ts-infra';
import type { ProcessExecutor } from '@gobing-ai/ts-runtime';
import { splitLaunchCommand } from '../workflow/split-launch-command';
import { type BoundedChildResult, describeBoundedFailure, runBoundedChild } from './bounded-child-run';
import { assertCanonicalTimeoutMs, normalizeLegacyTimeoutMs, type TimeoutPolicyMs } from './execution-policy';
import { acquireExclusiveJob, HISTORY_PRODUCER_EXCLUSIVE_KEY, releaseExclusiveJob } from './job-exclusion-guard';
import { SCHEDULER_CUSTOM_TIMEOUT_MS } from './scheduler-custom-job-service';

/**
 * Child env channel carrying the propagated history job policy (task 0813 R2).
 * When the refresh job's policy is explicit, the handler passes it to the
 * `history daily` child so omitted source limits inherit the job policy instead
 * of silently restoring the ten-minute standalone default. Value is a positive
 * integer string or `none`.
 */
export const HISTORY_SOURCE_TIMEOUT_ENV = 'SPUR_HISTORY_SOURCE_TIMEOUT_MS';

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
    /**
     * Explicit execution policy persisted with the queued work (task 0813 R2/R3):
     * a finite deadline or `null` for unlimited. Canonical — it beats the legacy
     * env chain at consume time, so a restart or environment change cannot
     * reinterpret the in-flight attempt. Absent inherits the configured default.
     */
    timeoutMs?: TimeoutPolicyMs;
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
    /**
     * Explicit execution policy persisted with the queued work (task 0813 R2/R3);
     * omitted → no canonical policy on the payload (legacy chain applies at
     * consume time). Validated before enqueue.
     */
    timeoutMs?: TimeoutPolicyMs;
    /** Clock seam for deterministic tests (default `Date.now`). */
    now?: () => number;
}

function parsePayload(raw: unknown): HistoryRefreshPayload {
    const candidate = (typeof raw === 'string' ? safeJsonParse(raw) : raw) as Partial<HistoryRefreshPayload> | null;
    const candidateTimeoutMs = candidate?.timeoutMs;
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
        // Lenient enqueue-side join: keep an explicit policy that is well-formed,
        // drop drifted values rather than failing the burst join.
        ...(candidateTimeoutMs === null ||
        (typeof candidateTimeoutMs === 'number' && Number.isInteger(candidateTimeoutMs) && candidateTimeoutMs > 0)
            ? { timeoutMs: candidateTimeoutMs }
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
    // Canonical policy at the consumer boundary: absent inherits, null is explicit
    // unlimited, and malformed values fail the attempt loudly (never fall back).
    const timeoutMs = assertCanonicalTimeoutMs(candidate.timeoutMs);
    return {
        trigger,
        triggerId,
        windowStart,
        windowEnd,
        ...(importMode !== undefined ? { importMode } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
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
    // Task 0813 R3: explicit canonical input is validated at the trigger boundary —
    // BEFORE the disabled gate, so malformed operator input is a usage error even
    // when refresh is off (nothing is queued, but garbage is never accepted).
    const explicitTimeoutMs = assertCanonicalTimeoutMs(options.timeoutMs);
    // Manual refreshes are explicit user intent — never gated; completion triggers
    // stay behind the on_completion opt-in. One gate, before any DB access. Periodic
    // refreshes are no longer a trigger here (task 0750): they are declared as a
    // `bootstrap.scheduler.jobs` entry that runs `spur history daily` directly.
    // `'schedule'` survives only as a payload value so persisted rows still validate.
    let enabled = triggerConfig.onCompletion;
    if (options.trigger === 'manual') enabled = true;
    if (!enabled) return { status: 'disabled' };
    const now = options.now?.() ?? Date.now();
    // Manual refreshes are user-facing "run it now" requests: a fresh job becomes
    // due immediately, and joining one only SHORTENS the pending due time — a due
    // burst is never delayed behind the debounce window (0716 R2). Nothing enqueues
    // with trigger 'schedule' since task 0750, but the immediate branch stays so a
    // replayed row from the retired interval path keeps its due-now semantics.
    const immediate = options.trigger === 'manual' || options.trigger === 'schedule';
    const incoming: HistoryRefreshPayload = {
        trigger: options.trigger,
        triggerId: options.triggerId ?? null,
        windowStart: now,
        windowEnd: now,
        ...(options.importMode !== undefined ? { importMode: options.importMode } : {}),
        ...(explicitTimeoutMs !== undefined ? { timeoutMs: explicitTimeoutMs } : {}),
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
                // First explicit policy wins (task 0813 R3), matching the
                // first-producer identity rule: the earliest canonical choice
                // persists; a later default (absent) never overrides it.
                ...(prev.timeoutMs !== undefined ? { timeoutMs: prev.timeoutMs } : {}),
                ...(prev.timeoutMs === undefined && curr.timeoutMs !== undefined ? { timeoutMs: curr.timeoutMs } : {}),
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
    /**
     * Legacy env-resolved execution policy (task 0803 R1; `null` = explicit
     * unlimited since task 0813 R2). Defaults to `SCHEDULER_CUSTOM_TIMEOUT_MS`;
     * the server resolves it once from `SPUR_HISTORY_REFRESH_TIMEOUT_MS` and
     * threads the same value into the child handler. A canonical policy on the
     * job payload takes precedence over this legacy value (R3).
     */
    timeoutMs?: TimeoutPolicyMs;
}

/**
 * Resolve the history-refresh child policy from the environment (task 0806 R3;
 * `none` → explicit unlimited since task 0813 R2). Decoupled from the
 * scheduler.custom global: raising `SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS` to bound a
 * long configured chain must NOT lengthen this short completion-triggered
 * deadline. Default stays the ten-minute application default (task 0803 R1);
 * invalid values fall back to it. A canonical `timeoutMs` (e.g. persisted on
 * the queued payload) beats the legacy env chain; a malformed canonical value
 * throws instead of falling back.
 */
export function resolveHistoryRefreshTimeoutMs(
    env: Record<string, string | undefined>,
    canonical?: TimeoutPolicyMs,
): TimeoutPolicyMs {
    if (canonical !== undefined) return assertCanonicalTimeoutMs(canonical);
    return normalizeLegacyTimeoutMs(env.SPUR_HISTORY_REFRESH_TIMEOUT_MS, SCHEDULER_CUSTOM_TIMEOUT_MS);
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
 *
 * Task 0813: the child is contained by the native execution policy — a finite
 * deadline arms the executor's owned process-group cleanup (SIGTERM, then
 * group SIGKILL after the termination grace) with no competing caller
 * watchdog, and the failure message separates the configured deadline from the
 * measured elapsed time (R5). The ten-minute default is preserved (R3); an
 * explicit unlimited job policy propagates to the child's source imports via
 * {@link HISTORY_SOURCE_TIMEOUT_ENV} instead of restoring a hidden default
 * (R2), decoupled via {@link resolveHistoryRefreshTimeoutMs}.
 */
export async function handleHistoryRefreshJob(deps: HistoryRefreshJobDeps, job: Job<unknown>): Promise<void> {
    // Strict payload validation at the boundary: envelope/payload drift must fail the
    // attempt, not silently refresh with defaulted trigger/window fields. The queue
    // registry hands Job<unknown>; this validation is the payload type gate.
    const payload = validateHistoryRefreshPayload(job.payload);
    const split = splitLaunchCommand(deps.invocation, 'history refresh "invocation"');
    if ('error' in split) throw new Error(split.error);
    // Task 0813 R3: the canonical payload policy (persisted with the queued work)
    // beats the legacy env-resolved deps value; both fall back to the ten-minute
    // application default. ABSENT (undefined) falls through the chain; EXPLICIT
    // UNLIMITED (null) must survive it — `??` would silently restore the hidden
    // ten-minute timer the operator turned off.
    const resolvedCanonical = payload.timeoutMs;
    const timeoutMs: TimeoutPolicyMs =
        resolvedCanonical !== undefined
            ? resolvedCanonical
            : deps.timeoutMs !== undefined
              ? deps.timeoutMs
              : SCHEDULER_CUSTOM_TIMEOUT_MS;
    // Task 0813 R2: propagate an explicit job policy to the child's source
    // imports. The silent default needs no channel (the child's standalone
    // default is the same ten minutes), so only a policy that differs from it
    // is injected — `none` for unlimited, the value for a distinct finite
    // deadline.
    let propagatedSourceTimeout: string | undefined;
    if (timeoutMs === null) {
        propagatedSourceTimeout = 'none';
    } else if (timeoutMs !== SCHEDULER_CUSTOM_TIMEOUT_MS) {
        propagatedSourceTimeout = String(timeoutMs);
    }
    // Task 0806 R6: the refresh IS a history producer — never overlap the configured
    // history chain's importer in the same daemon process.
    acquireExclusiveJob(HISTORY_PRODUCER_EXCLUSIVE_KEY, 'history.refresh');
    let outcome: BoundedChildResult;
    try {
        outcome = await runBoundedChild(deps.executor, {
            command: split.command,
            // Human summary, not `--json`: the child's exit code is the whole success contract
            // here (it owns every `history.*` event and writes the artifact itself), while the
            // JSON envelope would ship the entire analyze artifact through the pipe for nothing.
            // `--no-logo` keeps the startup banner off now that `--json` no longer suppresses it.
            args: [...split.leadingArgs, '--no-logo', 'history', 'daily'],
            cwd: deps.cwd,
            timeoutMs,
            env: {
                [HISTORY_REFRESH_CONTEXT_ENV]: JSON.stringify(payload),
                // Task 0813 R2: carry the explicit job policy into the child's
                // source imports (see propagatedSourceTimeout above).
                ...(propagatedSourceTimeout !== undefined
                    ? { [HISTORY_SOURCE_TIMEOUT_ENV]: propagatedSourceTimeout }
                    : {}),
                ...(deps.databaseUrl !== undefined ? { DATABASE_URL: deps.databaseUrl } : {}),
            },
            maxOutput: HISTORY_REFRESH_MAX_OUTPUT,
        });
    } finally {
        releaseExclusiveJob(HISTORY_PRODUCER_EXCLUSIVE_KEY, 'history.refresh');
    }
    const { result } = outcome;
    // Bounded child output as failure detail for queue events: last 400 chars. The daily
    // summary reports the failing sources on stdout, so it leads; stderr is the fallback.
    const stderrDetail = outputTail(result.stderr);
    const stdoutDetail = outputTail(result.stdout);
    if (outcome.timedOut) {
        throw new Error(
            describeBoundedFailure({
                subject: 'history refresh child',
                outcome,
                outputTail: stdoutDetail || stderrDetail,
            }),
        );
    }
    if (result.exitCode === null) {
        const signalDetail = result.signal === undefined ? '' : ` (${result.signal})`;
        throw new Error(
            `history refresh child terminated before a normal exit${signalDetail} after ${Math.round(outcome.elapsedMs)}ms${stderrDetail}`,
        );
    }
    if (result.exitCode !== 0) {
        throw new Error(`history daily exited ${result.exitCode}${stdoutDetail || stderrDetail}`);
    }
}

/** Re-export so trigger call sites can resolve config without a second import hop. */
export type { HistoryRefreshTriggerConfig };
