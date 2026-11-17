import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

/** Release asset file name. A `.exe` outfile is what Bun writes for Windows targets. */
export function binaryAssetName(suffix: string): string {
    return suffix.startsWith('windows-') ? `spur-${suffix}.exe` : `spur-${suffix}`;
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

/** Cross-compile all per-platform `spur` binaries into `<root>/dist/cli/` plus `SHA256SUMS`. */
export async function buildBinaries(
    options: { sourceRoot?: string; cwd?: string; run?: BuildRunner } = {},
): Promise<BuildResult> {
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
