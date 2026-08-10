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

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
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
 *  - `evals/` (monorepo-only; its sole consumer is the root `eval` script);
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
): Promise<{ pluginTarget: string; marketplaceTarget: string }> {
    await rm(pluginTarget, { recursive: true, force: true });
    await rm(marketplaceTarget, { recursive: true, force: true });

    await cp(PLUGIN_SOURCE, pluginTarget, {
        recursive: true,
        filter: (src) => !EXCLUDE.test(src.slice(PLUGIN_SOURCE.length)),
    });
    await cp(MARKETPLACE_SOURCE, marketplaceTarget, { recursive: true });

    return { pluginTarget, marketplaceTarget };
}
