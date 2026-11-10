import type { DbAdapter } from '@gobing-ai/ts-db';

/**
 * D3 (task 1323) adaptive agent-run budget and ladder-order policy.
 *
 * Two pure decisions plus the history reader both consumers share:
 *  - `resolveAdaptiveTimeoutMs` derives a per-node dispatch budget from the
 *    executor's observed latency, with the YAML `timeoutMs` as the hard cap
 *    (operator intent). Slow executors whose measured latency exceeds the cap
 *    are marked `fits: false` (timeout-exhausted in advance) so the ladder
 *    failovers before burning the static budget; executors that fit keep the
 *    operator budget unchanged — shrinking a healthy budget only regresses
 *    success rates.
 *  - `ladderScore` weighs measured latency × success rate for post-failure
 *    ladder ordering (R3).
 *
 * History source (Q&A): `history_board_model_stats` when present; any failure
 * to read it degrades to the static behavior (empty map), never throws.
 */

/** Observed latency for one executor (or its model) from run history. */
export interface ExecutorLatencyStats {
    /** Mean observed duration in ms. */
    meanMs: number;
    /** p95 duration when the source provides one; absent → derived from mean. */
    p95Ms?: number;
    /** Sample count backing the durations; 0 means "no evidence". */
    samples: number;
    /** Success ratio clamped to [0,1]; 1 when no failure evidence exists. */
    successRate: number;
}

/** How the effective dispatch timeout was resolved (recorded in the run trace). */
export interface AdaptiveTimeoutDecision {
    source: 'static' | 'derived-latency';
    /** Operator YAML budget when the node declared one (the hard cap). */
    staticMs?: number;
    /** The budget actually applied to the dispatch; undefined = unbounded. */
    appliedMs?: number;
    /** History-derived value when computed (evidence, even when not applied). */
    derivedMs?: number;
    meanMs?: number;
    p95Ms?: number;
    samples?: number;
    successRate?: number;
    /** False = measured latency exceeds the static cap (timeout-exhausted). */
    fits: boolean;
}

/** Headroom over a p95 measurement. */
const P95_HEADROOM = 1.5;
/**
 * Headroom over a mean when the source has no p95 (the rollup table stores
 * only mean totals): a 3x multiplier stands in for the unmeasured tail.
 */
const MEAN_HEADROOM = 3;
/** Floor so tiny/fast executors never derive an absurdly small budget. */
const DERIVED_FLOOR_MS = 30_000;

function derivedBudgetMs(latency: ExecutorLatencyStats): number {
    const base = latency.p95Ms ?? latency.meanMs;
    const headroom = latency.p95Ms !== undefined ? P95_HEADROOM : MEAN_HEADROOM;
    return Math.max(DERIVED_FLOOR_MS, Math.ceil(base * headroom));
}

/**
 * Resolve the effective dispatch timeout for one attempt. Pure: `latency`
 * comes from the caller's history read; `undefined`/zero-sample stats degrade
 * to the static behavior unchanged.
 */
export function resolveAdaptiveTimeoutMs(
    staticMs: number | undefined,
    latency: ExecutorLatencyStats | undefined,
): AdaptiveTimeoutDecision {
    if (latency === undefined || latency.samples <= 0) {
        return {
            source: 'static',
            ...(staticMs !== undefined ? { staticMs, appliedMs: staticMs } : {}),
            fits: true,
        };
    }
    const derivedMs = derivedBudgetMs(latency);
    if (staticMs === undefined) {
        // No operator budget declared: the derived budget replaces unbounded.
        return {
            source: 'derived-latency',
            appliedMs: derivedMs,
            derivedMs,
            meanMs: latency.meanMs,
            ...(latency.p95Ms !== undefined ? { p95Ms: latency.p95Ms } : {}),
            samples: latency.samples,
            successRate: latency.successRate,
            fits: true,
        };
    }
    // YAML is the hard cap: never apply more than the operator allowed, and
    // never shrink a declared budget the executor fits under.
    const fits = derivedMs <= staticMs;
    return {
        source: 'static',
        staticMs,
        appliedMs: staticMs,
        derivedMs,
        meanMs: latency.meanMs,
        ...(latency.p95Ms !== undefined ? { p95Ms: latency.p95Ms } : {}),
        samples: latency.samples,
        successRate: latency.successRate,
        fits,
    };
}

/**
 * Ladder ordering score (R3): lower is better. Latency penalized by failure
 * rate — `p95 ?? mean` over the clamped success ratio, so a broken executor
 * cannot rank by latency alone and a fast-but-flaky one cannot outrank a
 * slightly slower reliable one.
 */
export function ladderScore(latency: ExecutorLatencyStats): number {
    const base = latency.p95Ms ?? latency.meanMs;
    const successRate = Math.min(1, Math.max(0.1, latency.successRate));
    return base / successRate;
}

interface ModelStatsRow {
    model: string;
    assistant_duration_ms: number;
    assistant_duration_samples: number;
    errors: number;
    tool_calls: number;
}

/**
 * Read observed latency for the given executor/model keys from
 * `history_board_model_stats` (the table the history board rollup maintains).
 * A missing table, empty history or any read failure degrades to an empty map
 * — static behavior, never a failed dispatch (Q&A: degrades when history is
 * empty).
 */
export async function readExecutorLatency(
    db: DbAdapter,
    keys: readonly string[],
): Promise<Map<string, ExecutorLatencyStats>> {
    const wanted = [...new Set(keys)].filter((key) => key.length > 0);
    if (wanted.length === 0) return new Map();
    try {
        const placeholders = wanted.map(() => '?').join(', ');
        const rows = await db.queryAll<ModelStatsRow>(
            `SELECT model, assistant_duration_ms, assistant_duration_samples, errors, tool_calls
             FROM history_board_model_stats WHERE model IN (${placeholders})`,
            ...wanted,
        );
        const stats = new Map<string, ExecutorLatencyStats>();
        for (const row of rows) {
            const samples = row.assistant_duration_samples;
            if (samples <= 0) continue;
            // Success proxy from the same table: tool error ratio. No tool
            // evidence at all counts as success (no failure observation).
            const successRate = row.tool_calls > 0 ? Math.min(1, Math.max(0, 1 - row.errors / row.tool_calls)) : 1;
            stats.set(row.model, {
                meanMs: row.assistant_duration_ms / samples,
                samples,
                successRate,
            });
        }
        return stats;
    } catch {
        return new Map();
    }
}

/**
 * The latency-history seam both consumers share (1323 R2/R3): the injected
 * `historyLatency` context hook wins (tests, alternate sources); otherwise the
 * executor reads `history_board_model_stats` through the DB accessor. No
 * source or a read failure → empty map (static behavior).
 */
export interface LatencyHistorySource {
    historyLatency?: (executors: string[]) => Promise<Record<string, ExecutorLatencyStats>>;
    getDb?: () => Promise<DbAdapter>;
}

export async function loadExecutorLatency(
    source: LatencyHistorySource,
    keys: readonly string[],
): Promise<Map<string, ExecutorLatencyStats>> {
    if (source.historyLatency !== undefined) {
        try {
            return new Map(Object.entries(await source.historyLatency([...keys])));
        } catch {
            return new Map();
        }
    }
    if (source.getDb === undefined) return new Map();
    try {
        return await readExecutorLatency(await source.getDb(), keys);
    } catch {
        return new Map();
    }
}
