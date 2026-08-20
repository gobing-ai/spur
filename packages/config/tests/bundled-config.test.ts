import { describe, expect, test } from 'bun:test';
import {
    bundledConfigRoot,
    listBundledConfigFiles,
    listBundledProjectSeedFiles,
    listBundledTemplateFiles,
    resetBundledConfigCache,
} from '../src/loader';

describe('bundled-config', () => {
    test('bundledConfigRoot resolves to the repo-root config/ directory in dev', () => {
        // In the dev/test layout, import.meta.dirname is under packages/config/src/,
        // so the walk up should find ../../config at repo root.
        const root = bundledConfigRoot();
        expect(root).not.toBeNull();
        expect(root?.endsWith('config')).toBe(true);
    });

    test('listBundledConfigFiles includes the expected assets', () => {
        const files = listBundledConfigFiles();
        expect(files.length).toBeGreaterThan(0);
        // Rule presets extracted in task 0024.
        expect(files).toContain('rules/recommended-pre-check.yaml');
        expect(files).toContain('rules/recommended-post-check.yaml');
        // Workflow extracted in task 0024.
        expect(files).toContain('workflows/basic.yaml');
        expect(files).toContain('workflows/task-pipeline.yaml');
        // planning-pipeline.yaml still exists on disk (deleted only once ADR-072 is
        // accepted), so the raw bundle listing still sees it — but it is no longer
        // seeded into projects; see the project-seed exclusion test below.
        expect(files).toContain('workflows/planning-pipeline.yaml');
    });

    test('listBundledProjectSeedFiles excludes retired planning-pipeline (D5-K)', () => {
        const seeds = listBundledProjectSeedFiles();
        // Absorbed into the idea pipeline + /sp:dev-plan (ADR-072): a fresh project must
        // never receive a second planning graph, even while the source file still exists.
        expect(seeds).not.toContain('workflows/planning-pipeline.yaml');
        // Sibling pipelines are still seeded — the exclusion is targeted, not a blanket drop.
        expect(seeds).toContain('workflows/idea-pipeline.yaml');
        expect(seeds).toContain('workflows/task-pipeline.yaml');
    });

    test('listBundledConfigFiles excludes non-YAML/JSON entries', () => {
        const files = listBundledConfigFiles();
        // .gitkeep is not YAML/JSON — must not appear.
        expect(files.every((f) => /\.(ya?ml|json)$/i.test(f))).toBe(true);
    });

    test('cache reset allows re-resolution', () => {
        const first = bundledConfigRoot();
        resetBundledConfigCache();
        const second = bundledConfigRoot();
        expect(first).toBe(second);
    });

    test('listBundledTemplateFiles includes task template markdown files', () => {
        const files = listBundledTemplateFiles();
        expect(files.length).toBeGreaterThan(0);
        // Task templates created in task 0054
        expect(files).toContain('templates/task/standard.md');
        expect(files).toContain('templates/task/feature-impl.md');
        expect(files).toContain('templates/task/issue.md');
        expect(files).toContain('templates/task/review.md');
        // Feature template
        expect(files).toContain('templates/feature/default.md');
        // BDD templates
        expect(files).toContain('templates/bdd/gherkin.md');
        expect(files).toContain('templates/bdd/checklist.md');
        // Docs scaffolds (task 0088 — R1)
        expect(files).toContain('templates/docs/99_PROJECT_CONSTITUTION.md');
        expect(files).toContain('templates/docs/00_ADR.md');
        expect(files).toContain('templates/docs/05_FEATURES.md');
    });

    test('listBundledTemplateFiles excludes non-markdown entries', () => {
        const files = listBundledTemplateFiles();
        expect(files.every((f) => /\.md$/i.test(f))).toBe(true);
    });

    test('listBundledTemplateFiles returns sorted paths', () => {
        const files = listBundledTemplateFiles();
        const sorted = [...files].sort();
        expect(files).toEqual(sorted);
    });

    test('listBundledProjectSeedFiles includes rules, workflows, templates, and plugins', () => {
        const files = listBundledProjectSeedFiles();
        expect(files.length).toBeGreaterThan(listBundledConfigFiles().length);
        // Full rule tree (not just presets) — monorepo .spur/rules symlink parity
        expect(files).toContain('rules/typescript/no-debugger.yaml');
        expect(files).toContain('rules/boundary/dao-boundary.yaml');
        expect(files).toContain('workflows/basic.yaml');
        expect(files).toContain('templates/task/standard.md');
        expect(files).toContain('plugins/.gitkeep');
        // Example is never project-seeded under its .example name
        expect(files).not.toContain('config.example.yaml');
    });
});
