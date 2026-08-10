/**
 * Pre-publish version-drift guard (task 0500 R6).
 *
 * Fails `npm publish` if the repo-root marketplace/plugin versions have drifted
 * from the published CLI package version. This must run on `prepublishOnly`
 * (which executes BEFORE `prepack`/staging), so it reads the repo-root sources,
 * never the staged `apps/cli/` copies.
 *
 * Release keeps these in lockstep via `syncMarketplaceAndPlugins`
 * (scripts/commands/release.ts), so any drift at publish time means the packed
 * marketplace advertises a stale plugin version (superskill task 0113 measured
 * this class of defect — see `findMarketplaceVersionDrift`).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const PKG = join(REPO_ROOT, 'apps/cli/package.json');
const MARKETPLACE = join(REPO_ROOT, '.claude-plugin/marketplace.json');
const PLUGIN = join(REPO_ROOT, 'plugins/sp/plugin.json');

interface Marketplace {
    plugins?: Array<{ name?: string; version?: string }>;
}

/** Parse JSON, failing with a clear path-bearing message on malformed input. */
function parseJson<T>(text: string, label: string): T {
    try {
        return JSON.parse(text) as T;
    } catch (error) {
        throw new Error(
            `check-marketplace-version: ${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

/**
 * Collect marketplace plugin versions that differ from the given package version.
 * Pure string-input form (testable without the file layout).
 */
export function findMarketplaceVersionDriftFrom(
    marketplaceText: string,
    pluginVersion: string,
    pkgVersion: string,
): string[] {
    const marketplace = parseJson<Marketplace>(marketplaceText, '.claude-plugin/marketplace.json');
    const drift: string[] = [];
    for (const entry of marketplace.plugins ?? []) {
        if (entry.version !== pkgVersion) {
            drift.push(`marketplace plugin "${entry.name}": ${entry.version} (package is ${pkgVersion})`);
        }
    }
    if (pluginVersion !== pkgVersion) {
        drift.push(`plugins/sp/plugin.json: ${pluginVersion} (package is ${pkgVersion})`);
    }
    return drift;
}

/** Collect marketplace plugin versions that differ from the package version. */
export async function findMarketplaceVersionDrift(): Promise<string[]> {
    const pkgVersion =
        parseJson<{ version?: string }>(await readFile(PKG, 'utf-8'), 'apps/cli/package.json').version ?? '';
    const marketplace = await readFile(MARKETPLACE, 'utf-8');
    const plugin = parseJson<{ version?: string }>(await readFile(PLUGIN, 'utf-8'), 'plugins/sp/plugin.json');
    return findMarketplaceVersionDriftFrom(marketplace, plugin.version ?? '', pkgVersion);
}

/** Entry point for `spur-dev check-marketplace-version`. Exits non-zero on drift. */
export async function checkMarketplaceVersion(): Promise<number> {
    const drift = await findMarketplaceVersionDrift();
    if (drift.length > 0) {
        console.error(`Marketplace/plugin version drift:\n  ${drift.join('\n  ')}`);
        return 1;
    }
    console.log('Marketplace/plugin versions match package version.');
    return 0;
}
