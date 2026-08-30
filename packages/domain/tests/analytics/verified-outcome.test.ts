import { describe, expect, test } from 'bun:test';
import {
    deriveVerifiedOutcomeStat,
    VERIFIED_OUTCOME_SCHEMA_VERSION,
    type VerifiedOutcomeTaskInput,
} from '../../src/analytics/verified-outcome';

/**
 * Verified-outcome fold fixtures (0712 R8): each acceptance scenario gets a
 * table row. The fold is pure — fixtures are evidence rows, not DB states.
 */
function input(overrides: Partial<VerifiedOutcomeTaskInput> = {}): VerifiedOutcomeTaskInput {
    return {
        wbs: '0700',
        done: true,
        forcedDone: false,
        verdictPresent: true,
        passVerdict: true,
        sectionVerdictPresent: true,
        proofDigestPresent: true,
        certifyingRunCompleted: true,
        reopened: false,
        supersedingFailedRun: false,
        firstWipAt: '2026-08-29T10:00:00.000Z',
        doneAt: '2026-08-29T11:00:00.000Z',
        measuredTokens: 3000,
        ...overrides,
    };
}

const OPEN_WINDOW = { since: null, until: null };

describe('deriveVerifiedOutcomeStat', () => {
    test('clean verified result counts as verified without correction', () => {
        const stat = deriveVerifiedOutcomeStat([input()], OPEN_WINDOW);
        expect(stat.verifiedResults).toBe(1);
        expect(stat.verifiedWithoutCorrection).toBe(1);
        expect(stat.correctionCount).toBe(0);
        expect(stat.verifiedRate).toBe(1);
        expect(stat.excludedReasons).toEqual({
            notDone: 0,
            forcedDone: 0,
            missingVerdict: 0,
            syntheticVerdict: 0,
            verdictNotPass: 0,
            proofAbsent: 0,
            certifyingRunFailed: 0,
        });
    });

    test('forced done, missing verdict, synthetic verdict, non-PASS, absent proof, failed run all exclude', () => {
        const stat = deriveVerifiedOutcomeStat(
            [
                input({ wbs: '1', forcedDone: true }),
                input({ wbs: '2', verdictPresent: false, sectionVerdictPresent: false }),
                input({ wbs: '3', verdictPresent: false, sectionVerdictPresent: true }),
                input({ wbs: '4', passVerdict: false }),
                input({ wbs: '5', proofDigestPresent: false }),
                input({ wbs: '6', certifyingRunCompleted: false }),
                input({ wbs: '7', done: false }),
            ],
            OPEN_WINDOW,
        );
        expect(stat.verifiedResults).toBe(0);
        expect(stat.taskDenominator).toBe(7);
        expect(stat.excludedReasons).toEqual({
            notDone: 1,
            forcedDone: 1,
            missingVerdict: 1,
            syntheticVerdict: 1,
            verdictNotPass: 1,
            proofAbsent: 1,
            certifyingRunFailed: 1,
        });
        expect(stat.verifiedRate).toBe(0);
    });

    test('reopen and superseding failed run count as corrections and retry-exhaustion', () => {
        const stat = deriveVerifiedOutcomeStat(
            [input({ wbs: '1', reopened: true }), input({ wbs: '2', supersedingFailedRun: true })],
            OPEN_WINDOW,
        );
        expect(stat.verifiedResults).toBe(2);
        expect(stat.correctionCount).toBe(2);
        expect(stat.verifiedWithoutCorrection).toBe(0);
        expect(stat.retryExhaustedCount).toBe(1);
    });

    test('rates are null on an empty population and time/cost stay null without evidence', () => {
        const stat = deriveVerifiedOutcomeStat([], OPEN_WINDOW);
        expect(stat.taskDenominator).toBe(0);
        expect(stat.verifiedRate).toBeNull();
        expect(stat.correctionRate).toBeNull();
        expect(stat.verifiedWithoutCorrectionRate).toBeNull();
        expect(stat.timeToVerified).toEqual({ count: 0, meanMs: null, maxMs: null });
        expect(stat.measuredTokensPerVerifiedResult).toBeNull();
        expect(stat.costCoverage).toEqual({ covered: 0, total: 0 });
    });

    test('unmapped cost yields null metric with explicit partial coverage (R4)', () => {
        const stat = deriveVerifiedOutcomeStat(
            [input({ wbs: '1', measuredTokens: 1000 }), input({ wbs: '2', measuredTokens: null })],
            OPEN_WINDOW,
        );
        // One covered, one not — the per-result figure exists but coverage is labeled.
        expect(stat.measuredTokensPerVerifiedResult).toBe(1000);
        expect(stat.costCoverage).toEqual({ covered: 1, total: 2 });
    });

    test('zero covered cost is null, never zero', () => {
        const stat = deriveVerifiedOutcomeStat([input({ wbs: '1', measuredTokens: null })], OPEN_WINDOW);
        expect(stat.measuredTokensPerVerifiedResult).toBeNull();
        expect(stat.costCoverage).toEqual({ covered: 0, total: 1 });
    });

    test('time-to-verified folds mean and max from wip→done spans', () => {
        const stat = deriveVerifiedOutcomeStat(
            [
                input({ wbs: '1', firstWipAt: '2026-08-29T10:00:00.000Z', doneAt: '2026-08-29T10:10:00.000Z' }),
                input({ wbs: '2', firstWipAt: '2026-08-29T10:00:00.000Z', doneAt: '2026-08-29T10:30:00.000Z' }),
                input({ wbs: '3', firstWipAt: null, doneAt: '2026-08-29T10:30:00.000Z' }),
            ],
            OPEN_WINDOW,
        );
        expect(stat.timeToVerified).toEqual({ count: 2, meanMs: 20 * 60 * 1000, maxMs: 30 * 60 * 1000 });
    });

    test('duplicate wbs rows dedupe to the first occurrence (R8)', () => {
        const stat = deriveVerifiedOutcomeStat(
            [input({ wbs: '0900' }), input({ wbs: '0900', passVerdict: false, measuredTokens: 99 })],
            OPEN_WINDOW,
        );
        expect(stat.taskDenominator).toBe(1);
        expect(stat.verifiedResults).toBe(1);
        expect(stat.measuredTokensPerVerifiedResult).toBe(3000);
    });

    test('window bounds and schema version pass through', () => {
        const stat = deriveVerifiedOutcomeStat([], { since: '2026-08-01T00:00:00Z', until: null });
        expect(stat.schemaVersion).toBe(VERIFIED_OUTCOME_SCHEMA_VERSION);
        expect(stat.window).toEqual({ since: '2026-08-01T00:00:00Z', until: null });
    });
});
