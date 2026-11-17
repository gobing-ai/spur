/**
 * Stage the marketplace/plugin content into the CLI package tree for the npm
 * tarball. The published `@gobing-ai/spur` package (from `apps/cli/`) must ship
 * `plugins/` and `.claude-plugin/` at the package root so an end user can run
 * `superskill install sp --marketplace <spur-package-root>` without cloning
 * this monorepo.
 *
 * npm cannot pack these via bare `files` entries because both trees live at the
 * monorepo root while the package is `apps/cli/` (silent empty pack — superskill
 * task 0113 measured it). So staging is a build-time copy, mirroring
 * `bundle-config` / `bundle-web`, with a prune filter for non-distribution
 * content. The copied destinations are gitignored build artifacts — never
 * hand-edit `apps/cli/{plugins,.claude-plugin}`.
 */
import { cp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PLUGIN_SOURCE = join(REPO_ROOT, 'plugins');
const PLUGIN_TARGET = join(REPO_ROOT, 'apps/cli/plugins');
const MARKETPLACE_SOURCE = join(REPO_ROOT, '.claude-plugin');
const MARKETPLACE_TARGET = join(REPO_ROOT, 'apps/cli/.claude-plugin');

/**
 * Prune anything that is not distribution content. `cp`'s filter runs per
 * entry: returning false prunes the entry (and, for a directory, its subtree).
 *
 * Excluded from the staged copy only:
 *  - `tests/` directories and any `*.test.ts` file anywhere in the tree (the
 *    root suite is `bun test … ./apps/cli … ./scripts`; `bun test` walks the
 *    staged tree and ignores `.gitignore`, so an unpruned test file is
 *    discovered twice — AC7);
 *  - `evals/` directories (`plugins/sp/tests/evals` after task 1175) — harness fixtures whose
 *    sole consumer is the root `eval` script;
 *  - OS junk (`.DS_Store`), matching `bundle-config`'s EXCLUDE.
 */
export const EXCLUDE = /(^|\/)(\.DS_Store|tests|evals)($|\/)|\.test\.ts$/;

/**
 * Copy the repo-root `plugins/` and `.claude-plugin/` trees into `apps/cli/`,
 * pruning non-distribution content from the staged copies.
 *
 * @param pluginTarget  - destination for `plugins/` (default `apps/cli/plugins`)
 * @param marketplaceTarget - destination for `.claude-plugin/` (default `apps/cli/.claude-plugin`)
 */
export async function bundlePlugins(
    pluginTarget: string = PLUGIN_TARGET,
    marketplaceTarget: string = MARKETPLACE_TARGET,
    pluginSource: string = PLUGIN_SOURCE,
    marketplaceSource: string = MARKETPLACE_SOURCE,
): Promise<{ pluginTarget: string; marketplaceTarget: string }> {
    await rm(pluginTarget, { recursive: true, force: true });
    await rm(marketplaceTarget, { recursive: true, force: true });

    await cp(pluginSource, pluginTarget, {
        recursive: true,
        filter: (src) => !EXCLUDE.test(src.slice(pluginSource.length)),
    });
    await cp(marketplaceSource, marketplaceTarget, { recursive: true });

    return { pluginTarget, marketplaceTarget };
}

// A93 1355: CLI entry so the release path (`spur builder bump-ver`) can DRIVE this retained
// generator as a subprocess instead of value-importing repository tooling into the app.
//   bun scripts/commands/bundle-plugins.ts [pluginTarget] [marketplaceTarget] [pluginSource] [marketplaceSource]
// The dispatcher imports this module (`bundle-plugins` case), where `import.meta.main` is false.
if (import.meta.main) {
    const [pluginTarget, marketplaceTarget, pluginSource, marketplaceSource] = process.argv.slice(2);
    const result = await bundlePlugins(
        pluginTarget ?? PLUGIN_TARGET,
        marketplaceTarget ?? MARKETPLACE_TARGET,
        pluginSource ?? PLUGIN_SOURCE,
        marketplaceSource ?? MARKETPLACE_SOURCE,
    );
    console.log(`bundle-plugins: ${result.pluginTarget} + ${result.marketplaceTarget}`);
}
