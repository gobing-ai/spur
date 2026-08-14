import type { SpurConfig } from '@gobing-ai/spur-config';
import { type HistoryRefreshTriggerConfig, resolveHistoryRefreshTrigger } from '@gobing-ai/spur-config';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import { enqueueCoalesced } from '@gobing-ai/spur-domain';
import { type DailyResult, HistoryService, resolveArtifactPath } from './history-service';
import type { SystemEventBus } from './system-event-tap';

/**
 * Completion-triggered history refresh (task 0549).
 *
 * `spur history daily` is bound to a clock; this adds a second trigger bound to **work
 * completing** (task → done, pipeline run reaching terminal status). The trigger never
 * runs the refresh inline — it puts ONE coalesced job on the feature-A2 embedded job
 * queue and returns (R1). Bursts inside the debounce window join the pending job instead
 * of adding a second (R2), the trigger is opt-in config with observable firing (R3), the
 * debounce default follows task 0548's measured figures (R4), and the job body reuses
 * `HistoryService.daily`'s import-all fan-out with per-source isolation (R5).
 */

/** Built-in queue job kind for the coalesced completion-triggered history refresh. */
export const HISTORY_REFRESH_JOB = 'history.refresh';

/** Named completion points that may fire the trigger — never "every CLI invocation". */
export type HistoryRefreshTriggerPoint = 'task-done' | 'pipeline-run';

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
}

/** Outcome of {@link enqueueHistoryRefresh}. */
export type HistoryRefreshEnqueueResult =
    | { status: 'disabled' }
    | { status: 'enqueued'; jobId: string; payload: HistoryRefreshPayload }
    | { status: 'coalesced'; jobId: string; payload: HistoryRefreshPayload };

/** Options for {@link enqueueHistoryRefresh}. */
export interface HistoryRefreshEnqueueOptions {
    /** Raw project config (`history.refresh` resolved through schema defaults). */
    config: Pick<SpurConfig, 'history'> | null;
    /** Completion point that fired. */
    trigger: HistoryRefreshTriggerPoint;
    /** WBS (task-done) or run id (pipeline-run) — informational. */
    triggerId?: string;
    /** Clock seam for deterministic tests (default `Date.now`). */
    now?: () => number;
}

function parsePayload(raw: unknown): HistoryRefreshPayload {
    const candidate = (typeof raw === 'string' ? safeJsonParse(raw) : raw) as Partial<HistoryRefreshPayload> | null;
    const trigger: HistoryRefreshTriggerPoint =
        candidate?.trigger === 'task-done' || candidate?.trigger === 'pipeline-run' ? candidate.trigger : 'task-done';
    return {
        trigger,
        triggerId: typeof candidate?.triggerId === 'string' ? candidate.triggerId : null,
        windowStart: typeof candidate?.windowStart === 'number' ? candidate.windowStart : 0,
        windowEnd: typeof candidate?.windowEnd === 'number' ? candidate.windowEnd : 0,
    };
}

function safeJsonParse(raw: string): unknown {
    try {
        return JSON.parse(raw) as unknown;
    } catch {
        return null;
    }
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
    const { onCompletion, debounceMs } = resolveHistoryRefreshTrigger(options.config);
    if (!onCompletion) return { status: 'disabled' };
    const now = options.now?.() ?? Date.now();
    const incoming: HistoryRefreshPayload = {
        trigger: options.trigger,
        triggerId: options.triggerId ?? null,
        windowStart: now,
        windowEnd: now,
    };
    const result = await enqueueCoalesced(db, {
        type: HISTORY_REFRESH_JOB,
        payload: incoming,
        debounceMs,
        now: options.now,
        // Join the burst: keep the earliest windowStart, extend windowEnd to the latest
        // completion so the covered window spans the whole burst (R2).
        mergePayload: (existing, next) => {
            const prev = parsePayload(existing);
            const curr = parsePayload(next);
            return {
                trigger: prev.trigger,
                triggerId: prev.triggerId,
                windowStart: Math.min(prev.windowStart, curr.windowStart),
                windowEnd: Math.max(prev.windowEnd, curr.windowEnd),
            };
        },
    });
    // P3 review fix: `enqueueCoalesced` now returns the POST-merge payload, so an
    // enqueue-time observable carries the merged burst window (not just the current
    // completion's [now, now]) when this call joined a pending job.
    return { status: result.status, jobId: result.jobId, payload: parsePayload(result.payload) };
}

