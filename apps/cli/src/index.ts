#!/usr/bin/env bun
import { Command } from '@commander-js/extra-typings';
import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';
import { runNodeApplication } from '@gobing-ai/ts-infra/application-node';
import figlet from 'figlet';
import standard from 'figlet/fonts/Standard';
import { registerAgentCommand } from './commands/agent';
import { registerHistoryCommand } from './commands/history';
import { registerInitCommand } from './commands/init';
import { registerMessageCommand } from './commands/message';
import { registerMigrateCommand } from './commands/migrate';
import { registerPluginCommand } from './commands/plugin';
import { registerRuleCommand } from './commands/rule';
import { registerStatusCommand } from './commands/status';
import { registerTeamCommand } from './commands/team';
import { registerWorkflowCommand } from './commands/workflow';
import { CLI_CONFIG } from './config';
import { loadSpurConfig } from './config/loader';
import { resolveConfigFile } from './config/resolver';
import { type SpurAppConfig, SpurAppConfigSchema } from './config/schema';
import { createCliContext, createMigratedDbAdapter } from './context';
import { errorMessage } from './errors';
import { type CommandOutput, consoleOutput } from './output';
/** Options for programmatic CLI execution in tests. */
export interface MainOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    output?: CommandOutput;
    dbUrl?: string;
}

/** Run the Spur CLI with explicit argv and injectable runtime dependencies. */
export async function main(argv = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
    const output = options.output ?? consoleOutput;
    let exitCode = 0;

    const configFile = resolveConfigFile(options.cwd);
    const db = await createMigratedDbAdapter(options.cwd ?? process.cwd(), options.env ?? process.env, options.dbUrl);

    try {
        if (configFile !== undefined) {
            // Validate against JSON Schema ($schema in config file) before bootstrapping.
            // Throws StructuredConfigSchemaError on validation failure — fail fast, fix config.
            await loadSpurConfig(configFile);

            // Bootstrap through runNodeApplication — standard path (R1).
            const app = await runNodeApplication<SpurAppConfig>({
                configLoader: {
                    configFile,
                    bootstrapSection: 'bootstrap',
                    appConfig: { safeParse: (raw) => SpurAppConfigSchema.safeParse(raw) },
                },
                // Under test, force logging off so initializeLogger() does not
                // reconfigure LogTape with a console sink — which would reset the
                // global mute installed in tests/setup.ts and leak JSON log lines
                // from every later app.* logger (e.g. the rule engine).
                config: process.env.NODE_ENV === 'test' ? { logging: { enabled: false } } : undefined,
                services: { db },
                async start(_appRt: ApplicationRuntime<SpurAppConfig>) {
                    const context = createCliContext({
                        cwd: options.cwd,
                        env: options.env,
                        output,
                        db,
                    });
                    exitCode = await runCommandDispatch(argv, context, output);
                },
            });
            await app.stop('shutdown');
        } else {
            // No config file — direct path (pre-init, tests).
            // This preserves the exact same behavior as before for un-initialized projects.
            const context = createCliContext({
                cwd: options.cwd,
                env: options.env,
                output,
                db,
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
    registerHistoryCommand(program, context);
    registerInitCommand(program, context);
    registerMessageCommand(program, context);
    registerMigrateCommand(program, context);
    registerPluginCommand(program, context);
    registerRuleCommand(program, context);
    registerStatusCommand(program, context);
    registerTeamCommand(program, context);
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

if (import.meta.main) {
    const argv = process.argv.slice(2);
    if (!argv.includes('--json')) {
        consoleOutput.write(bannerText());
    }
    const exitCode = await main();
    process.exit(exitCode);
}
