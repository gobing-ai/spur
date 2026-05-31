import { describe, expect, test } from 'bun:test';
import { MODEL_PRICING } from '../../src/analytics/models';

describe('analytics models', () => {
    test('MODEL_PRICING contains known models', () => {
        expect(MODEL_PRICING['claude-sonnet-4-20250514']).toBeDefined();
        expect(MODEL_PRICING['gemini-2.5-flash']).toBeDefined();
    });
});
