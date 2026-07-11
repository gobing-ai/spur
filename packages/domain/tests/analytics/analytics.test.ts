import { describe, expect, test } from 'bun:test';
import type { DbAdapter } from '@gobing-ai/ts-db';
import { aggregateCosts, computeRecordCost, formatSummary, resolvePricing } from '../../src/analytics';
import { byCostDesc, byDateAsc } from '../../src/analytics/costs';
import { etlToCostRecord, extractClaudeTokens, queryAllEtlRecords, queryEtlRecords } from '../../src/analytics/query';

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
        const raw = {
            source: 'claude',
            date: '2026-05-30',
            model: 'claude-sonnet-4-20250514',
            inputTokens: 1_000_000,
            outputTokens: 500_000,
            costUsd: 0,
        };
        const priced = computeRecordCost(raw);
        expect(priced.costUsd).toBeCloseTo(10.5, 1); // 1M * $3/1M + 0.5M * $15/1M = 3 + 7.5 = 10.5
    });

    test('aggregates records into summary', () => {
        const records = [
            {
                source: 'claude',
                date: '2026-05-30',
                model: 'claude-sonnet-4-20250514',
                inputTokens: 1_000_000,
                outputTokens: 500_000,
                costUsd: 10.5,
            },
            {
                source: 'gemini',
                date: '2026-05-30',
                model: 'gemini-2.5-flash',
                inputTokens: 2_000_000,
                outputTokens: 1_000_000,
                costUsd: 0.9,
            },
            {
                source: 'claude',
                date: '2026-05-31',
                model: 'claude-sonnet-4-20250514',
                inputTokens: 500_000,
                outputTokens: 200_000,
                costUsd: 4.5,
            },
        ];

        const summary = aggregateCosts(records);

        expect(summary.totals).toMatchObject({
            inputTokens: 3_500_000,
            outputTokens: 1_700_000,
            costUsd: 15.9,
            records: 3,
        });
        expect(summary.bySource.claude).toMatchObject({
            inputTokens: 1_500_000,
            outputTokens: 700_000,
            costUsd: 15,
            records: 2,
        });
        expect(summary.bySource.gemini).toMatchObject({
            inputTokens: 2_000_000,
            outputTokens: 1_000_000,
            costUsd: 0.9,
            records: 1,
        });
        expect(summary.byModel['claude-sonnet-4-20250514']).toMatchObject({
            inputTokens: 1_500_000,
            outputTokens: 700_000,
            costUsd: 15,
            records: 2,
        });
        expect(summary.daily).toHaveLength(2);
        expect(summary.daily[0]?.date).toBe('2026-05-30');
        expect(summary.daily[1]?.date).toBe('2026-05-31');
    });

    test('formats summary as readable text', () => {
        const summary = {
            totals: { inputTokens: 3_000_000, outputTokens: 1_500_000, costUsd: 12.34, records: 2 },
            bySource: {
                claude: { inputTokens: 3_000_000, outputTokens: 1_500_000, costUsd: 12.34, records: 2 },
            },
            byModel: {
                'claude-sonnet-4-20250514': {
                    inputTokens: 3_000_000,
                    outputTokens: 1_500_000,
                    costUsd: 12.34,
                    records: 2,
                },
            },
            daily: [
                { date: '2026-05-30', inputTokens: 3_000_000, outputTokens: 1_500_000, costUsd: 12.34, records: 2 },
            ],
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
        expect(tokens).toEqual({ inputTokens: 1500, outputTokens: 800 });

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
        expect(withCache).toEqual({ inputTokens: 650, outputTokens: 200 });

        const noUsage = extractClaudeTokens({
            source_record_id: 'msg-3',
            created_at: '2026-05-30T00:00:00Z',
            content: 'no usage',
        });
        expect(noUsage).toEqual({ inputTokens: 0, outputTokens: 0 });
    });

    test('converts ETL payload to cost record with fallback estimation', () => {
        const withTokens = etlToCostRecord(
            {
                source_record_id: 'msg-1',
                created_at: '2026-05-30T12:00:00Z',
                content: 'test',
                model: 'claude-sonnet-4-20250514',
                usage: { input_tokens: 1_000_000, output_tokens: 100_000 },
            },
            'claude',
        );
        expect(withTokens).toMatchObject({ source: 'claude', date: '2026-05-30', model: 'claude-sonnet-4-20250514' });
        expect(withTokens.inputTokens).toBe(1_000_000);
        expect(withTokens.outputTokens).toBe(100_000);

        const noTokens = etlToCostRecord(
            {
                source_record_id: 'msg-2',
                created_at: '2026-05-30T12:00:00Z',
                content: 'hello world test',
            },
            'gemini',
        );
        expect(noTokens.source).toBe('gemini');
        expect(noTokens.inputTokens).toBe(0);
        expect(noTokens.outputTokens).toBeGreaterThan(0); // Content-length fallback
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

    test('queries ETL records from all source tables and converts to cost records', async () => {
        const db = createMockDb([
            {
                payload_json: JSON.stringify({
                    source_record_id: 'c1',
                    created_at: '2026-05-30T00:00:00Z',
                    content: 'hello',
                    model: 'claude-sonnet-4-20250514',
                }),
            },
        ]);
        const records = await queryAllEtlRecords(db);
        expect(records.length).toBeGreaterThanOrEqual(1);
        const claudeRecord = records.find((r) => r.source === 'claude');
        expect(claudeRecord).toBeDefined();
        expect(claudeRecord?.model).toBe('claude-sonnet-4-20250514');
        expect(claudeRecord?.date).toBe('2026-05-30');
    });

    test('queryAllEtlRecords passes since filter through', async () => {
        const db = createMockDb([]);
        const records = await queryAllEtlRecords(db, '2026-01-01');
        expect(records).toEqual([]);
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
