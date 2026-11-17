import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createNodeFileSystem, type FileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import {
    globalRulesRoot,
    resolveGlobalConfigDir,
    type SeedContext,
    seedGlobalConfig,
    seedGlobalRules,
} from './global-seed';

/**
 * `spur self install` — convergent machine setup (A93 1353, design §4).
 *
 * Ownership split this service enforces:
 *
 *  - **Machine seeds** (required): the shipped global rules and config layer, copied once and never
 *    overwritten. A seed pass that finds no bundled assets is a *failed* required step — zero files
 *    copied is broken packaging, not success.
 *  - **Optional tools** (`--with zg|a2a|sp-plugin`): network/package-manager work happens only when
 *    explicitly selected. A healthy binary is detected first and reported `unchanged`.
 *  - **Adapters** belong to Superskill: `sp-plugin` shells the supported
 *    `superskill install sp --marketplace <dir>` contract and reports the delegation instead of
 *    inferring an adapter stamp.
 *
 * Nothing here scaffolds a project, migrates SQL, edits a shell profile or replaces a running
 * binary, and there is no install journal: the filesystem and PATH are the resume authority.
 */
export const INSTALL_TOOLS = ['zg', 'a2a', 'sp-plugin'] as const;

/** Optional machine tools `spur self install --with <tool>` can install or verify. */
export type InstallTool = (typeof INSTALL_TOOLS)[number];

/** Per-step state; `unchanged` is the convergent rerun outcome. */
export type InstallStepState = 'created' | 'unchanged' | 'skipped' | 'failed';

/** One reported setup step. */
export interface InstallStep {
    name: string;
    state: InstallStepState;
    /** Required steps decide exit 0/1 on their own; optional ones only when selected. */
    required: boolean;
    message: string;
}

/** The whole run: `ok` gates the exit code, `changed` says whether anything was written. */
export interface InstallReport {
    ok: boolean;
    changed: boolean;
    steps: InstallStep[];
}

/** One command result; injected so tests never run a real package manager. */
export interface CommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

/** Runs one installer command. */
export type RunCommand = (command: string, args: readonly string[]) => Promise<CommandResult>;

/** What `installSelf` may read and run. */
export interface SelfInstallContext extends SeedContext {
    fs?: FileSystem;
    runCommand?: RunCommand;
    /** Directory holding `.claude-plugin/marketplace.json`; defaults to the bundled lookup. */
    marketplaceDir?: string | null;
}

/** Recipe for one optional tool: detection binary, installer commands, manual fallback text. */
interface ToolRecipe {
    binary: string;
    /** Package manager that must exist for the automatic route, and its commands. */
    managers: { manager: string; commands: string[][] }[];
    manual: string;
}

const RECIPES: Record<Exclude<InstallTool, 'sp-plugin'>, ToolRecipe> = {
    zg: {
        binary: 'zg',
        managers: [
            { manager: 'brew', commands: [['install', 'zvec-grep']] },
            { manager: 'npm', commands: [['install', '-g', '@zvec/zvec-grep', '--allow-scripts=@zvec/zvec-grep']] },
        ],
        manual: 'brew install zvec-grep',
    },
    a2a: {
        binary: 'a2a',
        managers: [
            {
                manager: 'brew',
                commands: [
                    ['tap', 'a2aproject/a2a-cli', 'https://github.com/a2aproject/a2a-cli'],
                    ['install', 'a2a'],
                ],
            },
        ],
        manual: 'brew tap a2aproject/a2a-cli https://github.com/a2aproject/a2a-cli && brew install a2a',
    },
};

/** Default command runner: bounded, buffered, and never interactive. */
export function defaultRunCommand(command: string, args: readonly string[]): Promise<CommandResult> {
    const executor = new NodeProcessExecutor({ defaultTimeout: 300_000, defaultMaxOutput: 256_000 });
    return executor.run({ command, args: [...args], cwd: process.cwd(), forceBuffered: true }).then((result) => ({
        // A null exit code means "killed by a signal": report it as a failure, never as success.
        exitCode: result.exitCode ?? 1,
        stdout: result.stdout,
        stderr: result.stderr,
    }));
}

