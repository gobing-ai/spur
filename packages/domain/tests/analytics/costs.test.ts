import { describe, expect, test } from 'bun:test';
import { byCostDesc, byDateAsc, cacheHitRatio, computeRecordCost, formatSummary } from '../../src/analytics/costs';
import type { AnalyticsSummary, CostRecord, TokenTotals } from '../../src/analytics/types';

/** Build a CostRecord from a partial, defaulting the cache/usage fields so a test only
 *  states the dimensions it exercises. Keeps fixtures immune to future field additions. */
function mkRecord(partial: Partial<CostRecord> = {}): CostRecord {
    return {
        source: 'claude',
        date: '2026-05-30',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        usageReported: true,
        costUsd: 0,
        ...partial,
    };
}

/** A {@link TokenTotals} bucket with the forensic fields defaulted. */
function totals(partial: Partial<TokenTotals> = {}): TokenTotals {
    return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        records: 0,
        recordsWithUsage: 0,
        messages: 0,
        toolCalls: 0,
        durationMs: 0,
        durationUnmeasured: 0,
        ...partial,
    };
}

/** Build an {@link AnalyticsSummary} from a shared bucket (the artifact-driven rendering path). */
function makeSummary(bucket: TokenTotals, overrides: Partial<AnalyticsSummary> = {}): AnalyticsSummary {
    return {
        totals: bucket,
        bySource: { claude: bucket },
        byModel: { 'claude-sonnet-4-20250514': bucket },
        daily: [{ date: '2026-05-30', ...bucket }],
        ...overrides,
    };
}

describe('analytics costs', () => {
    describe('byDateAsc', () => {
        test('sorts by date ascending', () => {
            const items = [{ date: '2026-05-31' }, { date: '2026-05-30' }, { date: '2026-06-01' }];
            const sorted = [...items].sort(byDateAsc);
            expect(sorted.map((i) => i.date)).toEqual(['2026-05-30', '2026-05-31', '2026-06-01']);
        });

        test('returns 0 for equal dates', () => {
            expect(byDateAsc({ date: '2026-01-01' }, { date: '2026-01-01' })).toBe(0);
        });
    });

    describe('byCostDesc', () => {
        test('sorts tuples by cost descending', () => {
            const items: Array<[string, { costUsd: number }]> = [
                ['a', { costUsd: 10 }],
                ['b', { costUsd: 50 }],
                ['c', { costUsd: 5 }],
            ];
            const sorted = [...items].sort(byCostDesc);
            expect(sorted.map(([, s]) => s.costUsd)).toEqual([50, 10, 5]);
        });

        test('returns 0 for equal costs', () => {
            expect(byCostDesc(['x', { costUsd: 10 }], ['y', { costUsd: 10 }])).toBe(0);
        });
    });

    describe('computeRecordCost', () => {
        test('computes cost for known model claude-sonnet-4', () => {
            const record = mkRecord({ inputTokens: 1_000_000, outputTokens: 1_000_000 });
            const result = computeRecordCost(record);
            // inputPricePer1M=3, outputPricePer1M=15 → 3 + 15 = 18
            expect(result.costUsd).toBeCloseTo(18, 10);
            expect(result.source).toBe('claude');
            expect(result.model).toBe('claude-sonnet-4-20250514');
        });

        test('computes cost for unknown model using fallback pricing', () => {
            const record = mkRecord({
                source: 'test',
                model: 'unknown-model-xyz',
                inputTokens: 2_000_000,
                outputTokens: 500_000,
            });
            const result = computeRecordCost(record);
            // UNKNOWN: inputPricePer1M=3, outputPricePer1M=15 → 6 + 7.5 = 13.5
            expect(result.costUsd).toBeCloseTo(13.5, 10);
        });

        test('computes zero cost for zero tokens', () => {
            const record = mkRecord({ source: 'test', inputTokens: 0, outputTokens: 0 });
            const result = computeRecordCost(record);
            expect(result.costUsd).toBe(0);
        });

        test('preserves other record fields', () => {
            const record = mkRecord({
                source: 'pi',
                date: '2026-01-15',
                model: 'gemini-2.5-flash',
                inputTokens: 100,
                outputTokens: 50,
            });
            const result = computeRecordCost(record);
            expect(result.source).toBe('pi');
            expect(result.date).toBe('2026-01-15');
            expect(result.model).toBe('gemini-2.5-flash');
            expect(result.inputTokens).toBe(100);
            expect(result.outputTokens).toBe(50);
        });
    });

    describe('formatSummary', () => {
        test('formats populated summary', () => {
            const bucket = totals({ inputTokens: 1_000_000, outputTokens: 500_000, costUsd: 10.5, records: 2 });
            const summary = makeSummary(bucket);
            const text = formatSummary(summary);
            expect(text).toContain('$10.50');
            expect(text).toContain('2 records');
            expect(text).toContain('By source:');
            expect(text).toContain('By model:');
            expect(text).toContain('claude');
        });

        test('formats empty summary', () => {
            const summary = makeSummary(totals());
            const text = formatSummary(summary);
            expect(text).toContain('$0.00');
            expect(text).toContain('0 records');
        });

        test('renders the cache-hit line as n/a when no record carried usage', () => {
            // Length-estimated records (usageReported=false) must not read as 0% cache — unknown, not zero.
            const summary = makeSummary(totals({ inputTokens: 100 }));
            expect(formatSummary(summary)).toContain('Cache hit: n/a');
        });

        test('renders the cache-hit percentage when usage is present', () => {
            const summary = makeSummary(totals({ inputTokens: 1000, cacheReadTokens: 250, recordsWithUsage: 1 }));
            expect(formatSummary(summary)).toContain('Cache hit: 25.0%');
        });
    });

    describe('cacheHitRatio', () => {
        test('is cache-read over total input when usage is present', () => {
            expect(cacheHitRatio({ inputTokens: 1000, cacheReadTokens: 300, recordsWithUsage: 1 })).toBeCloseTo(
                0.3,
                10,
            );
        });

        test('is null (unavailable) when no record carried usage — never a fabricated 0', () => {
            expect(cacheHitRatio({ inputTokens: 1000, cacheReadTokens: 0, recordsWithUsage: 0 })).toBeNull();
        });

        test('is null when there are no input tokens to divide by', () => {
            expect(cacheHitRatio({ inputTokens: 0, cacheReadTokens: 0, recordsWithUsage: 3 })).toBeNull();
        });
    });
});
