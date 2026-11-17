import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { bundleConfig } from './bundle-config';

/**
 * Compiled-binary build owner (A93 1354, design §5).
 *
 * Why the patches exist at all: `ts-runtime` and the decision service reach optional peers through
 * variable-specifier dynamic imports (`const spec = '@gobing-ai/ts-db'; await import(spec)`) so
 * typecheck passes on a host where the peer's dist is absent. Bun `--compile` only registers
 * string-literal dynamic imports in the bunfs module map, so a compile must rewrite those
 * specifiers for the duration of the build and restore them afterwards.
 *
 * Everything resolves from an explicit **source root**, never from this module's location: the same
 * service is compiled into the installed CLI, where walking up from `import.meta.url` would find the
 * published package instead of the checkout the operator asked to build.
 *
 * Two acquisition rules keep a failed build non-destructive:
 *  1. both patches are acquired inside one restoration scope, so a second acquisition failure still
 *     restores the first; and
 *  2. every restore is attempted in `finally`, even when an earlier restore throws.
 */

/** Left external because it is an optional GPU peer of `@johnhenry/laya` that Spur never executes. */
export const UNUSED_LAYA_PEER = '@johnhenry/backend-webgpu';

/** The darwin-only optional decision backend (ADR-041); absent from non-macOS installs. */
export const LAYA_MLX_PACKAGE = '@gobing-ai/ts-laya-mlx';

/** One artifact a build produced. */
export interface BuildArtifact {
    path: string;
    kind: string;
}

/** Captured child output, surfaced as diagnostics rather than streamed into a JSON document. */
export interface BuildDiagnostics {
    command: string;
    args: string[];
    exitCode: number;
    stdout: string;
    stderr: string;
}

/** Success shape shared by every build verb. */
export interface BuildResult {
    ok: true;
    sourceRoot: string;
    artifacts: BuildArtifact[];
    diagnostics: BuildDiagnostics[];
}

/** A build that could not complete; callers turn this into a nonzero exit. */
export class BuildError extends Error {
    constructor(
        message: string,
        readonly sourceRoot: string,
    ) {
        super(message);
        this.name = 'BuildError';
    }
}

/** Resolve `--source-root` against the invocation cwd and validate the checkout markers. */
export function resolveSourceRoot(sourceRoot: string | undefined, cwd: string): string {
    const resolved = resolve(cwd, sourceRoot ?? '.');
    const markers = [join(resolved, 'apps', 'cli', 'package.json'), join(resolved, 'packages', 'app', 'package.json')];
    for (const marker of markers) {
        try {
            readFileSync(marker);
        } catch {
            throw new BuildError(
                `not a Spur source checkout: ${marker} is missing (pass --source-root <dir>)`,
                resolved,
            );
        }
    }
    return resolved;
}

/** Resolve the ts-runtime dist the SOURCE CHECKOUT's CLI depends on. */
function resolveTsRuntimeDist(sourceRoot: string): string {
    const req = createRequire(join(sourceRoot, 'apps', 'cli', 'package.json'));
    const pkgPath = req.resolve('@gobing-ai/ts-runtime/package.json');
    return resolve(dirname(pkgPath), 'dist', 'runtime-node-bun.js');
}

/**
 * True when the darwin-only laya package is installed for the source checkout. `bun install` skips
 * it off macOS (ADR-041), so Linux CI must externalize it instead of resolving it.
 */
export function layaMlxInstalled(sourceRoot: string): boolean {
    try {
        const req = createRequire(join(sourceRoot, 'packages', 'app', 'package.json'));
        req.resolve(`${LAYA_MLX_PACKAGE}/package.json`);
        return true;
    } catch {
        return false;
    }
}

/**
 * Patch the decision service's variable-specifier laya import to a string literal. Throws when
 * nothing matched: a silent no-op would compile fine and ship a binary whose laya-local is dead.
 */
