#!/usr/bin/env bun
import { Command } from '@commander-js/extra-typings';
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
import { createCliContext } from './context';
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
    const context = createCliContext({
        cwd: options.cwd,
        env: options.env,
        output,
        dbUrl: options.dbUrl,
        setExitCode: (code: number) => {
            exitCode = code;
        },
    });

    const program = new Command();
    program.name('spur').version(CLI_CONFIG.binaryVersion).exitOverride();
    program.configureOutput({
        writeOut: (str: string) => output.write(str),
        writeErr: (str: string) => output.error(str),
    });
    program.option('-v, --cli-verbose', 'Show internal diagnostics');

    // Register every noun command group.
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
