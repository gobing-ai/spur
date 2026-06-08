/**
 * Cross-compile the `spur` CLI into per-platform standalone binaries for GitHub
 * Release assets. Bun's `--compile --target` cross-compiles from any host, so CI
 * can produce all four artifacts on a single Linux runner.
 *
 * Output: `dist/cli/spur-<os>-<arch>` matching the asset names that
 * `scripts/install.sh` downloads.
 */
import { mkdir } from 'node:fs/promises';

const CLI_ENTRY = new URL('../../apps/cli/src/index.ts', import.meta.url).pathname;
const OUT_DIR = new URL('../../dist/cli', import.meta.url).pathname;

// asset suffix -> Bun --target triple. Suffixes mirror scripts/install.sh.
const TARGETS: Record<string, string> = {
    'darwin-arm64': 'bun-darwin-arm64',
    'darwin-x64': 'bun-darwin-x64',
    'linux-arm64': 'bun-linux-arm64',
    'linux-x64': 'bun-linux-x64',
};

/** Cross-compile all per-platform `spur` binaries into `dist/cli/`. */
export async function buildBinaries(): Promise<void> {
    await mkdir(OUT_DIR, { recursive: true });

    let failed = false;
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

    if (failed) throw new Error('one or more targets failed to compile');
    console.log(`\nBuilt ${Object.keys(TARGETS).length} binaries into ${OUT_DIR}`);
}
