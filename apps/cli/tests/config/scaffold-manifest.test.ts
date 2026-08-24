import { describe, expect, test } from 'bun:test';
import { SCAFFOLD_MANIFEST } from '../../src/config/scaffold-manifest';

describe('scaffold-manifest', () => {
    test('contains required config files', () => {
        const sources = SCAFFOLD_MANIFEST.map((e) => e.source);
        // Rule presets
        expect(sources).toContain('rules/recommended-pre-check.yaml');
        expect(sources).toContain('rules/recommended-post-check.yaml');
        expect(sources.some((source) => source.startsWith('workflows/'))).toBe(false);
        // Section matrix
        expect(sources).toContain('tasks/section-matrix.yaml');
        // Task templates
        expect(sources).toContain('templates/task/standard.md');
        expect(sources).toContain('templates/task/feature-impl.md');
        expect(sources).toContain('templates/task/issue.md');
        expect(sources).toContain('templates/task/review.md');
        expect(sources).toContain('templates/task/brainstorm.md');
        expect(sources).toContain('templates/task/meta.md');
        // Docs scaffolds (task 0088 — R1)
        expect(SCAFFOLD_MANIFEST.some((entry) => entry.target.startsWith('templates/'))).toBe(false);
    });

    test('every entry has a non-empty source and target', () => {
        for (const entry of SCAFFOLD_MANIFEST) {
            expect(entry.source.length).toBeGreaterThan(0);
            expect(entry.target.length).toBeGreaterThan(0);
        }
    });

    test('has the expected entry count (updated when adding scaffolds)', () => {
        // 2 rule presets + section matrix + 6 task templates + 7 root docs + AGENTS.md.
        expect(SCAFFOLD_MANIFEST.length).toBe(17);
    });

    test('docs entries are root-scoped and preserve-marked (R1 — task 0088)', () => {
        const docsEntries = SCAFFOLD_MANIFEST.filter((e) => e.target.startsWith('docs/'));
        expect(docsEntries.length).toBe(7);
        for (const entry of docsEntries) {
            expect(entry.root).toBe(true);
            expect(entry.preserve).toBe(true);
        }
    });

    test('non-docs entries are not root-scoped except AGENTS.md (task 0232)', () => {
        const nonDocs = SCAFFOLD_MANIFEST.filter((e) => !e.target.startsWith('docs/') && e.target !== 'AGENTS.md');
        for (const entry of nonDocs) {
            expect(entry.root).not.toBe(true);
        }
    });

    test('AGENTS.md is root-scoped and preserve-marked (task 0232)', () => {
        const agents = SCAFFOLD_MANIFEST.find((e) => e.target === 'AGENTS.md');
        expect(agents).toBeDefined();
        expect(agents?.root).toBe(true);
        expect(agents?.preserve).toBe(true);
    });
});
