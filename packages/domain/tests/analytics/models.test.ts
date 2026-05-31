import { describe, expect, test } from 'bun:test';
import { MODEL_PRICING, resolvePricing, UNKNOWN_MODEL_PRICING } from '../../src/analytics/models';

describe('analytics models', () => {
    describe('MODEL_PRICING', () => {
        test('contains known Claude models', () => {
            expect(MODEL_PRICING['claude-3-opus-20240229']).toBeDefined();
            expect(MODEL_PRICING['claude-sonnet-4-20250514']).toBeDefined();
            expect(MODEL_PRICING['claude-haiku-4-5']).toBeDefined();
        });

        test('contains known Gemini models', () => {
            expect(MODEL_PRICING['gemini-2.5-flash']).toBeDefined();
            expect(MODEL_PRICING['gemini-2.5-pro']).toBeDefined();
        });

        test('contains known GPT models', () => {
            expect(MODEL_PRICING['gpt-4o']).toBeDefined();
            expect(MODEL_PRICING['gpt-4o-mini']).toBeDefined();
            expect(MODEL_PRICING.o1).toBeDefined();
        });

        test('each pricing entry has inputPricePer1M and outputPricePer1M', () => {
            for (const [, pricing] of Object.entries(MODEL_PRICING)) {
                expect(typeof pricing.inputPricePer1M).toBe('number');
                expect(typeof pricing.outputPricePer1M).toBe('number');
                expect(pricing.inputPricePer1M).toBeGreaterThan(0);
                expect(pricing.outputPricePer1M).toBeGreaterThan(0);
            }
        });
    });

    describe('UNKNOWN_MODEL_PRICING', () => {
        test('has conservative fallback values', () => {
            expect(UNKNOWN_MODEL_PRICING.inputPricePer1M).toBe(3);
            expect(UNKNOWN_MODEL_PRICING.outputPricePer1M).toBe(15);
        });
    });

    describe('resolvePricing', () => {
        test('returns exact match for known model', () => {
            const pricing = resolvePricing('claude-sonnet-4-20250514');
            expect(pricing.inputPricePer1M).toBe(3);
            expect(pricing.outputPricePer1M).toBe(15);
        });

        test('returns UNKNOWN_MODEL_PRICING for undefined', () => {
            const pricing = resolvePricing(undefined);
            expect(pricing).toBe(UNKNOWN_MODEL_PRICING);
        });

        test('returns UNKNOWN_MODEL_PRICING for empty string', () => {
            const pricing = resolvePricing('');
            expect(pricing).toBe(UNKNOWN_MODEL_PRICING);
        });

        test('performs case-insensitive exact match', () => {
            const pricing = resolvePricing('Claude-Sonnet-4-20250514');
            expect(pricing.inputPricePer1M).toBe(3);
            expect(pricing.outputPricePer1M).toBe(15);
        });

        test('performs prefix match for longer model name', () => {
            // "gemini-2.5-flash" is a key, longer names starting with it should match
            const pricing = resolvePricing('gemini-2.5-flash-preview-05-20');
            expect(pricing.inputPricePer1M).toBe(0.15);
            expect(pricing.outputPricePer1M).toBe(0.6);
        });

        test('returns UNKNOWN_MODEL_PRICING for completely unknown model', () => {
            const pricing = resolvePricing('totally-unknown-model-xyz');
            expect(pricing).toBe(UNKNOWN_MODEL_PRICING);
        });

        test('returns pricing for exact GPT model', () => {
            const pricing = resolvePricing('gpt-4o');
            expect(pricing.inputPricePer1M).toBe(2.5);
            expect(pricing.outputPricePer1M).toBe(10);
        });

        test('returns pricing for exact o1 model', () => {
            const pricing = resolvePricing('o1');
            expect(pricing.inputPricePer1M).toBe(15);
            expect(pricing.outputPricePer1M).toBe(60);
        });
    });
});
