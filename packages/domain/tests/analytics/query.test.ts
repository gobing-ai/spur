import { describe, expect, test } from 'bun:test';
import { extractClaudeTokens } from '../../src/analytics/query';

describe('analytics query', () => {
    describe('extractClaudeTokens', () => {
        test('returns tokens from usage and flags usage as reported', () => {
            const result = extractClaudeTokens({
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
            const result = extractClaudeTokens({});
            expect(result.usageReported).toBe(false);
            expect(result.inputTokens).toBe(0);
        });

        test('reports cache read tokens in the split AND folded into input total', () => {
            const result = extractClaudeTokens({
                usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 200 },
            });
            expect(result.inputTokens).toBe(300); // total stays fresh+read+create
            expect(result.cacheReadTokens).toBe(200); // and the split is now preserved
            expect(result.outputTokens).toBe(50);
        });

        test('reports cache creation tokens in the split AND folded into input total', () => {
            const result = extractClaudeTokens({
                usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 75 },
            });
            expect(result.inputTokens).toBe(175);
            expect(result.cacheCreationTokens).toBe(75);
        });

        test('treats non-number token values as 0 but still flags usage present', () => {
            const result = extractClaudeTokens({
                usage: { input_tokens: 'not-a-number', output_tokens: null },
            });
            expect(result.inputTokens).toBe(0);
            expect(result.outputTokens).toBe(0);
            expect(result.usageReported).toBe(true); // a usage object WAS present, just malformed
        });
    });
});
