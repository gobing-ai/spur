/**
 * Host-pause attribution (task 1319 R7/R8).
 *
 * A host-executor `agent.run` pauses: the pipeline records `{"pause": true}` in two milliseconds and
 * the work happens in the operator's session. Before this, that wall clock was invisible — the
 * credit-sentry post-mortem could only show `implement agent.run p50=0.0s` for a ten-hour step.
 *
 * The record is additive metadata (`hostPauses[]`) on the run row, written when the resume observes
 * both ends of the pause. Nothing here kills, times out or fails a paused run: a pause is measured,
 * and a pause past its budget is only *labelled* stalled.
 */
import { getEnvVar } from '@gobing-ai/spur-config';

/** One measured host pause: the paused action's start, the resume instant, and the elapsed wall clock. */
export interface HostPause {
    node: string;
    action: string;
    pausedAt: string;
    resumedAt: string;
    hostDurationMs: number;
    executor?: string;
}

/** Run-metadata key holding the append-only pause list. */
export const HOST_PAUSES_KEY = 'hostPauses';

/** Default stall budget when neither a node budget nor metadata supplies one: 30 minutes. */
export const STALL_THRESHOLD_MS_DEFAULT = 1_800_000;

/** Env override for the stall budget (milliseconds); useful in tests and for long-running hosts. */
export const STALL_THRESHOLD_MS_ENV = 'SPUR_WORKFLOW_STALL_MS';

/** Read a `hostPauses[]` array back out of raw run metadata, tolerating anything malformed. */
export function readHostPauses(metadata: unknown): HostPause[] {
    if (metadata === null || typeof metadata !== 'object') return [];
    const raw = (metadata as Record<string, unknown>)[HOST_PAUSES_KEY];
    if (!Array.isArray(raw)) return [];
    const out: HostPause[] = [];
    for (const entry of raw) {
        if (entry === null || typeof entry !== 'object') continue;
        const row = entry as Record<string, unknown>;
        const { node, action, pausedAt, resumedAt, hostDurationMs } = row;
        if (typeof node !== 'string' || typeof pausedAt !== 'string' || typeof resumedAt !== 'string') continue;
        if (typeof hostDurationMs !== 'number' || !Number.isFinite(hostDurationMs)) continue;
        out.push({
            node,
            action: typeof action === 'string' ? action : 'agent.run',
            pausedAt,
            resumedAt,
            hostDurationMs,
            ...(typeof row.executor === 'string' ? { executor: row.executor } : {}),
        });
    }
    return out;
}

/** Append one pause to the metadata list without mutating the input. */
export function appendHostPause(metadata: unknown, pause: HostPause): HostPause[] {
    return [...readHostPauses(metadata), pause];
}

/** Total host-pause milliseconds per node (the number the profile/cost projections report). */
export function hostPauseMsByNode(pauses: readonly HostPause[]): Map<string, number> {
    const totals = new Map<string, number>();
    for (const pause of pauses) totals.set(pause.node, (totals.get(pause.node) ?? 0) + pause.hostDurationMs);
    return totals;
}

/** A duration between two instants, or null when either is unparsable or the interval is inverted. */
export function hostDurationMs(pausedAt: string, resumedAt: string): number | null {
    const start = Date.parse(pausedAt);
    const end = Date.parse(resumedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    return end - start;
}

/**
 * Is a host receipt degenerate (missing, equal or inverted interval)? A host executor may write
 * `startedAt === finishedAt` because it never measured the step; the resume stamps those instead of
 * persisting a zero-length interval (1319 R7).
 */
export function isDegenerateReceiptInterval(startedAt?: string, finishedAt?: string): boolean {
    if (startedAt === undefined || finishedAt === undefined) return true;
    const start = Date.parse(startedAt);
    const end = Date.parse(finishedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return true;
    return end <= start;
}

/** The stall budget: an explicit node budget, then env, then the default. */
export function resolveStallThresholdMs(
    nodeTimeoutMs?: number,
    readEnvVar: (name: string) => string | undefined = getEnvVar,
): number {
    if (nodeTimeoutMs !== undefined && Number.isFinite(nodeTimeoutMs) && nodeTimeoutMs > 0) return nodeTimeoutMs;
    const raw = readEnvVar(STALL_THRESHOLD_MS_ENV);
    if (raw !== undefined) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
    }
    return STALL_THRESHOLD_MS_DEFAULT;
}

/**
 * Age of a still-open pause, or null when the run is not paused or the instant is unparsable.
 * `runs.updated_at` is an INTEGER epoch-ms column, so a number (or all-digit string) is taken as
 * epoch ms; `Date.parse` on it would be NaN and silently suppress every stalled label.
 */
export function openPauseMs(pausedAt: string | number | null | undefined, nowMs: number): number | null {
    if (pausedAt === null || pausedAt === undefined) return null;
    const start =
        typeof pausedAt === 'number' ? pausedAt : /^\d+$/.test(pausedAt) ? Number(pausedAt) : Date.parse(pausedAt);
    if (!Number.isFinite(start)) return null;
    return Math.max(0, nowMs - start);
}

/**
 * The paused node's own budget: `data.timeoutMs` on the LAST paused action row (the host surface
 * records it on the pause). Undefined when absent or malformed, so the stall check falls back to
 * env/default (1319 R8).
 */
export function pausedNodeBudgetMs(
    rows: ReadonlyArray<{ status: string; result_json: string | null }>,
): number | undefined {
    for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        if (row === undefined || row.result_json === null) continue;
        if (row.status !== 'paused' && !/"pause"\s*:\s*true/.test(row.result_json)) continue;
        try {
            const budget = (JSON.parse(row.result_json) as { data?: { timeoutMs?: unknown } })?.data?.timeoutMs;
            return typeof budget === 'number' && Number.isFinite(budget) && budget > 0 ? budget : undefined;
        } catch {
            return undefined;
        }
    }
    return undefined;
}

/** The one-line stalled label the projections print, with the resume hint (1319 R8). */
export function stalledLabel(runId: string, pauseMs: number): string {
    return `stalled — paused ${Math.round(pauseMs / 1000)}s; resume: spur workflow continue ${runId}`;
}
