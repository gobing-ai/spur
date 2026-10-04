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
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../apps/cli/src/index.ts', import.meta.url));
const CLI_DIR = fileURLToPath(new URL('../../apps/cli', import.meta.url));
const OUT_FILE = fileURLToPath(new URL('../../dist/cli/spur', import.meta.url));

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
 * Returns a restore function. Throws when no import can be patched: the compiled
 * binary would build fine and then fail at runtime with `Cannot find module`.
 */
export function patchTsRuntimeImport(): () => void {
    const distFile = resolveTsRuntimeDist();
    // Every native compilation facade (CLI, server and cross-target CLI) uses
    // this exclusive claim. Concurrent invocations fail before mutating dist.
    const lockPath = `${distFile}.spur-compile.lock`;
    let lockFd: number;
    try {
        lockFd = openSync(lockPath, 'wx');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new Error(`Another compiled build holds ${lockPath}; run CLI/server builds sequentially.`);
        }
        throw error;
    }
    const release = (): void => {
        closeSync(lockFd);
        unlinkSync(lockPath);
    };
    try {
        writeSync(lockFd, String(process.pid));
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
            throw new Error(
                `build-cli: no variable-specifier ts-db import found in ${distFile} — the ts-runtime dist shape changed; update patchTsRuntimeImport before compiling`,
            );
        }

        writeFileSync(distFile, patched, 'utf-8');
        console.log('compiled-build: patched ts-runtime variable-specifier import → string literal');
        return () => {
            try {
                writeFileSync(distFile, original, 'utf-8');
            } finally {
                release();
            }
        };
    } catch (error) {
        release();
        throw error;
    }
}

/** Compile a local Bun executable with its optional database peer registered in the bundle. */
export async function buildCompiledBinary(entry: string, outfile: string): Promise<void> {
    const restore = patchTsRuntimeImport();
    try {
        const result = Bun.spawnSync(['bun', 'build', entry, '--compile', '--outfile', outfile], {
            stdio: ['ignore', 'inherit', 'inherit'],
        });
        if (result.exitCode !== 0) throw new Error(`bun build failed with exit code ${result.exitCode}`);
    } finally {
        restore();
    }
}

/** Build and compile the local `spur` CLI binary. */
export async function buildCli(): Promise<void> {
    await buildCompiledBinary(CLI_ENTRY, OUT_FILE);
}
