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
import '@gobing-ai/ts-db';
import { Command } from '@commander-js/extra-typings';
import type { SpurAppConfig, SpurConfig } from '@gobing-ai/spur-config';
import { loadSpurConfig, resolveConfigFile } from '@gobing-ai/spur-config/loader';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';
import { runNodeApplication } from '@gobing-ai/ts-infra/application-node';
import figlet from 'figlet';
import standard from 'figlet/fonts/Standard';
import { registerAgentCommand } from './commands/agent';
import { registerBuilderCommand } from './commands/builder';
import { registerFeatureCommand } from './commands/feature';
import { registerHistoryCommand } from './commands/history';
import { registerInitCommand } from './commands/init';
import { registerMessageCommand } from './commands/message';
import { registerMigrateCommand } from './commands/migrate';
import { registerProjectsCommand } from './commands/projects';
import { registerRuleCommand } from './commands/rule';

import { registerServeCommand } from './commands/serve';
import { registerStatusCommand } from './commands/status';
import { registerTaskCommand } from './commands/task';
import { registerTeamCommand } from './commands/team';
import { registerWorkflowCommand } from './commands/workflow';
import { CLI_CONFIG } from './config';
import { EMBEDDED_SPUR_SCHEMAS } from './config/embedded-schemas';
import { createCliContext, createMigratedDbAdapter } from './context';
import { errorMessage } from './errors';
import { type CommandOutput, consoleOutput, toJson } from './output';
/** Options for programmatic CLI execution in tests. */
export interface MainOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    output?: CommandOutput;
    dbUrl?: string;
    /** Pre-built DB adapter. Injectable so tests can assert close-on-shutdown (ADR-018). */
    db?: DbAdapter;
}

/** Run the Spur CLI with explicit argv and injectable runtime dependencies. */
export async function main(argv = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
    const output = options.output ?? consoleOutput;
    let exitCode = 0;

    const cwd = options.cwd ?? process.cwd();
    const env = options.env ?? process.env;
    const configFile = resolveConfigFile(cwd);
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
        spurConfig = await loadSpurConfig(cwd, { embeddedSchemas: EMBEDDED_SPUR_SCHEMAS });
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
                    process.env.NODE_ENV === 'test' ? { logging: { enabled: false } } : { logging: { console: false } },
                services: { db },
                async start(appRt: ApplicationRuntime<SpurAppConfig>) {
                    void appRt;
                    const context = createCliContext({
                        cwd,
                        env,
                        output,
                        db,
                        spurConfig,
                    });
                    exitCode = await runCommandDispatch(argv, context, output);
                },
            });
            await app.stop('shutdown');
        } else {
            // No config file — direct path (pre-init, tests).
            const context = createCliContext({ cwd, env, output, db, spurConfig });
            exitCode = await runCommandDispatch(argv, context, output);
        }
    } finally {
        // ADR-018: ts-infra 0.3.6 no longer closes a caller-injected services.db.
        // Spur owns the adapter it creates — close it in both bootstrap branches.
        await db.close();
    }

    return exitCode;
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
    const program = new Command();
    program.name('spur').version(CLI_CONFIG.binaryVersion).exitOverride();
    program.configureOutput({
        writeOut: (str: string) => output.write(str),
        writeErr: (str: string) => output.error(str),
    });
    program.option('-v, --cli-verbose', 'Show internal diagnostics');

    // Register every noun command group — UNCHANGED (R3).
    registerAgentCommand(program, context);
    registerBuilderCommand(program, context);
    registerFeatureCommand(program, context);
    registerHistoryCommand(program, context);
    registerMessageCommand(program, context);
    registerProjectsCommand(program, context);
    registerRuleCommand(program, context);

    // `self` is the visible home for the self-management verbs; the four legacy
    // top-level nouns stay registered over the same builders as hidden aliases
    // so existing scripts, workflow YAML, and habits keep working unchanged.
    const selfCommand = program.command('self').summary('inspect and manage the Spur installation itself');
    registerInitCommand(selfCommand, context);
    registerMigrateCommand(selfCommand, context);
    registerServeCommand(selfCommand, context);
    registerStatusCommand(selfCommand, context);

    registerInitCommand(program, context, { hidden: true });
    registerMigrateCommand(program, context, { hidden: true });
    registerServeCommand(program, context, { hidden: true });
    registerStatusCommand(program, context, { hidden: true });

    registerTeamCommand(program, context);
    registerTaskCommand(program, context);
    registerWorkflowCommand(program, context);

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

/** CLI entry point extracted for test coverage. Does NOT call process.exit(). */
export async function runCli(): Promise<number> {
    const argv = process.argv.slice(2);
    if (!argv.some((arg) => arg === '--json' || arg === '--quiet' || arg === '--silent')) {
        consoleOutput.write(bannerText());
    }
    return main();
}

if (import.meta.main) {
    const exitCode = await runCli();
    process.exit(exitCode);
}
