import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { BUNDLED_GLOBAL_CONFIG, bundledConfigRoot, listBundledConfigFiles } from '@gobing-ai/spur-config/loader';
import { bundledRulesRoot, listBundledRuleFiles } from '@gobing-ai/ts-rule-engine';
import type { FileSystem } from '@gobing-ai/ts-runtime';

/**
 * Machine-wide seed ownership (A93 1353 R2), extracted from `spur init` so `spur self install`
 * and project scaffolding share one implementation of "copy the shipped global layer into
 * `~/.config/spur/`".
 *
 * The one behavioural difference the extraction enables is honest reporting:
 * {@link seedGlobalRules} and {@link seedGlobalConfig} return `{written, created, assetsFound}`.
 * Init only needs `written` (its scaffolding stays exactly as it was, including a silent zero when
 * assets are absent), while install treats `assetsFound: false` as a required failure — a seed run
 * that copies zero files because nothing was shipped is a broken installation, not success.
 */

/** Global user config root, relative to the home directory. */
export const GLOBAL_CONFIG_DIR = join('.config', 'spur');

/** Global user rules root, relative to the home directory. */
export const GLOBAL_RULES_DIR = join(GLOBAL_CONFIG_DIR, 'rules');

/** Shipped global-config filename, seeded under its canonical name on first run. */
export const GLOBAL_CONFIG_EXAMPLE = BUNDLED_GLOBAL_CONFIG;

/** Canonical global user config filename written into `~/.config/spur/`. */
export const GLOBAL_CONFIG_FILE = 'config.yaml';

/** Narrow context the seed writers need: a project root and the process environment. */
export interface SeedContext {
    cwd: string;
    env: Record<string, string | undefined>;
}

/** Result of one seed pass: what was written, and whether any source asset existed at all. */
export interface SeedOutcome {
    /** Files created by this pass; empty when everything already existed. */
    created: string[];
    /** `false` when the bundled asset root is absent — the caller decides whether that is fatal. */
    assetsFound: boolean;
}

/**
 * Resolve the user-global config directory `~/.config/spur`, honoring `SPUR_GLOBAL_RULES_DIR`
 * for test isolation — the same override `RuleService` and the seed writers use.
 */
export function resolveGlobalConfigDir(ctx: SeedContext): string {
    const override = ctx.env.SPUR_GLOBAL_RULES_DIR;
    return override !== undefined && override.length > 0
        ? resolve(ctx.cwd, override)
        : join(homedir(), GLOBAL_CONFIG_DIR);
}

/** Resolve the global rules directory inside the global config root. */
export function globalRulesRoot(ctx: SeedContext): string {
    const override = ctx.env.SPUR_GLOBAL_RULES_DIR;
    return override !== undefined && override.length > 0
        ? resolve(ctx.cwd, override)
        : join(homedir(), GLOBAL_RULES_DIR);
}

/**
 * Copy the rule presets bundled with `@gobing-ai/ts-rule-engine` into the user's global rules
 * directory. Existing files are never overwritten, so customizations survive every rerun.
 */
export async function seedGlobalRules(fs: FileSystem, ctx: SeedContext): Promise<SeedOutcome> {
    const source = await bundledRulesRoot();
    if (source === null) return { created: [], assetsFound: false };
    const target = globalRulesRoot(ctx);
    const created: string[] = [];
    for (const relPath of await listBundledRuleFiles()) {
        const destination = join(target, relPath);
        if (await fs.exists(destination)) continue;
        await fs.ensureDir(join(target, ...relPath.split('/').slice(0, -1)));
        await fs.writeFile(destination, await fs.readFile(join(source, relPath)));
        created.push(destination);
    }
    return { created, assetsFound: true };
}

/**
 * Copy the default config assets bundled with the CLI package into the user's global config
 * directory. Existing files are never overwritten; the shipped `config.example.yaml` is seeded
 * under its canonical name so a fresh machine has a working global layer without manual renaming.
 */
export async function seedGlobalConfig(fs: FileSystem, ctx: SeedContext): Promise<SeedOutcome> {
    const source = bundledConfigRoot();
    if (source === null) return { created: [], assetsFound: false };
    const target = resolveGlobalConfigDir(ctx);
    const created: string[] = [];
    for (const relPath of listBundledConfigFiles()) {
        // The example is seeded under its canonical name below, not verbatim.
        if (relPath === GLOBAL_CONFIG_EXAMPLE) continue;
        const destination = join(target, relPath);
        if (await fs.exists(destination)) continue;
        await fs.ensureDir(join(target, ...relPath.split('/').slice(0, -1)));
        await fs.writeFile(destination, await fs.readFile(join(source, relPath)));
        created.push(destination);
    }

    const examplePath = join(source, GLOBAL_CONFIG_EXAMPLE);
    const globalConfigPath = join(target, GLOBAL_CONFIG_FILE);
    if ((await fs.exists(examplePath)) && !(await fs.exists(globalConfigPath))) {
        await fs.ensureDir(target);
        await fs.writeFile(globalConfigPath, await fs.readFile(examplePath));
        created.push(globalConfigPath);
    }
    return { created, assetsFound: true };
}
