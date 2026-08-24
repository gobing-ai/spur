import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import { misplacedGlobalKeys } from '@gobing-ai/spur-config';
import {
    BUNDLED_GLOBAL_CONFIG,
    bundledConfigRoot,
    listBundledConfigFiles,
    listBundledProjectSeedFiles,
    parseConfigYaml,
} from '@gobing-ai/spur-config/loader';
import { ArtifactDao } from '@gobing-ai/spur-domain';
import { bundledRulesRoot, listBundledRuleFiles } from '@gobing-ai/ts-rule-engine';
import { CLI_CONFIG } from '../config';
import { SCAFFOLD_MANIFEST } from '../config/scaffold-manifest';
import type { CliContext } from '../context';
import { toJson } from '../output';
import { SHARED_OPTIONS } from './shared-options';

/** Global user config root, relative to the home directory. */
const GLOBAL_CONFIG_DIR = join('.config', 'spur');

/** Global user rules root, relative to the home directory (mirrors `rule.ts`). */
const GLOBAL_RULES_DIR = join(GLOBAL_CONFIG_DIR, 'rules');

/**
 * Bundled global-config filename, seeded as {@link GLOBAL_CONFIG_FILE} on first run.
 * Renamed from `config.example.yaml` by task 0646: the file is no longer an example,
 * it is the shipped machine-wide default layer that project configs merge over (A4).
 */
const GLOBAL_CONFIG_EXAMPLE = BUNDLED_GLOBAL_CONFIG;

/** Canonical global user config filename written into `~/.config/spur/`. */
const GLOBAL_CONFIG_FILE = 'config.yaml';

/** Idempotency marker — the heading searched for in an existing AGENTS.md. */
const INDEXED_CONTEXT_MARKER = '## Indexed context';

/**
 * Substitute AGENTS.md template tokens when scaffolding a fresh file (task 0242).
 * Only `{project-name}` and `{project-description}` are substituted at init time.
 * Remaining project-specific slots use HTML comments + human stubs (no brace tokens).
 */
export function substituteAgentsMdTemplate(content: string, projectName: string): string {
    const description = 'local Spur project';
    return content.replaceAll('{project-name}', projectName).replaceAll('{project-description}', description);
}

/**
 * Substitute doc template tokens when scaffolding (task 0313).
 * `{{init-date}}` is replaced with the current date in `YYYY-MM-DD` format,
 * so scaffolded docs get a real `updated_at`/`created_at` timestamp instead of a sentinel.
 */
export function substituteDocTemplateTokens(content: string, date: Date = new Date()): string {
    const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
    return content.replaceAll('{{init-date}}', dateStr);
}

/**
 * Activation block appended to an existing AGENTS.md when the marker is absent.
 * Mirrors the block embedded in the bundled AGENTS.md template (see SCAFFOLD_MANIFEST).
 */
const INDEXED_CONTEXT_BLOCK = `
---

## Indexed context

Project context lives in \`.spur/context/\` (gitignored) and is surfaced by the \`sp:indexed-context\` skill.
Check it before re-reading files you may already have indexed:

1. \`.spur/context/anatomy.md\` — one-line description + token estimate per file. Read before opening a file.
2. \`.spur/context/learnings.md\` — project conventions, decisions, preferences. Read before generating code.
3. \`.spur/context/pitfalls.md\` — dated "do-not-repeat" entries. Read before generating code.
4. \`.spur/context/buglog.md\` — historical bug log. Read before fixing a bug.
5. \`.spur/context/memory.md\` — session log. Append one line per significant action.
6. \`.spur/context/token-ledger.jsonl\` — auto-tracked by hooks; never hand-edit.

If \`.spur/context/\` is absent, proceed normally. Never block work on its absence.
`;

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
 * Resolve the user-global config directory `~/.config/spur`, honoring
 * `SPUR_GLOBAL_RULES_DIR` for test isolation — the same override `RuleService` and
 * `seedGlobalConfig` use, so tests can redirect the global layer.
 */
