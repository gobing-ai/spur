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
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../apps/cli/src/index.ts', import.meta.url));
const CLI_DIR = fileURLToPath(new URL('../../apps/cli', import.meta.url));
const OUT_FILE = fileURLToPath(new URL('../../dist/cli/spur', import.meta.url));

/**
 * Left external because `@johnhenry/laya` (via `ts-laya-mlx` 0.5.22+) imports this optional
 * GPU peer from `io-node.js`, and a single-file bundle fails resolving an uninstalled package.
 * Spur only ever asks laya for backend `mlx` (the `ts-laya-mlx` native client hardcodes it), so
 * the import stays for the runtime and is never executed. `--compile` accepts no Bun.build
 * plugins, which is why the compiled and CLI bundles pass this flag.
 */
export const UNUSED_LAYA_PEER = '@johnhenry/backend-webgpu';

/** The darwin-only optional decision backend (ADR-041); absent from non-macOS installs. */
export const LAYA_MLX_PACKAGE = '@gobing-ai/ts-laya-mlx';

const PACKAGES_APP_MANIFEST = fileURLToPath(new URL('../../packages/app/package.json', import.meta.url));
const DECISION_SERVICE_FILE = fileURLToPath(
    new URL('../../packages/app/src/decision/decision-service.ts', import.meta.url),
);

/**
 * True when the darwin-only laya package is installed on this build host. `bun install` skips it
 * off macOS (ADR-041), so Linux CI compiles must externalize it instead of resolving it.
 */
export function layaMlxInstalled(): boolean {
    try {
        // Resolve from packages/app: it declares the dependency, and bun's isolated install
        // leaves no root node_modules shim (same reason as bundle-laya-worker).
        Bun.resolveSync(LAYA_MLX_PACKAGE, dirname(PACKAGES_APP_MANIFEST));
        return true;
    } catch {
        return false;
    }
}

/**
 * Rewrite the decision service's variable-specifier laya import to a string literal for the
 * duration of a compile. `bun build --compile` registers only string-literal dynamic imports in
 * the bunfs module map (see the ts-runtime patch above), so the variable form — required for
 * typecheck on hosts without the package — would compile fine and then fail at runtime with
 * `Cannot find module`. Call only when {@link layaMlxInstalled} is true; restore afterward.
 * Throws when nothing was patched: a silent no-op would ship a binary whose laya-local is dead.
 */
export function patchLayaMlxSourceImport(): () => void {
    const original = readFileSync(DECISION_SERVICE_FILE, 'utf-8');
    const declMatch = original.match(/const\s+(\w+)\s*=\s*'@gobing-ai\/ts-laya-mlx'/);
    let patched = original;
    if (declMatch) {
        patched = original.replace(
            new RegExp(`await import\\(${declMatch[1]}\\)`, 'g'),
            `await import('${LAYA_MLX_PACKAGE}')`,
        );
    }
    if (patched === original) {
        throw new Error(
            `build-cli: no variable-specifier ts-laya-mlx import found in ${DECISION_SERVICE_FILE} — the decision-service shape changed; update patchLayaMlxSourceImport before compiling`,
        );
    }
    writeFileSync(DECISION_SERVICE_FILE, patched, 'utf-8');
    console.log('compiled-build: patched decision-service variable-specifier laya import → string literal');
    return () => writeFileSync(DECISION_SERVICE_FILE, original, 'utf-8');
}

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
    // The ts-runtime lock above already serializes compiled builds, so the source patch shares
    // its critical section. Without the package (Linux CI), externalize the import: the compile
    // cannot resolve it and the target platform cannot run MLX anyway — a lazy no-backend at
    // runtime is the truthful behavior there.
    const restoreLaya = layaMlxInstalled() ? patchLayaMlxSourceImport() : undefined;
    try {
        const args = ['bun', 'build', entry, '--compile', '--external', UNUSED_LAYA_PEER];
        if (restoreLaya === undefined) args.push('--external', LAYA_MLX_PACKAGE);
        args.push('--outfile', outfile);
        const result = Bun.spawnSync(args, {
            stdio: ['ignore', 'inherit', 'inherit'],
        });
        if (result.exitCode !== 0) throw new Error(`bun build failed with exit code ${result.exitCode}`);
    } finally {
        restoreLaya?.();
        restore();
    }
}

/** Build and compile the local `spur` CLI binary. */
export async function buildCli(): Promise<void> {
    await buildCompiledBinary(CLI_ENTRY, OUT_FILE);
}
