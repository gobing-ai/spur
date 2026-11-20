import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import {
    type BuildArtifact,
    type BuildDiagnostics,
    BuildError,
    type BuildResult,
    type BuildRunner,
    buildCompiledBinary,
    resolveSourceRoot,
} from './compile';

/**
 * Release-asset build owner (A93 1354, design §5).
 *
 * Cross-compiles the CLI for the six GitHub-Release targets on one host and writes
 * `SHA256SUMS` in GNU `sha256sum` format — the exact file `scripts/install.sh` verifies. Names and
 * checksum format are a contract with the installer, so they stay pinned by tests rather than by
 * prose.
 */
const TARGETS: Record<string, string> = {
    'darwin-arm64': 'bun-darwin-arm64',
    'darwin-x64': 'bun-darwin-x64',
    'linux-arm64': 'bun-linux-arm64',
    'linux-x64': 'bun-linux-x64',
    'windows-x64': 'bun-windows-x64',
    'windows-arm64': 'bun-windows-arm64',
};

/** Every cross-compile target this verb accepts (`--targets` values). */
export const BINARY_TARGETS = Object.keys(TARGETS);

/**
 * Release asset file name. A `.exe` outfile is what Bun writes for Windows targets.
 *
 * @param suffix - target suffix, e.g. `windows-x64`
 * @param name - asset base name (default `spur`, the release contract `scripts/install.sh` verifies)
 */
export function binaryAssetName(suffix: string, name = 'spur'): string {
    return suffix.startsWith('windows-') ? `${name}-${suffix}.exe` : `${name}-${suffix}`;
}

/** Every release asset name, in build order. */
export function releaseAssetNames(): string[] {
    return Object.keys(TARGETS).map((suffix) => binaryAssetName(suffix));
}

/**
 * Write `<dir>/SHA256SUMS` in GNU `sha256sum` format (`<hex>  <name>`), one line per asset in the
 * given order, and return its content. `scripts/install.sh` matches the second field exactly.
 */
export async function writeSha256Sums(dir: string, assetNames: readonly string[]): Promise<string> {
    let content = '';
    for (const name of assetNames) {
        const bytes = await readFile(join(dir, name));
        content += `${new Bun.CryptoHasher('sha256').update(bytes).digest('hex')}  ${name}\n`;
    }
    await writeFile(join(dir, 'SHA256SUMS'), content);
    return content;
}

/** Options accepted by {@link buildBinaries}. */
export interface BuildBinariesOptions {
    /** Spur checkout to build; ignored when `entry` is set (nothing is validated but `entry`). */
    sourceRoot?: string;
    cwd?: string;
    run?: BuildRunner;
    /**
     * Generic mode (A94 1411): compile this entry for the requested targets and write
     * `<name>-<target>[.exe]` plus `SHA256SUMS` into `out`. No Spur source-root check, and the
     * runtime patches are off because a downstream project has neither patched source.
     */
    entry?: string;
    /** Asset base name; defaults to the entry basename without its extension. */
    name?: string;
    /** Target subset; defaults to every target. */
    targets?: readonly string[];
    /** Output directory; defaults to `dist/bin` under the cwd. */
    out?: string;
}

/**
 * Cross-compile release binaries.
 *
 * Legacy mode (no `entry`): every per-platform `spur` binary into `<root>/dist/cli/` plus
 * `SHA256SUMS`, byte-identical to the route it replaced.
 * Generic mode (`entry`): `<name>-<target>[.exe]` assets for the requested targets into `out`.
 */
export async function buildBinaries(options: BuildBinariesOptions = {}): Promise<BuildResult> {
    if (options.entry !== undefined) return buildEntryBinaries(options, options.entry);
    const sourceRoot = resolveSourceRoot(options.sourceRoot, options.cwd ?? process.cwd());
    const outDir = join(sourceRoot, 'dist', 'cli');
    await mkdir(outDir, { recursive: true });
    const entry = join(sourceRoot, 'apps', 'cli', 'src', 'index.ts');

    // One invocation per target: the service re-applies both patches per call, so a failure on one
    // target cannot leave the checkout patched for the next one.
    const artifacts: BuildArtifact[] = [];
    const diagnostics: BuildDiagnostics[] = [];
    for (const [suffix, target] of Object.entries(TARGETS)) {
        const outfile = join(outDir, binaryAssetName(suffix));
        try {
            const result = await buildCompiledBinary({
                entry,
                outfile,
                sourceRoot,
                targets: [target],
                ...(options.run !== undefined ? { run: options.run } : {}),
            });
            artifacts.push(...result.artifacts);
            diagnostics.push(...result.diagnostics);
        } catch (error) {
            throw new BuildError(
                `target ${target} failed: ${error instanceof Error ? error.message : String(error)}`,
                sourceRoot,
            );
        }
    }

    const sums = await writeSha256Sums(
        outDir,
        artifacts.map((artifact) => artifact.path.slice(outDir.length + 1)),
    );
    artifacts.push({ path: join(outDir, 'SHA256SUMS'), kind: `sha256sums:${sums.split('\n').filter(Boolean).length}` });
    return { ok: true, sourceRoot, artifacts, diagnostics };
}

/** Generic mode: compile one entry per requested target and checksum the results. */
async function buildEntryBinaries(options: BuildBinariesOptions, entry: string): Promise<BuildResult> {
    const cwd = options.cwd ?? process.cwd();
    const requested = options.targets ?? BINARY_TARGETS;
    if (requested.length === 0) throw new BuildError('no targets requested', cwd);
    for (const target of requested) {
        if (!(target in TARGETS)) {
            throw new BuildError(`unknown target: ${target} (valid: ${BINARY_TARGETS.join(',')})`, cwd);
        }
    }
    const name = options.name ?? basename(entry, extname(entry));
    const outDir = resolve(cwd, options.out ?? join('dist', 'bin'));
    const absoluteEntry = resolve(cwd, entry);
    await mkdir(outDir, { recursive: true });

    const artifacts: BuildArtifact[] = [];
    const diagnostics: BuildDiagnostics[] = [];
    for (const target of requested) {
        const outfile = join(outDir, binaryAssetName(target, name));
        try {
            const result = await buildCompiledBinary({
                entry: absoluteEntry,
                outfile,
                sourceRoot: cwd,
                targets: [TARGETS[target] as string],
                patchRuntime: false,
                ...(options.run !== undefined ? { run: options.run } : {}),
            });
            artifacts.push(...result.artifacts);
            diagnostics.push(...result.diagnostics);
        } catch (error) {
            throw new BuildError(
                `target ${target} failed: ${error instanceof Error ? error.message : String(error)}`,
                cwd,
            );
        }
    }

    const sums = await writeSha256Sums(
        outDir,
        artifacts.map((artifact) => artifact.path.slice(outDir.length + 1)),
    );
    artifacts.push({ path: join(outDir, 'SHA256SUMS'), kind: `sha256sums:${sums.split('\n').filter(Boolean).length}` });
    return { ok: true, sourceRoot: cwd, artifacts, diagnostics };
}
