#!/usr/bin/env bun
// Force ts-db into the --compile static bundle so that dynamic
// import('@gobing-ai/ts-db') calls in ts-runtime resolve at runtime.
// Bun --compile bundles only the static import graph into bunfs;
// string-literal dynamic imports resolve from the bundled graph,
// but variable-specifier imports (ts-runtime@0.4.6 uses
// `const spec = '@gobing-ai/ts-db'; await import(spec)`) do not.
// The side-effect import below forces ts-db into the static graph.
// `spur-dev.ts build-cli` patches the variable specifier in ts-runtime's
// dist to a string literal at build time so it resolves at runtime.
import './sanitize-env';
import '@gobing-ai/ts-db';
import { Command } from '@commander-js/extra-typings';
import { disposeDecisionServices } from '@gobing-ai/spur-app';
import { getEnvVar, getEnvVars, type SpurAppConfig, type SpurConfig } from '@gobing-ai/spur-config';
import { loadSpurConfig, resolveConfigFile } from '@gobing-ai/spur-config/loader';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';
import { runNodeApplication } from '@gobing-ai/ts-infra/application-node';
import figlet from 'figlet';
import standard from 'figlet/fonts/Standard';
import { registerAgentCommand } from './commands/agent';
import { registerBuilderCommand } from './commands/builder';
import { registerDecisionCommand } from './commands/decision';
import { registerFeatureCommand } from './commands/feature';
import { registerHistoryCommand } from './commands/history';
import { registerMcpCommand } from './commands/mcp';
import { registerMessageCommand } from './commands/message';
import { registerProjectsCommand } from './commands/projects';
import { registerRuleCommand } from './commands/rule';
import { registerSelfCommand } from './commands/self';
import { registerInstallCommand } from './commands/self/install';
import { registerMigrateCommand } from './commands/self/migrate';

import { registerServeCommand } from './commands/self/serve';
import { registerStatusCommand } from './commands/self/status';
import { registerTaskCommand } from './commands/task';
import { registerTaskGateCommand } from './commands/task/gate';
import { registerWorkflowCommand } from './commands/workflow';
import { CLI_CONFIG } from './config';
import { EMBEDDED_SPUR_SCHEMAS } from './config/embedded-schemas';
import { createCliContext, createMigratedDbAdapter } from './context';
import { errorMessage } from './errors';
import { type CommandOutput, consoleOutput, toJson } from './output';
import { isWorkflowTransportInvocation, registerWorkflowTransportCommands } from './workflow-transport';
/** Options for programmatic CLI execution in tests. */
export interface MainOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    output?: CommandOutput;
    dbUrl?: string;
    /** Pre-built DB adapter. Injectable so tests can assert close-on-shutdown (ADR-018). */
    db?: DbAdapter;
    /** Database-free serve launch seam for startup tests. */
    startServer?: typeof import('@gobing-ai/spur-server').startServer;
}

