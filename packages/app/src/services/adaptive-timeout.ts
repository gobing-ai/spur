import { type DbAdapter, type ExecutorLatencyStats, readExecutorLatency } from '@gobing-ai/spur-domain';

/**
 * D3 (task 1323) adaptive agent-run budget and ladder-order policy.
 *
 * Two pure decisions plus the history seam both consumers share:
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
 * History source (Q&A): the read itself lives in domain
 * (`readExecutorLatency`, `history_board_model_stats`); any failure to read it
 * degrades to the static behavior (empty map), never throws.
 */

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

/**
 * The latency-history seam both consumers share (1323 R2/R3): the injected
 * `historyLatency` context hook wins (tests, alternate sources); otherwise the
 * executor reads `history_board_model_stats` through the DB accessor (domain
 * `readExecutorLatency`). No source or a read failure → empty map (static
 * behavior).
 */
export interface LatencyHistorySource {
    historyLatency?: (executors: string[]) => Promise<Record<string, ExecutorLatencyStats>>;
    getDb?: () => Promise<DbAdapter>;
}

/**
 * Resolve per-executor latency stats for the run's executor keys (1323 R2/R3):
 * the injected `historyLatency` hook wins; otherwise the DB path delegates to
 * domain `readExecutorLatency`. Any source failure → empty map (static behavior).
 */
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
