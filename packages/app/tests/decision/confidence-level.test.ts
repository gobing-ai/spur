import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { decisionLogRowSchema } from '@gobing-ai/spur-contracts';
import { loadDecisionCatalog } from '@gobing-ai/ts-ai-decision';
import {
    CONFIDENCE_HIGH_THRESHOLD,
    CONFIDENCE_MEDIUM_THRESHOLD,
    type ConfidenceLevel,
    confidenceLevel,
} from '../../src/decision/confidence-level';
import { extractAnswerConfidence } from '../../src/services/verify-answer-lint';
import { FEATURE_RECEIPT_CONFIDENCE_LEVELS } from '../../src/workflow/feature-verification-receipt';

/**
 * Verification for the derived confidence level (design §3.5, task 1100): the closed
 * HIGH/MEDIUM/LOW vocabulary, its boundaries, its fail-conservative behaviour on a
 * broken maker value, the catalog bar it is anchored to, and the FOUR declarations of
 * that vocabulary which must stay identical — this module's derivation, the answer
 * lint, the feature-verification receipt, and the transport enum.
 *
 * Every case that can silently mislead an operator is enumerated rather than sampled:
 * a value one step either side of each threshold, every invalid shape a maker can
 * return, and the two ways the vocabulary can drift (the catalog bar moving, or a
 * consumer's vocabulary diverging).
 */

const DECISIONS_DIR = join(import.meta.dir, '../../../../config', 'decisions');

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

    test('the level vocabulary is closed to exactly three values', () => {
        const values: Array<number | null> = [0, 0.1, 0.49, 0.5, 0.79, 0.8, 0.9, 1, null];
        const levels = new Set<ConfidenceLevel>(values.map((value) => confidenceLevel(value)));
        expect([...levels].sort()).toEqual(['HIGH', 'LOW', 'MEDIUM']);
    });

    test('every declaration of the vocabulary agrees — derivation, answer lint, receipt, transport', () => {
        // The closed vocabulary is written down four times: this module's type, the answer lint's
        // internal list, `FEATURE_RECEIPT_CONFIDENCE_LEVELS`, and the transport enum. The closure
        // test above pins only the derivation's own outputs against literals, so a consumer could
        // gain or lose a value unnoticed — exactly the "consumer's enum diverging" drift the file
        // header claims to cover. Each consumer is probed through its real entry point rather than
        // through a re-exported list, so the assertion cannot pass on a stale copy.
        const derived = [
            ...new Set(
                [0, 0.1, 0.49, 0.5, 0.6, 0.79, 0.8, 0.9, 1, null, Number.NaN, -1, 2].map((value) =>
                    confidenceLevel(value),
                ),
            ),
        ].sort();
        expect(derived).toEqual([...FEATURE_RECEIPT_CONFIDENCE_LEVELS].sort());
        expect(derived).toEqual(['HIGH', 'LOW', 'MEDIUM']);

        for (const level of FEATURE_RECEIPT_CONFIDENCE_LEVELS) {
            expect(extractAnswerConfidence(`Confidence: ${level}`)).toBe(level);
            expect(decisionLogRowSchema.shape.confidenceLevel.safeParse(level).success).toBe(true);
        }
        // Both consumers refuse a value outside the vocabulary, so neither is merely a superset.
        for (const bogus of ['CERTAIN', 'MEDIUMISH', '']) {
            expect(extractAnswerConfidence(`Confidence: ${bogus}`)).toBeUndefined();
            expect(decisionLogRowSchema.shape.confidenceLevel.safeParse(bogus).success).toBe(false);
        }
    });

    test('every shipped catalog bar is at or below the HIGH threshold, and one reaches it', async () => {
        // The threshold is anchored to the strictest served bar (docstring: review-failure-class
        // 0.8). A catalog that raised a bar above it would let a decision declare a floor the
        // strongest level cannot express; a corpus that lost the bar entirely would leave the
        // threshold unanchored. Both are drift this pins.
        const files = readdirSync(DECISIONS_DIR).filter((name) => name.endsWith('.yaml'));
        expect(files.length).toBeGreaterThan(0);
        const bars: number[] = [];
        for (const name of files) {
            const catalog = await loadDecisionCatalog(join(DECISIONS_DIR, name));
            const declared = [
                catalog.defaults?.minConfidence,
                ...Object.values(catalog.decisions).map((decision) => decision.minConfidence),
            ].filter((value): value is number => typeof value === 'number');
            bars.push(...declared);
        }
        expect(bars.length).toBeGreaterThan(0);
        expect(Math.max(...bars)).toBe(CONFIDENCE_HIGH_THRESHOLD);
    });

    test('an out-of-range confidence still satisfies the contract row schema as LOW', () => {
        // The Board reads persisted rows through this schema; an invalid maker value must land as
        // a valid row (LOW) rather than failing transport validation.
        const row = {
            id: 'invocation',
            decisionId: 'task-triage',
            decisionType: 'choice',
            caller: 'cli',
            runId: null,
            workflowName: null,
            nodeId: null,
            wbs: null,
            makerName: 'typesafe',
            makerSource: 'catalog-default',
            catalogLayer: 'shared',
            catalogSource: 'catalog',
            minConfidence: 0.8,
            inputKeys: [],
            evidenceDigest: null,
            outcome: 'accepted',
            value: 'standard',
            fallbackValue: 'standard',
            source: 'model',
            reason: 'accepted',
            confidence: 1.1,
            confidenceLevel: confidenceLevel(1.1),
            error: null,
            startedAt: '2026-10-11T00:00:00.000Z',
            endedAt: '2026-10-11T00:00:01.000Z',
            durationMs: 1000,
            schemaVersion: 1,
        };
        expect(row.confidenceLevel).toBe('LOW');
        expect(decisionLogRowSchema.safeParse(row).success).toBe(true);
    });
});
