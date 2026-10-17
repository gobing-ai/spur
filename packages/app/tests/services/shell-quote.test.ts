import { describe, expect, test } from 'bun:test';
import { shQuote } from '../../src/services/shell-quote';

describe('shQuote', () => {
    test('plain paths pass through unchanged so receipts stay readable', () => {
        expect(shQuote('packages/app/src/index.ts')).toBe('packages/app/src/index.ts');
        expect(shQuote('@scope/pkg-name_1')).toBe('@scope/pkg-name_1');
    });

    test('spaces, quotes and shell syntax are quoted, not expanded', () => {
        expect(shQuote('src/a b.ts')).toBe("'src/a b.ts'");
        expect(shQuote("it's.ts")).toBe("'it'\\''s.ts'");
        expect(shQuote('$(cmd).ts')).toBe("'$(cmd).ts'");
        expect(shQuote('a;echo hi')).toBe("'a;echo hi'");
        expect(shQuote('')).toBe("''");
    });
});
