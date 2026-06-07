import { describe, expect, test } from 'bun:test';
import { bundledConfigRoot, listBundledConfigFiles, resetBundledConfigCache } from '../src';

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
});
