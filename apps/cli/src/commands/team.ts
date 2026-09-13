import type { Command } from '@commander-js/extra-typings';
import type { AgentQuotaEventBus } from '@gobing-ai/spur-app';
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
import { attachAgentQuotaPersistence } from '../agent-quota-persistence';
import type { CliContext } from '../context';
import { toEnvelopeJson, writeJsonError } from '../output';
import { attachSystemEventLedger, type CliSystemEventLedger } from '../system-event-ledger';
import { SHARED_OPTIONS } from './shared-options';

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
export const DEFAULT_TEAM_SERVER = 'http://localhost:3000/api';

// ── team-noun-retired transition shim (0848 R5) ─────────────────────
// @transition-shim(team-noun-retired) — the `spur team` noun keeps working after its
// six verbs moved to owning nouns (0848); a one-time stderr warning names the replacement.
// Every `spur team` capability moved to its owning noun (task update --assignee,
// agent list --specs, agent start/stop/delete, fleet materialization at serve
// start). The noun itself stays functional until Robin records the G64 cutover
// window; removal of this shim and the noun is gated by the manifest entry
// `team-noun-retired` in config/transition-shims.json.

/** Replacement command shown in the one-time deprecation warning, per verb. */
const TEAM_NOUN_REPLACEMENTS: Record<string, string> = {
    assign: '`spur task update <wbs> --assignee <spec-id>`',
    status: '`spur agent list --specs`',
    up: 'fleet materialization at `spur serve` start (`--check` diff: `spur projects list --fleet`)',
    down: '`spur agent stop <spec-id>` per member (`--purge`: `spur agent delete <id>`)',
    start: '`spur agent start <spec-id>`',
    stop: '`spur agent stop <spec-id>`',
};

let warnedTeamNounRetired = false;

/** Reset the one-time team-noun retirement warning (test seam). */
export function resetTeamNounRetiredWarningForTesting(): void {
    warnedTeamNounRetired = false;
}

/** Emit the noun-level retirement warning once per process, naming the verb's replacement. */
function warnTeamNounRetiredOnce(verb: string, output: CliContext['output']): void {
    if (warnedTeamNounRetired) return;
    warnedTeamNounRetired = true;
    const replacement = TEAM_NOUN_REPLACEMENTS[verb] ?? '`spur agent` / `spur task` / `spur projects`';
    output.error(
        `warning: \`spur team ${verb}\` is deprecated — use ${replacement}. ` +
            'The noun keeps working until the G64 cutover window is recorded ' +
            '(docs/features/G64_retire-workspace-inbox-teams-and-spur-team.md).',
    );
}

