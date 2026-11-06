import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import { searchStatus, ZG_INDEX_HINT, ZG_INSTALL_HINT, ZG_REFRESH_HINT } from '@gobing-ai/spur-app';
import { resolveAction } from '@gobing-ai/spur-app/sdlc-actions';
import { shQuote } from '@gobing-ai/spur-app/shell-quote';
import { misplacedGlobalKeys, SDLC_ACTIONS, type SdlcAction } from '@gobing-ai/spur-config';
import {
    BUNDLED_GLOBAL_CONFIG,
    bundledConfigRoot,
    listBundledConfigFiles,
    listBundledProjectSeedFiles,
    parseConfigYaml,
} from '@gobing-ai/spur-config/loader';
import type { SearchStatus } from '@gobing-ai/spur-contracts';
import { ArtifactDao } from '@gobing-ai/spur-domain';
import { bundledRulesRoot, listBundledRuleFiles } from '@gobing-ai/ts-rule-engine';
import { CLI_CONFIG } from '../config';
import { SCAFFOLD_MANIFEST } from '../config/scaffold-manifest';
import type { CliContext } from '../context';
import { toEnvelopeJson } from '../output';
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

/** Makefile rule head: the bare `target:` form. `target := value` is an assignment, not a target. */
const MAKEFILE_TARGET_PATTERN = /^([a-z][a-z0-9-]*):(?!=)/;

/** Manager evidence is read as data; no lockfile content or script body becomes a command. */
const JS_LOCKFILES = {
    'package-lock.json': 'npm',
    'npm-shrinkwrap.json': 'npm',
    'pnpm-lock.yaml': 'pnpm',
    'yarn.lock': 'yarn',
} as const;

interface BuilderFiles {
    bunLock: boolean;
    makefile: string | null;
    packageJson?: string | null;
    lockfiles?: string[];
    availableManagers?: { npm: boolean; pnpm: boolean };
    cargoManifest?: boolean;
    goMod?: boolean;
    pyproject?: boolean;
    availableTools?: { cargo: boolean; go: boolean; make: boolean; bun: boolean };
    root?: string;
    candidateRoots?: string[];
}

interface BuilderBindings {
    bindings: Partial<Record<SdlcAction, string | string[]>>;
    sourceByAction: Partial<Record<SdlcAction, string>>;
    diagnostics: string[];
}

/** Select one declared JS manager, refusing contradictory or unsupported evidence. */
function detectJsManager(files: BuilderFiles, manifest: Record<string, unknown>, diagnostics: string[]) {
    // Root Bun projects use the preset; a child must bind only its declared scripts.
    if (files.bunLock) {
        if (files.availableTools?.bun === false)
            diagnostics.push('bun is not available on PATH; install it before execution');
        return { manager: 'bun', evidence: 'Bun lockfile' };
    }
    const managers = new Set<string>();
    const evidence: string[] = [];
    for (const [lock, manager] of Object.entries(JS_LOCKFILES)) {
        if (!files.lockfiles?.includes(lock)) continue;
        managers.add(manager);
        evidence.push(lock);
    }
    if (manifest.packageManager !== undefined) {
        // Accept only a manager plus a version/integrity token, never shell text or a URL.
        const match =
            typeof manifest.packageManager === 'string'
                ? /^([a-z][a-z0-9-]*)@[0-9][a-zA-Z0-9.+_-]*$/.exec(manifest.packageManager)
                : null;
        if (!match) {
            diagnostics.push('invalid packageManager; JavaScript actions remain unbound');
            return null;
        }
        managers.add(match[1] as string);
        evidence.push('package.json packageManager');
    }
    if (managers.size > 1) {
        diagnostics.push(
            `conflicting package manager evidence: ${evidence.join(', ')}; JavaScript actions remain unbound`,
        );
        return null;
    }
    const manager = [...managers][0];
    if (manager !== 'npm' && manager !== 'pnpm') {
        diagnostics.push(
            manager === undefined
                ? 'no unambiguous npm or pnpm evidence; JavaScript actions remain unbound'
                : 'unsupported packageManager; JavaScript actions remain unbound',
        );
        return null;
    }
    if (files.availableManagers?.[manager] === false) {
        diagnostics.push(
            `${manager} is not available on PATH; bindings are proposals only; install it before execution`,
        );
    }
    return { manager, evidence: evidence.join(', ') };
}

