import { TeamService, type TeamStatusEntry } from '@gobing-ai/spur-app';
import { booleanFlag } from '../args';
import type { CliContext } from '../context';
import { toJson } from '../output';

/** Message printed by the deferred Phase-4 daemon stubs. */
const DAEMON_STUB_MESSAGE =
    'Team daemon not yet available. Use `spur agent run --drain` for deferred message delivery.';

/** Render detailed usage for `spur team`. */
export function helpText(): string {
    return [
        'spur team - coordinate team agent assignments and status',
        '',
        'Usage: spur team <command> [options]',
        '',
        'Commands:',
        '  assign <task-id> <agent-id>',
        '      Set the assignee on a task file.',
        '  status [--json]',
        '      List agent specs and their run status.',
        '  start',
        '      Deferred daemon stub.',
        '  stop',
        '      Deferred daemon stub.',
        '  help',
        '      Show this help.',
        '',
        'Options:',
        '  --json             Output machine-readable JSON where supported',
        '  -h, --help         Show this help',
        '',
        'Examples:',
        '  spur team assign 0012 planner',
        '  spur team status --json',
    ].join('\n');
}

/** Execute `spur team` commands backed by TeamService. */
export async function runTeamCommand(
    subcommand: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: string[],
): Promise<number> {
    const svc = new TeamService(context);
    try {
        switch (subcommand) {
            case 'assign':
                return await runTeamAssign(svc, context, positionals);
            case 'status':
                return await runTeamStatus(svc, context, flags);
            case 'start':
            case 'stop':
                context.output.write(DAEMON_STUB_MESSAGE);
                return 0;
            default:
                context.output.error(`Unknown team command: ${subcommand ?? '(none)'}`);
                return 1;
        }
    } catch (error) {
        // Surface validation (bad agent id) and lookup (missing task file) errors
        // as a clean exit rather than an uncaught throw.
        context.output.error(error instanceof Error ? error.message : String(error));
        return 2;
    }
}

/** `spur team assign <task-id> <agent-id>` */
async function runTeamAssign(svc: TeamService, context: CliContext, positionals: string[]): Promise<number> {
    const taskId = positionals[0];
    const agentId = positionals[1];
    if (taskId === undefined || agentId === undefined) {
        context.output.error('team assign requires <task-id> <agent-id>');
        return 2;
    }
    await svc.assignTask(taskId, agentId);
    context.output.write(`assigned ${taskId} → ${agentId}`);
    return 0;
}

/** `spur team status [--json]` */
async function runTeamStatus(
    svc: TeamService,
    context: CliContext,
    flags: Record<string, string | boolean>,
): Promise<number> {
    const json = booleanFlag(flags, 'json');
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
