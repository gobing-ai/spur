import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Directory name holding the default config assets bundled with the CLI.
 * Lives at the repo root (sibling to `apps/`), shipped inside `dist/config/`
 * by the build:bundle step.
 */
const BUNDLED_CONFIG_DIR = 'config';

/** Memoized result so the upward filesystem walk runs at most once per process. */
let cachedRoot: string | null | undefined;

/**
 * Resolve the absolute path to the default config tree bundled with the CLI.
 *
 * The directory ships preset YAML files (`rules/`, `workflows/`, `plugins/`)
 * that `spur init` seeds into `~/.config/spur/` on first run. Resolution walks
 * up from this module's compiled location (under `dist/` at runtime, under
 * `src/` in tests) until it finds the bundled `config/` directory. Returns
 * `null` if the directory is absent (e.g. `bun build --compile` produces a
 * single binary with no sibling files).
 */
export function bundledConfigRoot(): string | null {
    if (cachedRoot !== undefined) return cachedRoot;
    let dir = import.meta.dirname;
    // Walk to filesystem root at most; the config dir is a few levels up.
    while (true) {
        const candidate = join(dir, BUNDLED_CONFIG_DIR);
        if (
            existsSync(candidate) &&
            statSync(candidate).isDirectory() &&
            // Distinguish the repo-root config/ from any coincidentally named dir
            // (e.g. this file's own parent directory) by checking for the expected
            // subdirectories created in task 0024.
            existsSync(join(candidate, 'rules')) &&
            existsSync(join(candidate, 'workflows'))
        ) {
            cachedRoot = candidate;
            return cachedRoot;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    cachedRoot = null;
    return cachedRoot;
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
 * List the relative paths of every bundled template file (`.md` under `config/templates/`),
 * each as a `/`-joined path relative to {@link bundledConfigRoot}.
 *
 * Intended for `spur init` to copy task templates, feature templates, and BDD
 * snippets into `.spur/config/templates/`. Returns an empty array when no
 * bundled directory is present.
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
