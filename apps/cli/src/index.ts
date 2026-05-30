#!/usr/bin/env bun
import { parseArgs } from './args';
import { runAgentCommand } from './commands/agent';
import { runHistoryCommand } from './commands/history';
import { runInitCommand } from './commands/init';
import { runInspectCommand } from './commands/inspect';
import { runMigrateCommand } from './commands/migrate';
import { runRuleCommand } from './commands/rule';
import { runStatusCommand } from './commands/status';
import { runWorkflowCommand } from './commands/workflow';
import { runWorkspaceCommand } from './commands/workspace';
import { CLI_CONFIG } from './config';
import { type CliContext, createCliContext } from './context';
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
    const context = createCliContext({
        cwd: options.cwd,
        env: options.env,
        output,
        dbUrl: options.dbUrl,
    });

    try {
        return await dispatch(argv, context);
    } catch (error) {
        output.error(errorMessage(error));
        return error instanceof Error && 'exitCode' in error && typeof error.exitCode === 'number' ? error.exitCode : 1;
    }
}

/** Dispatch parsed arguments to the concrete command implementation. */
export async function dispatch(argv: string[], context: CliContext): Promise<number> {
    const parsed = parseArgs(argv);
    const [command, subcommand] = parsed.command;

    if (command === undefined || command === 'help' || parsed.flags.help === true) {
        context.output.write(helpText());
        return 0;
    }

    if (command === 'version' || parsed.flags.version === true) {
        context.output.write(CLI_CONFIG.binaryVersion);
        return 0;
    }

    switch (command) {
        case 'init':
            return runInitCommand(context, parsed.flags);
        case 'status':
            return runStatusCommand(context, parsed.flags);
        case 'migrate':
            return runMigrateCommand(context, parsed.flags);
        case 'workspace':
            return runWorkspaceCommand(subcommand, context, parsed.flags);
        case 'inspect':
            return runInspectCommand(
                context,
                parsed.flags,
                subcommand === undefined ? parsed.positionals : [subcommand, ...parsed.positionals],
            );
        case 'rule':
            return runRuleCommand(subcommand, context, parsed.flags, parsed.positionals);
        case 'workflow':
            return runWorkflowCommand(subcommand, context, parsed.flags, parsed.positionals);
        case 'agent':
            return runAgentCommand(subcommand, context, parsed.flags, parsed.positionals);
        case 'history':
            return runHistoryCommand(subcommand, context, parsed.flags, parsed.positionals);
        default:
            context.output.error(`Unknown command: ${command}`);
            context.output.write(helpText());
            return 1;
    }
}

/** Render short CLI usage text. */
export function helpText(): string {
    return [
        `${CLI_CONFIG.binaryLabel} ${CLI_CONFIG.binaryVersion}`,
        '',
        'Usage:',
        '  spur init [--name <name>] [--json]',
        '  spur status [--json]',
        '  spur migrate [--json]',
        '  spur workspace add [--name <name>] [--root <path>] [--agent <agent>] [--json]',
        '  spur workspace list [--json]',
        '  spur inspect <path> [--json]',
        '  spur rule run [--preset <name>] [--rule <id>] [--fail-on <severity>] [--json]',
        '  spur agent list|doctor [agent] [--json]',
        '  spur history import --source <source> [--file <path>|--root <path>] [--mode <mode>] [--json]',
        '  spur workflow validate|run <workflow.yaml> [--json]',
        '  spur workflow list [--json]',
    ].join('\n');
}

if (import.meta.main) {
    const exitCode = await main();
    process.exit(exitCode);
}
