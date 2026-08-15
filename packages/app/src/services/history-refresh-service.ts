import { DEFAULT_HISTORY_REFRESH_DEBOUNCE_MS } from '@gobing-ai/spur-config';
import { loadSpurConfig } from '@gobing-ai/spur-config/loader';
import { createJobQueue, type DbAdapter, findPendingQueueJob, updatePendingQueueJob } from '@gobing-ai/spur-domain';
import type { JobQueue } from '@gobing-ai/ts-infra';
import {
    FULL_FIDELITY_HISTORY_SOURCES,
    type HistoryService,
    type RefreshCoverage,
    UNSUPPORTED_HISTORY_SOURCES,
} from './history-service';

/** Queue job kind for a coalesced history refresh (feature E3). */
export const HISTORY_REFRESH_JOB = 'history.refresh';

/** Why a completion hook asked for a refresh. */
export type HistoryRefreshTrigger = 'task-done' | 'pipeline-done';

/** One completion that joined a coalesced refresh window. */
export interface HistoryRefreshTriggerEvent {
    trigger: HistoryRefreshTrigger;
    at: string;
    wbs?: string;
    runId?: string;
}

/** Payload stored on a pending `history.refresh` job. */
export interface HistoryRefreshPayload {
    windowSince: string;
    windowUntil: string;
    events: HistoryRefreshTriggerEvent[];
}

/** Outcome of {@link HistoryRefreshService.enqueue}. */
export interface EnqueueHistoryRefreshResult {
    enqueued: boolean;
    coalesced: boolean;
    jobId?: string;
    reason: 'disabled' | 'enqueued' | 'coalesced';
}

/** Dependencies for {@link HistoryRefreshService}. */
export interface HistoryRefreshServiceContext {
    getDb(): Promise<DbAdapter>;
    cwd: string;
    now?: () => Date;
    getConfig?: () => Promise<{ on_completion: boolean; debounce_ms: number }>;
    createQueue?: (db: DbAdapter) => Promise<JobQueue<HistoryRefreshPayload>>;
    events?: { emit(name: string, payload: Record<string, unknown>): Promise<void> | void };
}

/**
 * Enqueue a coalesced, opt-in history refresh when work completes (task 0549)
 * and run it through {@link HistoryService.daily} (task 0550 coverage).
 *
 * Never runs the import on the caller's critical path — enqueue returns as soon
 * as the pending job is written. A second enqueue inside the debounce window
 * joins the existing pending job and stretches its covered window.
 */
export class HistoryRefreshService {
    constructor(private readonly ctx: HistoryRefreshServiceContext) {}

    /** Enqueue (or join) a refresh. No-op when `history.refresh.on_completion` is off. */
    async enqueue(event: HistoryRefreshTriggerEvent): Promise<EnqueueHistoryRefreshResult> {
        const config = await this.resolveConfig();
        if (!config.on_completion) {
            await this.emit('history.refresh.skipped', {
                reason: 'disabled',
                trigger: event.trigger,
                severity: 'info',
            });
            return { enqueued: false, coalesced: false, reason: 'disabled' };
        }

        const db = await this.ctx.getDb();
        const at = event.at;
        const pending = await findPendingRefresh(db);
        if (pending !== undefined) {
            const next: HistoryRefreshPayload = {
                windowSince: pending.payload.windowSince,
                windowUntil: at > pending.payload.windowUntil ? at : pending.payload.windowUntil,
                events: [...pending.payload.events, event],
            };
            await updatePendingQueueJob(db, pending.id, next, this.nowMs() + config.debounce_ms);
            await this.emit('history.refresh.enqueued', {
                jobId: pending.id,
                coalesced: true,
                trigger: event.trigger,
                windowSince: next.windowSince,
                windowUntil: next.windowUntil,
                severity: 'info',
            });
            return { enqueued: true, coalesced: true, jobId: pending.id, reason: 'coalesced' };
        }

        const payload: HistoryRefreshPayload = {
            windowSince: at,
            windowUntil: at,
            events: [event],
        };
        const queue = this.ctx.createQueue
            ? await this.ctx.createQueue(db)
            : await createJobQueue<HistoryRefreshPayload>(db);
        const jobId = await queue.enqueue(HISTORY_REFRESH_JOB, payload, {
            delay: config.debounce_ms,
            maxRetries: 2,
        });
        await this.emit('history.refresh.enqueued', {
            jobId,
            coalesced: false,
            trigger: event.trigger,
            windowSince: payload.windowSince,
            windowUntil: payload.windowUntil,
            severity: 'info',
        });
        return { enqueued: true, coalesced: false, jobId, reason: 'enqueued' };
    }

