import { resolvePricing } from './models';
import type { AnalyticsSummary, CostRecord } from './types';

/** Compute USD cost for a single cost record based on model pricing. */
export function computeRecordCost(record: CostRecord): CostRecord {
    const pricing = resolvePricing(record.model);
    const costUsd =
        (record.inputTokens / 1_000_000) * pricing.inputPricePer1M +
        (record.outputTokens / 1_000_000) * pricing.outputPricePer1M;
    return { ...record, costUsd };
}

/** Aggregate cost records into a summary with per-source and per-model breakdowns. */
export function aggregateCosts(records: readonly CostRecord[]): AnalyticsSummary {
    const summary: AnalyticsSummary = {
        totals: { inputTokens: 0, outputTokens: 0, costUsd: 0, records: 0 },
        bySource: {},
        byModel: {},
        daily: [],
    };

    const dailyMap = new Map<
        string,
        { date: string; inputTokens: number; outputTokens: number; costUsd: number; records: number }
    >();

    for (const record of records) {
        // Totals
        summary.totals.inputTokens += record.inputTokens;
        summary.totals.outputTokens += record.outputTokens;
        summary.totals.costUsd += record.costUsd;
        summary.totals.records += 1;

        // By source
        const sourceEntry = summary.bySource[record.source] ?? {
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            records: 0,
        };
        sourceEntry.inputTokens += record.inputTokens;
        sourceEntry.outputTokens += record.outputTokens;
        sourceEntry.costUsd += record.costUsd;
        sourceEntry.records += 1;
        summary.bySource[record.source] = sourceEntry;

        // By model
        const modelEntry = summary.byModel[record.model] ?? { inputTokens: 0, outputTokens: 0, costUsd: 0, records: 0 };
        modelEntry.inputTokens += record.inputTokens;
        modelEntry.outputTokens += record.outputTokens;
        modelEntry.costUsd += record.costUsd;
        modelEntry.records += 1;
        summary.byModel[record.model] = modelEntry;

        // Daily
        const dailyEntry = dailyMap.get(record.date) ?? {
            date: record.date,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            records: 0,
        };
        dailyEntry.inputTokens += record.inputTokens;
        dailyEntry.outputTokens += record.outputTokens;
        dailyEntry.costUsd += record.costUsd;
        dailyEntry.records += 1;
        dailyMap.set(record.date, dailyEntry);
    }

    summary.daily = [...dailyMap.values()].sort(byDateAsc);

    return summary;
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

export function byDateAsc(a: { date: string }, b: { date: string }): number {
    return a.date.localeCompare(b.date);
}

export function byCostDesc([, a]: [string, { costUsd: number }], [, b]: [string, { costUsd: number }]): number {
    return b.costUsd - a.costUsd;
}
