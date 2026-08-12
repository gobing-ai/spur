/**
 * Build the Spur CLI binary with `bun build --compile`.
 *
 * ts-runtime uses a variable-specifier dynamic import (`const spec = '@gobing-ai/ts-db';
 * await import(spec)`) to avoid TS2307 when ts-db's dist doesn't exist yet in CI.
 * Bun `--compile` can only resolve string-literal dynamic imports at runtime because
 * only those are registered in the bunfs module map. Variable-specifier imports are
 * not registered, so they fail with `Cannot find module '@gobing-ai/ts-db'`.
 *
 * This module patches the variable specifier back to a string literal in ts-runtime's
 * compiled dist before bundling, then restores the original afterward. The patch is
 * resilient to variable-name changes across ts-runtime versions: it detects the
 * `const <var> = '@gobing-ai/ts-db'` declaration, captures the identifier, and
 * rewrites `await import(<var>)` → `await import('@gobing-ai/ts-db')`.
 */
import { existsSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const CLI_ENTRY = new URL('../../apps/cli/src/index.ts', import.meta.url).pathname;
const CLI_DIR = new URL('../../apps/cli', import.meta.url).pathname;
const OUT_FILE = new URL('../../dist/cli/spur', import.meta.url).pathname;

/** Resolve the ts-runtime dist file through the CLI's module resolution. */
function resolveTsRuntimeDist(): string {
    const req = createRequire(resolve(CLI_DIR, 'package.json'));
    const pkgPath = req.resolve('@gobing-ai/ts-runtime/package.json');
    return resolve(pkgPath, '..', 'dist', 'runtime-node-bun.js');
}
/**
 * Patch the variable-specifier dynamic import in ts-runtime's compiled dist back to
 * a string literal so Bun `--compile` can resolve it at runtime.
 *
 * The patch is resilient to variable-name changes: it detects the
 * `const <var> = '@gobing-ai/ts-db'` declaration and rewrites
 * `await import(<var>)` → `await import('@gobing-ai/ts-db')`.
 *
 * Returns a restore function, or a no-op if no patch was needed.
 */
export function patchTsRuntimeImport(): () => void {
    const distFile = resolveTsRuntimeDist();
    const original = readFileSync(distFile, 'utf-8');

    // Legacy fallback: the 0.4.6 dist used the identifier `moduleSpecifier`.
    let patched = original.replace(/await import\(moduleSpecifier\)/g, "await import('@gobing-ai/ts-db')");

    // Version-agnostic: detect `const <var> = '@gobing-ai/ts-db'` and rewrite
    // `await import(<var>)` → `await import('@gobing-ai/ts-db')`.
    const declMatch = original.match(/const\s+(\w+)\s*=\s*'@gobing-ai\/ts-db'/);
    if (declMatch) {
        const varName = declMatch[1];
        const importRegex = new RegExp(`await import\\(${varName}\\)`, 'g');
        patched = patched.replace(importRegex, "await import('@gobing-ai/ts-db')");
    }

    if (patched === original) {
        console.warn(
            'build-cli: WARNING — could not find a variable-specifier ts-db import in ts-runtime dist. The pattern may have changed.',
        );
        return () => {};
    }

    writeFileSync(distFile, patched, 'utf-8');
    console.log('build-cli: patched ts-runtime variable-specifier import → string literal');
    return () => writeFileSync(distFile, original, 'utf-8');
}

/** Build and compile the local `spur` binary into `dist/cli/spur`. */
export async function buildCli(): Promise<void> {
    const restore = patchTsRuntimeImport();
    try {
        const result = Bun.spawnSync(['bun', 'build', CLI_ENTRY, '--compile', '--outfile', OUT_FILE], {
            stdio: ['ignore', 'inherit', 'inherit'],
        });
        if (result.exitCode !== 0) throw new Error(`bun build failed with exit code ${result.exitCode}`);
    } finally {
        restore();
    }
    relinkGlobal();
}

/**
 * Re-point the global `/Users/robin/.bun/bin/spur` symlink to the freshly-built
 * local binary so `spur` on PATH immediately reflects the dev build.
 *
 * Running `bun add -g @gobing-ai/spur` later will overwrite the symlink back
 * to the npm-installed version — that is intentional and acceptable.
 */
function relinkGlobal(): void {
    const GLOBAL_LINK = '/Users/robin/.bun/bin/spur';
    if (existsSync(GLOBAL_LINK)) {
        unlinkSync(GLOBAL_LINK);
    }
    symlinkSync(OUT_FILE, GLOBAL_LINK);
    console.log(`build-cli: symlinked ${GLOBAL_LINK} → ${OUT_FILE}`);
}
