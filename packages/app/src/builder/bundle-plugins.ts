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
 *
 * A94 1410: every root is an explicit option resolved from a source root, never from this module's
 * location, so the same service serves a downstream checkout through `spur builder bundle-plugins`.
 */
import { cp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuildArtifact, BuildResult } from './compile';

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

/** Plugin staging options; every root defaults under `sourceRoot`. */
export interface BundlePluginsOptions {
    sourceRoot: string;
    /** destination for `plugins/` (default `<sourceRoot>/apps/cli/plugins`) */
    pluginTarget?: string;
    /** destination for `.claude-plugin/` (default `<sourceRoot>/apps/cli/.claude-plugin`) */
    marketplaceTarget?: string;
    /** canonical plugin tree (default `<sourceRoot>/plugins`) */
    pluginSource?: string;
    /** canonical marketplace tree (default `<sourceRoot>/.claude-plugin`) */
    marketplaceSource?: string;
}

/**
 * Copy the source root's `plugins/` and `.claude-plugin/` trees into the CLI package tree, pruning
 * non-distribution content from the staged copies.
 */
export async function bundlePlugins(options: BundlePluginsOptions): Promise<BuildResult> {
    const { sourceRoot } = options;
    const pluginSource = options.pluginSource ?? join(sourceRoot, 'plugins');
    const marketplaceSource = options.marketplaceSource ?? join(sourceRoot, '.claude-plugin');
    const pluginTarget = options.pluginTarget ?? join(sourceRoot, 'apps', 'cli', 'plugins');
    const marketplaceTarget = options.marketplaceTarget ?? join(sourceRoot, 'apps', 'cli', '.claude-plugin');

    await rm(pluginTarget, { recursive: true, force: true });
    await rm(marketplaceTarget, { recursive: true, force: true });

    await cp(pluginSource, pluginTarget, {
        recursive: true,
        filter: (src) => !EXCLUDE.test(src.slice(pluginSource.length)),
    });
    await cp(marketplaceSource, marketplaceTarget, { recursive: true });

    const artifacts: BuildArtifact[] = [
        { path: pluginTarget, kind: 'plugins' },
        { path: marketplaceTarget, kind: 'marketplace' },
    ];
    return { ok: true, sourceRoot, artifacts, diagnostics: [] };
}
