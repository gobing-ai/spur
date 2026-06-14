import { describe, expect, test } from 'bun:test';
import { SCAFFOLD_MANIFEST } from '../../src/config/scaffold-manifest';

describe('scaffold-manifest', () => {
    test('contains required config files', () => {
        const sources = SCAFFOLD_MANIFEST.map((e) => e.source);
        // Rule presets
        expect(sources).toContain('rules/recommended-pre-check.yaml');
        expect(sources).toContain('rules/recommended-post-check.yaml');
        // Workflows
        expect(sources).toContain('workflows/basic.yaml');
        expect(sources).toContain('workflows/task-lifecycle.yaml');
        expect(sources).toContain('workflows/feature-lifecycle.yaml');
        expect(sources).toContain('workflows/task-pipeline.yaml');
        // Section matrix
        expect(sources).toContain('tasks/section-matrix.yaml');
        // Task templates
        expect(sources).toContain('templates/task/default.md');
        expect(sources).toContain('templates/task/feature-impl.md');
        expect(sources).toContain('templates/task/issue.md');
        expect(sources).toContain('templates/task/review.md');
        expect(sources).toContain('templates/task/meta.md');
        // Feature template
        expect(sources).toContain('templates/feature/default.md');
        // BDD snippets
        expect(sources).toContain('templates/bdd/gherkin.md');
        expect(sources).toContain('templates/bdd/checklist.md');
    });

    test('every entry has a non-empty source and target', () => {
        for (const entry of SCAFFOLD_MANIFEST) {
            expect(entry.source.length).toBeGreaterThan(0);
            expect(entry.target.length).toBeGreaterThan(0);
        }
    });

    test('has exactly 16 entries', () => {
        expect(SCAFFOLD_MANIFEST.length).toBe(16);
    });
});
