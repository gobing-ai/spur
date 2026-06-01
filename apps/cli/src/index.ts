#!/usr/bin/env bun
import figlet from 'figlet';
import standard from 'figlet/fonts/Standard';
import { parseArgs } from './args';
import { runAgentCommand } from './commands/agent';
import { runHistoryCommand } from './commands/history';
import { runInitCommand } from './commands/init';
import { runMigrateCommand } from './commands/migrate';
import { runRuleCommand } from './commands/rule';
import { runStatusCommand } from './commands/status';
import { runWorkflowCommand } from './commands/workflow';
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

    if (command === 'version') {
        context.output.write(CLI_CONFIG.binaryVersion);
        return 0;
    }

    if (command === undefined || command === 'help' || parsed.flags.help === true) {
        context.output.write(helpText());
        return 0;
    }

    switch (command) {
        case 'init':
            return runInitCommand(context, parsed.flags);
        case 'status':
            return runStatusCommand(
                context,
                parsed.flags,
                subcommand === undefined ? parsed.positionals : [subcommand, ...parsed.positionals],
            );
        case 'migrate':
            return runMigrateCommand(context, parsed.flags);
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
        CLI_CONFIG.binaryVersion,
        '',
        'Usage: spur [global options] <command>',
        '',
        'Global options:',
        '  --json                         Output machine-readable JSON where supported',
        '  -v, --verbose                  Show internal progress diagnostics where supported',
        '  -h, --help                     Display this help',
        '',
        'Commands:',
        '  init [--name <name>] [--json]                                      Scaffold .spur/config.json for this project',
        '  status [path] [--json]                                             Show project, .spur, Git, and optional path status',
        '  migrate [--json]                                                   Apply CLI-owned schema migrations (temporary helper)',
        '  agent run <prompt> [--agent <name>] [--continue] [--model <name>] [--mode <mode>] [--cwd <path>] [--json]',
        '                                                                      Execute a prompt or slash command via a coding agent',
        '  agent list|doctor [agent] [--json]                                 Detect installed agents or check agent readiness',
        '  rule run [--preset <name>] [--file <path>] [--rule <id>] [--fail-on <severity>] [--json]',
        '                                                                      Evaluate constraint rules over the working tree',
        '  rule validate [--file <path>|--preset <name>|<path>] [--json]       Validate rule files or presets without evaluating them',
        '  rule list [--preset <name>] [--json]                               List discovered local rules',
        '  history import --source <source> [--file <path>|--root <path>] [--mode <mode>] [--dry-run] [--json]',
        '                                                                      Import agent conversation JSONL',
        '  history analyze [--since <iso-date>] [--json]                      Summarize imported history cost and usage',
        '  history report [--json]                                            Reserved report surface; prints TODO marker for now',
        '  workflow validate|run <workflow.yaml> [--run-id <id>] [--json]      Validate or execute a workflow definition',
        '  workflow list [--json]                                             List persisted workflow runs',
        '  help                                                               Display this help',
    ].join('\n');
}

/** Render the startup ASCII banner without runtime font file I/O. */
export function bannerText(): string {
    figlet.parseFont('Standard', standard);
    return figlet.textSync(CLI_CONFIG.binaryLabel, { font: 'Standard' });
}

if (import.meta.main) {
    const argv = process.argv.slice(2);
    const versionOnly = argv[0] === 'version';
    if (!argv.includes('--json') && !versionOnly) {
        consoleOutput.write(bannerText());
    }
    const exitCode = await main();
    process.exit(exitCode);
}
