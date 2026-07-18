import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
    detectImplementHeavy,
    detectPipelineDriving,
    evaluateDogfoodGate,
    IMPLEMENT_HEAVY_ADVISORY_MESSAGE,
    isImplementHeavyStep,
    PIPELINE_DRIVING_REFUSE_MESSAGE,
    PIPELINE_TOKENS,
    parseCliArgs,
    runCli,
} from '../../scripts/dogfood-testing/detect-pipeline-driving';

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

describe('dogfood implement-heavy + Phase 1.0 gate (task 0277 W8 + live CLI)', () => {
    test('isImplementHeavyStep — dev-run is heavy; dev-verify is not', () => {
        expect(isImplementHeavyStep('/sp:dev-run 0125 --auto')).toBe(true);
        expect(isImplementHeavyStep('/sp:dev-verify 0125 --auto --next')).toBe(false);
        expect(isImplementHeavyStep('/sp:dev-review 0125')).toBe(false);
        expect(isImplementHeavyStep('/sp:dev-refine 0125 --auto --next')).toBe(true);
        expect(isImplementHeavyStep('/sp:dev-refine 0125 --auto')).toBe(false);
    });

    test('detectImplementHeavy — needs pipeline-driving AND a heavy step', () => {
        expect(detectImplementHeavy('/sp:dev-verify 0277 --next', ['load', 'verify', 'done'])).toBe(false);
        expect(detectImplementHeavy('/sp:dev-run 0125 --auto --next', ['implement task', 'verify'])).toBe(true);
        // no steps → fall back to testee string
        expect(detectImplementHeavy('/sp:dev-run 0125 --auto --next')).toBe(true);
        expect(detectImplementHeavy('/sp:dev-verify 0125 --next')).toBe(false);
    });

    test('evaluateDogfoodGate — refuse when pipeline-driving without max-retry', () => {
        const r = evaluateDogfoodGate('/sp:dev-run 0125 --next', { maxRetryPresent: false });
        expect(r.refuse).toBe(true);
        expect(r.exitCode).toBe(2);
        expect(r.message).toBe(PIPELINE_DRIVING_REFUSE_MESSAGE);
    });

    test('evaluateDogfoodGate — advisory when heavy + max-retry present', () => {
        const r = evaluateDogfoodGate('/sp:dev-run 0125 --next', {
            maxRetryPresent: true,
            steps: ['implement via dev-run'],
        });
        expect(r.refuse).toBe(false);
        expect(r.advisory).toBe(true);
        expect(r.exitCode).toBe(0);
        expect(r.message).toBe(IMPLEMENT_HEAVY_ADVISORY_MESSAGE);
    });

    test('isImplementHeavyStep — verify/review with a mutating --fix mode is heavy (0280 dogfood P2)', () => {
        expect(isImplementHeavyStep('/sp:dev-verify 0280 --auto --next --force --focus all --fix all')).toBe(true);
        expect(isImplementHeavyStep('/sp:dev-verify 0280 --next --fix blockers-first')).toBe(true);
        expect(isImplementHeavyStep('/sp:dev-review 0280 --fix all')).toBe(true);
        // --fix none stays observational; --focus all must never masquerade as --fix all.
        expect(isImplementHeavyStep('/sp:dev-verify 0280 --next --fix none')).toBe(false);
        expect(isImplementHeavyStep('/sp:dev-verify 0280 --next --focus all')).toBe(false);
    });

    test('detectImplementHeavy — a derived step label carrying --fix all triggers the advisory path', () => {
        expect(detectImplementHeavy('/sp:dev-verify 0280 --next', ['--fix all repair pass + re-verify'])).toBe(true);
    });

    test('evaluateDogfoodGate — W8 advisory for pipeline-driving verify --fix all (0280 dogfood P2)', () => {
        const r = evaluateDogfoodGate('/sp:dev-verify 0280 --auto --next --force --focus all --fix all', {
            maxRetryPresent: true,
        });
        expect(r.refuse).toBe(false);
        expect(r.advisory).toBe(true);
        expect(r.implementHeavy).toBe(true);
        expect(r.exitCode).toBe(0);
        expect(r.message).toBe(IMPLEMENT_HEAVY_ADVISORY_MESSAGE);
    });

    test('evaluateDogfoodGate — verify-only --next with max-retry is clean proceed', () => {
        const r = evaluateDogfoodGate('/sp:dev-verify 0277 --auto --next --force', {
            maxRetryPresent: true,
            steps: ['load task', 'verify requirements', 'strict-core done'],
        });
        expect(r.refuse).toBe(false);
        expect(r.advisory).toBe(false);
        expect(r.implementHeavy).toBe(false);
        expect(r.exitCode).toBe(0);
        expect(r.message).toBeNull();
    });

    test('parseCliArgs — flags, positional, -- remainder, empty steps', () => {
        expect(parseCliArgs(['--help']).help).toBe(true);
        expect(parseCliArgs(['-h']).help).toBe(true);
        expect(parseCliArgs(['--testee', '/sp:dev-run 1', '--max-retry-present', '--json'])).toEqual({
            testee: '/sp:dev-run 1',
            maxRetryPresent: true,
            steps: [],
            json: true,
            help: false,
        });
        expect(parseCliArgs(['/sp:dev-verify 1']).testee).toBe('/sp:dev-verify 1');
        expect(parseCliArgs(['--', 'a', 'b', 'c']).testee).toBe('a b c');
        expect(parseCliArgs(['--steps', 's1||s2||']).steps).toEqual(['s1', 's2']);
        expect(parseCliArgs(['--steps', '']).steps).toEqual([]);
        expect(parseCliArgs(['--testee']).testee).toBeNull();
    });

    test('runCli — refuse / advisory / help / usage / clean proceed', () => {
        const refuse = runCli(['--testee', '/sp:dev-run 0125 --auto']);
        expect(refuse.exitCode).toBe(2);
        expect(refuse.stdout).toContain('pipeline-driving testee detected');

        const advisory = runCli([
            '--testee',
            '/sp:dev-run 0125 --next',
            '--max-retry-present',
            '--steps',
            'implement||verify',
            '--json',
        ]);
        expect(advisory.exitCode).toBe(0);
        const parsed = JSON.parse(advisory.stdout);
        expect(parsed.advisory).toBe(true);
        expect(parsed.refuse).toBe(false);

        const help = runCli(['--help']);
        expect(help.exitCode).toBe(0);
        expect(help.stderr).toContain('Usage:');

        const usage = runCli([]);
        expect(usage.exitCode).toBe(1);
        expect(usage.stderr).toContain('Usage:');

        const clean = runCli([
            '--testee',
            '/sp:dev-verify 0277 --next',
            '--max-retry-present',
            '--steps',
            'load||verify',
        ]);
        expect(clean.exitCode).toBe(0);
        expect(clean.stdout).toBe('');
    });

    test('CLI binary — refuses pipeline-driving without --max-retry-present (exit 2)', async () => {
        const proc = Bun.spawn({
            cmd: [
                'bun',
                'plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts',
                '--testee',
                '/sp:dev-run 0125 --auto',
            ],
            cwd: join(import.meta.dir, '..', '..', '..', '..'),
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const out = await new Response(proc.stdout).text();
        const code = await proc.exited;
        expect(code).toBe(2);
        expect(out).toContain('pipeline-driving testee detected');
    });
});
