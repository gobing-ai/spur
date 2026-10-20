/**
 * Task 1263-adjacent verification gap (session review 2026-10-19): the Decisions drawer is the
 * only place a reader sees the derived `HIGH`/`MEDIUM`/`LOW` level, and it had no test. The
 * derivation itself (`packages/app/src/decision/confidence-level.ts`) and the ledger projection
 * (`decision-log-query.ts`) are covered elsewhere; what is pinned here is the RENDER contract:
 *
 * - the level leads, so a row whose maker never answered reads `LOW` rather than an empty `—`;
 * - the raw confidence and the catalog bar follow, and the bar is omitted when the catalog
 *   declares none (never `(min null)`);
 * - the drawer displays the level the row carries and never re-derives it, so the one derivation
 *   keeps its single owner.
 */
import { describe, expect, test } from 'bun:test';

import { formatConfidence } from '../../../src/modules/observability/DecisionDetailDrawer';

/**
 * One ledger row's confidence trio as the contract carries it. The level is derived in the app
 * layer (`packages/app/src/decision/confidence-level.ts`) and projected onto the row; a web test
 * must not import across that boundary (ADR-021), so the expected levels here are the documented
 * thresholds spelled out per case.
 */
function row(
    confidence: number | null,
    minConfidence: number | null = 0.8,
): { confidence: number | null; confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW'; minConfidence: number | null } {
    const level =
        confidence === null || !Number.isFinite(confidence) || confidence < 0 || confidence > 1
            ? 'LOW'
            : confidence >= 0.8
              ? 'HIGH'
              : confidence >= 0.5
                ? 'MEDIUM'
                : 'LOW';
    return { confidence, confidenceLevel: level, minConfidence };
}

describe('formatConfidence — Decisions drawer confidence field', () => {
    test('a served answer leads with its level, then the raw value and the bar it cleared', () => {
        expect(formatConfidence(row(0.9))).toBe('HIGH · 0.9 (min 0.8)');
        expect(formatConfidence(row(0.62, 0.5))).toBe('MEDIUM · 0.62 (min 0.5)');
        expect(formatConfidence(row(0.12, 0.85))).toBe('LOW · 0.12 (min 0.85)');
    });

    test('a catalog without a bar renders no suffix — never `(min null)`', () => {
        expect(formatConfidence(row(0.9, null))).toBe('HIGH · 0.9');
        expect(formatConfidence(row(0.35, null))).toBe('LOW · 0.35');
    });

    test('an unanswered row reads its level alone, never an empty dash', () => {
        // A fallback row has no numeric confidence; the level is the whole signal.
        expect(formatConfidence({ confidence: null, confidenceLevel: 'LOW', minConfidence: 0.8 })).toBe('LOW');
        expect(formatConfidence({ confidence: null, confidenceLevel: 'MEDIUM', minConfidence: null })).toBe('MEDIUM');
    });

    test('the thresholds the drawer relies on: 0.8 is HIGH, 0.5 is MEDIUM, below is LOW', () => {
        expect(formatConfidence(row(0.8))).toBe('HIGH · 0.8 (min 0.8)');
        expect(formatConfidence(row(0.799))).toBe('MEDIUM · 0.799 (min 0.8)');
        expect(formatConfidence(row(0.5))).toBe('MEDIUM · 0.5 (min 0.8)');
        expect(formatConfidence(row(0.499))).toBe('LOW · 0.499 (min 0.8)');
        expect(formatConfidence(row(0))).toBe('LOW · 0 (min 0.8)');
        expect(formatConfidence(row(1))).toBe('HIGH · 1 (min 0.8)');
    });

    test('the drawer displays the row level verbatim and never re-derives it', () => {
        // The level is derived once, in the app layer, when the ledger row is projected. A drawer
        // that recomputed it would silently diverge from a schema or threshold change.
        expect(formatConfidence({ confidence: 0.9, confidenceLevel: 'LOW', minConfidence: 0.8 })).toBe(
            'LOW · 0.9 (min 0.8)',
        );
        expect(formatConfidence({ confidence: null, confidenceLevel: 'HIGH', minConfidence: null })).toBe('HIGH');
    });

    test('an out-of-range or non-finite confidence is never graded HIGH', () => {
        expect(formatConfidence(row(1.5))).toBe('LOW · 1.5 (min 0.8)');
        expect(formatConfidence(row(-0.2))).toBe('LOW · -0.2 (min 0.8)');
        expect(formatConfidence(row(Number.NaN))).toBe('LOW · NaN (min 0.8)');
    });
});