export function patchLayaMlxSourceImport(sourceRoot: string): () => void {
    const file = join(sourceRoot, 'packages', 'app', 'src', 'decision', 'decision-service.ts');
    const original = readFileSync(file, 'utf-8');
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
            `build: no variable-specifier ts-laya-mlx import found in ${file} — the decision-service shape changed; update patchLayaMlxSourceImport before compiling`,
        );
    }
    writeFileSync(file, patched, 'utf-8');
    return () => writeFileSync(file, original, 'utf-8');
}

/**
 * Patch ts-runtime's variable-specifier ts-db import in the source checkout's dependency dist.
 *
 * The `.spur-compile.lock` beside that dist is the single compile lock: it is created exclusively
 * before any mutation, so a concurrent invocation fails before touching anything.
 */
export function patchTsRuntimeImport(sourceRoot: string): () => void {
    const distFile = resolveTsRuntimeDist(sourceRoot);
    const lockPath = `${distFile}.spur-compile.lock`;
    let lockFd: number;
    try {
        lockFd = openSync(lockPath, 'wx');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new Error(`another compiled build holds ${lockPath}; run CLI/server builds sequentially`);
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
        let patched = original.replace(/await import\(moduleSpecifier\)/g, "await import('@gobing-ai/ts-db')");
        const declMatch = original.match(/const\s+(\w+)\s*=\s*'@gobing-ai\/ts-db'/);
        if (declMatch) {
            patched = patched.replace(
                new RegExp(`await import\\(${declMatch[1]}\\)`, 'g'),
                "await import('@gobing-ai/ts-db')",
            );
        }
        if (patched === original) {
            throw new Error(
                `build: no variable-specifier ts-db import found in ${distFile} — the ts-runtime dist shape changed; update patchTsRuntimeImport before compiling`,
            );
        }
        writeFileSync(distFile, patched, 'utf-8');
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

/** Default child runner: buffered capture so build output becomes diagnostics, not stdout noise. */
async function defaultRunner(command: string, args: readonly string[], cwd: string): Promise<BuildDiagnostics> {
    const executor = new NodeProcessExecutor({ defaultTimeout: 900_000, defaultMaxOutput: 512_000 });
    const result = await executor.run({ command, args: [...args], cwd, forceBuffered: true });
    return {
        command,
        args: [...args],
        exitCode: result.exitCode ?? 1,
        stdout: result.stdout,
        stderr: result.stderr,
    };
}

/** Runs one child build; injected so tests never shell a real toolchain by accident. */
export type BuildRunner = (command: string, args: readonly string[], cwd: string) => Promise<BuildDiagnostics>;

/** One compiled-binary build request. */
export interface CompileRequest {
    /** Absolute entry file inside the source checkout. */
    entry: string;
    /** Absolute output path. */
    outfile: string;
    sourceRoot: string;
    /** Extra `--target` triples (cross-compilation); empty for a host-native build. */
    targets?: readonly string[];
    run?: BuildRunner;
}

/**
 * Compile one or more Bun executables with both patches applied under one restoration scope.
 *
 * `tryAcquire()` is awaited inside the scope on purpose: when the laya acquisition throws, the
 * ts-runtime patch is still restored and its lock released. Every restore in `finally` is attempted
 * even if a previous one throws, so one broken restore cannot strand the other patch.
 */
export async function buildCompiledBinary(request: CompileRequest): Promise<BuildResult> {
    const { entry, outfile, sourceRoot } = request;
    const run = request.run ?? defaultRunner;
    const diagnostics: BuildDiagnostics[] = [];
    const artifacts: BuildArtifact[] = [];
    const restores: (() => void)[] = [];
    const restoreFailures: Error[] = [];
    let outcome: BuildResult | undefined;
    let failure: unknown;
    let assetRoot: string | undefined;

    try {
        if (existsSync(join(sourceRoot, 'config'))) {
            assetRoot = await mkdtemp(join(tmpdir(), 'spur-build-assets-'));
            await bundleConfig(join(assetRoot, 'config'), { sourceRoot });
        }
        restores.push(patchTsRuntimeImport(sourceRoot));
        const restoreLaya = layaMlxInstalled(sourceRoot) ? patchLayaMlxSourceImport(sourceRoot) : undefined;
        if (restoreLaya !== undefined) restores.push(restoreLaya);

        for (const target of request.targets ?? [null]) {
            const args = ['build', entry, '--compile'];
            // The first install must find its seeds inside the single-file release binary.
            if (assetRoot !== undefined) args.push('--asset', join(assetRoot, 'config'));
            if (target !== null) args.push(`--target=${target}`);
            args.push('--external', UNUSED_LAYA_PEER);
            // Homebrew-less hosts without the darwin-only package (Linux CI) must externalize it:
            // the compile cannot resolve it and the target could not run MLX anyway.
            if (restoreLaya === undefined) args.push('--external', LAYA_MLX_PACKAGE);
            args.push('--outfile', outfile);
            const diagnostic = await run('bun', args, sourceRoot);
            diagnostics.push(diagnostic);
            if (diagnostic.exitCode !== 0) {
                throw new BuildError(
                    `bun build failed with exit code ${diagnostic.exitCode}${target === null ? '' : ` (${target})`}`,
                    sourceRoot,
                );
            }
            artifacts.push({ path: outfile, kind: target === null ? 'binary' : `binary:${target}` });
        }
        outcome = { ok: true, sourceRoot, artifacts, diagnostics };
    } catch (err) {
        failure = err;
    } finally {
        // Restore in reverse acquisition order and never let one restore strand the other. Nothing is
        // thrown from `finally`: the verdict is decided below, so a restore failure cannot mask the
        // build failure that caused the unwind (biome noUnsafeFinally).
        for (const restore of restores.slice().reverse()) {
            try {
                restore();
            } catch (err) {
                restoreFailures.push(err instanceof Error ? err : new Error(String(err)));
            }
        }
        if (assetRoot !== undefined) {
            try {
                await rm(assetRoot, { recursive: true, force: true });
            } catch (err) {
                restoreFailures.push(err instanceof Error ? err : new Error(String(err)));
            }
        }
    }

    if (restoreFailures.length > 0) {
        const detail = restoreFailures.map((err) => err.message).join('; ');
        const after =
            failure === undefined
                ? ''
                : ` (during cleanup after: ${failure instanceof Error ? failure.message : String(failure)})`;
        throw new BuildError(`patch restore failed: ${detail}${after}`, sourceRoot);
    }
    if (failure !== undefined) throw failure;
    if (outcome === undefined) throw new BuildError('build produced no result', sourceRoot);
    return outcome;
}

/** Compile the checkout's CLI to `<root>/dist/cli/spur`. */
export async function buildCli(
    options: { sourceRoot?: string; cwd?: string; run?: BuildRunner } = {},
): Promise<BuildResult> {
    const sourceRoot = resolveSourceRoot(options.sourceRoot, options.cwd ?? process.cwd());
    return buildCompiledBinary({
        entry: join(sourceRoot, 'apps', 'cli', 'src', 'index.ts'),
        outfile: join(sourceRoot, 'dist', 'cli', 'spur'),
        sourceRoot,
        ...(options.run !== undefined ? { run: options.run } : {}),
    });
}

/** Compile the checkout's standalone server to `<root>/dist/server/spur-server`. */
export async function buildServer(
    options: { sourceRoot?: string; cwd?: string; run?: BuildRunner } = {},
): Promise<BuildResult> {
    const sourceRoot = resolveSourceRoot(options.sourceRoot, options.cwd ?? process.cwd());
    return buildCompiledBinary({
        entry: join(sourceRoot, 'apps', 'server', 'src', 'index.ts'),
        outfile: join(sourceRoot, 'dist', 'server', 'spur-server'),
        sourceRoot,
        ...(options.run !== undefined ? { run: options.run } : {}),
    });
}

/** Absolute path helper so callers never re-derive the layout. */
export function buildOutputPath(sourceRoot: string, ...segments: string[]): string {
    return isAbsolute(sourceRoot) ? join(sourceRoot, ...segments) : join(sourceRoot, ...segments);
}
