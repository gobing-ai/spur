import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import { bundledConfigRoot, listBundledConfigFiles } from '@gobing-ai/spur-config';
import { ArtifactDao } from '@gobing-ai/spur-domain';
import { bundledRulesRoot, listBundledRuleFiles } from '@gobing-ai/ts-rule-engine';
import { CLI_CONFIG } from '../config';
import { SCAFFOLD_MANIFEST } from '../config/scaffold-manifest';
import type { CliContext } from '../context';
import { toJson } from '../output';

/** Global user config root, relative to the home directory. */
const GLOBAL_CONFIG_DIR = join('.config', 'spur');

/** Global user rules root, relative to the home directory (mirrors `rule.ts`). */
const GLOBAL_RULES_DIR = join(GLOBAL_CONFIG_DIR, 'rules');

/** Bundled example config filename, seeded as {@link GLOBAL_CONFIG_FILE} on first run. */
const GLOBAL_CONFIG_EXAMPLE = 'config.example.yaml';

/** Canonical global user config filename written into `~/.config/spur/`. */
const GLOBAL_CONFIG_FILE = 'config.yaml';

/** Files created or skipped during a scaffold, reported in the result envelope. */
interface ScaffoldResult {
    created: string[];
    skipped: string[];
}

/** Resolve the global rules root, honoring `SPUR_GLOBAL_RULES_DIR` for test isolation. */
function globalRulesRoot(context: CliContext): string {
    const override = context.env.SPUR_GLOBAL_RULES_DIR;
    return override !== undefined && override.length > 0
        ? resolve(context.cwd, override)
        : join(homedir(), GLOBAL_RULES_DIR);
}

/** Write `content` at `path` unless it already exists (or `force`); record the outcome. */
async function writeIfNew(
    context: CliContext,
    path: string,
    content: string,
    force: boolean,
    result: ScaffoldResult,
): Promise<void> {
    if (!force && (await context.fs.exists(path))) {
        result.skipped.push(path);
        return;
    }
    await context.fs.writeFile(path, content);
    result.created.push(path);
}

/**
 * Copy the rule presets bundled with `@gobing-ai/ts-rule-engine` into the user's
 * global rules directory on first run. Existing files are never overwritten, so a
 * user's customizations and `--force` re-inits leave the global layer intact. This
 * is what makes `spur rule run --preset recommended-pre-check` resolve to a real ruleset
 * from any project, independent of the bundled fallback. Returns files written.
 */
async function seedGlobalRules(context: CliContext): Promise<number> {
    const source = await bundledRulesRoot();
    if (source === null) return 0;
    const target = globalRulesRoot(context);
    let written = 0;
    for (const relPath of await listBundledRuleFiles()) {
        const destination = join(target, relPath);
        if (await context.fs.exists(destination)) continue;
        await context.fs.ensureDir(join(target, ...relPath.split('/').slice(0, -1)));
        await context.fs.writeFile(destination, await context.fs.readFile(join(source, relPath)));
        written += 1;
    }
    return written;
}

/**
 * Copy the default config assets bundled in `dist/config/` (or `config/` in dev)
 * into the user's global config directory on first run. Seeds both `rules/` and
 * `workflows/` subdirectories. Existing files are never overwritten, preserving
 * user customizations. Returns the number of files written.
 */