/** Init-only proposals: explicit Make/JS actions win over conservative native defaults. */
function detectBuilderBindings(files: BuilderFiles): BuilderBindings {
    const result: BuilderBindings = { bindings: {}, sourceByAction: {}, diagnostics: [] };
    const targets = new Set(
        (files.makefile ?? '').split('\n').flatMap((line) => MAKEFILE_TARGET_PATTERN.exec(line)?.[1] ?? []),
    );
    for (const action of SDLC_ACTIONS) {
        if (!targets.has(action)) continue;
        result.bindings[action] = `make ${action}`;
        result.sourceByAction[action] = `Makefile target ${action}`;
    }
    if (targets.size > 0 && files.availableTools !== undefined) {
        result.diagnostics.push(
            files.availableTools.make
                ? 'make is available on PATH'
                : 'make is not available on PATH; bindings are proposals only; install it before execution',
        );
    }
    detectJsBindings(files, result);
    if (files.pyproject) {
        result.diagnostics.push('Python commands require explicit bindings; project.scripts are not shell actions');
    }
    if (files.cargoManifest && files.goMod) {
        result.diagnostics.push('conflicting language manifests: Cargo.toml, go.mod; native defaults remain unbound');
        return result;
    }
    const tool = files.cargoManifest ? 'cargo' : files.goMod ? 'go' : null;
    if (tool === null) return result;
    if (files.availableTools?.[tool] !== true) {
        result.diagnostics.push(`${tool} is not available on PATH; native defaults remain unbound`);
        return result;
    }
    result.diagnostics.push(`${tool} is available on PATH`);
    const defaults =
        tool === 'cargo'
            ? { build: 'cargo build', typecheck: 'cargo check', test: 'cargo test', check: ['typecheck', 'test'] }
            : { build: 'go build ./...', test: 'go test ./...', check: ['build', 'test'] };
    for (const action of SDLC_ACTIONS) {
        const command = defaults[action as keyof typeof defaults];
        if (command === undefined || result.bindings[action] !== undefined) continue;
        result.bindings[action] = command;
        result.sourceByAction[action] = tool === 'cargo' ? 'Cargo.toml (manifest default members)' : 'go.mod';
    }
    return result;
}

/** Add only exact reserved JS script names; script bodies are never copied or executed. */
function detectJsBindings(files: BuilderFiles, result: BuilderBindings): void {
    if (files.packageJson == null) {
        result.diagnostics.push('no package.json; JavaScript actions remain unbound');
        return;
    }
    let manifest: Record<string, unknown>;
    try {
        const parsed: unknown = JSON.parse(files.packageJson);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        manifest = parsed as Record<string, unknown>;
    } catch {
        result.diagnostics.push('invalid package.json; JavaScript actions remain unbound');
        return;
    }
    const selected = detectJsManager(files, manifest, result.diagnostics);
    if (selected === null) return;
    const scripts = manifest.scripts;
    if (scripts === null || typeof scripts !== 'object' || Array.isArray(scripts)) return;
    const declared = scripts as Record<string, unknown>;
    for (const action of SDLC_ACTIONS) {
        const script = declared[action];
        if (result.bindings[action] !== undefined || typeof script !== 'string' || script.trim().length === 0) continue;
        result.bindings[action] = `${selected.manager} run ${action}`;
        result.sourceByAction[action] = `package.json scripts.${action} (${selected.evidence})`;
    }
}

/** Read only known markers at one directory; detection never invokes a project tool. */
async function readBuilderFiles(context: CliContext, root: string): Promise<BuilderFiles> {
    const exists = (name: string) => context.fs.exists(join(context.cwd, root, name));
    const read = async (name: string) =>
        (await exists(name)) ? context.fs.readFile(join(context.cwd, root, name)) : null;
    const lockfiles: string[] = [];
    for (const lock of Object.keys(JS_LOCKFILES)) if (await exists(lock)) lockfiles.push(lock);
    return {
        root,
        bunLock: (await exists('bun.lock')) || (await exists('bun.lockb')),
        makefile: await read('Makefile'),
        packageJson: await read('package.json'),
        lockfiles,
        cargoManifest: await exists('Cargo.toml'),
        goMod: await exists('go.mod'),
        pyproject: await exists('pyproject.toml'),
    };
}

