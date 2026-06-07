import { describe, expect, test } from 'bun:test';
import { SCAFFOLD_MANIFEST } from '../../src/config/scaffold-manifest';

describe('scaffold-manifest', () => {
    test('enumerates the three extracted config assets', () => {
        const sources = SCAFFOLD_MANIFEST.map((e) => e.source);
        expect(sources).toContain('rules/recommended-pre-check.yaml');
        expect(sources).toContain('rules/recommended-post-check.yaml');
        expect(sources).toContain('workflows/basic.yaml');
    });

    test('each entry maps source to an identical target under .spur/', () => {
        for (const entry of SCAFFOLD_MANIFEST) {
            // The manifest currently maps 1:1; source relative path == target relative path.
            expect(entry.target).toBe(entry.source);
        }
    });

    test('has exactly three entries', () => {
        expect(SCAFFOLD_MANIFEST.length).toBe(3);
    });
});
