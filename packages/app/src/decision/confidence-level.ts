/**
 * Derived confidence level for decision receipts and decision-log records.
 *
 * Thresholds: HIGH ≥ 0.8 (the catalog's strictest `minConfidence` bar —
 * review-failure-class), MEDIUM ≥ 0.5, LOW otherwise. The derivation is total
 * and fail-conservative: absent, NaN or out-of-[0,1] confidence can never
 * present as HIGH/MEDIUM, so a broken maker value reads as LOW at every
 * consumer without throwing.
 */

/** The closed level vocabulary, strongest first (schema enums and UI ordering). */
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

/** HIGH ≥ 0.8 — the catalog strict bar (`review-failure-class.minConfidence`). */
export const CONFIDENCE_HIGH_THRESHOLD = 0.8;
/** MEDIUM ≥ 0.5. */
export const CONFIDENCE_MEDIUM_THRESHOLD = 0.5;

/** Map a raw maker confidence to its level; total, and LOW for any absent or invalid value. */
export function confidenceLevel(confidence: number | null | undefined): ConfidenceLevel {
    if (confidence === null || confidence === undefined) return 'LOW';
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return 'LOW';
    if (confidence >= CONFIDENCE_HIGH_THRESHOLD) return 'HIGH';
    return confidence >= CONFIDENCE_MEDIUM_THRESHOLD ? 'MEDIUM' : 'LOW';
}