/** Select the root or one immediate child; conflicting roots require operator configuration. */
async function discoverBuilderFiles(context: CliContext): Promise<BuilderFiles> {
    const hasManifest = (files: BuilderFiles) =>
        files.bunLock ||
        files.makefile !== null ||
        files.packageJson !== null ||
        files.cargoManifest ||
        files.goMod ||
        files.pyproject;
    let files = await readBuilderFiles(context, '.');
    if (!hasManifest(files)) {
        const candidates: BuilderFiles[] = [];
        const canonicalRoot = context.fs.realPath?.(context.cwd) ?? context.cwd;
        for (const entry of (await context.fs.readDir(context.cwd)).sort()) {
            if (entry.startsWith('.') || ['node_modules', 'vendor', 'vendors'].includes(entry)) continue;
            const path = join(context.cwd, entry);
            if (!(await context.fs.stat(path))?.isDirectory()) continue;
            // A symlink cannot make discovery inspect packages outside this project.
            const canonicalPath = context.fs.realPath?.(path);
            if (canonicalPath !== undefined && !canonicalPath.startsWith(`${canonicalRoot}${sep}`)) continue;
            const child = await readBuilderFiles(context, entry);
            if (hasManifest(child)) candidates.push(child);
        }
        if (candidates.length === 1) files = candidates[0] as BuilderFiles;
        else if (candidates.length > 1) files.candidateRoots = candidates.map((child) => child.root as string);
    }
    // PATH lookup does not run a tool, Corepack shim, or install anything.
    files.availableManagers = {
        npm: Bun.which('npm', { PATH: context.env.PATH }) !== null,
        pnpm: Bun.which('pnpm', { PATH: context.env.PATH }) !== null,
    };
    files.availableTools = {
        cargo: Bun.which('cargo', { PATH: context.env.PATH }) !== null,
        go: Bun.which('go', { PATH: context.env.PATH }) !== null,
        make: Bun.which('make', { PATH: context.env.PATH }) !== null,
        bun: Bun.which('bun', { PATH: context.env.PATH }) !== null,
    };
    return files;
}

/**
 * Render init's one-time stack discovery as command config plus provenance comments.
 * Bun lockfiles retain preset precedence; other stacks expose missing actions explicitly.
 */
