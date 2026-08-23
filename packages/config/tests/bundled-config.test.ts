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
    });

    test('listBundledProjectSeedFiles includes the canonical pipelines', () => {
        const seeds = listBundledProjectSeedFiles();
        // Sibling pipelines are still seeded — the retired planning graph is gone.
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

    test('listBundledProjectSeedFiles keeps the assets a project actually resolves through .spur/', () => {
        const files = listBundledProjectSeedFiles();
        // Full rule tree (not just presets) — monorepo .spur/rules symlink parity.
        // Rules stay per-project: they resolve against project folder structure.
        expect(files).toContain('rules/typescript/no-debugger.yaml');
        expect(files).toContain('rules/boundary/dao-boundary.yaml');
        expect(files).toContain('workflows/basic.yaml');
        // BDD templates have no resolver — plugin skills read the project copy directly.
        expect(files).toContain('templates/bdd/gherkin.md');
    });

    test('listBundledProjectSeedFiles drops assets with no .spur/ reader (0646)', () => {
        const files = listBundledProjectSeedFiles();
        // Dead natural-path duplicate: loadTemplateBodies reads .spur/tasks/templates/,
        // never .spur/templates/task/. The manifest remap is the live copy.
        expect(files.some((f) => f.startsWith('templates/task/'))).toBe(false);
        // Placeholders with no reader at all.
        expect(files.some((f) => f.startsWith('plugins/'))).toBe(false);
        // The five monorepo dev baselines are read from repo-root config/, not .spur/.
        expect(files.filter((f) => !f.includes('/') && f.endsWith('.json'))).toEqual([]);
        // The shipped global default seeds ~/.config/spur/, never a project.
        expect(files).not.toContain('config.global.yaml');
    });

    test('listBundledProjectSeedFiles keeps nested json (only top-level baselines are dropped)', () => {
        // Guards the drop predicate against over-reach: a nested .json under a kept
        // tree (e.g. tasks/) must survive, since only the top-level baselines are dev-only.
        const files = listBundledProjectSeedFiles();
        const nestedJson = files.filter((f) => f.includes('/') && f.endsWith('.json'));
        for (const f of nestedJson) expect(f.includes('/')).toBe(true);
        expect(files.length).toBeLessThan(listBundledConfigFiles().length + files.length);
    });
});