/** Run the Spur CLI with explicit argv and injectable runtime dependencies. */
export async function main(argv = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
    const output = options.output ?? consoleOutput;
    let exitCode = 0;

    const cwd = options.cwd ?? process.cwd();
    const env = options.env ?? getEnvVars();
    // Serve owns its sole runtime and database. Dispatch before the CLI's adapter
    // and configuration runtime boot, including the canonical `self serve` form.
    const commandTokens = argv.filter((token) => !['--no-logo', '--cli-verbose', '-v'].includes(token));
    if (commandTokens[0] === 'self' && commandTokens[1] === 'serve') {
        const program = new Command().name('spur').exitOverride();
        program.option('--no-logo').option('-v, --cli-verbose');
        program.configureOutput({ writeOut: (str) => output.write(str), writeErr: (str) => output.error(str) });
        const context = {
            cwd,
            output,
            env,
            setExitCode: (code: number) => {
                exitCode = code;
            },
        };
        registerServeCommand(program.command('self'), context, { startServer: options.startServer });
        try {
            await program.parseAsync(argv, { from: 'user' });
            return exitCode;
        } catch (error) {
            const code = (error as { exitCode?: number }).exitCode;
            if (code !== undefined) return code;
            output.error(errorMessage(error));
            return 1;
        }
    }

    const migrationCheck = commandTokens[0] === 'self' && commandTokens[1] === 'migrate' && argv.includes('--check');
    const taskGate = commandTokens[0] === 'task' && commandTokens[1] === 'gate';
    // `self status` reports readiness (A93 1352): booting the adapter would create the very
    // database and schema the aggregate inspects, so it joins the boot-free dispatch set.
    const statusReport = commandTokens[0] === 'self' && commandTokens[1] === 'status';
    // `self install` is machine setup: it must not require a project config or create a project DB.
    const selfInstall = commandTokens[0] === 'self' && commandTokens[1] === 'install';
    const builderArtifact =
        commandTokens[0] === 'builder' &&
        ['build-cli', 'build-server', 'build-binaries', 'bundle-config', 'bundle-web', 'verify-pack'].includes(
            commandTokens[1] ?? '',
        );
    // `spur mcp` is a stdio transport shim (feature B9, task 1373): boot-free like the other
    // transports — it never touches the project DB and reads the target project's config
    // through the strict per-project loader (ADR-082 composition-root wiring below).
    const mcpBridge = commandTokens[0] === 'mcp';
    // `workflow commit-guard-*|persist-*` are boot-free transports (script-absorption PR-4): like the
    // plugin scripts they replace, they never create a database in the cwd. Migration checks must also
    // bypass boot, which would create or repair the database being checked.
    if (
        isWorkflowTransportInvocation(argv) ||
        migrationCheck ||
        taskGate ||
        statusReport ||
        selfInstall ||
        builderArtifact ||
        mcpBridge
    ) {
        const program = new Command().name('spur').exitOverride();
        program.option('--no-logo').option('-v, --cli-verbose');
        program.configureOutput({ writeOut: (str) => output.write(str), writeErr: (str) => output.error(str) });
        const context = {
            cwd,
            output,
            env,
            setExitCode: (code: number) => {
                exitCode = code;
            },
        };
        try {
            if (taskGate) {
                // Gate receipts and checks use files and Git; booting the project DB adds unrelated latency.
                const spurConfig = await loadSpurConfig(options.cwd, { embeddedSchemas: EMBEDDED_SPUR_SCHEMAS });
                registerTaskGateCommand(program.command('task'), createCliContext({ ...context, spurConfig }));
            } else if (migrationCheck) {
                const migrationContext = createCliContext(context);
                registerMigrateCommand(program.command('self'), migrationContext);
            } else if (builderArtifact) {
                registerBuilderCommand(program, createCliContext(context));
            } else if (selfInstall) {
                // Only the install verb is registered on this boot-free path; the other self verbs keep
                // their full-boot registrations (serve and migrate-check already dispatch even earlier).
                registerInstallCommand(program.command('self'), createCliContext(context));
            } else if (statusReport) {
                // A broken project layer is reported (exit 1, no project contents echoed) rather than
                // being turned into a crash or a silent "no config" — the same contract as full boot.
                let spurConfig: SpurConfig;
                try {
                    spurConfig = await loadSpurConfig(options.cwd, { embeddedSchemas: EMBEDDED_SPUR_SCHEMAS });
                } catch (err) {
                    const message = errorMessage(err);
                    if (argv.includes('--json')) {
                        output.write(toJson({ error: { code: 'config', message } }));
                    } else {
                        output.error(message);
                    }
                    return 1;
                }
                const statusContext = createCliContext({ ...context, spurConfig });
                registerStatusCommand(program.command('self'), statusContext);
            } else if (mcpBridge) {
                // Server settings come from the app-layer env config (like `spur self serve`), so the
                // bridge needs no project-config loader wiring.
                registerMcpCommand(program, createCliContext(context));
            } else {
                registerWorkflowTransportCommands(program.command('workflow'), context);
            }
            await program.parseAsync(argv, { from: 'user' });
            return exitCode;
        } catch (error) {
            const code = (error as { exitCode?: number }).exitCode;
            if (code !== undefined) return code;
            output.error(errorMessage(error));
            return 1;
        }
    }

    // Task 0817 R1: forward `options.cwd` verbatim — which may be undefined — so the
    // loader's `SPUR_SKIP_PROJECT_CONFIG` gate can suppress the project layer for
    // unpinned programmatic runs. `cwd` stays materialized for the DB and context seams.
    const configFile = resolveConfigFile(options.cwd);
    const db = options.db ?? (await createMigratedDbAdapter(cwd, env, options.dbUrl));

    // Load the merged global+project config ONCE at the composition root (A5 /
    // ADR-082) — covering both the config-present and no-config branches — and
    // thread the result into dispatch as the only app-config source. A config-load
    // failure emits exactly one error and exits 1 (R4); the loader's message already
    // names the failing layer path and is propagated verbatim.
    let spurConfig: SpurConfig;
    try {
        // Pass the embedded schemas so the `$schema` ref resolves without
        // node_modules (dev tree and --compile binary alike).
        spurConfig = await loadSpurConfig(options.cwd, { embeddedSchemas: EMBEDDED_SPUR_SCHEMAS });
    } catch (err) {
        const message = errorMessage(err);
        if (argv.includes('--json')) {
            output.write(toJson({ error: { code: 'config', message } }));
        } else {
            output.error(message);
        }
        await db.close();
        return 1;
    }

    // 0799 (ADR-082): re-load accessor for the quota-update flow (R3 executor
    // refresh, drain-time binding checks). Only this composition root may call
    // the loader; commands receive the closure through CliContext.
    const loadAgentConfig = async (projectRoot: string): Promise<SpurConfig | null> => {
        try {
            return await loadSpurConfig(projectRoot, { embeddedSchemas: EMBEDDED_SPUR_SCHEMAS });
        } catch {
            return null;
        }
    };

    // 0858 R2/R5: the fail-loud sibling. A read surface that reports a project's
    // declared fleet state must surface a broken config (retired source, invalid
    // section) instead of degrading it to "nothing declared".
    const loadAgentConfigStrict = (projectRoot: string): Promise<SpurConfig> =>
        loadSpurConfig(projectRoot, { embeddedSchemas: EMBEDDED_SPUR_SCHEMAS });

    try {
        if (configFile !== undefined) {
            // Bootstrap through runNodeApplication — standard path (R1).
            // `bootstrap` is project-shaped (0641 split); the app section comes from
            // the merged load, so the appConfig validator is dropped and
            // appRt.appConfig is never read.
            const app = await runNodeApplication<SpurAppConfig>({
                configLoader: {
                    configFile,
                    bootstrapSection: 'bootstrap',
                },
                // Under test, force logging off so initializeLogger() does not
                // reconfigure LogTape with a console sink — which would reset the
                // global mute installed in tests/setup.ts and leak JSON log lines
                // from every later app.* logger (e.g. the rule engine).
                // Outside test, enforce console off — all output goes to file.
                config:
                    getEnvVar('NODE_ENV') === 'test'
                        ? { logging: { enabled: false } }
                        : { logging: { console: false } },
                services: { db },
                async start(appRt: ApplicationRuntime<SpurAppConfig>) {
                    void appRt;
                    const context = createCliContext({
                        cwd,
                        env,
                        output,
                        db,
                        spurConfig,
                        loadAgentConfig,
                        loadAgentConfigStrict,
                    });
                    exitCode = await runCommandDispatch(argv, context, output);
                },
            });
            await app.stop('shutdown');
        } else {
            // No config file — direct path (pre-init, tests).
            const context = createCliContext({
                cwd,
                env,
                output,
                db,
                spurConfig,
                loadAgentConfig,
                loadAgentConfigStrict,
            });
            exitCode = await runCommandDispatch(argv, context, output);
        }
    } finally {
        // ADR-018: ts-infra 0.3.6 no longer closes a caller-injected services.db.
        // Spur owns the adapter it creates — close it in both bootstrap branches.
        await db.close();
    }

    return exitCode;
}