export function renderBuilderBlock(files: BuilderFiles): string[] {
    if (files.bunLock && (files.root === undefined || files.root === '.')) return ['builder:', '  preset: bun'];
    // Explicit relative paths bypass CDPATH and keep leading dashes out of cd's options.
    const relativeRoot = files.root !== undefined && files.root !== '.' ? `./${files.root}` : files.root;
    const { bindings, sourceByAction, diagnostics } = detectBuilderBindings(files);
    const bound = SDLC_ACTIONS.filter((action) => bindings[action] !== undefined);
    const unbound = SDLC_ACTIONS.filter(
        (action) => resolveAction({ preset: 'none', actions: bindings }, action).kind === 'unbound',
    );
    return [
        'builder:',
        '  preset: none',
        // Keep an unusual directory name inside one YAML comment line.
        ...(files.candidateRoots !== undefined
            ? [
                  `  # multiple candidate roots: ${files.candidateRoots.map((root) => root.replace(/[\r\n]/g, ' ')).join(', ')}; actions remain unbound`,
              ]
            : [`  # working directory: ${(files.root ?? '.').replace(/[\r\n]/g, ' ')}`]),
        ...diagnostics.map((message) => `  # ${message}`),
        ...(bound.length > 0 ? ['  actions:'] : []),
        ...bound.flatMap((action) => {
            const binding = bindings[action] as string | string[];
            const rendered = Array.isArray(binding)
                ? JSON.stringify(binding)
                : relativeRoot !== undefined && relativeRoot !== '.'
                  ? JSON.stringify(`cd ${shQuote(relativeRoot)} && ${binding}`)
                  : binding;
            return [`    # source: ${sourceByAction[action]}`, `    ${action}: ${rendered}`];
        }),
        ...(unbound.length > 0
            ? [
                  '  # Uncomment and bind each action this project supports:',
                  '  # Unbound proposals: no matching declared target or script, or manager evidence was refused.',
                  ...(bound.length === 0 ? ['  # actions:'] : []),
                  ...unbound.map((action) => `  #   ${action}: <command>`),
              ]
            : []),
    ];
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
        .option(...SHARED_OPTIONS.jsonEnvelope)
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

            // R12 (A34): probe before the converge early-return so a re-run reports readiness too.
            let search: SearchStatus;
            try {
                search = await searchStatus(context.cwd);
            } catch {
                search = { rg: { available: false }, zg: { available: false, index: 'unknown' } };
            }

            // Re-init converge (R1/R2): a config that already exists is no longer an
            // error. Without --force the command converges instead — seeds missing
            // assets, writes no config, reports drift — and only rewrites the global
            // config under the explicit --adopt-global-config opt-in (backup first).
            if (!force && (await context.fs.exists(configPath))) {
                const configRoot = bundledConfigRoot();
                if (configRoot !== null && !minimal) {
                    for (const relPath of listBundledProjectSeedFiles()) {
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
                    search,
                };
                if (json) {
                    context.output.write(toEnvelopeJson(payload, { enveloped: options.jsonEnvelope }));
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
                    context.output.write(`search: ${describeZgReadiness(search)}`);
                }
                context.setExitCode(0);
                return;
            }

            // Write a minimal .spur/config.yaml (single surface — ADR-017).
            // The bootstrap block is seeded from config.example.yaml during scaffold below;
            // this minimal stub is enough to mark the project as initialized.
            // Detect the stack once, at init, and write it down (A92, ADR-139).
            const builderFiles = await discoverBuilderFiles(context);

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
                '  # Downstream Board modules — opt-in, empty means built-ins only.',
                '  # See docs/design/downstream-board-modules.md for the react/iframe schema.',
                '  modules: []',
                '',
                ...renderBuilderBlock(builderFiles),
            ].join('\n')}\n`;

            await context.fs.ensureDir(join(context.cwd, CLI_CONFIG.configDir));
            await context.fs.writeFile(configPath, configYaml);
            result.created.push(configPath);

            // Team-mode agent specs live under .spur/agents/; seed the directory with a
            // .gitkeep so it is tracked before fleet materialization writes a spec.
            const agentsDir = join(context.cwd, CLI_CONFIG.configDir, 'agents');
            await context.fs.ensureDir(agentsDir);
            await writeIfNew(context, join(agentsDir, '.gitkeep'), '', force, result);
            // Ensure machine-generated state is gitignored. Runs in all modes — hooks create
            // .spur/context/ regardless of --minimal, and zg builds .zvec-grep/ per project.
            // Idempotent: each entry appends only when missing (even inside a comment).
            const gitignoreEntries = [
                { entry: '.spur/context/', comment: '# Spur indexed-context (machine-generated)' },
                { entry: '.zvec-grep/', comment: '# zg semantic-search index (operator-built)' },
            ];
            const gitignorePath = join(context.cwd, '.gitignore');
            if (await context.fs.exists(gitignorePath)) {
                let existing = await context.fs.readFile(gitignorePath);
                for (const { entry, comment } of gitignoreEntries) {
                    if (existing.includes(entry)) continue;
                    existing = `${existing.trimEnd()}\n\n${comment}\n${entry}\n`;
                    await context.fs.writeFile(gitignorePath, existing);
                }
            } else {
                await context.fs.writeFile(
                    gitignorePath,
                    gitignoreEntries.map(({ entry, comment }) => `${comment}\n${entry}\n`).join('\n'),
                );
            }

            if (!minimal) {
                // Resolve the bundled config root once; fall back gracefully if absent
                // (e.g. compiled binary without sibling config/ directory).
                const configRoot = bundledConfigRoot();
                if (configRoot !== null) {
                    // Project seed: copy only bundled assets with live project readers
                    // (rules/** and tasks/**) into `.spur/`. Workflow and template
                    // consumers resolve the bundled tree directly, so project copies
                    // would be stale shadows (0650). Never overwrites without --force.
                    for (const relPath of listBundledProjectSeedFiles()) {
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

            // zg readiness probe (ADR-147 §4 Init): informational only — never installs, never
            // indexes, and a probe failure degrades to index 'unknown' without failing init.
            if (json) {
                context.output.write(
                    toEnvelopeJson(
                        {
                            ok: true,
                            project: projectName,
                            config: CLI_CONFIG.configFile,
                            ...result,
                            globalRulesSeeded: rulesSeeded,
                            globalConfigSeeded: configSeeded,
                            search,
                        },
                        { enveloped: options.jsonEnvelope },
                    ),
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
                context.output.write(`search: ${describeZgReadiness(search)}`);
            }
        });
}

/** One-line zg readiness for init's human output (hints are printed, never executed). */
function describeZgReadiness(status: SearchStatus): string {
    if (!status.zg.available) return `zg not installed (optional) — install: ${ZG_INSTALL_HINT}`;
    if (status.zg.index === 'ready') return 'zg ready';
    if (status.zg.index === 'stale') return `zg index stale — run: ${ZG_REFRESH_HINT}`;
    if (status.zg.index === 'missing') return `zg index missing — run: ${ZG_INDEX_HINT}`;
    return 'zg status unknown';
}