/** Dependencies for {@link handleHistoryRefreshJob}. */
export interface HistoryRefreshJobDeps {
    getDb(): Promise<DbAdapter>;
    /** Project root for the artifact write (passed through to `daily`). */
    cwd: string;
    /** When present, the refresh outcome is emitted as observable `history.*` events (R3). */
    bus?: SystemEventBus;
    /** Test seam — defaults to the real HistoryService. */
    service?: Pick<HistoryService, 'daily'>;
}

/**
 * Queue-job body (R5): run `HistoryService.daily` — the same import-all fan-out with
 * per-source isolation, analyze, and artifact write the nightly loop uses. One source
 * failing produces a failed coverage entry and a non-zero fan-out exit code; the other
 * sources still import and the failure is reported per source (never an abort).
 *
 * Failure policy: a degraded fan-out (per-source failures) emits `history.daily.failed`
 * and does NOT rethrow — the refresh is idempotent (checkpoint resume) and the next
 * completion re-triggers it. An exception from `daily` itself emits and rethrows so the
 * queue records the job failed.
 */
export async function handleHistoryRefreshJob(deps: HistoryRefreshJobDeps, payload: unknown): Promise<void> {
    const job = parsePayload(payload);
    const svc = deps.service ?? new HistoryService({ getDb: deps.getDb });
    const startMs = Date.now();
    let result: DailyResult;
    try {
        result = await svc.daily({ cwd: deps.cwd });
    } catch (e) {
        await emitDailyFailed(deps, job, Date.now() - startMs, e instanceof Error ? e.message : String(e));
        throw e;
    }
    const durationMs = Date.now() - startMs;
    const entries = result.fanOut.entries;
    const sources = entries.length;
    const okSources = entries.filter((e) => e.status === 'ok').length;
    const failedSources = entries.filter((e) => e.status === 'failed').length;
    const files = entries.reduce((sum, e) => sum + e.files, 0);
    const messages = entries.reduce((sum, e) => sum + e.messages, 0);
    const artifactPath = artifactPathFor(deps.cwd);
    if (deps.bus === undefined) return;
    if (result.fanOut.exitCode === 0) {
        await deps.bus.emit('history.import.completed', {
            source: 'history',
            renderer: 'history-import',
            sources,
            okSources,
            failedSources,
            files,
            messages,
            durationMs,
            artifactPath,
            trigger: job.trigger,
            windowStart: job.windowStart,
            windowEnd: job.windowEnd,
            severity: 'info',
        });
        await deps.bus.emit('history.analyze.completed', {
            source: 'history',
            renderer: 'history-analyze',
            artifactPath,
            totals: result.artifact.totals,
            trigger: job.trigger,
            severity: 'info',
        });
    } else {
        const problems = entries.filter((e) => e.status === 'failed' || e.status === 'degraded');
        await emitDailyFailed(
            deps,
            job,
            durationMs,
            problems.length > 0
                ? problems.map((e) => `${e.source}: ${e.status}`).join('; ')
                : 'refresh fan-out reported non-zero exit with no failing or degraded source',
            {
                sources,
                okSources,
                failedSources,
                artifactPath,
            },
        );
    }
}

async function emitDailyFailed(
    deps: HistoryRefreshJobDeps,
    job: HistoryRefreshPayload,
    durationMs: number,
    detail: string,
    extra: { sources?: number; okSources?: number; failedSources?: number; artifactPath?: string } = {},
): Promise<void> {
    if (deps.bus === undefined) return;
    await deps.bus.emit('history.daily.failed', {
        source: 'history',
        renderer: 'history-daily',
        detail,
        durationMs,
        trigger: job.trigger,
        windowStart: job.windowStart,
        windowEnd: job.windowEnd,
        severity: 'error',
        ...extra,
    });
}

/** Best-effort artifact pointer resolution — an unreadable pointer must not drop the event. */
function artifactPathFor(cwd: string): string | undefined {
    try {
        return resolveArtifactPath(undefined, cwd).path;
    } catch {
        return undefined;
    }
}

/** Re-export so trigger call sites can resolve config without a second import hop. */
export type { HistoryRefreshTriggerConfig };
