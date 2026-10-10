import { describe, expect, test } from 'bun:test';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { readVerdictArtifact } from '../../src/services/done-transition-guard';
import { extractAnswerConfidence } from '../../src/services/verify-answer-lint';
import { CONFIDENCE_LEVELS, parseVerifyVerdict } from '../../src/services/verify-verdict';

/**
 * The confidence taxonomy `HIGH|MEDIUM|LOW` is declared three times, each with a
 * hand-written "mirrors the other" comment and no executable tie between them:
 *   - `verify-verdict.ts:44`          CONFIDENCE_LEVELS (exported; the artifact schema)
 *   - `verify-answer-lint.ts:360`     a private copy (the answer-text lint)
 *   - `done-transition-guard.ts:48`   a bare type (the done gate reader)
 *
 * A drift here is silent in the worst way: a level added in one place reads as
 * "invalid confidence" in another, so a legitimate PASS is denied (or a bad one
 * admitted). These tests pin the shared taxonomy behaviourally, since only one of
 * the three exports its array.
 */

/** Minimal in-memory FS matching the guard reader's contract (exists/readFile). */
function memFs(files: Record<string, string>): FileSystem {
    return {
        exists: async (p: string) => p in files,
        readFile: async (p: string) => {
            const c = files[p];
            if (c === undefined) throw new Error(`ENOENT: ${p}`);
            return c;
        },
    } as unknown as FileSystem;
}

const RUN = '/proj/.spur/run';
/**
 * Values no consumer may accept. The near-misses matter more than the obvious ones: a
 * drift that WIDENS one definition (e.g. the lint gaining an `EXTRA` level) is the
 * dangerous direction — it admits a bogus confidence — and is invisible to a test that
 * only replays the canonical three.
 */
const OFF_TAXONOMY = [
    'SURE',
    'EXTRA',
    'VERY_HIGH',
    'HIGHEST',
    'UNVERIFIED',
    'NONE',
    'MAYBE',
    'HIGH EXTRA', // two tokens where the answer grammar takes one
    '',
];

describe('confidence taxonomy parity (HIGH|MEDIUM|LOW)', () => {
    test('the exported taxonomy is exactly the three levels, in order', () => {
        expect([...CONFIDENCE_LEVELS]).toEqual(['HIGH', 'MEDIUM', 'LOW']);
    });

    test('every level is accepted by all three consumers', async () => {
        for (const level of CONFIDENCE_LEVELS) {
            // 1. Artifact schema (`parseVerifyVerdict`).
            const parsed = parseVerifyVerdict(
                JSON.stringify({ wbs: '1139', verdict: 'PASS', confidence: level }),
                '1139',
            );
            expect(parsed.kind).toBe('valid');
            if (parsed.kind === 'valid') expect(parsed.verdict.confidence).toBe(level);

            // 2. Answer-text lint (`extractAnswerConfidence`).
            expect(extractAnswerConfidence(`Verdict: PASS\nConfidence: ${level}`)).toBe(level);

            // 3. Done-gate reader (`readVerdictArtifact`).
            const read = await readVerdictArtifact(
                memFs({
                    [`${RUN}/1139-verdict.json`]: JSON.stringify({
                        verdict: 'PASS',
                        confidence: level,
                        requirements: [{ id: 'R1', status: 'MET', evidence: 'a' }],
                    }),
                }),
                RUN,
                '1139',
            );
            expect(read.readError).toBeUndefined();
            expect(read.artifact?.confidence).toBe(level);
        }
    });

    test('every off-taxonomy value is refused by all three consumers', async () => {
        for (const bad of OFF_TAXONOMY) {
            // 1. Artifact schema — invalid, naming the field (never silently coerced).
            const parsed = parseVerifyVerdict(
                JSON.stringify({ wbs: '1139', verdict: 'PASS', confidence: bad }),
                '1139',
            );
            expect(parsed.kind).toBe('invalid');
            if (parsed.kind === 'invalid') expect(parsed.reason).toContain('confidence');

            // 2. Answer lint — undefined, never a silent default.
            expect(extractAnswerConfidence(`Verdict: PASS\nConfidence: ${bad}`)).toBeUndefined();

            // 3. Done gate — fail closed with a readError.
            const read = await readVerdictArtifact(
                memFs({
                    [`${RUN}/1139-verdict.json`]: JSON.stringify({
                        verdict: 'PASS',
                        confidence: bad,
                        requirements: [{ id: 'R1', status: 'MET', evidence: 'a' }],
                    }),
                }),
                RUN,
                '1139',
            );
            expect(read.artifact).toBeUndefined();
            expect(read.readError).toContain('confidence');
        }
    });

    test('all three consumers normalize case identically', async () => {
        for (const level of CONFIDENCE_LEVELS) {
            const lower = level.toLowerCase();
            const parsed = parseVerifyVerdict(
                JSON.stringify({ wbs: '1139', verdict: 'PASS', confidence: lower }),
                '1139',
            );
            expect(parsed.kind === 'valid' ? parsed.verdict.confidence : parsed.kind).toBe(level);
            expect(extractAnswerConfidence(`Verdict: PASS\nConfidence: ${lower}`)).toBe(level);
            const read = await readVerdictArtifact(
                memFs({
                    [`${RUN}/1139-verdict.json`]: JSON.stringify({
                        verdict: 'PASS',
                        confidence: lower,
                        requirements: [{ id: 'R1', status: 'MET', evidence: 'a' }],
                    }),
                }),
                RUN,
                '1139',
            );
            expect(read.artifact?.confidence).toBe(level);
        }
    });
});
