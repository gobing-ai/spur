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

    // Render the top-level command list grouped by domain instead of commander's
    // flat alphabetical list. Each row's summary is pulled from the registered
    // command, so adding a noun only requires assigning it to a group below.
    program.configureHelp({ visibleCommands: () => [] });
    program.addHelpText('after', () => renderCommandGroups(program));

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

/** Top-level commands grouped by domain for the `spur help` listing. */
const COMMAND_GROUPS: readonly { title: string; commands: readonly string[] }[] = [
    { title: 'Harness', commands: ['agent', 'message', 'team'] },
    { title: 'Policy', commands: ['rule'] },
    { title: 'Workflow', commands: ['workflow'] },
    { title: 'History', commands: ['history'] },
    { title: 'Extension', commands: ['plugin'] },
    { title: 'Project', commands: ['init', 'status', 'migrate'] },
];

/** Build the domain-grouped "Commands:" block for top-level help, sourced from registered specs. */
export function renderCommandGroups(program: Command): string {
    const summaryOf = (name: string): string => {
        const cmd = program.commands.find((c) => c.name() === name);
        return cmd?.summary() ?? cmd?.description() ?? '';
    };
    const width = Math.max(...COMMAND_GROUPS.flatMap((g) => g.commands.map((c) => c.length)));
    const lines = ['Commands:'];
    for (const group of COMMAND_GROUPS) {
        lines.push(`  ${group.title}`);
        for (const name of group.commands) {
            lines.push(`    ${name.padEnd(width)}  ${summaryOf(name)}`.trimEnd());
        }
    }
    return lines.join('\n');
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
