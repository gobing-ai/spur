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
        expect(sources).toContain('workflows/planning-pipeline.yaml');
        expect(sources).toContain('workflows/idea-pipeline.yaml');
        expect(sources).toContain('workflows/wrapup-pipeline.yaml');
        expect(sources).toContain('workflows/pr-review.yaml');
        // Section matrix
        expect(sources).toContain('tasks/section-matrix.yaml');
        // Task templates
        expect(sources).toContain('templates/task/standard.md');
        expect(sources).toContain('templates/task/feature-impl.md');
        expect(sources).toContain('templates/task/issue.md');
        expect(sources).toContain('templates/task/review.md');
        expect(sources).toContain('templates/task/brainstorm.md');
        expect(sources).toContain('templates/task/meta.md');
        // Feature template
        expect(sources).toContain('templates/feature/default.md');
        // BDD snippets
        expect(sources).toContain('templates/bdd/gherkin.md');
        expect(sources).toContain('templates/bdd/checklist.md');
        // Docs scaffolds (task 0088 — R1)
        expect(sources).toContain('templates/docs/99_PROJECT_CONSTITUTION.md');
        expect(sources).toContain('templates/docs/00_ADR.md');
        expect(sources).toContain('templates/docs/05_FEATURES.md');
    });

    test('every entry has a non-empty source and target', () => {
        for (const entry of SCAFFOLD_MANIFEST) {
            expect(entry.source.length).toBeGreaterThan(0);
            expect(entry.target.length).toBeGreaterThan(0);
        }
    });

    test('has the expected entry count (updated when adding scaffolds)', () => {
        // 16 original + 1 planning-pipeline + 2 idea/wrapup pipelines + 7 docs (root) + 7 docs templates
        // + 1 brainstorm task template + 1 AGENTS.md (root) + 1 pr-review workflow = 36
        expect(SCAFFOLD_MANIFEST.length).toBe(36);
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
