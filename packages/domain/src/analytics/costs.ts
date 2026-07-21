import { resolvePricing } from './models';
import type { AnalyticsSummary, CostRecord, TokenTotals } from './types';

/** Compute USD cost for a single cost record based on model pricing. */
export function computeRecordCost(record: CostRecord): CostRecord {
    const pricing = resolvePricing(record.model);
    const costUsd =
        (record.inputTokens / 1_000_000) * pricing.inputPricePer1M +
        (record.outputTokens / 1_000_000) * pricing.outputPricePer1M;
    return { ...record, costUsd };
}

/** A zeroed {@link TokenTotals} accumulator. */
function emptyTotals(): TokenTotals {
    return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
        records: 0,
        recordsWithUsage: 0,
    };
}

/** Fold one record into a {@link TokenTotals} bucket in place. Single point of truth so a
 *  new token dimension is added once, not once per breakdown — the omission that dropped the
 *  cache split in the first place. */
function accumulate(bucket: TokenTotals, record: CostRecord): void {
    bucket.inputTokens += record.inputTokens;
    bucket.outputTokens += record.outputTokens;
    bucket.cacheReadTokens += record.cacheReadTokens;
    bucket.cacheCreationTokens += record.cacheCreationTokens;
    bucket.costUsd += record.costUsd;
    bucket.records += 1;
    if (record.usageReported) bucket.recordsWithUsage += 1;
}

/** Aggregate cost records into a summary with per-source and per-model breakdowns. */
export function aggregateCosts(records: readonly CostRecord[]): AnalyticsSummary {
    const summary: AnalyticsSummary = {
        totals: emptyTotals(),
        bySource: {},
        byModel: {},
        daily: [],
    };

    const dailyMap = new Map<string, { date: string } & TokenTotals>();

    for (const record of records) {
        accumulate(summary.totals, record);

        summary.bySource[record.source] ??= emptyTotals();
        accumulate(summary.bySource[record.source] as TokenTotals, record);

        summary.byModel[record.model] ??= emptyTotals();
        accumulate(summary.byModel[record.model] as TokenTotals, record);

        let dailyEntry = dailyMap.get(record.date);
        if (dailyEntry === undefined) {
            dailyEntry = { date: record.date, ...emptyTotals() };
            dailyMap.set(record.date, dailyEntry);
        }
        accumulate(dailyEntry, record);
    }

    summary.daily = [...dailyMap.values()].sort(byDateAsc);

    return summary;
}

/**
 * Prompt-cache hit ratio for a totals bucket: cache-read input tokens over total billed
 * input tokens, in `[0, 1]`.
 *
 * Returns `null` — never 0 — when the ratio is not knowable: no records carried provider
 * usage, or there were no input tokens to divide by. A `null` here is the "unavailable"
 * that callers must render as such rather than as 0%, honoring the 0281/0284 never-fabricate
 * invariant: absent telemetry is unknown, not a real zero.
 */
export function cacheHitRatio(
    totals: Pick<TokenTotals, 'inputTokens' | 'cacheReadTokens' | 'recordsWithUsage'>,
): number | null {
    if (totals.recordsWithUsage === 0) return null;
    if (totals.inputTokens === 0) return null;
    return totals.cacheReadTokens / totals.inputTokens;
}

/** Format a human-readable analytics summary string. */
export function formatSummary(summary: AnalyticsSummary): string {
    const lines: string[] = [];

    const totalCost = summary.totals.costUsd.toFixed(2);
    const totalInput = (summary.totals.inputTokens / 1_000_000).toFixed(1);
    const totalOutput = (summary.totals.outputTokens / 1_000_000).toFixed(1);

    lines.push(
        `Total: ${totalInput}M input / ${totalOutput}M output tokens · $${totalCost} · ${summary.totals.records} records`,
    );
    lines.push(`Cache hit: ${formatRatio(cacheHitRatio(summary.totals))} of input tokens served from cache`);
    lines.push('');

    // By source
    lines.push('By source:');
    const sourceEntries = Object.entries(summary.bySource).sort(byCostDesc);
    for (const entry of sourceEntries) {
        const [source, stats] = entry;
        lines.push(
            `  ${source.padEnd(12)} $${stats.costUsd.toFixed(2).padStart(8)}  ${(stats.inputTokens / 1_000_000).toFixed(1).padStart(6)}M in  ${(stats.outputTokens / 1_000_000).toFixed(1).padStart(6)}M out  ${String(stats.records).padStart(6)} rec`,
        );
    }
    lines.push('');

    // By model
    lines.push('By model:');
    const modelEntries = Object.entries(summary.byModel).sort(byCostDesc);
    for (const entry of modelEntries) {
        const [model, stats] = entry;
        lines.push(
            `  ${model.slice(0, 28).padEnd(28)} $${stats.costUsd.toFixed(2).padStart(8)}  ${(stats.inputTokens / 1_000_000).toFixed(1).padStart(6)}M in  ${(stats.outputTokens / 1_000_000).toFixed(1).padStart(6)}M out  ${String(stats.records).padStart(6)} rec`,
        );
    }

    return lines.join('\n');
}

/** Render a cache-hit ratio for humans: `42.0%`, or `n/a` when the ratio is unavailable
 *  (`null`) — never a fabricated `0.0%`. */
function formatRatio(ratio: number | null): string {
    return ratio === null ? 'n/a' : `${(ratio * 100).toFixed(1)}%`;
}

/** Comparator that orders daily entries by ISO date string, ascending. */
export function byDateAsc(a: { date: string }, b: { date: string }): number {
    return a.date.localeCompare(b.date);
}

/** Comparator that orders `[key, stats]` entries by USD cost, descending. */
export function byCostDesc([, a]: [string, { costUsd: number }], [, b]: [string, { costUsd: number }]): number {
    return b.costUsd - a.costUsd;
}
