/**
 * answer-confidence — the ADR-141 derivation contract.
 *
 * The point of these cases is that the level is a READ of the answer's own rows, so the gate can
 * reject a stated level that disagrees with them. Each case names the row shape that must produce
 * the level, not a self-assessment.
 */
import { describe, expect, test } from 'bun:test';
import {
    CONFIDENCE_LEVELS,
    confidenceMismatchMessage,
    deriveReviewConfidence,
    deriveVerifyConfidence,
    normalizeConfidenceLevel,
    parseConfidenceLines,
} from '../../src/services/answer-confidence';

describe('confidence vocabulary', () => {
    test('only HIGH/MEDIUM/LOW normalize; case and surrounding space tolerated', () => {
        expect(CONFIDENCE_LEVELS).toEqual(['HIGH', 'MEDIUM', 'LOW']);
        expect(normalizeConfidenceLevel('high')).toBe('HIGH');
        expect(normalizeConfidenceLevel(' Medium ')).toBe('MEDIUM');
        expect(normalizeConfidenceLevel('LOW')).toBe('LOW');
        expect(normalizeConfidenceLevel('CERTAIN')).toBeNull();
        expect(normalizeConfidenceLevel('')).toBeNull();
    });

    test('parseConfidenceLines finds top-level lines anywhere and ignores indented table cells', () => {
        const text = [
            'Verdict: PASS',
            'Confidence: MEDIUM',
            '| Req | Status | Evidence |',
            'note: Confidence: HIGH is not a line here',
            '- **Confidence:** LOW',
        ].join('\n');
        expect(parseConfidenceLines(text)).toEqual([
            { level: 'MEDIUM', line: 2 },
            { level: 'LOW', line: 5 },
        ]);
    });
});

describe('verify derivation (ADR-141)', () => {
    const ac = (status: string, evidenceType: string) => ({ status, evidenceType });

    test('a non-PASS verdict is LOW regardless of rows', () => {
        expect(
            deriveVerifyConfidence({ verdict: 'PARTIAL', requirements: [], acceptanceCriteria: [ac('MET', 'test')] }),
        ).toBe('LOW');
    });

    test('any PARTIAL/UNMET requirement or AC is LOW', () => {
        expect(
            deriveVerifyConfidence({
                verdict: 'PASS',
                requirements: [{ status: 'PARTIAL' }],
                acceptanceCriteria: [ac('MET', 'test')],
            }),
        ).toBe('LOW');
        expect(
            deriveVerifyConfidence({
                verdict: 'PASS',
                requirements: [{ status: 'MET' }],
                acceptanceCriteria: [ac('MET', 'test'), ac('UNMET', 'static-ref')],
            }),
        ).toBe('LOW');
    });

    test('all ACs MET on executable evidence is HIGH (compound types allowed)', () => {
        expect(
            deriveVerifyConfidence({
                verdict: 'PASS',
                requirements: [{ status: 'MET' }],
                acceptanceCriteria: [ac('MET', 'test'), ac('MET', 'command'), ac('MET', 'test + command')],
            }),
        ).toBe('HIGH');
    });

    test('all ACs MET but a citation/manual-review/N/A row is MEDIUM', () => {
        for (const type of ['static-ref', 'manual-review', 'llm-judge', 'n/a']) {
            expect(
                deriveVerifyConfidence({
                    verdict: 'PASS',
                    requirements: [{ status: 'MET' }],
                    acceptanceCriteria: [ac('MET', 'test'), ac('MET', type)],
                }),
            ).toBe('MEDIUM');
        }
    });
});

describe('review derivation (ADR-141)', () => {
    const row = (priority: string, disposition: string) => ({ priority, disposition });

    test('a non-PASS verdict is LOW', () => {
        expect(deriveReviewConfidence({ verdict: 'FAIL', findings: [] })).toBe('LOW');
    });

    test('an open or undispositioned P1–P3 row is LOW', () => {
        expect(deriveReviewConfidence({ verdict: 'PASS', findings: [row('P2 (major)', 'OPEN')] })).toBe('LOW');
        expect(deriveReviewConfidence({ verdict: 'PASS', findings: [row('P3 (minor)', '')] })).toBe('LOW');
    });

    test('carried residuals only (DEFER / ACCEPTED / open P4) is MEDIUM', () => {
        expect(
            deriveReviewConfidence({ verdict: 'PASS', findings: [row('P3 (minor)', 'DEFER(doc-only, no reader)')] }),
        ).toBe('MEDIUM');
        expect(deriveReviewConfidence({ verdict: 'PASS', findings: [row('P4 (advisory)', 'ACCEPTED')] })).toBe(
            'MEDIUM',
        );
        expect(deriveReviewConfidence({ verdict: 'PASS', findings: [row('P4 (advisory)', 'OPEN')] })).toBe('MEDIUM');
    });

    test('every finding closed is HIGH', () => {
        expect(
            deriveReviewConfidence({
                verdict: 'PASS',
                findings: [row('P2 (major)', 'FIXED(abc1234)'), row('P3 (minor)', 'RESOLVED')],
            }),
        ).toBe('HIGH');
        expect(deriveReviewConfidence({ verdict: 'PASS', findings: [] })).toBe('HIGH');
    });
});

describe('mismatch message', () => {
    test('names the stated level, the derived level and the basis', () => {
        const message = confidenceMismatchMessage('HIGH', 'MEDIUM', '2 AC row(s) carry no executable evidence');
        expect(message).toContain('Confidence: HIGH');
        expect(message).toContain('derive MEDIUM');
        expect(message).toContain('no executable evidence');
    });
});