/**
 * Build the Commander program with every noun command group registered.
 * Exported so the docs/help flag-set parity test (task 0800 R3) walks the same
 * tree the dispatcher runs — a separately-built tree would drift.
 */
export function buildProgram(context: ReturnType<typeof createCliContext>, output: CommandOutput): Command {
    const program = new Command();
    program.name('spur').version(CLI_CONFIG.binaryVersion).exitOverride();
    program.configureOutput({
        writeOut: (str: string) => output.write(str),
        writeErr: (str: string) => output.error(str),
    });
    program.option('-v, --cli-verbose', 'Show internal diagnostics');
    // Global startup-decoration opt-out (A31/0719). Registered at the composition root so the
    // token is accepted before or after nested noun/verb tokens; runCli() consumes it via raw
    // argv, so this registration only owns help visibility and parse acceptance.
    program.option('--no-logo', 'Suppress the startup ASCII banner');

    // Register every noun command group — UNCHANGED (R3).
    registerAgentCommand(program, context);
    registerBuilderCommand(program, context);
    registerDecisionCommand(program, context);
    registerFeatureCommand(program, context);
    registerHistoryCommand(program, context);
    registerMessageCommand(program, context);
    registerProjectsCommand(program, context);
    registerRuleCommand(program, context);

    // Task 1388: `self` is the only home for init/maintain/migrate/serve/status — the hidden
    // top-level aliases are gone, so one spelling per action.
    const selfCommand = program.command('self').summary('inspect and manage the Spur installation itself');
    registerSelfCommand(selfCommand, context);

    registerTaskCommand(program, context);
    registerWorkflowCommand(program, context);

    return program;
}

