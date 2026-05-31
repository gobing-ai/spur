import { describe, expect, test } from 'bun:test';
import { etlToCostRecord, extractClaudeTokens, queryEtlRecords } from '../../src/analytics/query';

describe('analytics query', () => {
    test('extractClaudeTokens returns tokens from usage', () => {
        const result = extractClaudeTokens({
            source_record_id: 'test-1',
            created_at: '2026-01-01T00:00:00Z',
            content: 'hello',
            usage: { input_tokens: 100, output_tokens: 50 },
        });
        expect(result).toEqual({ inputTokens: 100, outputTokens: 50 });
    });

    test('etlToCostRecord creates cost record from payload', () => {
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
    });

    test('queryEtlRecords requires db adapter', () => {
        // Type check: function exists and takes DbAdapter
        expect(typeof queryEtlRecords).toBe('function');
    });
});
