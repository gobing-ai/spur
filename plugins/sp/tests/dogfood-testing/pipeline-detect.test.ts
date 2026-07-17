import { describe, expect, test } from 'bun:test';
import { detectPipelineDriving, PIPELINE_TOKENS } from '../../scripts/dogfood-testing/detect-pipeline-driving';

/**
 * dogfood-pipeline-detect — @1.2 pipeline-driving detector contract (task 0277 W7).
 *
 * Mirrors the @1.1 prose contract on a machine-checked footing. The detector
 * is what the Phase 1.0 refuse-ambiguous gate relies on; these tests encode
 * WHY the word-boundary switch mattered (0274 §3) by asserting both the
 * positives the prose matched AND the false-positives the prose let through.
 */
describe('dogfood-pipeline-detect — detectPipelineDriving word-boundary contract (task 0277 W7)', () => {
    describe('positives — pipeline-driving tokens are detected', () => {
        const positives: Array<[string, string]> = [
            // Slash-command forms (the @1.1 prose required a leading space; the new matcher is invariant).
            ['/sp:dev-run 0125 --auto', 'dev-run slash form'],
            ['/sp:dev-runall --feature M1', 'dev-runall slash form'],
            ['/sp:dev-wrap 0042', 'dev-wrap slash form'],
            ['/sp:dev-wrapall --feature M1', 'dev-wrapall slash form'],
            ['/sp:dev-idea "add rate limiting"', 'dev-idea slash form'],
            // Flag form anywhere in the string.
            ['/sp:dev-run 0125 --auto --next', '--next flag'],
            ['--next', 'bare --next'],
            // Long-form noun appearing as its own word (no leading space required).
            ['bun run apps/cli/src/index.ts task run 0042', 'bare `run` noun'],
            ['spur task runall --feature M1', 'bare `runall` noun'],
        ];

        for (const [input, label] of positives) {
            test(`positive: ${label} → detected`, () => {
                expect(detectPipelineDriving(input)).toBe(true);
            });
        }
    });

    describe('true negatives — non-pipeline testees are not flagged', () => {
        const negatives = [
            '/sp:dev-verify 0125',
            '/sp:dev-review 0125',
            '/sp:dev-unit 0125',
            '/sp:dev-refine 0125 --auto',
            'spur task show 0042',
            'spur status',
            '',
        ];

        for (const input of negatives) {
            test(`negative: ${JSON.stringify(input)} → not detected`, () => {
                expect(detectPipelineDriving(input)).toBe(false);
            });
        }
    });

    describe('false-positive regression — word-boundary prevents substring matches', () => {
        // These are the cases the @1.1 leading-space prose matcher either missed
        // (no leading space) or falsely flagged (substring inside a longer word).
        // 0274 §3 named them explicitly as the reason for the word-boundary switch.
        const falsePositives: Array<[string, string]> = [
            // `run` must NOT match inside `runaway`, `prerun`, `trundle`.
            ['the testee is a runaway process', 'run inside runaway'],
            ['spur prerun-check', 'run inside prerun'],
            ['trundle along', 'run inside trundle'],
            // `wrap` must NOT match inside `wrapper`, `wraparound`.
            ['use the wrapper pattern', 'wrap inside wrapper'],
            ['wraparound indexing', 'wrap inside wraparound'],
            // `idea` must NOT match inside `idealist`, `ideal`, `ideas` is fine though (boundary).
            ['an idealist implementation', 'idea inside idealist'],
            ['the ideal gas law', 'idea inside ideal'],
            // `runall`/`wrapall` must NOT match inside a longer identifier.
            ['cleanup-runallizer', 'runall inside runallizer'],
            // `--next` must NOT match inside `--next-gen` (hyphenated extension) or `--nextid`.
            ['--next-gen flag', '--next inside --next-gen'],
            ['--nextid=5', '--next inside --nextid'],
        ];

        for (const [input, label] of falsePositives) {
            test(`false-positive-guard: ${label} → not detected`, () => {
                expect(detectPipelineDriving(input)).toBe(false);
            });
        }
    });

    describe('leading-space invariance — detection does not depend on a leading space', () => {
        // The @1.1 prose matcher required a leading space before `run`/`runall`/...
        // which silently missed the slash forms (`/sp:dev-run` has no space before `run`).
        const pairs: Array<[string, string]> = [
            ['/sp:dev-run 0042', 'no-space-before-run slash form'],
            ['task run 0042', 'space-before-run noun form'],
        ];

        for (const [input, label] of pairs) {
            test(`leading-space-invariant: ${label}`, () => {
                expect(detectPipelineDriving(input)).toBe(true);
            });
        }
    });
    test('PIPELINE_TOKENS export — stable, ordered diagnostic surface', () => {
        // Order is documented in the helper; tests pin it so diagnostic output
        // stays stable across refactors.
        expect(PIPELINE_TOKENS).toEqual([
            '--next',
            'dev-runall',
            'dev-wrapall',
            'dev-run',
            'dev-wrap',
            'dev-idea',
            'runall',
            'wrapall',
            'run',
            'wrap',
            'idea',
        ]);
    });

    test('non-string / empty input is safe — returns false, never throws', () => {
        expect(detectPipelineDriving('')).toBe(false);
        // @ts-expect-error — runtime guard against accidental non-string callers
        expect(detectPipelineDriving(undefined)).toBe(false);
        // @ts-expect-error — runtime guard against accidental non-string callers
        expect(detectPipelineDriving(null)).toBe(false);
    });
});
