/**
 * Build the Spur CLI binary with `bun build --compile`.
 *
 * ts-runtime@0.4.6 uses `const spec = '@gobing-ai/ts-db'; await import(spec)`
 * (variable specifier) to avoid TS2307 when ts-db's dist doesn't exist yet in CI.
 * Bun `--compile` can only resolve string-literal dynamic imports at runtime because
 * only those are registered in the bunfs module map. Variable-specifier imports are
 * not registered, so they fail with `Cannot find module '@gobing-ai/ts-db'`.
 *
 * This module patches the variable specifier back to a string literal in ts-runtime's
 * compiled dist before bundling, then restores the original afterward. The patch is
 * idempotent — if the pattern isn't found, it warns and proceeds (the build may still
 * succeed via the side-effect import in `apps/cli/src/index.ts`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
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
 * Patch `import(moduleSpecifier)` → `import('@gobing-ai/ts-db')` in ts-runtime dist.
 * Returns a restore function, or a no-op if no patch was needed.
 */
export function patchTsRuntimeImport(): () => void {
    const distFile = resolveTsRuntimeDist();
    const original = readFileSync(distFile, 'utf-8');
    const patched = original.replace(/await import\(moduleSpecifier\)/g, "await import('@gobing-ai/ts-db')");

    if (patched === original) {
        console.warn(
            'build-cli: WARNING — could not find import(moduleSpecifier) in ts-runtime dist. The pattern may have changed.',
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
}
