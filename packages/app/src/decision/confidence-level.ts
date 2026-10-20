/**
 * Derived confidence level for decision receipts and decision-log records.
 *
 * Thresholds: HIGH ≥ 0.8, MEDIUM ≥ 0.5, LOW otherwise. 0.8 is the level cut, not a catalog bar —
 * the strictest shipped bar is `executor-failure-class` at 0.85 (task 1264), so an accepted answer
 * is always HIGH, and a bar below 0.8 would let an accepted answer read MEDIUM/LOW.
 * The derivation is total and fail-conservative: absent, NaN or out-of-[0,1] confidence can never
 * present as HIGH/MEDIUM, so a broken maker value reads as LOW at every consumer without throwing.
 */

/** The closed level vocabulary, strongest first (schema enums and UI ordering). */
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

/** HIGH ≥ 0.8 — the level cut; every shipped catalog bar is at or above it (task 1264 D). */
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
