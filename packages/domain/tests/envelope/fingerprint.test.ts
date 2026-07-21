import { describe, expect, test } from 'bun:test';
import { computeContentHash } from '../../src/envelope/fingerprint';

describe('computeContentHash', () => {
    test('returns a 64-character hex string', () => {
        const hash = computeContentHash('hello');
        expect(hash).toHaveLength(64);
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    test('is deterministic — same input produces the same hash', () => {
        const input = 'The quick brown fox jumps over the lazy dog';
        expect(computeContentHash(input)).toBe(computeContentHash(input));
    });

    test('different inputs produce different hashes', () => {
        const h1 = computeContentHash('abc');
        const h2 = computeContentHash('xyz');
        expect(h1).not.toBe(h2);
    });

    test('handles empty string', () => {
        const hash = computeContentHash('');
        expect(hash).toHaveLength(64);
        // Known SHA-256 of empty string
        expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    test('handles unicode content', () => {
        const hash = computeContentHash('你好世界 🎉');
        expect(hash).toHaveLength(64);
        expect(computeContentHash('你好世界 🎉')).toBe(computeContentHash('你好世界 🎉'));
    });

    test('handles multiline content', () => {
        const content = 'line 1\nline 2\nline 3';
        const hash = computeContentHash(content);
        expect(hash).toHaveLength(64);
    });

    test('handles JSON-like content', () => {
        const json = JSON.stringify({ key: 'value', num: 42 });
        const hash = computeContentHash(json);
        expect(hash).toHaveLength(64);
    });
});
