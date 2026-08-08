import { describe, expect, test } from 'bun:test';
import type { DbAdapter } from '@gobing-ai/ts-db';
import { computeRecordCost, formatSummary, resolvePricing } from '../../src/analytics';
import { byCostDesc, byDateAsc } from '../../src/analytics/costs';
import { extractClaudeTokens, queryEtlRecords } from '../../src/analytics/query';
import type { CostRecord, TokenTotals } from '../../src/analytics/types';

/** CostRecord with cache/usage fields defaulted — a test states only what it exercises. */
function rec(partial: Partial<CostRecord> = {}): CostRecord {
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

/** TokenTotals bucket with cache/usage fields defaulted. */
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

describe('analytics', () => {
    test('resolves model pricing', () => {
        expect(resolvePricing('claude-sonnet-4-20250514')).toMatchObject({ inputPricePer1M: 3, outputPricePer1M: 15 });
        expect(resolvePricing('gemini-2.5-flash')).toMatchObject({ inputPricePer1M: 0.15, outputPricePer1M: 0.6 });
        expect(resolvePricing('gpt-4o')).toMatchObject({ inputPricePer1M: 2.5, outputPricePer1M: 10 });
        expect(resolvePricing(undefined)).toMatchObject({ inputPricePer1M: 3, outputPricePer1M: 15 });
        expect(resolvePricing('unknown-model-xyz')).toMatchObject({ inputPricePer1M: 3, outputPricePer1M: 15 });
        // Prefix match
        expect(resolvePricing('claude-sonnet-4')).toMatchObject({ inputPricePer1M: 3, outputPricePer1M: 15 });
    });

    test('computes record costs from token counts', () => {
        const raw = rec({ inputTokens: 1_000_000, outputTokens: 500_000 });
        const priced = computeRecordCost(raw);
        expect(priced.costUsd).toBeCloseTo(10.5, 1); // 1M * $3/1M + 0.5M * $15/1M = 3 + 7.5 = 10.5
    });

    test('formats summary as readable text', () => {
        const bucket = totals({ inputTokens: 3_000_000, outputTokens: 1_500_000, costUsd: 12.34, records: 2 });
        const summary = {
            totals: bucket,
            bySource: { claude: bucket },
            byModel: { 'claude-sonnet-4-20250514': bucket },
            daily: [{ date: '2026-05-30', ...bucket }],
        };

        const text = formatSummary(summary);
        expect(text).toContain('Total:');
        expect(text).toContain('$12.34');
        expect(text).toContain('By source:');
        expect(text).toContain('claude');
        expect(text).toContain('By model:');
        expect(text).toContain('claude-sonnet-4-20250514');
    });

    test('extracts Claude tokens from usage passthrough', () => {
        const tokens = extractClaudeTokens({
            source_record_id: 'msg-1',
            created_at: '2026-05-30T00:00:00Z',
            content: 'hello',
            usage: { input_tokens: 1500, output_tokens: 800 },
        });
        expect(tokens).toEqual({
            inputTokens: 1500,
            outputTokens: 800,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            usageReported: true,
        });

        const withCache = extractClaudeTokens({
            source_record_id: 'msg-2',
            created_at: '2026-05-30T00:00:00Z',
            content: 'cached',
            usage: {
                input_tokens: 100,
                output_tokens: 200,
                cache_read_input_tokens: 500,
                cache_creation_input_tokens: 50,
            },
        });
        expect(withCache).toEqual({
            inputTokens: 650, // total: 100 + 500 + 50
            outputTokens: 200,
            cacheReadTokens: 500,
            cacheCreationTokens: 50,
            usageReported: true,
        });

        const noUsage = extractClaudeTokens({
            source_record_id: 'msg-3',
            created_at: '2026-05-30T00:00:00Z',
            content: 'no usage',
        });
        expect(noUsage).toEqual({
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            usageReported: false,
        });
    });

    test('queries ETL records from a single source table without since filter', async () => {
        const db = createMockDb([
            {
                payload_json: JSON.stringify({
                    source_record_id: 'a',
                    created_at: '2026-01-01T00:00:00Z',
                    content: 'x',
                }),
            },
            {
                payload_json: JSON.stringify({
                    source_record_id: 'b',
                    created_at: '2026-01-02T00:00:00Z',
                    content: 'y',
                }),
            },
        ]);
        const records = await queryEtlRecords(db, 'history_etl_pi');
        expect(records).toHaveLength(2);
        expect(records[0]?.source_record_id).toBe('a');
        expect(records[1]?.source_record_id).toBe('b');
    });

    test('queries ETL records with since filter', async () => {
        const db = createMockDb([
            {
                payload_json: JSON.stringify({
                    source_record_id: 'recent',
                    created_at: '2026-06-01T00:00:00Z',
                    content: 'z',
                }),
            },
        ]);
        const records = await queryEtlRecords(db, 'history_etl_pi', '2026-05-01');
        expect(records).toHaveLength(1);
        expect(records[0]?.source_record_id).toBe('recent');
    });

    test('byDateAsc sorts by date ascending', () => {
        const items = [{ date: '2026-05-31' }, { date: '2026-05-30' }, { date: '2026-06-01' }];
        const sorted = [...items].sort(byDateAsc);
        expect(sorted.map((i) => i.date)).toEqual(['2026-05-30', '2026-05-31', '2026-06-01']);
    });

    test('byCostDesc sorts by cost descending', () => {
        const items: Array<[string, { costUsd: number }]> = [
            ['a', { costUsd: 10 }],
            ['b', { costUsd: 50 }],
            ['c', { costUsd: 5 }],
        ];
        const sorted = [...items].sort(byCostDesc);
        expect(sorted.map(([, s]) => s.costUsd)).toEqual([50, 10, 5]);
    });
});

/** Create a minimal mock DbAdapter that returns controlled rows from queryAll. */
function createMockDb(rows: Array<{ payload_json: string }>): DbAdapter {
    return {
        // ts-db 0.2.x exposes the internal typed db via `db`; this mock only uses
        // the string-SQL methods, so `db` is an unused stub.
        db: {} as DbAdapter['db'],
        exec: async () => {},
        run: async () => {},
        queryFirst: async <T>() => undefined as T | undefined,
        queryAll: async <T>() => rows as T[],
        // ts-db 0.4.7 requires batch() on DbAdapter; unused by analytics.
        batch: async () => {},
        close: () => {},
    };
}
