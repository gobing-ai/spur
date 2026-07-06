import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Directory names to search for bundled config assets, tried at each filesystem
 * level. `config` is the repo-root layout; `spur-cli/config` is the npm package
 * layout produced by the `build:bundle` script.
 */
const BUNDLED_CONFIG_DIRS = ['config', 'spur-cli/config'];

/** Memoized result so the upward filesystem walk runs at most once per process. */
let cachedRoot: string | null | undefined;

/**
 * Resolve the absolute path to the default config tree bundled with the CLI.
 *
 * Walks up from this module's location, trying each of {@link BUNDLED_CONFIG_DIRS}
 * at each level, until it finds one containing `rules/` + `workflows/`. This
 * handles the two runtimes that ship a sibling `config/` tree:
 *   - source: `bun run apps/cli/src/index.ts` → finds repo-root `config/`
 *   - npm package: `spur.js` + `spur-cli/config/` → finds `spur-cli/config/`
 *
 * Returns `null` when no matching directory is reachable. NOTE: a `bun build
 * --compile` single binary has no sibling filesystem, so this returns `null`
 * there — callers fall back to their built-in defaults. Embedding config into the
 * compiled binary (0117 R6) is not yet implemented; `--asset name=path` is not a
 * valid Bun flag, and asset embedding requires importing the files so Bun bundles
 * them, plus reading them back via `Bun.embeddedFiles` at runtime.
 */
export function bundledConfigRoot(): string | null {
    if (cachedRoot !== undefined) return cachedRoot;
    let dir = import.meta.dirname;
    while (true) {
        for (const name of BUNDLED_CONFIG_DIRS) {
            const candidate = join(dir, name);
            if (isBundledConfigDir(candidate)) {
                cachedRoot = candidate;
                return cachedRoot;
            }
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    cachedRoot = null;
    return cachedRoot;
}

/** Check that a candidate dir exists and contains the expected subdirectories. */
function isBundledConfigDir(candidate: string): boolean {
    return (
        existsSync(candidate) &&
        statSync(candidate).isDirectory() &&
        existsSync(join(candidate, 'rules')) &&
        existsSync(join(candidate, 'workflows'))
    );
}

/**
 * List the relative paths of every bundled config asset, each as a `/`-joined
 * path relative to {@link bundledConfigRoot}. Filters to YAML/JSON files only.
 *
 * Intended for `seedGlobalConfig` to copy the bundled config into a writable
 * location (e.g. `~/.config/spur/`) on first run. Returns an empty array when
 * no bundled directory is present.
 */
export function listBundledConfigFiles(): string[] {
    const root = bundledConfigRoot();
    if (root === null) return [];
    return walk(root, '').sort();
}

/** Recursively collect files under `dir` matching `filter`, returning paths relative to the walk origin. */
function walk(dir: string, relPrefix: string, filter: RegExp = /\.(ya?ml|json)$/i): string[] {
    const acc: string[] = [];
    for (const entry of readdirSync(dir)) {
        const abs = join(dir, entry);
        const rel = relPrefix.length > 0 ? `${relPrefix}/${entry}` : entry;
        if (statSync(abs).isDirectory()) {
            acc.push(...walk(abs, rel, filter));
        } else if (filter.test(entry)) {
            acc.push(rel);
        }
    }
    return acc;
}

/**
 * List the relative paths of every bundled template file (`.md` under the shipped `templates/`),
 * each as a `/`-joined path relative to {@link bundledConfigRoot}.
 *
 * Intended for `spur init` to copy task templates, feature templates, and BDD
 * snippets into `.spur/templates/` (task templates land in `.spur/tasks/templates/`).
 * Returns an empty array when no bundled directory is present.
 */
export function listBundledTemplateFiles(): string[] {
    const root = bundledConfigRoot();
    if (root === null) return [];
    const templatesDir = join(root, 'templates');
    if (!existsSync(templatesDir) || !statSync(templatesDir).isDirectory()) return [];
    return walk(templatesDir, 'templates', /\.md$/i).sort();
}

/**
 * Reset the cached root. For use in tests that need to re-resolve after
 * filesystem changes (e.g. build output appearing mid-test).
 */
export function resetBundledConfigCache(): void {
    cachedRoot = undefined;
}
