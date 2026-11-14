import { describe, expect, test } from 'bun:test';
import {
    CONFIDENCE_HIGH_THRESHOLD,
    CONFIDENCE_MEDIUM_THRESHOLD,
    confidenceLevel,
} from '../../src/decision/confidence-level';

/**
 * Focused verification for the derived confidence thresholds and their fail-conservative
 * handling of absent, non-finite and out-of-range maker values (design §3.5, task 1100).
 */

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

    test('the MEDIUM threshold is pinned and the two thresholds stay ordered', () => {
        expect(CONFIDENCE_MEDIUM_THRESHOLD).toBe(0.5);
        expect(CONFIDENCE_MEDIUM_THRESHOLD).toBeLessThan(CONFIDENCE_HIGH_THRESHOLD);
    });

    test('absent, NaN and out-of-range values fail conservative to LOW', () => {
        expect(confidenceLevel(null)).toBe('LOW');
        expect(confidenceLevel(undefined)).toBe('LOW');
        expect(confidenceLevel(Number.NaN)).toBe('LOW');
        expect(confidenceLevel(-0.1)).toBe('LOW');
        expect(confidenceLevel(1.1)).toBe('LOW');
    });

    test('non-finite values never read as HIGH, even though Infinity compares above 0.8', () => {
        // Contract pin, not a guard pin: `Infinity` is also caught by the `> 1` range check and
        // NaN by the ordered comparisons, so no single guard owns this. What must hold is the
        // outcome — a maker returning a non-finite number can never outrank a real 0.8+ answer.
        expect(confidenceLevel(Number.POSITIVE_INFINITY)).toBe('LOW');
        expect(confidenceLevel(Number.NEGATIVE_INFINITY)).toBe('LOW');
    });
});