async function seedGlobalConfig(context: CliContext): Promise<number> {
    const source = bundledConfigRoot();
    if (source === null) return 0;
    // Target is ~/.config/spur/ (same parent as globalRulesRoot, one level up).
    const globalOverride = context.env.SPUR_GLOBAL_RULES_DIR;
    const target =
        globalOverride !== undefined && globalOverride.length > 0
            ? resolve(context.cwd, globalOverride)
            : join(homedir(), GLOBAL_CONFIG_DIR);
    // Only create subdirs that have files to seed (rules, workflows).
    let written = 0;
    for (const relPath of listBundledConfigFiles()) {
        // The example is seeded under its canonical name `config.yaml` below, not
        // verbatim — a user edits `config.yaml`, never a `.example` file.
        if (relPath === GLOBAL_CONFIG_EXAMPLE) continue;
        const destination = join(target, relPath);
        if (await context.fs.exists(destination)) continue;
        await context.fs.ensureDir(join(target, ...relPath.split('/').slice(0, -1)));
        await context.fs.writeFile(destination, await context.fs.readFile(join(source, relPath)));
        written += 1;
    }

    // Seed `config.example.yaml` as `~/.config/spur/config.yaml` on first run so a
    // fresh install has a working global config without manual renaming. Never
    // overwrite an existing config — the user owns it once it exists.
    const examplePath = join(source, GLOBAL_CONFIG_EXAMPLE);
    const globalConfigPath = join(target, GLOBAL_CONFIG_FILE);
    if ((await context.fs.exists(examplePath)) && !(await context.fs.exists(globalConfigPath))) {
        await context.fs.ensureDir(target);
        await context.fs.writeFile(globalConfigPath, await context.fs.readFile(examplePath));
        written += 1;
    }
    return written;
}
/** Register `spur init` command. */
export function registerInitCommand(program: Command, context: CliContext): void {
    program
        .command('init')
        .summary('scaffold a local Spur project')
        .option('--name <name>', 'Project name (default: current directory name)')
        .option('--force', 'Recreate files that already exist')
        .option('--minimal', 'Only write the minimal .spur scaffold')
        .option('--json', 'Output machine-readable JSON')
        .action(async (options) => {
            const json = options.json === true;
            const force = options.force === true;
            const minimal = options.minimal === true;
            const projectName = options.name ?? 'default';
            const configPath = join(context.cwd, CLI_CONFIG.configFile);

            // Re-init guard: a config that already exists is only overwritten with --force,
            // so a stray `spur init` cannot silently clobber a configured project.
            if (!force && (await context.fs.exists(configPath))) {
                const message = `Already initialized: ${CLI_CONFIG.configFile}. Use --force to overwrite.`;
                context.output.write(
                    json
                        ? toJson({ ok: false, reason: 'already-initialized', config: CLI_CONFIG.configFile })
                        : message,
                );
                context.setExitCode(1);
                return;
            }

            const result: ScaffoldResult = { created: [], skipped: [] };
            // Write a minimal .spur/config.yaml (single surface — ADR-017).
            // The bootstrap block is seeded from config.example.yaml during scaffold below;
            // this minimal stub is enough to mark the project as initialized.
            const configYaml = `${[
                `# Spur project configuration for ${projectName}`,
                `# Generated by \`spur init\``,
                '',
                '$schema: "@gobing-ai/spur/schemas/spur-config.schema.json"',
                `version: "1"`,
                `name: ${projectName}`,
                '',
                'bootstrap:',
                '  logging:',
                '    enabled: true',
                '    level: info',
                '    console: true',
                '    json: true',
                '    file: true',
                `    filePath: ${CLI_CONFIG.configDir}/logs/spur.log`,
                '  database:',
                '    enabled: true',
                '    driver: bun-sqlite',
                `    url: ${CLI_CONFIG.databaseFile}`,
                '  telemetry:',
                '    enabled: false',
                '  scheduler:',
                '    enabled: false',
            ].join('\n')}\n`;

            await context.fs.ensureDir(join(context.cwd, CLI_CONFIG.configDir));
            await context.fs.writeFile(configPath, configYaml);
            result.created.push(configPath);

            // Team-mode agent specs live under .spur/agents/; seed the directory with a
            // .gitkeep so it is tracked before any `spur agent create` writes a spec.
            const agentsDir = join(context.cwd, CLI_CONFIG.configDir, 'agents');
            await context.fs.ensureDir(agentsDir);
            await writeIfNew(context, join(agentsDir, '.gitkeep'), '', force, result);

            if (!minimal) {
                // Resolve the bundled config root once; fall back gracefully if absent
                // (e.g. compiled binary without sibling config/ directory).
                const configRoot = bundledConfigRoot();
                if (configRoot !== null) {
                    for (const entry of SCAFFOLD_MANIFEST) {
                        const sourcePath = join(configRoot, entry.source);
                        if (!(await context.fs.exists(sourcePath))) continue;
                        // root-scoped entries (docs/) resolve against the project root, not .spur/
                        const baseDir = entry.root === true ? context.cwd : join(context.cwd, CLI_CONFIG.configDir);
                        const targetPath = join(baseDir, entry.target);
                        await context.fs.ensureDir(join(targetPath, '..'));
                        // preserve-marked entries are never overwritten, even with --force
                        const entryForce = entry.preserve === true ? false : force;
                        await writeIfNew(
                            context,
                            targetPath,
                            await context.fs.readFile(sourcePath),
                            entryForce,
                            result,
                        );
                    }
                }
            }

            const db = await context.getDb();
            await new ArtifactDao(db).record({ path: configPath, kind: 'config' });

            const rulesSeeded = await seedGlobalRules(context);
            const configSeeded = await seedGlobalConfig(context);

            if (json) {
                context.output.write(
                    toJson({
                        ok: true,
                        project: projectName,
                        config: CLI_CONFIG.configFile,
                        ...result,
                        globalRulesSeeded: rulesSeeded,
                        globalConfigSeeded: configSeeded,
                    }),
                );
            }

            if (!json) {
                context.output.write(`Initialized ${CLI_CONFIG.configFile}`);
                for (const path of result.created) context.output.write(`  ✓ ${path}`);
                for (const path of result.skipped) context.output.write(`  - ${path} (exists)`);
                if (rulesSeeded > 0) {
                    context.output.write(`  ✓ seeded ${rulesSeeded} rule file(s) to ~/${GLOBAL_RULES_DIR}`);
                }
                if (configSeeded > 0) {
                    context.output.write(`  ✓ seeded ${configSeeded} config file(s) to ~/${GLOBAL_CONFIG_DIR}`);
                }
            }
        });
}
