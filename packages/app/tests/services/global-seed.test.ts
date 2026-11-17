import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    globalRulesRoot,
    resolveGlobalConfigDir,
    seedGlobalConfig,
    seedGlobalRules,
} from '../../src/services/global-seed';

/**
 * Machine-wide seeds (A93 1353 R2). The failure modes that matter: a second run overwriting a
 * user's customizations, a seed writing outside the resolved root, and the two resolution
 * overrides (`SPUR_GLOBAL_RULES_DIR`, else `~/.config/spur`) disagreeing.
 */
const fs = createNodeFileSystem();

async function tempRoot(): Promise<string> {
    return mkdtempSync(join(tmpdir(), 'spur-seed-'));
}

describe('global seed resolution', () => {
    test('SPUR_GLOBAL_RULES_DIR wins over the home default for both roots', () => {
        const override = '/tmp/spur-override';
        const ctx = { cwd: '/project', env: { SPUR_GLOBAL_RULES_DIR: override } };
        expect(resolveGlobalConfigDir(ctx)).toBe(override);
        expect(globalRulesRoot(ctx)).toBe(override);
        const homeDefault = { cwd: '/project', env: {} };
        expect(resolveGlobalConfigDir(homeDefault).endsWith(join('.config', 'spur'))).toBe(true);
        expect(globalRulesRoot(homeDefault).endsWith(join('.config', 'spur', 'rules'))).toBe(true);
    });
});

describe('seed writers', () => {
    test('seeds into the override root and never rewrites what already exists', async () => {
        const root = await tempRoot();
        const ctx = { cwd: root, env: { SPUR_GLOBAL_RULES_DIR: join(root, 'global') } };
        const first = await seedGlobalRules(fs, ctx);
        const configFirst = await seedGlobalConfig(fs, ctx);
        expect(first.assetsFound).toBe(true);
        expect(configFirst.assetsFound).toBe(true);
        expect(first.created.length).toBeGreaterThan(0);
        expect(configFirst.created.length).toBeGreaterThan(0);

        const second = await seedGlobalRules(fs, ctx);
        expect(second.created).toEqual([]);

        // A user edit survives the next pass byte for byte.
        const globalConfig = join(root, 'global', 'config.yaml');
        await writeFile(globalConfig, 'project: mine\n');
        const third = await seedGlobalConfig(fs, ctx);
        expect(third.created).toEqual([]);
        expect(readFileSync(globalConfig, 'utf-8')).toBe('project: mine\n');
    });

    test('the canonical config name is seeded, not the shipped example name', async () => {
        const root = await tempRoot();
        const ctx = { cwd: root, env: { SPUR_GLOBAL_RULES_DIR: join(root, 'global') } };
        await seedGlobalConfig(fs, ctx);
        expect(readFileSync(join(root, 'global', 'config.yaml'), 'utf-8').length).toBeGreaterThan(0);
    });

    test('an unwritable root surfaces as a thrown error the caller reports', async () => {
        const root = await tempRoot();
        const blocked = join(root, 'blocked');
        await mkdir(blocked, { recursive: true });
        const ctx = { cwd: root, env: { SPUR_GLOBAL_RULES_DIR: join(blocked, 'global') } };
        // Sanity: the same write the seed performs fails when the parent is a file.
        await writeFile(join(blocked, 'global'), 'not a directory');
        await expect(seedGlobalRules(fs, ctx)).rejects.toThrow();
    });
});