/** Build the Commander program and run the dispatch. Returns exit code. */
async function runCommandDispatch(
    argv: string[],
    context: ReturnType<typeof createCliContext>,
    output: CommandOutput,
): Promise<number> {
    let exitCode = 0;
    context.setExitCode = (code: number) => {
        exitCode = code;
    };
    const program = buildProgram(context, output);

    try {
        await program.parseAsync(argv, { from: 'user' });
        return exitCode;
    } catch (err) {
        if (err instanceof Error && 'exitCode' in err) {
            return (err as Error & { exitCode: number }).exitCode;
        }
        output.error(errorMessage(err));
        return exitCode !== 0 ? exitCode : 1;
    }
}

/** Render the startup ASCII banner without runtime font file I/O. */
export function bannerText(): string {
    figlet.parseFont('Standard', standard);
    return figlet.textSync(CLI_CONFIG.binaryLabel, { font: 'Standard' });
}

/**
 * Startup-banner policy (A31/0719) — single composition-root owner. Exact argv
 * tokens only: near-misses like `--no-logos` must not suppress the logo. `main()`
 * never consults this — programmatic dispatch stays banner-free by construction.
 */
export function shouldRenderBanner(argv: readonly string[]): boolean {
    // The inline driver parses these transports' stdout (JSON verdicts, fingerprints).
    if (isWorkflowTransportInvocation(argv)) return false;
    // JSON-only output with no --json flag; sp:session-review pipes it to jq.
    if (argv[0] === 'history' && argv[1] === 'timeline') return false;
    // `spur mcp` (feature B9, task 1373): stdout is the NDJSON JSON-RPC channel — a banner
    // would corrupt the stream the client parses.
    if (argv[0] === 'mcp') return false;
    // 1218: `builder show-branches --format json` is the same JSON-only surface as `--json`.
    if (argv[0] === 'builder' && argv[1] === 'show-branches' && requestsJsonFormat(argv)) return false;
    return !argv.some((arg) => arg === '--no-logo' || arg === '--json' || arg === '--quiet' || arg === '--silent');
}

/** `--format json` in either spelling; a machine consumer parses this verb's stdout. */
function requestsJsonFormat(argv: readonly string[]): boolean {
    const index = argv.indexOf('--format');
    return argv.includes('--format=json') || (index !== -1 && argv[index + 1] === 'json');
}

/** CLI entry point extracted for test coverage. Does NOT call process.exit(). */
export async function runCli(): Promise<number> {
    const argv = process.argv.slice(2);
    if (shouldRenderBanner(argv)) {
        consoleOutput.write(bannerText());
    }
    try {
        return await main();
    } finally {
        // A `laya-local` decision leaves a warm Python worker whose open pipes keep this process
        // alive; the CLI owns that client, so it releases it at the process boundary (otherwise the
        // command prints its result and the process never exits).
        await disposeDecisionServices();
    }
}

if (import.meta.main) {
    // main() closes its runtime and DB; natural shutdown also drains buffered pipe output.
    process.exitCode = await runCli();
}
