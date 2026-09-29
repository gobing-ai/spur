import { describe, expect, test } from 'bun:test';
import { isFeatureFile } from '../../src/services/feature-check';

describe('isFeatureFile', () => {
    test('matches <id>_<slug>.md literally — operator ids are not regex patterns', () => {
        expect(isFeatureFile('A1_auth.md', 'A1')).toBe(true);
        expect(isFeatureFile('A12_auth.md', 'A1')).toBe(false);
        expect(isFeatureFile('A1_.md', 'A1')).toBe(false);
        // Before: `new RegExp('^.*_.+\\.md$')` matched the first feature; `(` threw a SyntaxError.
        expect(isFeatureFile('A1_auth.md', '.*')).toBe(false);
        expect(() => isFeatureFile('A1_auth.md', '(')).not.toThrow();
    });
});