/** Register `spur team` commands. */
export function registerTeamCommand(program: Command, context: CliContext): void {
    const noun = program.command('team').summary('coordinate team agent assignments and status');

    noun.command('assign')
        .description('Set the assignee on a task file.')
        .argument('<task-id>', 'Task file id')
        .argument('<agent-id>', 'Agent spec id')
        .action(async (taskId, agentId) => {
            warnTeamNounRetiredOnce('assign', context.output);
            const code = await runTeamAssign(taskId, agentId, context);
            context.setExitCode(code);
        });

    noun.command('status')
        .description('List agent specs and their run status; --by-team groups by team (0258 R4).')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .option('--by-team', 'Group specs by their agent.team.<id> membership')
        .option('--server <url>', 'Server API URL for live run status', DEFAULT_TEAM_SERVER)
        .action(async (options) => {
            warnTeamNounRetiredOnce('status', context.output);
            const code = options.byTeam
                ? await runTeamStatusGrouped(options, context)
                : await runTeamStatus(options, context);
            context.setExitCode(code);
        });

    noun.command('up')
        .description('Materialize a team roster into agent specs; best-effort start when spur serve is reachable.')
        .argument('<team>', 'Team id (agent.team.<team>)')
        .option('--check', 'Dry-run: show the add/prune diff without writing')
        .option('--server <url>', 'Server API URL', DEFAULT_TEAM_SERVER)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (team, options) => {
            warnTeamNounRetiredOnce('up', context.output);
            const code = await runTeamUp(team, options, context);
            context.setExitCode(code);
        });

    noun.command('down')
        .description('Tear down a team: stop members; --purge also removes generated specs.')
        .argument('<team>', 'Team id')
        .option('--purge', 'Also delete spur:generated specs (never manual / ref:)')
        .option('--server <url>', 'Server API URL', DEFAULT_TEAM_SERVER)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (team, options) => {
            warnTeamNounRetiredOnce('down', context.output);
            const code = await runTeamDown(team, options, context);
            context.setExitCode(code);
        });

    noun.command('start')
        .description('Start a supervised agent process (requires spur serve).')
        .argument('<agent-id>', 'Agent spec id')
        .option('--server <url>', 'Server API URL', DEFAULT_TEAM_SERVER)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (agentId, options) => {
            warnTeamNounRetiredOnce('start', context.output);
            const code = await runTeamStart(agentId, options, context);
            context.setExitCode(code);
        });

    noun.command('stop')
        .description('Stop a supervised agent process (requires spur serve).')
        .argument('<agent-id>', 'Agent spec id')
        .option('--server <url>', 'Server API URL', DEFAULT_TEAM_SERVER)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (agentId, options) => {
            warnTeamNounRetiredOnce('stop', context.output);
            const code = await runTeamStop(agentId, options, context);
            context.setExitCode(code);
        });
}

/**
 * `spur team assign <task-id> <agent-id>` — moved home of the assignment capability
 * (0848): `spur task update <wbs> --assignee <spec-id>` delegates here so the ledger
 * attach and `team.member.assigned` emission stay in one place (R2: moved, not copied).
 */
export async function runTeamAssign(taskId: string, agentId: string, context: CliContext): Promise<number> {
    // CLI ledger so team.member.assigned reaches system_events without serve (0371 R6).
    const { svc, ledger, quotaPersistence } = await makeTeamServiceWithLedger(context);
    try {
        await svc.assignTask(taskId, agentId);
        context.output.write(`assigned ${taskId} → ${agentId}`);
        return 0;
    } finally {
        await ledger.flush();
        ledger.unsubscribe();
        await quotaPersistence.flush();
        quotaPersistence.unsubscribe();
    }
}

/** `spur team status [--json] [--server <url>]` */
async function runTeamStatus(
    options: { json?: boolean; jsonEnvelope?: boolean; server: string },
    context: CliContext,
): Promise<number> {
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
        context.output.write(toEnvelopeJson(status, { enveloped: options.jsonEnvelope }));
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
 *
 * 0848: shared with `spur agent list --specs`, which inherited `team status`'s
 * live-run merge (same fallback, same stderr warning).
 */
export async function fetchServerProcesses(
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
    options: { server: string; json?: boolean; jsonEnvelope?: boolean },
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
        // The server's JSON `error` is untrusted input — its declared string type is a
        // claim, not a guarantee (0699 R1). When it arrives as an envelope, take its
        // message rather than serializing the whole object: the server attaches a stack
        // with absolute paths, which has no business on the CLI's stdout.
        const detail = errorText(body.error);
        return { ok: false, error: detail ?? `start failed: ${res.status}`, status: res.status };
    } catch (err) {
        return { ok: false, transportError: err };
    }
}

/**
 * `spur team start <agent-id> [--server <url>] [--json]` — spawn via server API.
 * 0848: shared with `spur agent start <spec-id>` (same endpoint, same error text) —
 * the capability moved nouns, not implementation (R2).
 */
