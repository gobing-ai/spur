import type { Command } from '@commander-js/extra-typings';
import { TeamService, type TeamStatusEntry } from '@gobing-ai/spur-app';
import type { CliContext } from '../context';
import { toJson } from '../output';

/** Message printed by the deferred Phase-4 daemon stubs. */
const DAEMON_STUB_MESSAGE =
    'Team daemon not yet available. Use `spur agent run --drain` for deferred message delivery.';

/** Register `spur team` commands. */
export function registerTeamCommand(program: Command, context: CliContext): void {
    const noun = program.command('team').summary('coordinate team agent assignments and status');

    noun.command('assign')
        .description('Set the assignee on a task file.')
        .argument('<task-id>', 'Task file id')
        .argument('<agent-id>', 'Agent spec id')
        .action(async (taskId, agentId) => {
            const code = await runTeamAssign(taskId, agentId, context);
            context.setExitCode(code);
        });

    noun.command('status')
        .description('List agent specs and their run status.')
        .option('--json', 'Output machine-readable JSON')
        .action(async (options) => {
            const code = await runTeamStatus(options, context);
            context.setExitCode(code);
        });

    noun.command('start')
        .description('Deferred daemon stub.')
        .action(() => {
            context.output.write(DAEMON_STUB_MESSAGE);
        });

    noun.command('stop')
        .description('Deferred daemon stub.')
        .action(() => {
            context.output.write(DAEMON_STUB_MESSAGE);
        });
}

/** `spur team assign <task-id> <agent-id>` */
async function runTeamAssign(taskId: string, agentId: string, context: CliContext): Promise<number> {
    const svc = new TeamService(context);
    await svc.assignTask(taskId, agentId);
    context.output.write(`assigned ${taskId} → ${agentId}`);
    return 0;
}

/** `spur team status [--json]` */
async function runTeamStatus(options: { json?: boolean }, context: CliContext): Promise<number> {
    const svc = new TeamService(context);
    const json = options.json === true;
    const status = await svc.getStatus();
    if (json) {
        context.output.write(toJson(status));
        return 0;
    }
    if (status.agents.length === 0) {
        context.output.write('No agent specs found in .spur/agents/');
        return 0;
    }
    context.output.write(status.agents.map(formatStatusLine).join('\n'));
    return 0;
}

/** Format a single agent status row for plain-text listing. */
function formatStatusLine(agent: TeamStatusEntry): string {
    const pid = agent.pid === undefined ? '' : ` pid=${agent.pid}`;
    return `${agent.status}\t${agent.id}\t${agent.type}\t${agent.purpose}${pid}`;
}
