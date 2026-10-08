import { describe, expect, test } from 'bun:test';
import { CONFIDENCE_HIGH_THRESHOLD, confidenceLevel } from '../../src/decision/confidence-level';

describe('confidenceLevel', () => {
    test('threshold boundaries (HIGH ≥ 0.8, MEDIUM ≥ 0.5, LOW otherwise)', () => {
        expect(CONFIDENCE_HIGH_THRESHOLD).toBe(0.8);
        expect(confidenceLevel(1)).toBe('HIGH');
        expect(confidenceLevel(0.8)).toBe('HIGH');
        expect(confidenceLevel(0.79)).toBe('MEDIUM');
        expect(confidenceLevel(0.5)).toBe('MEDIUM');
        expect(confidenceLevel(0.49)).toBe('LOW');
        expect(confidenceLevel(0)).toBe('LOW');
    });

    test('absent, NaN and out-of-range values fail conservative to LOW', () => {
        expect(confidenceLevel(null)).toBe('LOW');
        expect(confidenceLevel(undefined)).toBe('LOW');
        expect(confidenceLevel(Number.NaN)).toBe('LOW');
        expect(confidenceLevel(-0.1)).toBe('LOW');
        expect(confidenceLevel(1.1)).toBe('LOW');
    });
});
