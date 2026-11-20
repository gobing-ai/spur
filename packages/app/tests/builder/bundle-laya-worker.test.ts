/**
 * 1262 R1/AC1 — the npm bundle ships the `laya-local` worker (moved to the app layer by A94 1410).
 *
 * `bun run build:bundle` runs `spur builder bundle-laya-worker`, which copies the installed
 * `@gobing-ai/ts-laya-mlx` Python worker into `apps/cli/worker/`. Without it the bundled CLI
 * resolved the worker inside `spur.js` and every `laya-local` ask failed with `reason: error`.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleLayaWorker } from '../../src/builder/bundle-laya-worker';

/** Repo root: packages/app/tests/builder → repo. */
const SOURCE_ROOT = join(import.meta.dir, '../../../..');
const CLI_MANIFEST = join(SOURCE_ROOT, 'apps/cli/package.json');

/** The worker source package is a darwin-only optional dependency (ADR-041): absent on
 * Linux/Windows CI, so the copy test can only run where it is installed. */
const HAS_LAYA_MLX = (() => {
    try {
        Bun.resolveSync('@gobing-ai/ts-laya-mlx', join(SOURCE_ROOT, 'packages', 'app'));
        return true;
    } catch {
        return false;
    }
})();

describe('bundleLayaWorker', () => {
    let target: string;

    afterEach(async () => {
        if (target) await rm(target, { recursive: true, force: true });
    });

    test.skipIf(!HAS_LAYA_MLX)('copies a non-empty laya_worker.py from the installed package', async () => {
        target = await mkdtemp(join(tmpdir(), 'spur-laya-worker-'));
        const result = await bundleLayaWorker({ sourceRoot: SOURCE_ROOT, target });
        const { size } = await stat(join(target, 'laya_worker.py'));
        expect(size).toBeGreaterThan(0);
        expect(result.artifacts[0]).toEqual({ path: join(target, 'laya_worker.py'), kind: 'worker' });
        // The worker is the real MLX bridge, not a placeholder.
        expect(await readFile(join(target, 'laya_worker.py'), 'utf8')).toContain('laya_mlx');
    });

    test('an installed package without the worker file fails instead of staging nothing', async () => {
        // A fixture checkout that resolves its own copy of the package: the worker path is missing, so
        // the verb must fail by name rather than write an empty worker directory.
        const root = await mkdtemp(join(tmpdir(), 'spur-laya-fixture-'));
        try {
            const pkg = join(root, 'packages', 'app');
            const installed = join(pkg, 'node_modules', '@gobing-ai', 'ts-laya-mlx');
            await mkdir(installed, { recursive: true });
            await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'app' }));
            await writeFile(
                join(installed, 'package.json'),
                JSON.stringify({ name: '@gobing-ai/ts-laya-mlx', main: 'index.js' }),
            );
            await writeFile(join(installed, 'index.js'), 'export const worker = null;\n');
            await expect(bundleLayaWorker({ sourceRoot: root })).rejects.toThrow(/installed worker missing at/);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test('a resolved entry with no matching package manifest is refused by name', async () => {
        // The walk from the resolved entry finds package.json files that never identify themselves as
        // the worker package, so the verb must fail rather than guess a directory.
        const root = await mkdtemp(join(tmpdir(), 'spur-laya-nameless-'));
        try {
            const pkg = join(root, 'packages', 'app');
            const installed = join(pkg, 'node_modules', '@gobing-ai', 'ts-laya-mlx');
            await mkdir(installed, { recursive: true });
            await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'app' }));
            await writeFile(join(installed, 'package.json'), JSON.stringify({ main: 'index.js' }));
            await writeFile(join(installed, 'index.js'), 'export const worker = null;\n');
            await expect(bundleLayaWorker({ sourceRoot: root })).rejects.toThrow(
                /could not resolve the @gobing-ai\/ts-laya-mlx package root/,
            );
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("the CLI package's published file list carries worker/", async () => {
        const manifest = JSON.parse(await readFile(CLI_MANIFEST, 'utf8')) as { files?: string[] };
        expect(manifest.files).toContain('worker');
    });
});
