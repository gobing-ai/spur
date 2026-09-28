/**
 * Cross-compile the `spur` CLI into per-platform standalone binaries for GitHub
 * Release assets. Bun's `--compile --target` cross-compiles from any host, so CI
 * can produce all four artifacts on a single Linux runner.
 *
 * Output: `dist/cli/spur-<os>-<arch>` matching the asset names that
 * `scripts/install.sh` downloads, plus `dist/cli/SHA256SUMS` that it verifies them against.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchTsRuntimeImport } from './build-cli';

const CLI_ENTRY = fileURLToPath(new URL('../../apps/cli/src/index.ts', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../../dist/cli', import.meta.url));

// asset suffix -> Bun --target triple. Suffixes mirror scripts/install.sh.
const TARGETS: Record<string, string> = {
    'darwin-arm64': 'bun-darwin-arm64',
    'darwin-x64': 'bun-darwin-x64',
    'linux-arm64': 'bun-linux-arm64',
    'linux-x64': 'bun-linux-x64',
};

/**
 * Write `<dir>/SHA256SUMS` in GNU `sha256sum` format (`<hex>  <name>`), one line per asset in the
 * given order, and return its content. `scripts/install.sh` matches the second field exactly.
 */
export async function writeSha256Sums(dir: string, assetNames: readonly string[]): Promise<string> {
    let content = '';
    for (const name of assetNames) {
        const bytes = await Bun.file(join(dir, name)).arrayBuffer();
        content += `${new Bun.CryptoHasher('sha256').update(bytes).digest('hex')}  ${name}\n`;
    }
    await Bun.write(join(dir, 'SHA256SUMS'), content);
    return content;
}

/** Cross-compile all per-platform `spur` binaries into `dist/cli/`. */
export async function buildBinaries(): Promise<void> {
    await mkdir(OUT_DIR, { recursive: true });

    const restore = patchTsRuntimeImport();
    let failed = false;
    try {
        for (const [suffix, target] of Object.entries(TARGETS)) {
            const outfile = `${OUT_DIR}/spur-${suffix}`;
            console.log(`Compiling ${target} -> ${outfile}`);
            const result = Bun.spawnSync(
                ['bun', 'build', CLI_ENTRY, '--compile', `--target=${target}`, '--outfile', outfile],
                { stdio: ['ignore', 'inherit', 'inherit'] },
            );
            if (result.exitCode !== 0) {
                console.error(`  failed: ${target}`);
                failed = true;
            }
        }
    } finally {
        restore();
    }

    if (failed) throw new Error('one or more targets failed to compile');
    const assets = Object.keys(TARGETS).map((suffix) => `spur-${suffix}`);
    await writeSha256Sums(OUT_DIR, assets);
    console.log(`\nBuilt ${assets.length} binaries into ${OUT_DIR}; wrote SHA256SUMS (${assets.length} entries)`);
}
