import { describe, expect, test } from 'bun:test';
import {
    assertCanonicalTimeoutMs,
    MAX_TIMEOUT_INPUT_MS,
    normalizeLegacyTimeoutMs,
    parseTimeoutInput,
} from '../../src/services/execution-policy';

describe('parseTimeoutInput (task 0813 R3 — strict explicit inputs)', () => {
    test("accepts 'none' in any casing and surrounding whitespace as explicit unlimited", () => {
        expect(parseTimeoutInput('none')).toBeNull();
        expect(parseTimeoutInput('NONE')).toBeNull();
        expect(parseTimeoutInput('  None  ')).toBeNull();
    });

    test('accepts positive integer strings within the platform timer range', () => {
        expect(parseTimeoutInput('1000')).toBe(1000);
        expect(parseTimeoutInput(' 42 ')).toBe(42);
        expect(parseTimeoutInput(String(MAX_TIMEOUT_INPUT_MS))).toBe(MAX_TIMEOUT_INPUT_MS);
    });

    test('rejects partial numbers, signs, fractions, zero, blank, and overflow before any work runs', () => {
        for (const malformed of ['12x', 'x12', '12.5', '-1', '+5', '0', '', '   ', '1e3']) {
            expect(() => parseTimeoutInput(malformed)).toThrow(/invalid timeout/);
        }
        // Timer overflow: a setTimeout delay beyond 2^31-1 fires immediately, so an
        // execution deadline must be rejected, never silently collapsed into a no-op.
        expect(() => parseTimeoutInput(String(MAX_TIMEOUT_INPUT_MS + 1))).toThrow(/invalid timeout/);
        expect(() => parseTimeoutInput('99999999999999')).toThrow(/invalid timeout/);
    });
});

describe('normalizeLegacyTimeoutMs (task 0813 R2 — legacy env channel)', () => {
    test('absent and blank values keep the fallback', () => {
        expect(normalizeLegacyTimeoutMs(undefined, 600_000)).toBe(600_000);
        expect(normalizeLegacyTimeoutMs('', 600_000)).toBe(600_000);
        expect(normalizeLegacyTimeoutMs('   ', 600_000)).toBe(600_000);
    });

    test("explicit 'none' maps to unlimited — including when the fallback is itself unlimited", () => {
        expect(normalizeLegacyTimeoutMs('none', 600_000)).toBeNull();
        expect(normalizeLegacyTimeoutMs(' None ', 600_000)).toBeNull();
        expect(normalizeLegacyTimeoutMs('none', null)).toBeNull();
    });

    test('valid positive integers pass through; invalid values retain the fallback (even null)', () => {
        expect(normalizeLegacyTimeoutMs('250', 600_000)).toBe(250);
        expect(normalizeLegacyTimeoutMs('nope', 600_000)).toBe(600_000);
        expect(normalizeLegacyTimeoutMs('-1', 600_000)).toBe(600_000);
        expect(normalizeLegacyTimeoutMs('0', 600_000)).toBe(600_000);
        expect(normalizeLegacyTimeoutMs('1.5', 600_000)).toBe(600_000);
        // A bad override against an unlimited parent keeps unlimited — an invalid value
        // must never introduce a deadline by accident.
        expect(normalizeLegacyTimeoutMs('nope', null)).toBeNull();
    });
});

describe('assertCanonicalTimeoutMs (task 0813 R3 — canonical queue/config policy)', () => {
    test('undefined stays absent so the legacy chain can apply', () => {
        expect(assertCanonicalTimeoutMs(undefined)).toBeUndefined();
    });

    test('null is explicit unlimited and finite integers pass through', () => {
        expect(assertCanonicalTimeoutMs(null)).toBeNull();
        expect(assertCanonicalTimeoutMs(5000)).toBe(5000);
        expect(assertCanonicalTimeoutMs(MAX_TIMEOUT_INPUT_MS)).toBe(MAX_TIMEOUT_INPUT_MS);
    });

    test('malformed canonical values throw — configuration drift must fail loudly', () => {
        for (const drifted of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '5000', MAX_TIMEOUT_INPUT_MS + 1]) {
            expect(() => assertCanonicalTimeoutMs(drifted)).toThrow(/invalid canonical timeout/);
        }
    });
});
