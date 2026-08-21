import { describe, expect, test } from 'bun:test';
import { SHARED_OPTIONS } from '../../src/commands/shared-options';

// Minimal same-path sibling so the require-corresponding-test rule is satisfied; the semantic
// surface (registry ↔ command modules parity) is enforced by shared-option-parity.test.ts.

describe('shared option registry shape', () => {
    test('every entry is a (flags, description) tuple of two non-empty strings', () => {
        for (const [key, value] of Object.entries(SHARED_OPTIONS)) {
            expect(Array.isArray(value)).toBe(true);
            expect(value).toHaveLength(2);
            expect(typeof value[0]).toBe('string');
            expect(typeof value[1]).toBe('string');
            expect(value[0].trim().length).toBeGreaterThan(0);
            expect(value[1].trim().length).toBeGreaterThan(0);
            expect(key.length).toBeGreaterThan(0);
        }
    });

    test('every key is unique by construction and every flag string starts with a dash', () => {
        const keys = Object.keys(SHARED_OPTIONS);
        expect(new Set(keys).size).toBe(keys.length);
        for (const value of Object.values(SHARED_OPTIONS)) {
            const head = value[0].trim().split(/[\s,]+/)[0] ?? '';
            expect(head.startsWith('-')).toBe(true);
        }
    });
});