/** Resolve an executable on PATH without running it. */
function which(binary: string, env: Record<string, string | undefined>): string | null {
    return Bun.which(binary, { PATH: env.PATH ?? '' });
}

/**
 * Locate the bundled marketplace directory (`.claude-plugin/marketplace.json`), walking up from this
 * module in a source checkout and falling back to a sibling of the running executable for a packaged
 * or compiled install. Returns `null` when the assets are absent.
 */
export async function resolveBundledMarketplaceDir(
    fs: FileSystem,
    moduleDir: string,
    execPath: string,
): Promise<string | null> {
    let dir = moduleDir;
    for (;;) {
        if (await fs.exists(join(dir, '.claude-plugin', 'marketplace.json'))) return join(dir, '.claude-plugin');
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    const beside = dirname(execPath);
    return (await fs.exists(join(beside, '.claude-plugin', 'marketplace.json')))
        ? join(beside, '.claude-plugin')
        : null;
}

/** First non-empty stderr/stdout line, for an actionable one-line step message. */
function lastLine(result: CommandResult): string {
    const text = `${result.stderr}\n${result.stdout}`;
    return (
        text
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .at(-1) ?? ''
    );
}

/** Seed one required machine asset group, reporting absence/failure honestly. */
async function seedStep(
    name: string,
    seed: () => Promise<{ created: string[]; assetsFound: boolean }>,
    assetsMessage: string,
): Promise<InstallStep> {
    try {
        const outcome = await seed();
        if (!outcome.assetsFound) {
            return { name, state: 'failed', required: true, message: assetsMessage };
        }
        return outcome.created.length > 0
            ? {
                  name,
                  state: 'created',
                  required: true,
                  message: `wrote ${outcome.created.length} file(s)`,
              }
            : { name, state: 'unchanged', required: true, message: 'already present; left untouched' };
    } catch (err) {
        return {
            name,
            state: 'failed',
            required: true,
            message: err instanceof Error ? err.message : String(err),
        };
    }
}

/** One optional tool: healthy → unchanged, selected → install, unselected → skipped. */
async function toolStep(
    tool: InstallTool,
    ctx: SelfInstallContext,
    selected: boolean,
    run: RunCommand,
    fs: FileSystem,
): Promise<InstallStep> {
    const required = false;
    if (!selected) {
        return {
            name: tool,
            state: 'skipped',
            required,
            message: `not selected; re-run with --with ${tool}`,
        };
    }

    if (tool === 'sp-plugin') {
        const marketplace =
            ctx.marketplaceDir ?? (await resolveBundledMarketplaceDir(fs, import.meta.dirname, process.execPath));
        if (marketplace === null) {
            return {
                name: tool,
                state: 'failed',
                required,
                message: 'bundled marketplace (.claude-plugin/marketplace.json) is missing from this install',
            };
        }
        if (which('superskill', ctx.env) === null) {
            return {
                name: tool,
                state: 'failed',
                required,
                message: 'superskill is not on PATH; install it, then re-run --with sp-plugin',
            };
        }
        const result = await run('superskill', ['install', 'sp', '--marketplace', marketplace]);
        if (result.exitCode !== 0) {
            return {
                name: tool,
                state: 'failed',
                required,
                message: `superskill install failed (exit ${result.exitCode}): ${lastLine(result)}`,
            };
        }
        // Superskill owns adapter convergence and may refresh timestamps; this step reports the
        // delegation rather than inferring an adapter state it cannot observe.
        return {
            name: tool,
            state: 'unchanged',
            required,
            message: 'adapters converged by superskill; adapter state is Superskill-owned',
        };
    }

    const recipe = RECIPES[tool];
    const existing = which(recipe.binary, ctx.env);
    if (existing !== null) {
        return { name: tool, state: 'unchanged', required, message: `${recipe.binary} already on PATH` };
    }
    let route: ToolRecipe['managers'][number] | undefined;
    for (const entry of recipe.managers) {
        if (which(entry.manager, ctx.env) !== null) {
            route = entry;
            break;
        }
    }
    if (route === undefined) {
        if (tool === 'a2a' && which('curl', ctx.env) !== null && which('bash', ctx.env) !== null) {
            const download = await run('curl', [
                '-fsSL',
                'https://raw.githubusercontent.com/a2aproject/a2a-cli/main/install.sh',
            ]);
            if (download.exitCode !== 0) {
                return {
                    name: tool,
                    state: 'failed',
                    required,
                    message: `a2a installer download failed: ${lastLine(download)}`,
                };
            }
            const script = join(tmpdir(), `spur-a2a-${crypto.randomUUID()}.sh`);
            const target = resolve(ctx.cwd, ctx.env.SPUR_INSTALL ?? join(ctx.env.HOME ?? homedir(), '.local', 'bin'));
            try {
                await fs.writeFile(script, download.stdout);
                const result = await run('env', [`A2A_INSTALL_DIR=${target}`, 'bash', script]);
                return result.exitCode === 0 && which('a2a', ctx.env) !== null
                    ? { name: tool, state: 'created', required, message: 'installed through the a2a installer' }
                    : {
                          name: tool,
                          state: 'failed',
                          required,
                          message: `a2a installer failed or left a2a off PATH: ${lastLine(result)}`,
                      };
            } finally {
                await fs.deleteFile(script);
            }
        }
        return {
            name: tool,
            state: 'failed',
            required,
            message: `no supported package manager on PATH; install manually: ${recipe.manual}`,
        };
    }
    for (const args of route.commands) {
        const result = await run(route.manager, args);
        if (result.exitCode !== 0) {
            return {
                name: tool,
                state: 'failed',
                required,
                message: `${route.manager} ${args.join(' ')} failed (exit ${result.exitCode}): ${lastLine(result)}; install manually: ${recipe.manual}`,
            };
        }
    }
    if (which(recipe.binary, ctx.env) === null) {
        // The package manager exited 0 but the binary is still not resolvable — report what is true.
        return {
            name: tool,
            state: 'failed',
            required,
            message: `${route.manager} reported success but ${recipe.binary} is not on PATH; open a new shell or add its bin directory`,
        };
    }
    return { name: tool, state: 'created', required, message: `installed via ${route.manager}` };
}

/**
 * Run machine setup. Seeds first (so a failing optional tool never costs the caller its global
 * layer), then every optional tool in a stable order. Exit policy is the caller's: `ok` is false
 * when any required step failed or any explicitly selected step failed.
 */
export async function installSelf(
    ctx: SelfInstallContext,
    opts: { tools: readonly InstallTool[] },
): Promise<InstallReport> {
    const fs = ctx.fs ?? createNodeFileSystem();
    const run = ctx.runCommand ?? defaultRunCommand;
    const selected = new Set(opts.tools);

    const steps: InstallStep[] = [
        await seedStep(
            'rules',
            () => seedGlobalRules(fs, ctx),
            'bundled rule presets are missing from this install; reinstall spur (machine rules root: ' +
                `${globalRulesRoot(ctx)})`,
        ),
        await seedStep(
            'config',
            () => seedGlobalConfig(fs, ctx),
            'bundled config assets are missing from this install; reinstall spur (target: ' +
                `${resolveGlobalConfigDir(ctx)})`,
        ),
    ];
    for (const tool of INSTALL_TOOLS) {
        try {
            steps.push(await toolStep(tool, ctx, selected.has(tool), run, fs));
        } catch (error) {
            steps.push({
                name: tool,
                state: 'failed',
                required: false,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    const ok = steps.every(
        (step) => !(step.state === 'failed' && (step.required || selected.has(step.name as InstallTool))),
    );
    const changed = steps.some((step) => step.state === 'created');
    return { ok, changed, steps };
}
