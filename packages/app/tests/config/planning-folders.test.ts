import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { resolvePlanningFolders } from '../../src/config/planning-folders';

/**
 * Phase-folder resolution: every layer derives task/feature folders from
 * `.spur/config.yaml`, never a hardcoded `docs/tasks`. These tests pin the
 * behavior the write-guard regression and the multi-surface fix depend on.
 */
describe('resolvePlanningFolders', () => {
    const roots: string[] = [];

    afterEach(() => {
        for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
    });

    function seed(configYaml?: string): string {
        const root = mkdtempSync(join(tmpdir(), 'spur-folders-'));
        roots.push(root);
        if (configYaml !== undefined) {
            mkdirSync(join(root, '.spur'), { recursive: true });
            writeFileSync(join(root, '.spur', 'config.yaml'), configYaml);
        }
        return root;
    }

    test('defaults when no config file exists', async () => {
        const fs = createNodeFileSystem(seed());
        const result = await resolvePlanningFolders(fs);
        expect(result.tasksDir).toBe('docs/tasks');
        expect(result.featuresDir).toBe('docs/features');
        expect(result.foldersConfig.active_folder).toBe('docs/tasks');
    });

    test('reads the active folder and all registered phase folders', async () => {
        const fs = createNodeFileSystem(
            seed(
                [
                    'tasks:',
                    '  active: docs/tasks2',
                    '  folders:',
                    '    docs/tasks: { baseCounter: 0, label: Primary }',
                    '    docs/tasks2: { baseCounter: 128, label: Phase 2 }',
                    'features:',
                    '  dir: docs/features2',
                ].join('\n'),
            ),
        );
        const result = await resolvePlanningFolders(fs);
        // active becomes tasksDir — the SOURCE of the original hardcode bug.
        expect(result.tasksDir).toBe('docs/tasks2');
        expect(result.featuresDir).toBe('docs/features2');
        expect(Object.keys(result.foldersConfig.folders).sort()).toEqual(['docs/tasks', 'docs/tasks2']);
        expect(result.foldersConfig.folders['docs/tasks2']?.base_counter).toBe(128);
    });

    test('falls back to defaults on malformed config (never throws)', async () => {
        const fs = createNodeFileSystem(seed('tasks: [this is not a map'));
        const result = await resolvePlanningFolders(fs);
        expect(result.tasksDir).toBe('docs/tasks');
        expect(result.featuresDir).toBe('docs/features');
    });

    test('a config with no tasks block keeps default task folder but honors features.dir', async () => {
        const fs = createNodeFileSystem(seed(['features:', '  dir: docs/feats'].join('\n')));
        const result = await resolvePlanningFolders(fs);
        expect(result.tasksDir).toBe('docs/tasks');
        expect(result.featuresDir).toBe('docs/feats');
    });
});
