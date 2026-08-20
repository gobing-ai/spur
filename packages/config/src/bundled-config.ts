import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Directory names to search for bundled config assets, tried at each filesystem
 * level (first match wins):
 *   - `config` — repo-root SSOT (dev) AND the npm package layout produced by
 *     `build:bundle` (`apps/cli/config` shipped as package-root `config/`)
 *   - `spur-cli/config` — legacy npm layout (0.2.x–0.3.x before the restore of
 *     package-root `config/`); kept so already-installed packages still resolve
 */
const BUNDLED_CONFIG_DIRS = ['config', 'spur-cli/config'];

/** Memoized result so the upward filesystem walk runs at most once per process. */
let cachedRoot: string | null | undefined;

/**
 * Resolve the absolute path to the default config tree bundled with the CLI.
 *
 * Walks up from this module's location, trying each of {@link BUNDLED_CONFIG_DIRS}
 * at each level, until it finds one containing `rules/` + `workflows/`. This
 * handles the runtimes that ship a sibling config tree:
 *   - source: `bun run apps/cli/src/index.ts` → repo-root `config/`
 *   - npm package (current): `spur.js` + package-root `config/`
 *   - npm package (legacy): `spur.js` + `spur-cli/config/`
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
 * snippets into `.spur/templates/` (task templates land in `.spur/templates/task/`).
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
 * Extensions copied into a project's `.spur/` on `spur init` (full-tree seed).
 * Includes rule/workflow YAML, templates (`.md`), and plugin placeholders (`.gitkeep`).
 * Excludes the example config filename — that is seeded as project/global `config.yaml`
 * under a different name, never as a live `.example` file.
 */
const PROJECT_SEED_FILTER = /\.(ya?ml|json|md|gitkeep)$/i;

/** Bundled example filename — never copied into project `.spur/` as-is. */
const BUNDLED_CONFIG_EXAMPLE = 'config.example.yaml';

/**
 * Bundled assets kept in this repository but no longer seeded into projects.
 *
 * D5-K absorbed planning into the idea pipeline + `/sp:dev-plan` (ADR-072), so a fresh
 * project must not receive a second, competing planning graph. The source file stays
 * on disk until ADR-072 is accepted, which is when it is deleted outright.
 */
const RETIRED_PROJECT_SEEDS: ReadonlySet<string> = new Set(['workflows/planning-pipeline.yaml']);

/**
 * List every bundled asset that should land under a project's `.spur/` on init.
 *
 * Unlike {@link listBundledConfigFiles} (YAML/JSON only, for `~/.config/spur/`) this
 * includes markdown templates and `.gitkeep` placeholders so the project scaffold
 * mirrors the full monorepo `config/` tree (rules, workflows, tasks, templates,
 * plugins). `config.example.yaml` is omitted.
 */
export function listBundledProjectSeedFiles(): string[] {
    const root = bundledConfigRoot();
    if (root === null) return [];
    return walk(root, '', PROJECT_SEED_FILTER)
        .filter((rel) => rel !== BUNDLED_CONFIG_EXAMPLE && !RETIRED_PROJECT_SEEDS.has(rel))
        .sort();
}

/**
 * Reset the cached root. For use in tests that need to re-resolve after
 * filesystem changes (e.g. build output appearing mid-test).
 */
export function resetBundledConfigCache(): void {
    cachedRoot = undefined;
}