export async function runTeamStart(
    agentId: string,
    options: { server: string; json?: boolean; jsonEnvelope?: boolean },
    context: CliContext,
): Promise<number> {
    const result = await performTeamStart(agentId, options);
    if ('transportError' in result) {
        const err = result.transportError;
        writeJsonError(
            context.output,
            options,
            `Cannot reach server at ${options.server} — is spur serve running? (${err instanceof Error ? err.message : String(err)})`,
            'INTERNAL_ERROR',
        );
        return 1;
    }
    if (!result.ok) {
        writeJsonError(context.output, options, result.error, 'INTERNAL_ERROR');
        return 1;
    }
    if (options.json) {
        context.output.write(toEnvelopeJson(result.body, { enveloped: options.jsonEnvelope }));
    } else {
        context.output.write(`started ${agentId} (pid=${result.body.pid}, status=${result.body.status ?? '?'})`);
    }
    return 0;
}

/** Send `spur team stop <agent-id>` to the server and translate the response. */
/** Narrow an untrusted server `error` field to a single human line (0699 R1). */
function errorText(raw: unknown): string | undefined {
    if (typeof raw === 'string') return raw;
    if (raw !== null && typeof raw === 'object' && 'message' in raw) {
        const message = (raw as { message?: unknown }).message;
        if (typeof message === 'string' && message !== '') return message;
        if ('code' in raw && typeof (raw as { code?: unknown }).code === 'string') {
            return (raw as { code: string }).code;
        }
    }
    return raw === undefined ? undefined : JSON.stringify(raw);
}

async function performTeamStop(
    agentId: string,
    options: { server: string; json?: boolean; jsonEnvelope?: boolean },
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
        // The server's JSON `error` is untrusted input — its declared string type is a
        // claim, not a guarantee (0699 R1). When it arrives as an envelope, take its
        // message rather than serializing the whole object: the server attaches a stack
        // with absolute paths, which has no business on the CLI's stdout.
        const detail = errorText(body.error);
        return { ok: false, error: detail ?? `stop failed: ${res.status}`, status: res.status };
    } catch (err) {
        return { ok: false, transportError: err };
    }
}

/**
 * `spur team stop <agent-id> [--server <url>] [--json]` — stop via server API.
 * 0848: shared with `spur agent stop <spec-id>` (same endpoint, same error text) —
 * the capability moved nouns, not implementation (R2).
 */
export async function runTeamStop(
    agentId: string,
    options: { server: string; json?: boolean; jsonEnvelope?: boolean },
    context: CliContext,
): Promise<number> {
    const result = await performTeamStop(agentId, options);
    if ('transportError' in result) {
        const err = result.transportError;
        writeJsonError(
            context.output,
            options,
            `Cannot reach server at ${options.server} — is spur serve running? (${err instanceof Error ? err.message : String(err)})`,
            'INTERNAL_ERROR',
        );
        return 1;
    }
    if (!result.ok) {
        writeJsonError(context.output, options, result.error, 'INTERNAL_ERROR');
        return 1;
    }
    if (options.json) {
        context.output.write(toEnvelopeJson(result.body, { enveloped: options.jsonEnvelope }));
    } else {
        context.output.write(`stopped ${agentId}`);
    }
    return 0;
}

/** Format a single agent status row for plain-text listing. */
function formatStatusLine(agent: TeamStatusEntry): string {
    const pid = agent.pid === undefined ? '' : ` pid=${agent.pid}`;
    // 0544 R4: an undeclared role renders the literal `unset` — never blank, never inferred.
    const role = agent.role ?? 'unset';
    return `${agent.status}\t${agent.id}\t${agent.type}\t${role}\t${agent.purpose}${pid}`;
}

