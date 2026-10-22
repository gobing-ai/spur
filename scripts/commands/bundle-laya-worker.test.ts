/**
 * 1262 R1/AC1 — the npm bundle ships the `laya-local` worker.
 *
 * `bun run build:bundle` runs `bundle-laya-worker`, which copies the installed
 * `@gobing-ai/ts-laya-mlx` Python worker into `apps/cli/worker/`. Without it the bundled CLI
 * resolved the worker inside `spur.js` and every `laya-local` ask failed with `reason: error`.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleLayaWorker } from './bundle-laya-worker';

const CLI_MANIFEST = fileURLToPath(new URL('../../apps/cli/package.json', import.meta.url));

/** The worker source package is a darwin-only optional dependency (ADR-041): absent on
 * Linux/Windows CI, so the copy test can only run where it is installed. */
const HAS_LAYA_MLX = (() => {
    try {
        Bun.resolveSync('@gobing-ai/ts-laya-mlx', fileURLToPath(new URL('../../packages/app', import.meta.url)));
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
        const result = await bundleLayaWorker(target);
        const { size } = await stat(join(target, 'laya_worker.py'));
        expect(size).toBeGreaterThan(0);
        expect(result.bytes).toBe(size);
        // The worker is the real MLX bridge, not a placeholder.
        expect(await readFile(join(target, 'laya_worker.py'), 'utf8')).toContain('laya_mlx');
    });

    test("the CLI package's published file list carries worker/", async () => {
        const manifest = JSON.parse(await readFile(CLI_MANIFEST, 'utf8')) as { files?: string[] };
        expect(manifest.files).toContain('worker');
    });
});