function resolveGlobalConfigDir(context: CliContext): string {
    const globalOverride = context.env.SPUR_GLOBAL_RULES_DIR;
    return globalOverride !== undefined && globalOverride.length > 0
        ? resolve(context.cwd, globalOverride)
        : join(homedir(), GLOBAL_CONFIG_DIR);
}

/**
 * Copy the default config assets bundled with the CLI package (package-root
 * `config/`, or repo-root `config/` in dev) into the user's global config
 * directory on first run. Seeds `rules/`, `workflows/`, and other YAML/JSON
 * assets. Existing files are never overwritten, preserving user customizations.
 * Returns the number of files written.
 */
async function seedGlobalConfig(context: CliContext): Promise<number> {
    const source = bundledConfigRoot();
    if (source === null) return 0;
    // Target is ~/.config/spur/ (same parent as globalRulesRoot, one level up).
    const target = resolveGlobalConfigDir(context);
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
/** Register `spur init` command (optionally hidden from the top-level help listing). */
export function registerInitCommand(program: Command, context: CliContext, options: { hidden?: boolean } = {}): void {
    program
        .command('init', { hidden: options.hidden === true })
        .summary('scaffold a local Spur project')
        .option(...SHARED_OPTIONS.nameProjectInit)
        .option(...SHARED_OPTIONS.forceInitRecreate)
        .option('--minimal', 'Only write the minimal .spur scaffold')
        .option(
            '--adopt-global-config',
            'Also rewrite ~/.config/spur/config.yaml from the shipped global default (backed up first)',
        )
        .option(...SHARED_OPTIONS.json)
        .action(async (options) => {
            const json = options.json === true;
            const force = options.force === true;
            const minimal = options.minimal === true;
            const adoptGlobal = options.adoptGlobalConfig === true;
            const projectName = options.name ?? 'default';
            const configPath = join(context.cwd, CLI_CONFIG.configFile);
            const result: ScaffoldResult = { created: [], skipped: [] };

            // R4 (task 0649): pre-A4 global-config detection — classify the global
            // layer's top-level keys against the 0641 project/global split on every
            // run, opt-in or not. Reports; never auto-fixes (R2 forbids writing the
            // global config without the operator's opt-in).
            const globalConfigDir = resolveGlobalConfigDir(context);
            const globalConfigPath = join(globalConfigDir, GLOBAL_CONFIG_FILE);
            const globalConfigExists = await context.fs.exists(globalConfigPath);
            let misplacedKeys: string[] = [];
            if (globalConfigExists) {
                try {
                    const raw = await context.fs.readFile(globalConfigPath);
                    misplacedKeys = misplacedGlobalKeys(parseConfigYaml(raw));
                } catch {
                    // Unreadable/unparseable global config is reported elsewhere, not a blocker.
                }
            }

            // Re-init converge (R1/R2): a config that already exists is no longer an
            // error. Without --force the command converges instead — seeds missing
            // assets, writes no config, reports drift — and only rewrites the global
            // config under the explicit --adopt-global-config opt-in (backup first).
            if (!force && (await context.fs.exists(configPath))) {
                const configRoot = bundledConfigRoot();
                if (configRoot !== null && !minimal) {
                    for (const relPath of listBundledProjectSeedFiles()) {
                        if (relPath.startsWith('templates/docs/')) continue;
                        const sourcePath = join(configRoot, relPath);
                        if (!(await context.fs.exists(sourcePath))) continue;
                        const targetPath = join(context.cwd, CLI_CONFIG.configDir, relPath);
                        await context.fs.ensureDir(join(targetPath, '..'));
                        await writeIfNew(context, targetPath, await context.fs.readFile(sourcePath), false, result);
                    }
                    for (const entry of SCAFFOLD_MANIFEST) {
                        const sourcePath = join(configRoot, entry.source);
                        if (!(await context.fs.exists(sourcePath))) continue;
                        const baseDir = entry.root === true ? context.cwd : join(context.cwd, CLI_CONFIG.configDir);
                        const targetPath = join(baseDir, entry.target);
                        await context.fs.ensureDir(join(targetPath, '..'));
                        // preserve-marked entries are never overwritten, even on converge
                        const entryForce = false;
                        let body = await context.fs.readFile(sourcePath);
                        if (entry.target === 'AGENTS.md') {
                            body = substituteAgentsMdTemplate(body, projectName);
                        }
                        if (entry.source.startsWith('templates/docs/')) {
                            body = substituteDocTemplateTokens(body);
                        }
                        await writeIfNew(context, targetPath, body, entryForce, result);
                    }
                }

                // R3: opted-in global rewrite is preceded by a timestamped backup.
                let adoptedGlobal = false;
                if (adoptGlobal && globalConfigExists) {
                    const backupPath = `${globalConfigPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
                    await context.fs.writeFile(backupPath, await context.fs.readFile(globalConfigPath));
                    const bundledRoot = bundledConfigRoot();
                    const examplePath = bundledRoot !== null ? join(bundledRoot, GLOBAL_CONFIG_EXAMPLE) : null;
                    if (examplePath !== null && (await context.fs.exists(examplePath))) {
                        await context.fs.writeFile(globalConfigPath, await context.fs.readFile(examplePath));
                        adoptedGlobal = true;
                    }
                    result.created.push(backupPath);
                }

                const rulesSeeded = await seedGlobalRules(context);
                const configSeeded = await seedGlobalConfig(context);

                const payload = {
                    ok: true,
                    converged: true,
                    config: CLI_CONFIG.configFile,
                    ...result,
                    globalRulesSeeded: rulesSeeded,
                    globalConfigSeeded: configSeeded,
                    ...(adoptedGlobal ? { adoptGlobalConfig: adoptedGlobal } : {}),
                    ...(misplacedKeys.length > 0 ? { misplacedGlobalKeys: misplacedKeys } : {}),
                };
                if (json) {
                    context.output.write(toJson(payload));
                } else {
                    context.output.write('Already initialized — converged (no project files overwritten)');
                    for (const path of result.created) context.output.write(`  ✓ ${path}`);
                    for (const path of result.skipped) context.output.write(`  - ${path} (exists)`);
                    if (rulesSeeded > 0) {
                        context.output.write(`  ✓ seeded ${rulesSeeded} rule file(s) to ~/${GLOBAL_RULES_DIR}`);
                    }
                    if (configSeeded > 0) {
                        context.output.write(`  ✓ seeded ${configSeeded} config file(s) to ~/${GLOBAL_CONFIG_DIR}`);
                    }
                    if (adoptedGlobal) {
                        context.output.write('  ✓ adopted global config from bundled default (backup written)');
                    }
                    if (misplacedKeys.length > 0) {
                        context.output.write(
                            `  ⚠ global config carries project-shaped key(s): ${misplacedKeys.join(', ')}`,
                        );
                    }
                }
                context.setExitCode(0);
                return;
            }

            // Write a minimal .spur/config.yaml (single surface — ADR-017).
            // The bootstrap block is seeded from config.example.yaml during scaffold below;
            // this minimal stub is enough to mark the project as initialized.
            const configYaml = `${[
                `# Spur project configuration for ${projectName}`,
                `# Generated by \`spur init\``,
                '',
                '$schema: "@gobing-ai/spur/schemas/spur-config.schema.json"',
                `version: "1.2"`,
                `name: ${projectName}`,
                '',
                'bootstrap:',
                '  logging:',
                '    enabled: true',
                '    level: info',
                '    console: false',
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
            // Ensure `.spur/context/` (machine-generated state, written by indexed-context
            // hooks) is gitignored. Runs in all modes — hooks create the dir regardless of --minimal.
            // Idempotent: skips the append if the entry already exists (even inside a comment).
            const gitignorePath = join(context.cwd, '.gitignore');
            const contextEntry = '.spur/context/';
            if (await context.fs.exists(gitignorePath)) {
                const existing = await context.fs.readFile(gitignorePath);
                if (!existing.includes(contextEntry)) {
                    await context.fs.writeFile(
                        gitignorePath,
                        `${existing.trimEnd()}\n\n# Spur indexed-context (machine-generated)\n${contextEntry}\n`,
                    );
                }
            } else {
                await context.fs.writeFile(
                    gitignorePath,
                    `# Spur indexed-context (machine-generated)\n${contextEntry}\n`,
                );
            }

            if (!minimal) {
                // Resolve the bundled config root once; fall back gracefully if absent
                // (e.g. compiled binary without sibling config/ directory).
                const configRoot = bundledConfigRoot();
                if (configRoot !== null) {
                    // Full-tree seed: copy every bundled asset (rules/**, workflows/**,
                    // tasks/**, templates/**, plugins/**) into `.spur/` at its natural
                    // relative path. Mirrors the monorepo convention where `.spur/{rules,
                    // workflows, …}` are symlinks into repo-root `config/` — end-user
                    // projects get real copies instead of links (ADR-015: no symlinks in
                    // install/init). Never overwrites without --force.
                    for (const relPath of listBundledProjectSeedFiles()) {
                        // The manifest owns doc-template copies because they require init-time
                        // token rendering. Seeding them here first would make the manifest pass
                        // treat them as existing and leave `{{init-date}}` unresolved.
                        if (relPath.startsWith('templates/docs/')) continue;
                        const sourcePath = join(configRoot, relPath);
                        if (!(await context.fs.exists(sourcePath))) continue;
                        const targetPath = join(context.cwd, CLI_CONFIG.configDir, relPath);
                        await context.fs.ensureDir(join(targetPath, '..'));
                        await writeIfNew(context, targetPath, await context.fs.readFile(sourcePath), force, result);
                    }

                    // Manifest pass: remaps (e.g. templates/task → tasks/templates),
                    // root-scoped docs/AGENTS.md, and preserve-marked entries.
                    for (const entry of SCAFFOLD_MANIFEST) {
                        const sourcePath = join(configRoot, entry.source);
                        if (!(await context.fs.exists(sourcePath))) continue;
                        // root-scoped entries (docs/, AGENTS.md) resolve against the project root
                        const baseDir = entry.root === true ? context.cwd : join(context.cwd, CLI_CONFIG.configDir);
                        const targetPath = join(baseDir, entry.target);
                        await context.fs.ensureDir(join(targetPath, '..'));
                        // preserve-marked entries are never overwritten, even with --force
                        const entryForce = entry.preserve === true ? false : force;
                        let body = await context.fs.readFile(sourcePath);
                        // AGENTS.md: fill init-time tokens so new projects never ship `{project-name}`.
                        if (entry.target === 'AGENTS.md') {
                            body = substituteAgentsMdTemplate(body, projectName);
                        }
                        // Doc templates: replace `{{init-date}}` with the current date (task 0313).
                        if (entry.source.startsWith('templates/docs/')) {
                            body = substituteDocTemplateTokens(body);
                        }
                        await writeIfNew(context, targetPath, body, entryForce, result);
                    }
                }
            }

            // Idempotently inject the indexed-context activation block into an existing
            // AGENTS.md that lacks it. Fresh projects already get it from the template;
            // existing projects with a pre-existing AGENTS.md need the block appended.
            const agentsMdPath = join(context.cwd, 'AGENTS.md');
            if (await context.fs.exists(agentsMdPath)) {
                const existing = await context.fs.readFile(agentsMdPath);
                if (!existing.includes(INDEXED_CONTEXT_MARKER)) {
                    await context.fs.writeFile(agentsMdPath, `${existing.trimEnd()}${INDEXED_CONTEXT_BLOCK}`);
                    result.created.push(agentsMdPath);
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
