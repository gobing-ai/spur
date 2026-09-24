/**
 * 0948 R3 / AC3 — the feature-verification pass script's module mode is explicit.
 *
 * Before this fix, `loadModule` preferred `packages/app/src/index.ts` whenever a source
 * checkout was detected. That entry is not a plugin-script contract surface and does not
 * re-export every seam (`splitLaunchCommand`, `ArtifactDao`), so the pass failed with
 * "application entry is missing feature-verification seams — rebuild/install the sp plugin".
 * No rebuild could fix it: the source entry genuinely lacks the seams.
 *
 * The script now loads the generated inline bundle (`plugins/sp/lib/inline-run.generated.mjs`)
 * and every failure names `mode=bundle` plus the actual fix. These tests drive the script in a
 * sandbox layout so both bundle failure shapes are reachable, and assert the retired advice is gone.
 */

import { expect, test } from 'bun:test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const SCRIPT_SRC = join(ROOT, 'plugins', 'sp', 'scripts', 'feature-verification-steps.ts');
const ENV_SRC = join(ROOT, 'plugins', 'sp', 'lib', 'env.ts');

/** The retired advice — the fix must never point at it again. */
const RETIRED_ADVICE = 'rebuild/install the sp plugin';

/** Build a sandbox holding just the script and its env helper, with an optional bundle. */
function makeSandbox(bundle: string | null): string {
    const dir = mkdtempSync(join(tmpdir(), 'fv-steps-mode-'));
    mkdirSync(join(dir, 'plugins', 'sp', 'scripts'), { recursive: true });
    mkdirSync(join(dir, 'plugins', 'sp', 'lib'), { recursive: true });
    copyFileSync(SCRIPT_SRC, join(dir, 'plugins', 'sp', 'scripts', 'feature-verification-steps.ts'));
    copyFileSync(ENV_SRC, join(dir, 'plugins', 'sp', 'lib', 'env.ts'));
    if (bundle !== null) {
        writeFileSync(join(dir, 'plugins', 'sp', 'lib', 'inline-run.generated.mjs'), bundle);
    }
    return dir;
}

function runPass(dir: string): { exitCode: number; stderr: string } {
    const r = Bun.spawnSync({
        cmd: [
            'bun',
            join(dir, 'plugins', 'sp', 'scripts', 'feature-verification-steps.ts'),
            'verify',
            '--feature-id',
            'H99',
            '--run-id',
            'run-mode-test',
            '--spur-bin',
            '',
        ],
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return { exitCode: r.exitCode, stderr: r.stderr.toString() };
}

test('0948 AC3: a missing bundle names the mode and the build fix, not the retired advice', () => {
    const dir = makeSandbox(null);
    try {
        const { exitCode, stderr } = runPass(dir);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain('mode=bundle');
        expect(stderr).toContain('build:bundle');
        expect(stderr).toContain('inline-run.generated.mjs');
        expect(stderr).not.toContain(RETIRED_ADVICE);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('0948 AC3: a seam-less bundle names the mode, the entry, and the fix', () => {
    // Exports nothing → every seam is reported missing.
    const dir = makeSandbox('export const unrelated = 1;\n');
    try {
        const { exitCode, stderr } = runPass(dir);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain('mode=bundle');
        expect(stderr).toContain('inline-run.generated.mjs');
        expect(stderr).toContain('splitLaunchCommand');
        expect(stderr).toContain('ArtifactDao');
        expect(stderr).toContain('build:bundle');
        expect(stderr).not.toContain(RETIRED_ADVICE);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('0948 R3: the source app entry is never selected as a plugin-script module source', () => {
    const source = Bun.file(SCRIPT_SRC).text();
    return source.then((text) => {
        // The module loader must not reach for app source; the bundle is the contract surface.
        expect(text).not.toContain("'packages', 'app', 'src', 'index.ts'");
        expect(text).toContain("'../lib/inline-run.generated.mjs'");
        expect(existsSync(join(ROOT, 'plugins', 'sp', 'lib', 'inline-run.generated.mjs'))).toBe(true);
    });
});