    /**
     * Drain a claimed refresh job: incremental import of full-fidelity sources
     * via {@link HistoryService.daily}, then coverage honesty.
     */
    async run(
        payload: HistoryRefreshPayload,
        history: HistoryService,
        opts?: { root?: string },
    ): Promise<{ refreshCoverage: RefreshCoverage }> {
        const result = await history.daily({
            cwd: this.ctx.cwd,
            sources: [...FULL_FIDELITY_HISTORY_SOURCES],
            coverageWindow: { since: payload.windowSince, until: payload.windowUntil },
            ...(opts?.root !== undefined ? { root: opts.root } : {}),
        });
        const refreshCoverage = result.refreshCoverage ?? {
            refreshed: result.fanOut.entries.map((e) => e.source),
            skipped: [...UNSUPPORTED_HISTORY_SOURCES],
            window: { since: payload.windowSince, until: payload.windowUntil },
        };
        await this.emit('history.refresh.completed', {
            refreshed: refreshCoverage.refreshed,
            skipped: refreshCoverage.skipped,
            windowSince: refreshCoverage.window.since,
            windowUntil: refreshCoverage.window.until,
            exitCode: result.fanOut.exitCode,
            severity: result.fanOut.exitCode === 0 ? 'info' : 'error',
        });
        return { refreshCoverage };
    }

    private nowMs(): number {
        const now = this.ctx.now ?? (() => new Date());
        return now().getTime();
    }

    private async resolveConfig(): Promise<{ on_completion: boolean; debounce_ms: number }> {
        if (this.ctx.getConfig !== undefined) return this.ctx.getConfig();
        try {
            const cfg = await loadSpurConfig(this.ctx.cwd);
            return {
                on_completion: cfg.history?.refresh?.on_completion ?? false,
                debounce_ms: cfg.history?.refresh?.debounce_ms ?? DEFAULT_HISTORY_REFRESH_DEBOUNCE_MS,
            };
        } catch {
            return { on_completion: false, debounce_ms: DEFAULT_HISTORY_REFRESH_DEBOUNCE_MS };
        }
    }

    private async emit(name: string, payload: Record<string, unknown>): Promise<void> {
        try {
            await this.ctx.events?.emit(name, payload);
        } catch {
            // Observability must never fail the completion hook.
        }
    }
}

/** Best-effort hook used by task/pipeline completion. Never throws. */
export async function enqueueHistoryRefreshSafe(
    svc: HistoryRefreshService | undefined,
    event: HistoryRefreshTriggerEvent,
): Promise<void> {
    if (svc === undefined) return;
    try {
        await svc.enqueue(event);
    } catch {
        // The operation that completed must return regardless of refresh enqueue.
    }
}

async function findPendingRefresh(db: DbAdapter): Promise<{ id: string; payload: HistoryRefreshPayload } | undefined> {
    const pending = await findPendingQueueJob<HistoryRefreshPayload>(db, HISTORY_REFRESH_JOB);
    // A pending row whose payload is not a well-formed refresh (no string
    // window bounds) is not coalescible — treat as absent so a fresh enqueue
    // replaces it rather than joining garbage.
    if (pending === undefined) return undefined;
    if (typeof pending.payload.windowSince !== 'string' || typeof pending.payload.windowUntil !== 'string') {
        return undefined;
    }
    return pending;
}

export { FULL_FIDELITY_HISTORY_SOURCES, UNSUPPORTED_HISTORY_SOURCES };

/** Build a refresh service for a CLI or server composition root. */
export function createHistoryRefreshService(ctx: HistoryRefreshServiceContext): HistoryRefreshService {
    return new HistoryRefreshService(ctx);
}
