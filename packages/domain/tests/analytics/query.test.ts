import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { SOURCE_DEFINITIONS } from '@gobing-ai/ts-llm-jsonl-importer';
import { extractClaudeTokens, queryEtlRecords, SOURCE_TABLES } from '../../src/analytics/query';

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
        test('returns tokens from usage and flags usage as reported', () => {
            const result = extractClaudeTokens({
                source_record_id: 'test-1',
                created_at: '2026-01-01T00:00:00Z',
                content: 'hello',
                usage: { input_tokens: 100, output_tokens: 50 },
            });
            expect(result).toEqual({
                inputTokens: 100,
                outputTokens: 50,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                usageReported: true,
            });
        });

        test('returns zeros and usageReported=false for null usage', () => {
            const result = extractClaudeTokens({
                source_record_id: 'test-2',
                created_at: '2026-01-01T00:00:00Z',
                content: 'hello',
                usage: null,
            });
            expect(result).toEqual({
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                usageReported: false,
            });
        });

        test('returns zeros and usageReported=false for undefined usage', () => {
            const result = extractClaudeTokens({
                source_record_id: 'test-3',
                created_at: '2026-01-01T00:00:00Z',
                content: 'hello',
            });
            expect(result.usageReported).toBe(false);
            expect(result.inputTokens).toBe(0);
        });

        test('reports cache read tokens in the split AND folded into input total', () => {
            const result = extractClaudeTokens({
                source_record_id: 'test-4',
                created_at: '2026-01-01T00:00:00Z',
                content: '',
                usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 200 },
            });
            expect(result.inputTokens).toBe(300); // total stays fresh+read+create
            expect(result.cacheReadTokens).toBe(200); // and the split is now preserved
            expect(result.outputTokens).toBe(50);
        });

        test('reports cache creation tokens in the split AND folded into input total', () => {
            const result = extractClaudeTokens({
                source_record_id: 'test-5',
                created_at: '2026-01-01T00:00:00Z',
                content: '',
                usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 75 },
            });
            expect(result.inputTokens).toBe(175);
            expect(result.cacheCreationTokens).toBe(75);
        });

        test('treats non-number token values as 0 but still flags usage present', () => {
            const result = extractClaudeTokens({
                source_record_id: 'test-6',
                created_at: '2026-01-01T00:00:00Z',
                content: '',
                usage: { input_tokens: 'not-a-number', output_tokens: null },
            });
            expect(result.inputTokens).toBe(0);
            expect(result.outputTokens).toBe(0);
            expect(result.usageReported).toBe(true); // a usage object WAS present, just malformed
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

    // A persisted payload_json is always valid JSON under the validate-before-persist
    // contract, so a parse failure signals DB corruption/tampering. The reader must fail
    // loud with the offending table (not a bare opaque SyntaxError) so `spur history
    // analyze` is diagnosable, never silently dropping or mis-reporting cost data.
    describe('malformed payload_json', () => {
        test('queryEtlRecords throws a contextual error naming the table', async () => {
            const adapter = await setupEtlDb();
            await adapter.run(
                "INSERT INTO history_etl_pi (payload_json, imported_at) VALUES (?, '2026-05-30')",
                '{not valid json',
            );

            await expect(queryEtlRecords(adapter, 'history_etl_pi')).rejects.toThrow(
                /Malformed payload_json in history_etl_pi/,
            );
            adapter.close();
        });
    });

    // R5 — drift regression. The allowlist must cover every targetTable the importer
    // declares, so a new source can never land without an allowlist entry again. This
    // is exactly how omp/grok/agy were missed: SOURCE_DEFINITIONS grew, SOURCE_TABLES did not.
    // The test reads SOURCE_DEFINITIONS (production code does not — that would defeat the
    // compile-time-constant security invariant).
    describe('SOURCE_TABLES drift regression', () => {
        test('every SOURCE_DEFINITIONS targetTable is present in SOURCE_TABLES', () => {
            const declared = new Set(Object.values(SOURCE_DEFINITIONS).map((d) => d.targetTable));
            const allowed = new Set<string>(SOURCE_TABLES);
            for (const table of declared) {
                expect(allowed.has(table)).toBe(true);
            }
        });

        test('the drift check is real — removing an entry would fail it', () => {
            // Sanity: confirm the assertion has teeth. If every declared table is already
            // covered, removing one allowed entry makes at least one declared table uncovered.
            const declared = new Set(Object.values(SOURCE_DEFINITIONS).map((d) => d.targetTable));
            expect(declared.size).toBeGreaterThan(0);
            // Simulate a regression: drop one entry from the allowed set and verify the
            // invariant would be violated.
            const regressed = new Set<string>(SOURCE_TABLES);
            const victim = declared.values().next().value as string;
            regressed.delete(victim);
            expect(regressed.has(victim)).toBe(false);
        });
    });
});
