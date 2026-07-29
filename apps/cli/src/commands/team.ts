import type { Command } from '@commander-js/extra-typings';
import {
    type MaterializeResult,
    type SystemEventBus,
    type TeamListing,
    TeamService,
    type TeamServiceEventBus,
    type TeamStatusEntry,
    type TeardownResult,
} from '@gobing-ai/spur-app';
import { EventBus } from '@gobing-ai/ts-infra';
import type { CliContext } from '../context';
import { toJson } from '../output';
import { attachSystemEventLedger, type CliSystemEventLedger } from '../system-event-ledger';

// ── Injectable fetch seam for tests ───────────────────────────────────
let _testFetch: typeof fetch | undefined;

/** Replace the fetch implementation for the current test. Call resetTeamFetchForTesting in cleanup. */
export function setTeamFetchForTesting(fn: typeof fetch): void {
    _testFetch = fn;
}

/** Restore the platform fetch after a test. */
export function resetTeamFetchForTesting(): void {
    _testFetch = undefined;
}

function teamFetch(url: string, init: RequestInit): Promise<Response> {
    const fetcher = _testFetch ?? fetch;
    return fetcher(url, init);
}

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
        .description('List agent specs and their run status; --by-team groups by team (0258 R4).')
        .option('--json', 'Output machine-readable JSON')
        .option('--by-team', 'Group specs by their agent.team.<id> membership')
        .option('--server <url>', 'Server API URL for live run status', DEFAULT_SERVER)
        .action(async (options) => {
            const code = options.byTeam
                ? await runTeamStatusGrouped(options, context)
                : await runTeamStatus(options, context);
            context.setExitCode(code);
        });

    noun.command('up')
        .description('Materialize a team roster into agent specs; best-effort start when spur serve is reachable.')
        .argument('<team>', 'Team id (agent.team.<team>)')
        .option('--check', 'Dry-run: show the add/prune diff without writing')
        .option('--server <url>', 'Server API URL', DEFAULT_SERVER)
        .option('--json', 'Output machine-readable JSON')
        .action(async (team, options) => {
            const code = await runTeamUp(team, options, context);
            context.setExitCode(code);
        });

    noun.command('down')
        .description('Tear down a team: stop members; --purge also removes generated specs.')
        .argument('<team>', 'Team id')
        .option('--purge', 'Also delete spur:generated specs (never manual / ref:)')
        .option('--server <url>', 'Server API URL', DEFAULT_SERVER)
        .option('--json', 'Output machine-readable JSON')
        .action(async (team, options) => {
            const code = await runTeamDown(team, options, context);
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
    // CLI ledger so team.member.assigned reaches system_events without serve (0371 R6).
    const { svc, ledger } = await makeTeamServiceWithLedger(context);
    try {
        await svc.assignTask(taskId, agentId);
        context.output.write(`assigned ${taskId} → ${agentId}`);
        return 0;
    } finally {
        await ledger.flush();
        ledger.unsubscribe();
    }
}

/** `spur team status [--json] [--server <url>]` */
async function runTeamStatus(options: { json?: boolean; server: string }, context: CliContext): Promise<number> {
    const svc = new TeamService(context);
    const json = options.json === true;
    const status = await svc.getStatus();
    if (status.agents.length === 0) {
        context.output.write('No agent specs found in .spur/agents/');
        return 0;
    }
    // The local TeamOrchestrator `getStatus` consults is always empty in the CLI
    // process — agents are spawned by `spur serve`'s SupervisorService, which the
    // CLI can only observe via the HTTP API. Fetch live run status from the server
    // and merge it onto the local specs so `status` agrees with the board's Roster.
    // When the server is unreachable, fall back to the local specs (all `stopped`)
    // so offline `status` still lists the specs.
    const live = await fetchServerProcesses(options.server);
    if (live === null) {
        context.output.error(
            `Cannot reach server at ${options.server} — showing local specs as stopped. Is spur serve running?`,
        );
    } else {
        for (const agent of status.agents) {
            const proc = live.get(agent.id);
            if (proc) {
                agent.status = proc.status;
                agent.pid = proc.pid ?? undefined;
            }
        }
    }
    if (json) {
        context.output.write(toJson(status));
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

/** A supervised-process row from `GET /api/team/processes`. */
interface ServerProcess {
    agentId: string;
    pid: number | null;
    status: string;
}

/** Response shape of `GET /api/team/processes`. */
interface ProcessesResponse {
    processes: ServerProcess[];
    count: number;
}

/** Map a `SupervisorService` process status onto the `TeamStatusEntry` status union. */
function mapServerStatus(status: string): TeamStatusEntry['status'] {
    switch (status) {
        case 'running':
            return 'running';
        case 'errored':
            return 'errored';
        case 'stopped':
        case 'exited':
            return 'stopped';
        default:
            return 'unknown';
    }
}

/**
 * Fetch live run status from the server supervisor (`GET /api/team/processes`).
 * Returns a `Map<agentId, { status, pid }>`, or `null` when the server is
 * unreachable / returns a non-OK response — callers fall back to local specs.
 */
async function fetchServerProcesses(
    server: string,
): Promise<Map<string, { status: TeamStatusEntry['status']; pid: number | null }> | null> {
    try {
        const url = `${server}/team/processes`;
        const res = await teamFetch(url, { method: 'GET' });
        if (!res.ok) return null;
        const body = (await res.json()) as ProcessesResponse;
        const map = new Map<string, { status: TeamStatusEntry['status']; pid: number | null }>();
        for (const proc of body.processes ?? []) {
            map.set(proc.agentId, { status: mapServerStatus(proc.status), pid: proc.pid ?? null });
        }
        return map;
    } catch {
        return null;
    }
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
        const res = await teamFetch(url, { method: 'POST' });
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
        const res = await teamFetch(url, { method: 'POST' });
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

/** `spur team status --by-team` — group specs by their `team:<id>` membership (0258 R4). */
async function runTeamStatusGrouped(
    options: { json?: boolean; server?: string },
    context: CliContext,
): Promise<number> {
    const teams = await new TeamService(context).listTeams();
    if (options.json === true) {
        context.output.write(toJson({ teams }));
        return 0;
    }
    if (teams.length === 0) {
        context.output.write('No teams or agent specs found');
        return 0;
    }
    context.output.write(teams.map(formatTeamBlock).join('\n'));
    return 0;
}

/** Render one team as a header line plus one indented row per spec. */
function formatTeamBlock(team: TeamListing): string {
    const header = team.name && team.name !== team.teamId ? `# ${team.teamId} (${team.name})` : `# ${team.teamId}`;
    const rows = team.specs.map((spec) => `  ${spec.id}\t${spec.type}\t${spec.purpose}`);
    return [header, ...rows].join('\n');
}

/**
 * TeamService + CLI EventBus ledger for team.* durability (task 0371 R6).
 * Same attach pattern as workflow/agent (task 0370): bus → registerSystemEventTap
 * → SystemEventDao. Mutations still succeed if the ledger attach fails.
 */
async function makeTeamServiceWithLedger(
    context: CliContext,
): Promise<{ svc: TeamService; ledger: CliSystemEventLedger }> {
    const bus = new EventBus() as SystemEventBus;
    const ledger = await attachSystemEventLedger(bus, context);
    const svc = new TeamService({
        ...context,
        eventBus: bus as unknown as TeamServiceEventBus,
    });
    return { svc, ledger };
}

/** `spur team up <team> [--check] [--server <url>] [--json]` — materialize + best-effort start. */
async function runTeamUp(
    team: string,
    options: { check?: boolean; server: string; json?: boolean },
    context: CliContext,
): Promise<number> {
    const { svc, ledger } = await makeTeamServiceWithLedger(context);
    try {
        let result: MaterializeResult;
        try {
            result = await svc.materializeTeam(team, { check: options.check === true });
        } catch (error) {
            context.output.error(error instanceof Error ? error.message : String(error));
            return 1;
        }

        // Best-effort start of autostart members when the server is reachable (0252 up-scope).
        const started: string[] = [];
        if (options.check !== true && result.upserted.length > 0) {
            const specs = await svc.listAgentSpecs();
            const autostart = specs.filter((spec) => spec.autoStart === true && result.upserted.includes(spec.id));
            for (const spec of autostart) {
                const res = await performTeamStart(spec.id, { server: options.server });
                if ('ok' in res && res.ok === true) started.push(spec.id);
            }
        }

        if (options.json === true) {
            context.output.write(toJson({ ...result, started }));
        } else {
            const verb = options.check === true ? 'would materialize' : 'materialized';
            const startNote = started.length > 0 ? `, started ${started.length}` : '';
            context.output.write(
                `team ${team}: ${verb} ${result.upserted.length} member(s), prune ${result.orphaned.length}${startNote}`,
            );
        }
        return 0;
    } finally {
        await ledger.flush();
        ledger.unsubscribe();
    }
}

/** `spur team down <team> [--purge] [--server <url>] [--json]` — teardown + best-effort stop. */
async function runTeamDown(
    team: string,
    options: { purge?: boolean; server: string; json?: boolean },
    context: CliContext,
): Promise<number> {
    const { svc, ledger } = await makeTeamServiceWithLedger(context);
    try {
        let result: TeardownResult;
        try {
            result = await svc.teardownTeam(team, { purge: options.purge === true });
        } catch (error) {
            context.output.error(error instanceof Error ? error.message : String(error));
            return 1;
        }

        // Best-effort stop of the team's members when the server is reachable.
        const stopped: string[] = [];
        for (const id of result.stopped) {
            const res = await performTeamStop(id, { server: options.server });
            if ('ok' in res && res.ok === true) stopped.push(id);
        }

        if (options.json === true) {
            context.output.write(toJson({ ...result, stopped }));
        } else {
            context.output.write(`team ${team}: stopped ${stopped.length}, purged ${result.purged.length}`);
        }
        return 0;
    } finally {
        await ledger.flush();
        ledger.unsubscribe();
    }
}
