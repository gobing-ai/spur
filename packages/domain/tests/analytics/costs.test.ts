import { describe, expect, test } from 'bun:test';
import { aggregateCosts, byCostDesc, byDateAsc, computeRecordCost, formatSummary } from '../../src/analytics/costs';
import type { CostRecord } from '../../src/analytics/types';

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
            const record: CostRecord = {
                source: 'claude',
                date: '2026-05-30',
                model: 'claude-sonnet-4-20250514',
                inputTokens: 1_000_000,
                outputTokens: 1_000_000,
                costUsd: 0,
            };
            const result = computeRecordCost(record);
            // inputPricePer1M=3, outputPricePer1M=15 → 3 + 15 = 18
            expect(result.costUsd).toBeCloseTo(18, 10);
            expect(result.source).toBe('claude');
            expect(result.model).toBe('claude-sonnet-4-20250514');
        });

        test('computes cost for unknown model using fallback pricing', () => {
            const record: CostRecord = {
                source: 'test',
                date: '2026-05-30',
                model: 'unknown-model-xyz',
                inputTokens: 2_000_000,
                outputTokens: 500_000,
                costUsd: 0,
            };
            const result = computeRecordCost(record);
            // UNKNOWN: inputPricePer1M=3, outputPricePer1M=15 → 6 + 7.5 = 13.5
            expect(result.costUsd).toBeCloseTo(13.5, 10);
        });

        test('computes zero cost for zero tokens', () => {
            const record: CostRecord = {
                source: 'test',
                date: '2026-05-30',
                model: 'claude-sonnet-4-20250514',
                inputTokens: 0,
                outputTokens: 0,
                costUsd: 0,
            };
            const result = computeRecordCost(record);
            expect(result.costUsd).toBe(0);
        });

        test('preserves other record fields', () => {
            const record: CostRecord = {
                source: 'pi',
                date: '2026-01-15',
                model: 'gemini-2.5-flash',
                inputTokens: 100,
                outputTokens: 50,
                costUsd: 0,
            };
            const result = computeRecordCost(record);
            expect(result.source).toBe('pi');
            expect(result.date).toBe('2026-01-15');
            expect(result.model).toBe('gemini-2.5-flash');
            expect(result.inputTokens).toBe(100);
            expect(result.outputTokens).toBe(50);
        });
    });

    describe('aggregateCosts', () => {
        test('returns zeroed summary for empty array', () => {
            const summary = aggregateCosts([]);
            expect(summary.totals).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0, records: 0 });
            expect(summary.bySource).toEqual({});
            expect(summary.byModel).toEqual({});
            expect(summary.daily).toEqual([]);
        });

        test('aggregates single record correctly', () => {
            const records: CostRecord[] = [
                {
                    source: 'claude',
                    date: '2026-05-30',
                    model: 'claude-sonnet-4-20250514',
                    inputTokens: 1000,
                    outputTokens: 500,
                    costUsd: 0.05,
                },
            ];
            const summary = aggregateCosts(records);
            expect(summary.totals.records).toBe(1);
            expect(summary.totals.inputTokens).toBe(1000);
            expect(summary.totals.outputTokens).toBe(500);
            expect(summary.totals.costUsd).toBeCloseTo(0.05);
            expect(summary.bySource.claude?.records).toBe(1);
            expect(summary.byModel['claude-sonnet-4-20250514']?.records).toBe(1);
            expect(summary.daily).toHaveLength(1);
            expect(summary.daily[0]?.date).toBe('2026-05-30');
        });

        test('aggregates multiple records from different sources', () => {
            const records: CostRecord[] = [
                {
                    source: 'claude',
                    date: '2026-05-30',
                    model: 'claude-sonnet-4-20250514',
                    inputTokens: 1000,
                    outputTokens: 500,
                    costUsd: 0.05,
                },
                {
                    source: 'pi',
                    date: '2026-05-30',
                    model: 'gemini-2.5-flash',
                    inputTokens: 2000,
                    outputTokens: 1000,
                    costUsd: 0.02,
                },
                {
                    source: 'claude',
                    date: '2026-05-29',
                    model: 'claude-sonnet-4-20250514',
                    inputTokens: 500,
                    outputTokens: 200,
                    costUsd: 0.03,
                },
            ];
            const summary = aggregateCosts(records);

            // Totals
            expect(summary.totals.records).toBe(3);
            expect(summary.totals.inputTokens).toBe(3500);
            expect(summary.totals.outputTokens).toBe(1700);
            expect(summary.totals.costUsd).toBeCloseTo(0.1);

            // By source
            expect(Object.keys(summary.bySource)).toHaveLength(2);
            expect(summary.bySource.claude?.records).toBe(2);
            expect(summary.bySource.pi?.records).toBe(1);

            // By model
            expect(Object.keys(summary.byModel)).toHaveLength(2);

            // Daily — sorted ascending
            expect(summary.daily).toHaveLength(2);
            expect(summary.daily[0]?.date).toBe('2026-05-29');
            expect(summary.daily[1]?.date).toBe('2026-05-30');
        });

        test('sorts daily entries by date ascending', () => {
            const records: CostRecord[] = [
                { source: 'pi', date: '2026-05-31', model: 'm', inputTokens: 1, outputTokens: 0, costUsd: 0 },
                { source: 'pi', date: '2026-05-29', model: 'm', inputTokens: 1, outputTokens: 0, costUsd: 0 },
                { source: 'pi', date: '2026-05-30', model: 'm', inputTokens: 1, outputTokens: 0, costUsd: 0 },
            ];
            const summary = aggregateCosts(records);
            const dates = summary.daily.map((d) => d.date);
            expect(dates).toEqual(['2026-05-29', '2026-05-30', '2026-05-31']);
        });
    });

    describe('formatSummary', () => {
        test('formats populated summary', () => {
            const summary = aggregateCosts([
                {
                    source: 'claude',
                    date: '2026-05-30',
                    model: 'claude-sonnet-4-20250514',
                    inputTokens: 1_000_000,
                    outputTokens: 500_000,
                    costUsd: 10.5,
                },
                {
                    source: 'pi',
                    date: '2026-05-30',
                    model: 'gemini-2.5-flash',
                    inputTokens: 500_000,
                    outputTokens: 200_000,
                    costUsd: 2.1,
                },
            ]);
            const text = formatSummary(summary);
            expect(text).toContain('$12.60');
            expect(text).toContain('2 records');
            expect(text).toContain('By source:');
            expect(text).toContain('By model:');
            expect(text).toContain('claude');
            expect(text).toContain('pi');
        });

        test('formats empty summary', () => {
            const summary = aggregateCosts([]);
            const text = formatSummary(summary);
            expect(text).toContain('$0.00');
            expect(text).toContain('0 records');
        });
    });
});