/** `spur team status --by-team` — group specs by their `team:<id>` membership (0258 R4). */
async function runTeamStatusGrouped(
    options: { json?: boolean; jsonEnvelope?: boolean; server?: string },
    context: CliContext,
): Promise<number> {
    const teams = await new TeamService(context).listTeams();
    if (options.json === true) {
        context.output.write(toEnvelopeJson({ teams }, { enveloped: options.jsonEnvelope }));
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
    const rows = team.specs.map((spec) => {
        // 0544 R1/R4: role is a distinct column; undeclared renders `unset`.
        const role = typeof spec.config?.role === 'string' ? spec.config.role : 'unset';
        return `  ${spec.id}\t${spec.type}\t${role}\t${spec.purpose}`;
    });
    return [header, ...rows].join('\n');
}

/**
 * TeamService + CLI EventBus ledger for team.* durability (task 0371 R6).
 * Same attach pattern as workflow/agent (task 0370): bus → registerSystemEventTap
 * → SystemEventDao. Mutations still succeed if the ledger attach fails.
 */
async function makeTeamServiceWithLedger(context: CliContext): Promise<{
    svc: TeamService;
    ledger: CliSystemEventLedger;
    quotaPersistence: ReturnType<typeof attachAgentQuotaPersistence>;
}> {
    const bus = new EventBus() as SystemEventBus;
    const ledger = await attachSystemEventLedger(bus, context);
    // 0799 R1: quota events from team lifecycle commands persist beside the
    // ledger tap on the same bus; flushed by each command's `finally`.
    // SAFETY: one structural ts-infra EventBus behind the nominal names (ADR-044).
    const quotaPersistence = attachAgentQuotaPersistence(bus as unknown as AgentQuotaEventBus, context);
    const svc = new TeamService({
        ...context,
        // SAFETY: TeamServiceEventBus is structurally the same ts-infra EventBus (see workflow.ts:248).
        eventBus: bus as unknown as TeamServiceEventBus,
        // 0543 R1: role-only members resolve through the Layer-1 role table —
        // same map AgentService receives for `--agent <role>`.
        roles: context.agentRoles,
        // 0799 R3: the launch boundary prefers a fresh merged config so a quota
        // event applied by the updater gates this materialization immediately.
        // The composition-root closure (ADR-082) owns the loader call.
        reloadAgentConfig: () => context.loadAgentConfig(context.cwd),
    });
    return { svc, ledger, quotaPersistence };
}

/** `spur team up <team> [--check] [--server <url>] [--json]` — materialize + best-effort start. */
async function runTeamUp(
    team: string,
    options: { check?: boolean; server: string; json?: boolean; jsonEnvelope?: boolean },
    context: CliContext,
): Promise<number> {
    const { svc, ledger, quotaPersistence } = await makeTeamServiceWithLedger(context);
    try {
        let result: MaterializeResult;
        try {
            result = await svc.materializeTeam(team, { check: options.check === true });
        } catch (error) {
            writeJsonError(context.output, options, error instanceof Error ? error.message : String(error));
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
            context.output.write(toEnvelopeJson({ ...result, started }, { enveloped: options.jsonEnvelope }));
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
        await quotaPersistence.flush();
        quotaPersistence.unsubscribe();
    }
}

/** `spur team down <team> [--purge] [--server <url>] [--json]` — teardown + best-effort stop. */
async function runTeamDown(
    team: string,
    options: { purge?: boolean; server: string; json?: boolean; jsonEnvelope?: boolean },
    context: CliContext,
): Promise<number> {
    const { svc, ledger, quotaPersistence } = await makeTeamServiceWithLedger(context);
    try {
        let result: TeardownResult;
        try {
            result = await svc.teardownTeam(team, { purge: options.purge === true });
        } catch (error) {
            writeJsonError(context.output, options, error instanceof Error ? error.message : String(error));
            return 1;
        }

        // Best-effort stop of the team's members when the server is reachable.
        const stopped: string[] = [];
        for (const id of result.stopped) {
            const res = await performTeamStop(id, { server: options.server });
            if ('ok' in res && res.ok === true) stopped.push(id);
        }

        if (options.json === true) {
            context.output.write(toEnvelopeJson({ ...result, stopped }, { enveloped: options.jsonEnvelope }));
        } else {
            context.output.write(`team ${team}: stopped ${stopped.length}, purged ${result.purged.length}`);
        }
        return 0;
    } finally {
        await ledger.flush();
        ledger.unsubscribe();
        await quotaPersistence.flush();
        quotaPersistence.unsubscribe();
    }
}
