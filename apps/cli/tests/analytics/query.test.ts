import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { etlToCostRecord, extractClaudeTokens, queryAllEtlRecords, queryEtlRecords } from '../../src/analytics/query';

async function setupEtlDb(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    const stmt =
        'CREATE TABLE IF NOT EXISTS ETL_TABLE (id INTEGER PRIMARY KEY AUTOINCREMENT, payload_json TEXT NOT NULL, imported_at TEXT NOT NULL)';
    const tables = [
        'history_etl_pi',
        'history_etl_claude',
        'history_etl_codex',
        'history_etl_gemini',
        'history_etl_opencode',
        'history_etl_antigravity',
        'history_etl_openclaw',
    ];
    for (const table of tables) {
        await adapter.exec(stmt.replace('ETL_TABLE', table));
    }
    return adapter;
}

describe('analytics query', () => {
    describe('extractClaudeTokens', () => {
        test('returns tokens from usage', () => {
            const result = extractClaudeTokens({
                source_record_id: 'test-1',
                created_at: '2026-01-01T00:00:00Z',
                content: 'hello',
                usage: { input_tokens: 100, output_tokens: 50 },
            });
            expect(result).toEqual({ inputTokens: 100, outputTokens: 50 });
        });

        test('returns zeros for null usage', () => {
            const result = extractClaudeTokens({
                source_record_id: 'test-2',
                created_at: '2026-01-01T00:00:00Z',
                content: 'hello',
                usage: null,
            });
            expect(result).toEqual({ inputTokens: 0, outputTokens: 0 });
        });

        test('returns zeros for undefined usage', () => {
            const result = extractClaudeTokens({
                source_record_id: 'test-3',
                created_at: '2026-01-01T00:00:00Z',
                content: 'hello',
            });
            expect(result).toEqual({ inputTokens: 0, outputTokens: 0 });
        });

        test('includes cache read tokens in input', () => {
            const result = extractClaudeTokens({
                source_record_id: 'test-4',
                created_at: '2026-01-01T00:00:00Z',
                content: '',
                usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 200 },
            });
            expect(result.inputTokens).toBe(300);
            expect(result.outputTokens).toBe(50);
        });

        test('includes cache creation tokens in input', () => {
            const result = extractClaudeTokens({
                source_record_id: 'test-5',
                created_at: '2026-01-01T00:00:00Z',
                content: '',
                usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 75 },
            });
            expect(result.inputTokens).toBe(175);
        });

        test('treats non-number token values as 0', () => {
            const result = extractClaudeTokens({
                source_record_id: 'test-6',
                created_at: '2026-01-01T00:00:00Z',
                content: '',
                usage: { input_tokens: 'not-a-number', output_tokens: null },
            });
            expect(result).toEqual({ inputTokens: 0, outputTokens: 0 });
        });
    });

    describe('etlToCostRecord', () => {
        test('creates cost record from payload with usage', () => {
            const record = etlToCostRecord(
                {
                    source_record_id: 'test-1',
                    created_at: '2026-01-01T00:00:00Z',
                    content: 'test content',
                    model: 'claude-sonnet-4-20250514',
                    usage: { input_tokens: 1000, output_tokens: 200 },
                },
                'claude',
            );
            expect(record.source).toBe('claude');
            expect(record.model).toBe('claude-sonnet-4-20250514');
            expect(record.inputTokens).toBe(1000);
            expect(record.outputTokens).toBe(200);
            expect(record.costUsd).toBe(0);
        });

        test('estimates outputTokens from content length when no usage', () => {
            const record = etlToCostRecord(
                {
                    source_record_id: 'test-2',
                    created_at: '2026-01-01T00:00:00Z',
                    content: 'a'.repeat(100),
                },
                'pi',
            );
            expect(record.inputTokens).toBe(0);
            expect(record.outputTokens).toBe(25); // ceil(100/4)
            expect(record.source).toBe('pi');
        });

        test('returns 0 tokens when no usage and no content', () => {
            const record = etlToCostRecord(
                {
                    source_record_id: 'test-3',
                    created_at: '2026-01-01T00:00:00Z',
                    content: '',
                },
                'codex',
            );
            expect(record.inputTokens).toBe(0);
            expect(record.outputTokens).toBe(0);
        });

        test('returns unknown date for missing created_at', () => {
            const record = etlToCostRecord(
                {
                    source_record_id: 'test-4',
                    created_at: undefined as unknown as string,
                    content: '',
                },
                'pi',
            );
            expect(record.date).toBe('unknown');
        });

        test('returns unknown model for missing model field', () => {
            const record = etlToCostRecord(
                {
                    source_record_id: 'test-5',
                    created_at: '2026-01-01T00:00:00Z',
                    content: '',
                },
                'pi',
            );
            expect(record.model).toBe('unknown');
        });

        test('extracts date portion from ISO timestamp', () => {
            const record = etlToCostRecord(
                {
                    source_record_id: 'test-6',
                    created_at: '2026-05-30T14:22:00Z',
                    content: '',
                    usage: { input_tokens: 10, output_tokens: 5 },
                },
                'gemini',
            );
            expect(record.date).toBe('2026-05-30');
        });
    });

    describe('queryEtlRecords', () => {
        test('queries records from a single source table', async () => {
            const adapter = await setupEtlDb();
            const payload = { source_record_id: 'r1', created_at: '2026-05-30T00:00:00Z', content: 'hello' };
            await adapter.run(
                "INSERT INTO history_etl_pi (payload_json, imported_at) VALUES (?, '2026-05-30')",
                JSON.stringify(payload),
            );

            const records = await queryEtlRecords(adapter, 'history_etl_pi');
            expect(records).toHaveLength(1);
            expect(records[0]?.source_record_id).toBe('r1');
            adapter.close();
        });

        test('filters by since date', async () => {
            const adapter = await setupEtlDb();
            await adapter.run(
                "INSERT INTO history_etl_pi (payload_json, imported_at) VALUES (?, '2026-05-29')",
                JSON.stringify({ source_record_id: 'old', created_at: '2026-05-29T00:00:00Z', content: 'old' }),
            );
            await adapter.run(
                "INSERT INTO history_etl_pi (payload_json, imported_at) VALUES (?, '2026-05-31')",
                JSON.stringify({ source_record_id: 'new', created_at: '2026-05-31T00:00:00Z', content: 'new' }),
            );

            const records = await queryEtlRecords(adapter, 'history_etl_pi', '2026-05-30');
            expect(records).toHaveLength(1);
            expect(records[0]?.source_record_id).toBe('new');
            adapter.close();
        });

        test('returns empty array for empty table', async () => {
            const adapter = await setupEtlDb();
            const records = await queryEtlRecords(adapter, 'history_etl_pi');
            expect(records).toHaveLength(0);
            adapter.close();
        });
    });

    describe('queryAllEtlRecords', () => {
        test('queries and converts records from all source tables', async () => {
            const adapter = await setupEtlDb();
            await adapter.run(
                "INSERT INTO history_etl_pi (payload_json, imported_at) VALUES (?, '2026-05-30')",
                JSON.stringify({
                    source_record_id: 'pi-1',
                    created_at: '2026-05-30T00:00:00Z',
                    content: '',
                    model: 'gemini-2.5-flash',
                    usage: { input_tokens: 100, output_tokens: 50 },
                }),
            );
            await adapter.run(
                "INSERT INTO history_etl_claude (payload_json, imported_at) VALUES (?, '2026-05-30')",
                JSON.stringify({
                    source_record_id: 'claude-1',
                    created_at: '2026-05-30T00:00:00Z',
                    content: '',
                    model: 'claude-sonnet-4-20250514',
                    usage: { input_tokens: 200, output_tokens: 100 },
                }),
            );

            const records = await queryAllEtlRecords(adapter);
            expect(records).toHaveLength(2);
            expect(records.map((r) => r.source).sort()).toEqual(['claude', 'pi']);
            adapter.close();
        });

        test('filters all tables by since date', async () => {
            const adapter = await setupEtlDb();
            await adapter.run(
                "INSERT INTO history_etl_pi (payload_json, imported_at) VALUES (?, '2026-05-28')",
                JSON.stringify({ source_record_id: 'old', created_at: '2026-05-28T00:00:00Z', content: '' }),
            );
            await adapter.run(
                "INSERT INTO history_etl_claude (payload_json, imported_at) VALUES (?, '2026-05-31')",
                JSON.stringify({ source_record_id: 'new', created_at: '2026-05-31T00:00:00Z', content: '' }),
            );

            const records = await queryAllEtlRecords(adapter, '2026-05-30');
            expect(records).toHaveLength(1);
            expect(records[0]?.source).toBe('claude');
            adapter.close();
        });
    });
});
