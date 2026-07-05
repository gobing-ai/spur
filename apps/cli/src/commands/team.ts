import type { Command } from '@commander-js/extra-typings';
import { TeamService, type TeamStatusEntry } from '@gobing-ai/spur-app';
import type { CliContext } from '../context';
import { toJson } from '../output';

/** Default server API URL for team start/stop (requires spur serve). */
const DEFAULT_SERVER = 'http://localhost:3000/api';

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
        .description('Start a supervised agent process (requires spur serve).')
        .argument('<agent-id>', 'Agent spec id')
        .option('--server <url>', 'Server API URL', DEFAULT_SERVER)
        .option('--json', 'Output machine-readable JSON')
        .action(async (agentId, options) => {
            const code = await runTeamStart(agentId, options, context);
            context.setExitCode(code);
        });

    noun.command('stop')
        .description('Stop a supervised agent process (requires spur serve).')
        .argument('<agent-id>', 'Agent spec id')
        .option('--server <url>', 'Server API URL', DEFAULT_SERVER)
        .option('--json', 'Output machine-readable JSON')
        .action(async (agentId, options) => {
            const code = await runTeamStop(agentId, options, context);
            context.setExitCode(code);
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

/** Payload of a `spur team start` server response. */
interface StartResponse {
    ok?: boolean;
    error?: string;
    pid?: number;
    status?: string;
}

/** Payload of a `spur team stop` server response. */
interface StopResponse {
    ok?: boolean;
    error?: string;
}

/** Send `spur team start <agent-id>` to the server and translate the response. */
async function performTeamStart(
    agentId: string,
    options: { server: string; json?: boolean },
): Promise<
    | { ok: true; body: StartResponse }
    | { ok: false; error: string; status: number }
    | { ok: false; transportError: unknown }
> {
    try {
        const url = `${options.server}/team/agents/${encodeURIComponent(agentId)}/start`;
        const res = await fetch(url, { method: 'POST' });
        const body = (await res.json()) as StartResponse;
        if (res.ok) return { ok: true, body };
        return { ok: false, error: body.error ?? `start failed: ${res.status}`, status: res.status };
    } catch (err) {
        return { ok: false, transportError: err };
    }
}

/** `spur team start <agent-id> [--server <url>] [--json]` — spawn via server API. */
async function runTeamStart(
    agentId: string,
    options: { server: string; json?: boolean },
    context: CliContext,
): Promise<number> {
    const result = await performTeamStart(agentId, options);
    if ('transportError' in result) {
        const err = result.transportError;
        context.output.error(
            `Cannot reach server at ${options.server} — is spur serve running? (${err instanceof Error ? err.message : String(err)})`,
        );
        return 1;
    }
    if (!result.ok) {
        context.output.error(result.error);
        return 1;
    }
    if (options.json) {
        context.output.write(toJson(result.body));
    } else {
        context.output.write(`started ${agentId} (pid=${result.body.pid}, status=${result.body.status ?? '?'})`);
    }
    return 0;
}

/** Send `spur team stop <agent-id>` to the server and translate the response. */
async function performTeamStop(
    agentId: string,
    options: { server: string; json?: boolean },
): Promise<
    | { ok: true; body: StopResponse }
    | { ok: false; error: string; status: number }
    | { ok: false; transportError: unknown }
> {
    try {
        const url = `${options.server}/team/agents/${encodeURIComponent(agentId)}/stop`;
        const res = await fetch(url, { method: 'POST' });
        const body = (await res.json()) as StopResponse;
        if (res.ok) return { ok: true, body };
        return { ok: false, error: body.error ?? `stop failed: ${res.status}`, status: res.status };
    } catch (err) {
        return { ok: false, transportError: err };
    }
}

/** `spur team stop <agent-id> [--server <url>] [--json]` — stop via server API. */
async function runTeamStop(
    agentId: string,
    options: { server: string; json?: boolean },
    context: CliContext,
): Promise<number> {
    const result = await performTeamStop(agentId, options);
    if ('transportError' in result) {
        const err = result.transportError;
        context.output.error(
            `Cannot reach server at ${options.server} — is spur serve running? (${err instanceof Error ? err.message : String(err)})`,
        );
        return 1;
    }
    if (!result.ok) {
        context.output.error(result.error);
        return 1;
    }
    if (options.json) {
        context.output.write(toJson(result.body));
    } else {
        context.output.write(`stopped ${agentId}`);
    }
    return 0;
}

/** Format a single agent status row for plain-text listing. */
function formatStatusLine(agent: TeamStatusEntry): string {
    const pid = agent.pid === undefined ? '' : ` pid=${agent.pid}`;
    return `${agent.status}\t${agent.id}\t${agent.type}\t${agent.purpose}${pid}`;
}
