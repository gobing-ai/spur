import { randomUUID } from 'node:crypto';
import type { Command } from '@commander-js/extra-typings';
import type { AgentQuotaEventBus } from '@gobing-ai/spur-app';
import {
    type AgentRunDeps,
    AgentService,
    DeliveryReconciler,
    FINDING_CODES,
    FleetService,
    FOLLOW_POLL_INTERVAL_MS,
    followSystemEventsAfter,
    MAX_INJECT_ATTEMPTS,
    normalizeProjectPath,
    resolveAgentSelector,
    resolvePlanningFolders,
    StrategyRuntime,
    type SystemEventBus,
    TeamService,
    type TeamStatusEntry,
    WaitError,
    type WaitUntil,
    waitForOccupant,
} from '@gobing-ai/spur-app';
import { ExecutorDisabledError, resolveExecutor } from '@gobing-ai/spur-config';
import {
    CLAIM_TTL_MS,
    InboxMessageDao,
    ProjectClaimDao,
    SystemEventDao,
    type SystemEventRow,
} from '@gobing-ai/spur-domain';
import { type AgentSpec, isAgentName } from '@gobing-ai/ts-ai-runner';
import { EventBus } from '@gobing-ai/ts-infra';
import { attachAgentQuotaPersistence } from '../agent-quota-persistence';
import type { CliContext } from '../context';
import { toEnvelopeJson, writeJsonError } from '../output';
import { attachSystemEventLedger } from '../system-event-ledger';
import { SHARED_OPTIONS } from './shared-options';
import { makeCheckService, makeService } from './task';

export type { AgentRunDeps };

// ── Injectable fetch seam for the `spur serve` supervisor calls ───────
let _testFetch: typeof fetch | undefined;

/** Replace the server fetch for the current test. Call resetAgentServerFetchForTesting in cleanup. */
export function setAgentServerFetchForTesting(fn: typeof fetch): void {
    _testFetch = fn;
}

/** Restore the platform fetch after a test. */
export function resetAgentServerFetchForTesting(): void {
    _testFetch = undefined;
}

/** Default server API URL for agent start/stop and live `list --specs` status (requires spur serve). */
const DEFAULT_SERVER = 'http://localhost:3000/api';

/** Register `spur agent` commands on the CLI program. */
export function registerAgentCommand(program: Command, context: CliContext): void {
    const agent = program.command('agent').summary('run and inspect supported coding agents');

    agent
        .command('list')
        .description('List detected coding agents, or agent specs with --specs.')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .option('--specs', 'List agent specs instead of detected agents')
        .option('--server <url>', 'Server API URL for live run status (with --specs)', DEFAULT_SERVER)
        .action(async (options) => {
            const svc = new AgentService({ cwd: context.cwd, env: context.env, output: context.output });
            const code = await runAgentList(svc, context, {
                json: options.json,
                jsonEnvelope: options.jsonEnvelope,
                specs: options.specs,
                server: options.server,
            });
            context.setExitCode(code);
        });

    agent
        .command('doctor')
        .description('Check agent readiness.')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .argument('[agent]', 'Agent to check')
        .option('--probe-health', 'Opt into model health probing (liveness questions are never cached)')
        .option('--force-refresh', 'Bypass the detection cache, re-run, and rewrite it')
        .action(async (agentName, options) => {
            const svc = context.agentService();
            const code = await svc.doctor(
                {
                    json: options.json === true,
                    enveloped: options.jsonEnvelope,
                    agent: agentName,
                    probeHealth: options.probeHealth === true,
                    forceRefresh: options.forceRefresh === true,
                },
                undefined,
            );
            context.setExitCode(code);
        });

    agent
        .command('run')
        .description('Execute a prompt or slash command via a coding agent.')
        .option(
            '--agent <name>',
            'Role, executor, agent binary, auto, or inline (host-session-only; errors on headless surfaces)',
        )
        .option('--spec <id>', 'Agent spec id (occupant addressing; pairs with --drain)')
        .option('--continue', 'Resume the previous agent session')
        .option('--model <name>', 'Agent model argument')
        .option(...SHARED_OPTIONS.modeAgent)
        .option(...SHARED_OPTIONS.cwdAgent)
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .option('--drain', 'Prepend pending inbox messages for --spec <id>')
        .argument('<prompt>', 'The prompt or slash command to execute')
        .action(async (prompt, options) => {
            const flags = commanderOptionsToFlags(options);
            // ADR-091: `--json-envelope` is tri-state on the run path — thread the
            // explicit value under the camelCase key the service reads (the kebab-case
            // conversion above would drop it); absent stays undefined so the service
            // defers to SPUR_JSON_ENVELOPE.
            if (options.jsonEnvelope !== undefined) flags.jsonEnvelope = options.jsonEnvelope;
            const code = await runAgentRun(prompt, context, flags);
            context.setExitCode(code);
        });

    // Supervisor-internal (`supervisor-service.ts` spawns `agent loop --spec <id>`): hidden from help.
    agent
        .command('loop', { hidden: true })
        .description('Run the persistent self-draining loop for a supervised agent spec.')
        .option('--spec <id>', 'Agent spec id / message recipient')
        .option(...SHARED_OPTIONS.pollAgent, String(DEFAULT_LOOP_POLL_MS))
        .action(async (options) => {
            const controller = new AbortController();
            const onSignal = () => controller.abort();
            process.on('SIGINT', onSignal);
            process.on('SIGTERM', onSignal);
            try {
                const flags = commanderOptionsToFlags(options);
                const code = await runAgentLoop(context, flags, { signal: controller.signal });
                context.setExitCode(code);
            } finally {
                process.off('SIGINT', onSignal);
                process.off('SIGTERM', onSignal);
            }
        });

    agent
        .command('wait')
        .description('Wait for a pinned occupant run to reach a lifecycle state. Address by spec id or --role.')
        .argument('[specId]', 'Agent spec id whose occupant to wait on (mutually exclusive with --role)')
        .option(
            '--role <name>',
            'Address by Layer-1 role or executor name; must resolve to exactly one materialized instance',
        )
        .option(...SHARED_OPTIONS.runAgentPin)
        .option(...SHARED_OPTIONS.untilAgent, collectUntil, [])
        .option(...SHARED_OPTIONS.timeout, parseTimeout)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (specId, options) => {
            // 0685 R6: --role resolves to exactly one materialized instance spec id;
            // the wait itself stays identity-pinned on the resolved id.
            if (options.role !== undefined && specId !== undefined) {
                context.setExitCode(
                    waitUsageError(context, options, 'agent wait accepts a spec id or --role, not both'),
                );
                return;
            }
            let targetId = specId;
            if (options.role !== undefined) {
                const resolution = await resolveAgentSelector(
                    () => new TeamService(context).listAgentSpecs(),
                    context.agentConfig,
                    options.role,
                );
                if (!resolution.ok) {
                    context.setExitCode(resolution.code === 'unknown_selector' ? 2 : 1);
                    if (options.json) {
                        context.output.write(
                            toEnvelopeJson(
                                { error: { code: resolution.code, message: resolution.message } },
                                {
                                    enveloped: options.jsonEnvelope,
                                    error: {
                                        code: 'INTERNAL_ERROR',
                                        message: resolution.message,
                                        details: { cliCode: resolution.code },
                                    },
                                },
                            ),
                        );
                    } else {
                        context.output.error(resolution.message);
                    }
                    return;
                }
                targetId = resolution.specId;
            }
            if (targetId === undefined) {
                context.setExitCode(waitUsageError(context, options, 'agent wait requires a spec id or --role <name>'));
                return;
            }
            const code = await runAgentWait(context, targetId, options);
            context.setExitCode(code);
        });

    // Per-spec process lifecycle through the `spur serve` supervisor
    // (POST /api/team/agents/:id/{start,stop}).
    agent
        .command('start')
        .description('Start a supervised agent process (requires spur serve).')
        .argument('<spec-id>', 'Agent spec id')
        .option('--server <url>', 'Server API URL', DEFAULT_SERVER)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (specId, options) => {
            // 0697 AC4: the advertised flag's decision rides visibly on the delegated options.
            const code = await runAgentLifecycle(
                'start',
                specId,
                { server: options.server, json: options.json, jsonEnvelope: options.jsonEnvelope },
                context,
            );
            context.setExitCode(code);
        });

    agent
        .command('stop')
        .description('Stop a supervised agent process (requires spur serve).')
        .argument('<spec-id>', 'Agent spec id')
        .option('--server <url>', 'Server API URL', DEFAULT_SERVER)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (specId, options) => {
            // Same threading contract as `agent start` (0697 AC4).
            const code = await runAgentLifecycle(
                'stop',
                specId,
                { server: options.server, json: options.json, jsonEnvelope: options.jsonEnvelope },
                context,
            );
            context.setExitCode(code);
        });
}

/** Map commander-style camelCase option keys to kebab-case flags internal handlers expect. */
function commanderOptionsToFlags(options: Record<string, unknown>): Record<string, string | boolean> {
    const flags: Record<string, string | boolean> = {};
    for (const [k, v] of Object.entries(options)) {
        if (v === undefined) continue;
        // commander camelCase → kebab-case (e.g. systemPrompt → system-prompt)
        const key = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
        // --no-* flags: commander strips "no" prefix and sets value=false; restore.
        if (v === false && /^[a-z]/.test(k)) flags[`no-${key}`] = true;
        else flags[key] = v as string | boolean;
    }
    return flags;
}

/**
 * Validate an `--agent` value at the flag boundary, before any agent process
 * spawns (0536 R3). Omitted, `auto`, and `inline` pass; AgentService substitutes
 * tier resolution with a warning when `inline` reaches a headless surface (0687
 * R3 / ADR-087). A role, configured executor, or bare coding-agent binary name
 * also passes; the service warns once for a registered bare-binary shim.
 * Returns an error message, or null to proceed. Exported as a test seam.
 */
export function validateAgentSelector(flags: Record<string, string | boolean>, context: CliContext): string | null {
    const raw = typeof flags.agent === 'string' ? flags.agent : undefined;
    if (raw === undefined || raw === 'auto') return null;
    if (raw === 'inline') return null; // 0687 R3: valid selector on every surface
    if (context.agentRoles.has(raw)) return null;
    if ((context.agentConfig?.executors ?? []).some((e) => e.name === raw)) return null;
    if (isAgentName(raw)) return null;
    const roleList = [...context.agentRoles.keys()].join(', ');
    const executors = (context.agentConfig?.executors ?? []).map((e) => e.name);
    const executorList = executors.length > 0 ? executors.join(', ') : '(none configured)';
    return `Unknown agent: '${raw}'. Accepted: role (${roleList}), configured executor (${executorList}), 'inline', or 'auto'.`;
}

/** `spur agent list [--json] [--specs]` — optionally list team agent specs instead of detection. */
async function runAgentList(
    svc: AgentService,
    context: CliContext,
    opts: { json?: boolean; jsonEnvelope?: boolean; specs?: boolean; server?: string },
): Promise<number> {
    if (!opts.specs) {
        return svc.list({ json: opts.json ?? false, enveloped: opts.jsonEnvelope });
    }
    const specs = await new TeamService(context).listAgentSpecs();
    // The CLI process never owns the supervisor — specs are spawned by `spur serve` —
    // so the local listing is only the desired state until the server's process table
    // overrides it. Unreachable server ⇒ every spec `stopped` plus a stderr warning,
    // so offline listing still works.
    const server = opts.server ?? DEFAULT_SERVER;
    const live = await fetchServerProcesses(server);
    if (live === null) {
        context.output.error(
            `Cannot reach server at ${server} — showing local specs as stopped. Is spur serve running?`,
        );
    }
    const statusOf = (id: string): { status: string; pid?: number } => {
        const proc = live?.get(id);
        if (proc === undefined) return { status: 'stopped' };
        return proc.pid !== null ? { status: proc.status, pid: proc.pid } : { status: proc.status };
    };
    if (opts.json) {
        context.output.write(
            toEnvelopeJson(
                {
                    specs: specs.map((spec) => ({
                        id: spec.id,
                        type: spec.type,
                        purpose: spec.purpose,
                        // 0544 R2: role and executor are DISTINCT fields — never merged.
                        ...(typeof spec.config?.role === 'string' && spec.config.role.length > 0
                            ? { role: spec.config.role }
                            : {}),
                        ...(spec.executor !== undefined ? { executor: spec.executor } : {}),
                        ...statusOf(spec.id),
                        path: `.spur/agents/${spec.id}.yaml`,
                    })),
                },
                { enveloped: opts.jsonEnvelope },
            ),
        );
        return 0;
    }
    if (specs.length === 0) {
        context.output.write('No agent specs found in .spur/agents/');
        return 0;
    }
    // 0544 R2/R4: role and executor are distinct columns; undeclared renders `unset`.
    // Live run status is the trailing column (`running pid=<n>` / `stopped`).
    context.output.write(
        specs
            .map((spec) => {
                const role =
                    typeof spec.config?.role === 'string' && spec.config.role.length > 0 ? spec.config.role : 'unset';
                const executor = spec.executor ?? 'unset';
                const { status, pid } = statusOf(spec.id);
                const pidSuffix = pid === undefined ? '' : ` pid=${pid}`;
                return `${spec.id}\t${spec.type}\t${role}\t${executor}\t${spec.purpose}\t${status}${pidSuffix}`;
            })
            .join('\n'),
    );
    return 0;
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
        const res = await (_testFetch ?? fetch)(`${server}/team/processes`, { method: 'GET' });
        if (!res.ok) return null;
        const body = (await res.json()) as {
            processes?: Array<{ agentId: string; pid: number | null; status: string }>;
        };
        const map = new Map<string, { status: TeamStatusEntry['status']; pid: number | null }>();
        for (const proc of body.processes ?? []) {
            map.set(proc.agentId, { status: mapServerStatus(proc.status), pid: proc.pid ?? null });
        }
        return map;
    } catch {
        return null;
    }
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

/** `spur agent start|stop <spec-id> [--server <url>] [--json]` — POST to the serve supervisor. */
async function runAgentLifecycle(
    action: 'start' | 'stop',
    agentId: string,
    options: { server: string; json?: boolean; jsonEnvelope?: boolean },
    context: CliContext,
): Promise<number> {
    let res: Response;
    let body: { ok?: boolean; error?: unknown; pid?: number; status?: string };
    try {
        const url = `${options.server}/team/agents/${encodeURIComponent(agentId)}/${action}`;
        res = await (_testFetch ?? fetch)(url, { method: 'POST' });
        body = (await res.json()) as typeof body;
    } catch (err) {
        writeJsonError(
            context.output,
            options,
            `Cannot reach server at ${options.server} — is spur serve running? (${err instanceof Error ? err.message : String(err)})`,
            'INTERNAL_ERROR',
        );
        return 1;
    }
    if (!res.ok) {
        // The server's JSON `error` is untrusted input (0699 R1): take an envelope's
        // message rather than serializing it — the server attaches a stack with
        // absolute paths, which has no business on the CLI's stdout.
        writeJsonError(
            context.output,
            options,
            errorText(body.error) ?? `${action} failed: ${res.status}`,
            'INTERNAL_ERROR',
        );
        return 1;
    }
    if (options.json) {
        context.output.write(toEnvelopeJson(body, { enveloped: options.jsonEnvelope }));
    } else if (action === 'start') {
        context.output.write(`started ${agentId} (pid=${body.pid}, status=${body.status ?? '?'})`);
    } else {
        context.output.write(`stopped ${agentId}`);
    }
    return 0;
}

/**
 * The `--json` / `--json-envelope` pair, read out of the kebab-cased flags record the
 * agent verbs pass around (0699 R1). `runAgentRun` never sees the raw commander
 * `options`, so its failure paths need this to reach `writeJsonError`.
 * `jsonEnvelope` stays tri-state: absent defers to `SPUR_JSON_ENVELOPE`.
 */
function jsonFlags(flags: Record<string, string | boolean>): { json?: boolean; jsonEnvelope?: boolean } {
    const envelope = flags.jsonEnvelope ?? flags['json-envelope'];
    return {
        json: flags.json === true,
        jsonEnvelope: typeof envelope === 'boolean' ? envelope : undefined,
    };
}

/**
 * Settle messages claimed by a drain (0831): a claimed row ends in exactly one of
 * `delivered` (invocation accepted — seen `agent.invoke.start` on the run bus),
 * `queued` (released for redelivery — the invocation never started and the row
 * still has attempt budget), or `failed` (never started AND the budget is
 * exhausted). The exit code is irrelevant to delivery: a run that started is
 * delivered (0831 R2), and delivery failure is never inferred from the exit
 * code (0831 R5). Called from a `finally` so an abort still settles.
 */
export async function settleClaimedMessages(
    context: CliContext,
    claimed: string[],
    outcome: 'accepted' | 'not-started',
): Promise<void> {
    if (claimed.length === 0) return;
    const team = new TeamService(context);
    if (outcome === 'accepted') {
        await team.settleDelivered(claimed);
        return;
    }
    // Not started: release within the claim budget, else a queryable terminal failure.
    const dao = new InboxMessageDao(await context.getDb());
    const releasable: string[] = [];
    const exhausted: string[] = [];
    for (const id of claimed) {
        const row = await dao.getById(id);
        // Already settled on another path (e.g. the live stdin-injection delivery)
        // or gone — never re-settle someone else's row.
        if (row?.status !== 'injected') continue;
        if (row.injectAttempts >= MAX_INJECT_ATTEMPTS) exhausted.push(id);
        else releasable.push(id);
    }
    if (releasable.length > 0) await team.releasePending(releasable);
    for (const id of exhausted) {
        await team.settleFailed(
            [id],
            `delivery not accepted: invocation never started after ${MAX_INJECT_ATTEMPTS} inject attempts`,
        );
    }
}

/** Execute `spur agent run <prompt> [flags]`. */
export async function runAgentRun(
    prompt: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
    deps?: AgentRunDeps,
): Promise<number> {
    // Task 0370: direct `spur agent run` emits cataloged `agent.invoke.*` on a
    // CLI-local bus with a SystemEventDao tap — the EventBus dual of task 0249's
    // SystemEventEmitter for planning. Workflow-dispatched agent.run stays on the
    // workflow path (`workflow.agent` series only) so a nested execution never
    // double-counts (R4). Route through context.agentService({ events }) so the
    // validated agentConfig (0126) is still threaded into resolution.
    const bus = new EventBus() as SystemEventBus;
    const ledger = await attachSystemEventLedger(bus, context);
    // 0799 R1: quota events from this run persist into `agent_executor_updates`
    // so the server can apply them even if it was offline during the run.
    // SAFETY: the ledger's SystemEventBus and AgentQuotaEventBus are nominal
    // names over one structural ts-infra EventBus instance (ADR-044 event
    // bridge, same crossing the ledger attach performs above).
    const quotaPersistence = attachAgentQuotaPersistence(bus as unknown as AgentQuotaEventBus, context);
    const svc = context.agentService({ events: bus });
    // 0831: acceptance is detected from the `agent.invoke.start` lifecycle event —
    // never from an exit code (exit 2 is both a pre-spawn validation failure and a
    // legitimate agent exit). The sync listener flips before `svc.run` resolves.
    let invocationStarted = false;
    bus.on('agent.invoke.start', (event) => {
        if (event && typeof event === 'object' && 'operation' in event && event.operation === 'prompt') {
            invocationStarted = true;
        }
    });
    let claimed: string[] = [];
    try {
        // `--spec <id>` (canonical, 0542 R1) or the legacy `--agent <spec-id>`
        // names the occupant address; `--drain` is DB-backed, so it is resolved in
        // the command layer (where getDb lives) rather than in the app service.
        // The addressed id names a message recipient (an agent spec id), which is
        // a different namespace from the coding-agent type the runner resolves.
        // When a matching spec exists we rewrite `--agent` to the spec's underlying
        // executor/type so resolution still works; in Phase 1-3 there is no live
        // stdin, so prepending is how deferred messages reach the agent.
        if (flags.drain === true || typeof flags.spec === 'string') {
            const {
                prompt: drained,
                flags: rewritten,
                claimed: drainedIds,
            } = await drainIntoPrompt(prompt, context, flags);
            // Track the claim immediately: a validation failure BEFORE the run
            // must still settle (release) the rows, not strand them at injected.
            claimed = drainedIds;
            // R1 (0542): an explicit --spec must resolve to a real team spec — a
            // typo'd id must not silently fall through to auto resolution.
            if (typeof flags.spec === 'string' && flags.spec !== '' && rewritten['spec-id'] !== flags.spec) {
                writeJsonError(
                    context.output,
                    jsonFlags(flags),
                    `--spec "${flags.spec}" does not match a team agent spec`,
                    'VALIDATION_FAILED',
                );
                return 2;
            }
            const invalid = validateAgentSelector(rewritten, context);
            if (invalid !== null) {
                writeJsonError(context.output, jsonFlags(flags), invalid, 'VALIDATION_FAILED');
                return 2;
            }
            return await svc.run(drained, rewritten, deps);
        }
        // R3 (0536): reject a value that is neither a role, a configured executor,
        // nor auto at the flag boundary — before any agent process spawns.
        // Explicit `inline` is rejected here too (G5 / ADR-047 amendment): exit 2
        // with the frozen headless-surface message, zero spawn, no fallback.
        const invalid = validateAgentSelector(flags, context);
        if (invalid !== null) {
            writeJsonError(context.output, jsonFlags(flags), invalid, 'VALIDATION_FAILED');
            return 2;
        }
        return await svc.run(prompt, flags, deps);
    } finally {
        // Settle AFTER the run attempt (0831 R1/R3): in a finally so an abort or
        // early validation failure still settles the claim. Only the drained path
        // (drainIntoPrompt above) claims messages — the released ids go back to
        // `queued` for redelivery; rows whose invocation started settle `delivered`.
        await settleClaimedMessages(context, claimed, invocationStarted ? 'accepted' : 'not-started');
        await ledger.flush();
        ledger.unsubscribe();
        // 0799 R1: flush recorded quota observations before process exit.
        await quotaPersistence.flush();
        quotaPersistence.unsubscribe();
    }
}

/**
 * Drain pending inbox messages for the addressed agent spec and prepend them to
 * the prompt — or, with `--spec` alone, just address the occupant without
 * touching the inbox. Returns possibly-rewritten flags (with `--agent` mapped
 * from spec id to the spec's executor name — or coding-agent type when the spec
 * carries no executor field — when a spec is found).
 *
 * R1 (0542): the spec id is read from `--spec <id>` (canonical). A spec id
 * passed to the legacy `--agent <spec-id>` is still accepted as fallback
 * addressing; the deprecation warning was retired by 0849 once the flag-spec-id
 * scan proved no caller remains. `spec-id` is
 * set BEFORE the rewrite so AgentService.executeRun can persist an occupant pin
 * (ADR-057 wave 1 R1) — the flag survives even when the inbox is empty, because
 * runAgentLoop relies on it.
 */
async function drainIntoPrompt(
    prompt: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
): Promise<{ prompt: string | undefined; flags: Record<string, string | boolean>; claimed: string[] }> {
    const specFlag = typeof flags.spec === 'string' ? flags.spec : '';
    const agentFlag = typeof flags.agent === 'string' ? flags.agent : '';
    const recipient = specFlag !== '' ? specFlag : agentFlag;
    if (recipient === '' || recipient === 'auto') {
        context.output.error('--drain requires an explicit --spec <id> matching a message recipient');
        return { prompt, flags, claimed: [] };
    }

    const team = new TeamService(context);
    const spec = (await team.listAgentSpecs()).find((entry) => entry.id === recipient);
    const flagsOut =
        spec === undefined ? flags : { ...flags, 'spec-id': spec.id, agent: drainAgentSelector(spec, context) };

    // `--spec` without `--drain`: address the occupant, leave the inbox alone.
    if (flags.drain !== true) return { prompt, flags: flagsOut, claimed: [] };

    const inbox = await team.drainPending(recipient);
    if (inbox.count === 0) return { prompt, flags: flagsOut, claimed: [] };

    const header = inbox.messages.map((m) => `- ${m.fromId ?? 'operator'}: ${m.body}`).join('\n');
    const block = `Pending messages:\n${header}`;
    const merged = prompt === undefined ? block : `${block}\n\n${prompt}`;
    const claimed = inbox.messages.map((m) => m.id);
    // Claimed ids (0831): the caller must settle these rows once it knows whether
    // the invocation started — spawned-but-settled-later is the whole 0831 contract.
    // 0833: the same ids ride into executeRun as the requestMessage flag (comma-
    // joined, dual spelling per the sessionDir convention) so the exit sink can
    // persist the run↔message receipt.
    const requestMessage = claimed.join(',');
    return {
        prompt: merged,
        flags: { ...flagsOut, requestMessage, 'request-message': requestMessage },
        claimed,
    };
}

/**
 * Resolve the `--agent` selector for a drained spec (0537, feature B2).
 *
 * A spec materialized with an `executor` name routes through that executor so the
 * operator's model + tier binding survives drain (R2). A dangling executor —
 * renamed or removed from `agent.executors` — fails loudly instead of silently
 * falling back to a bare binary on the default model (R5): the error names the
 * spec and the missing executor, and no process spawns. Pre-existing specs with
 * no executor field keep today's `spec.type` behavior.
 */
function drainAgentSelector(spec: AgentSpec, context: CliContext): string {
    // @transition-shim(spec-without-executor-field) — legacy specs carry only `type`, no executor binding
    if (spec.executor === undefined) return spec.type;
    try {
        resolveExecutor(spec.executor, context.agentConfig, { isCanonicalAgent: isAgentName });
    } catch (error) {
        // 111 R4: a spec pinned to a profile disabled AFTER materialization fails
        // before spawn with the enable-fix — never relabeled as a dangling ref.
        if (error instanceof ExecutorDisabledError) {
            throw new Error(
                `Spec "${spec.id}" pins disabled executor "${spec.executor}" — enable it via agent.executors.${spec.executor}.disabled: false or repin the spec before drain`,
            );
        }
        throw new Error(
            `Spec "${spec.id}" references unknown executor "${spec.executor}" — define it under agent.executors or remove the reference (${error instanceof Error ? error.message : String(error)})`,
        );
    }
    return spec.executor;
}

/** Default wakeup-backstop timeout for `spur agent loop` (ms) — `--poll` (0839 R5). */
const DEFAULT_LOOP_POLL_MS = 2000;

/** Injectable knobs for {@link runAgentLoop} — tests pass maxIterations/signal to bound runs. */
export interface AgentLoopRuntime {
    /** Aborting ends the loop cleanly (SIGINT/SIGTERM in the CLI action). */
    signal?: AbortSignal;
    /** Hard cap on iterations (tests only); undefined = run until aborted. */
    maxIterations?: number;
}

/** Parse the `--poll` backstop timeout; falls back to the default for non-positive/non-numeric input. */
function parseLoopPoll(raw: string | boolean | undefined): number {
    if (typeof raw !== 'string') return DEFAULT_LOOP_POLL_MS;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_LOOP_POLL_MS;
}

/** Valid `agent wait --until` states. */
const WAIT_UNTIL_STATES = new Set<WaitUntil>(['idle', 'working', 'invoke-exit', 'blocked']);

/** Commander reducer: accumulate repeatable `--until` values into an array. */
function collectUntil(value: string, acc: WaitUntil[]): WaitUntil[] {
    if (!WAIT_UNTIL_STATES.has(value as WaitUntil)) {
        throw new Error(`invalid --until "${value}" (expected one of: ${[...WAIT_UNTIL_STATES].join(', ')})`);
    }
    return [...acc, value as WaitUntil];
}

/** Parse the `--timeout` flag as a positive-integer ms value, or undefined. */
function parseTimeout(raw: string | boolean | undefined): number | undefined {
    if (raw === undefined || typeof raw === 'boolean') return undefined;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`invalid --timeout "${raw}" (expected a positive integer ms)`);
    }
    return n;
}

/** Cancellable sleep; resolves immediately if the signal is already aborted. */
function loopSleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted) {
            resolve();
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true },
        );
    });
}

/** Render a reconcile report as run-log lines (0834 R2): summary, then one line per held message. */
function formatReconcileReport(report: {
    unresolved: Array<{ messageId: string; reason: string; injectAttempts: number; runId?: string }>;
    exhausted: string[];
    scanned: number;
}): string {
    const lines = [
        `reconcile: scanned=${report.scanned} unresolved=${report.unresolved.length} exhausted=${report.exhausted.length}`,
    ];
    for (const u of report.unresolved) {
        const run = u.runId !== undefined ? ` run=${u.runId}` : '';
        lines.push(`  ${u.messageId} ${u.reason} attempts=${u.injectAttempts}${run}`);
    }
    return lines.join('\n');
}

/**
 * The four wake sources (0839 R1): a human request (a ledgered `message.sent`
 * — Board/server senders persist it), a strategy change (`strategy.changed`,
 * emitted by StrategyRuntime.setStrategy), a task or capacity change
 * (`fleet.capacity.changed`, emitted by WriteSlotService claim/release), and a
 * completion receipt (`agent.invoke.exit`, persisted by every ledger-attached
 * run — 0833 writes the receipt in the same exit sink). Nothing else wakes the
 * loop; an unfiltered follow would re-create the hot loop with extra steps.
 */
const WAKE_EVENT_NAMES = [
    'message.sent', // human request / orchestrator order   (existing)
    'message.replied',
    'task.created',
    'task.updated',
    'strategy.changed', // strategy change                      (new)
    'fleet.capacity.changed', // task or capacity change        (new)
    'agent.invoke.exit', // completion receipt (0833 writes it in the same sink)
] as const;
type WakeSource = (typeof WAKE_EVENT_NAMES)[number] | 'backstop-timeout';

/** What ended one wait: the wake event consumed, or the `--poll` backstop timeout. */
interface WakeResult {
    source: WakeSource;
    /** The ledger cursor the loop resumes from — never replays a seen row. */
    sequence: number;
}

/** Batch size for the wake poll — mirrors the shared follower's query batch. */
const WAKE_FOLLOW_BATCH = 512;

/**
 * Wait for the next wake event on the `system_events` ledger (0839 R4/R5):
 * keyset-follows `sequence > afterSequence` at the shared follower cadence
 * ({@link FOLLOW_POLL_INTERVAL_MS}), returning on the first wake event, or
 * `{ source: 'backstop-timeout' }` after `timeoutMs` (R5's `--poll`), or on
 * abort. The cursor only ever moves forward: non-matching rows are consumed,
 * and the timeout/abort snapshot is `latestSequence()` — a wake never replays
 * an event the loop has already seen. Built on `dao.follow` (the same query
 * `followSystemEventsAfter` tails) because the frozen signature passes a dao,
 * not a getDb factory; the ledger — not a second transport — stays the source.
 */
async function waitForWake(
    dao: SystemEventDao,
    afterSequence: number,
    timeoutMs: number,
    signal?: AbortSignal,
): Promise<WakeResult> {
    const deadline = Date.now() + timeoutMs;
    let cursor = afterSequence;
    for (;;) {
        if (signal?.aborted === true) {
            return { source: 'backstop-timeout', sequence: cursor };
        }
        const rows = await dao.follow(cursor, WAKE_FOLLOW_BATCH);
        for (const row of rows) {
            const sequence = row.sequence;
            if (sequence === null || sequence <= cursor) continue;
            cursor = sequence;
            if ((WAKE_EVENT_NAMES as readonly string[]).includes(row.event_name)) {
                return { source: row.event_name as WakeSource, sequence };
            }
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            return { source: 'backstop-timeout', sequence: cursor };
        }
        await loopSleep(Math.min(FOLLOW_POLL_INTERVAL_MS, remaining), signal);
    }
}

/** Ledger event name for the recorded idle hold (0839 R3; rendered by G63 0844). */
const IDLE_HOLD_EVENT = 'fleet.idle-hold';

/**
 * Record the operator-readable hold reason when nothing is runnable (0839 R3),
 * sourced from 0838's StrategyRuntime.selectNext — one `system_events` row
 * ONLY when the hold key changes (a steadily idle orchestrator writes one row,
 * not one per wake; a run that did work resets the caller's key via the loop
 * body). The loop's cwd is the project: strategy/claims/corpus/fleet resolve
 * against it, and the hold lands in the same ledger the loop follows. A
 * selectNext failure (no corpus, unmigrated db) is logged, never fatal — the
 * hold row is advisory, and silence must not wedge a consuming loop.
 */
async function makeFleetRuntime(context: CliContext): Promise<StrategyRuntime> {
    return new StrategyRuntime({
        openDb: () => context.getDb(),
        tasks: await makeService(context, undefined, true),
        fleet: new FleetService({
            spurConfig: await context.loadAgentConfig(context.cwd),
            roles: context.agentRoles,
            fs: context.fs,
            openDb: () => context.getDb(),
        }),
        ready: async (candidate) => {
            const check = await makeCheckService(context);
            const result = await check.check(candidate.filePath, candidate.wbs, { asStatus: 'wip', strict: true });
            return !result.findings.some(
                (finding) => finding.severity === 'error' && finding.code !== FINDING_CODES.L4_PREREQUISITE_NOT_DONE,
            );
        },
        dependencyBlocked: async (_projectPath, wbs) => {
            const { foldersConfig } = await resolvePlanningFolders(context.fs);
            const check = await makeCheckService(context);
            return await check.firstBlockingPrerequisite(context.fs.resolve(foldersConfig.active_folder), wbs);
        },
    });
}

async function recordIdleHold(
    context: CliContext,
    recipient: string,
    source: WakeSource,
    lastHoldKey: string,
): Promise<string> {
    const projectPath = normalizeProjectPath(context.cwd);
    let holds: Array<{ wbs: string; reason: string }>;
    try {
        // Construction is inside the try on purpose: a bare project (no corpus,
        // no agent config) must degrade to "no hold row", never wedge the loop.
        const runtime = await makeFleetRuntime(context);
        holds = (await runtime.selectNext(projectPath)).holds;
    } catch (error) {
        context.output.error(
            `idle-hold: strategy selectNext failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return lastHoldKey;
    }
    const holdKey =
        holds.length === 0
            ? 'idle'
            : holds
                  .map((h) => `${h.wbs}:${h.reason}`)
                  .sort()
                  .join(',');
    if (holdKey === lastHoldKey) return lastHoldKey;
    await new SystemEventDao(await context.getDb()).insert({
        id: randomUUID(),
        event_name: IDLE_HOLD_EVENT,
        occurred_at: new Date().toISOString(),
        actor: recipient,
        payload_json: JSON.stringify({ projectPath, source, holdKey, holds }),
    });
    return holdKey;
}

/**
 * `spur agent loop --spec <id> [--poll <ms>]` — the persistent self-draining wrapper
 * the supervisor spawns (0258 R6). Each iteration WAITS for a wake on the
 * `system_events` ledger (0839: a human request, a strategy change, a capacity
 * change, or a completion receipt) and only then drains the inbox via
 * `drainPending`; an empty drain records the idle hold reason instead of a
 * silent sleep (R3). `--poll` is the backstop timeout — with no wake event the
 * loop still drains every `--poll` ms (R5, no migration for promoted loops).
 * Idle wakes cost no model call and no dispatch (R2). This is the long-lived,
 * attachable process — the member no longer dies after one successful drain.
 * Exits cleanly on abort (SIGINT/SIGTERM); crash-restart is the supervisor's
 * job.
 */
export async function runAgentLoop(
    context: CliContext,
    flags: Record<string, string | boolean>,
    runtime: AgentLoopRuntime = {},
    deps?: AgentRunDeps,
): Promise<number> {
    const recipient = typeof flags.spec === 'string' ? flags.spec : '';
    if (recipient === '' || recipient === 'auto') {
        context.output.error('agent loop requires an explicit --spec <id> matching a team agent spec');
        return 2;
    }
    const pollMs = parseLoopPoll(flags.poll);
    // 0831 R4: the loop shares runAgentRun's acceptance rule — a per-process bus so
    // `agent.invoke.start` (via the agent runner) marks the invocation accepted.
    const bus = new EventBus() as SystemEventBus;
    const svc = context.agentService({ events: bus });

    const fleet = new FleetService({
        fs: context.fs,
        spurConfig: await context.loadAgentConfig(context.cwd),
        roles: context.agentRoles,
        openDb: () => context.getDb(),
    });
    const declaration = await fleet.load(context.cwd);
    const claims = new ProjectClaimDao(await context.getDb());
    const projectPath = normalizeProjectPath(context.cwd);
    const binding = declaration === null ? null : await fleet.resolveOrchestrator(projectPath);
    const owner =
        binding?.instanceId === recipient
            ? await (async () => {
                  await fleet.assertLaunchGroundTruth(projectPath);
                  return claims.claim(projectPath, 'orchestrator', recipient, CLAIM_TTL_MS);
              })()
            : null;
    if (binding?.instanceId === recipient && owner === null) {
        context.output.error(`Orchestrator ${recipient} already has a live owner`);
        return 2;
    }
    let ownershipLost = false;
    let renewal = Promise.resolve();
    const ownerTimer =
        owner === null
            ? undefined
            : setInterval(() => {
                  renewal = renewal
                      .then(async () => {
                          if (
                              !(await claims.heartbeat(
                                  projectPath,
                                  'orchestrator',
                                  recipient,
                                  CLAIM_TTL_MS,
                                  owner.ownerEpoch,
                              ))
                          ) {
                              ownershipLost = true;
                          }
                      })
                      .catch(() => {
                          ownershipLost = true;
                      });
              }, CLAIM_TTL_MS / 3);
    try {
        // 0834 R2: reconcile unfinished requests and runs BEFORE the first drain —
        // ambiguous work is named (outcome-unknown, never requeued) and budget-
        // exhausted rows are marked failed, so the loop never re-dispatches them.
        // The report is operator information in the run log; a non-empty unresolved
        // list does NOT gate the loop (blocking dispatch is G62's 0838 decision).
        const report = await new DeliveryReconciler(context).reconcile(recipient);
        context.output.write(formatReconcileReport(report));
        if (owner) await (await makeFleetRuntime(context)).resume(projectPath);

        let invocationStarted = false;
        bus.on('agent.invoke.start', (event) => {
            if (event && typeof event === 'object' && 'operation' in event && event.operation === 'prompt') {
                invocationStarted = true;
            }
        });

        // 0839 R4 wake-then-drain: the drain runs only AFTER a wake (a wake event on
        // the ledger, or the `--poll` backstop timeout — R5 keeps `--poll` as the
        // backstop so a promoted loop keeps consuming at the same worst-case latency
        // with no migration). The cursor starts at the current ledger tail so a
        // long-idle ledger fires no spurious immediate wake, and never replays a
        // seen row (waitForWake owns the forward-only guarantee).
        const wakeDao = new SystemEventDao(await context.getDb());
        let cursor = await wakeDao.latestSequence();
        let lastHoldKey = '';

        let iteration = 0;
        while (
            !ownershipLost &&
            !runtime.signal?.aborted &&
            (runtime.maxIterations === undefined || iteration < runtime.maxIterations)
        ) {
            const wake = await waitForWake(wakeDao, cursor, pollMs, runtime.signal);
            cursor = wake.sequence;
            if (runtime.signal?.aborted) break;
            if ((await fleet.load(context.cwd)) !== null) {
                if (owner !== null) {
                    const strategy = await makeFleetRuntime(context);
                    const ledger = await attachSystemEventLedger(bus, context);
                    try {
                        await strategy.dispatchNext(
                            projectPath,
                            owner.ownerEpoch,
                            async (decision, signal, beforeDispatch) => {
                                await fleet.assertLaunchGroundTruth(projectPath);
                                const member = (await fleet.resolve(projectPath)).members.find(
                                    (m) => m.instanceId === decision.instanceId,
                                );
                                if (!member) throw new Error(`Fleet member disappeared: ${decision.instanceId}`);
                                const result = await svc.runTraced(
                                    `/sp:dev-run ${decision.taskId} --auto`,
                                    {
                                        'spec-id': decision.instanceId,
                                        agent: member.executor,
                                        task: decision.taskId ?? '',
                                        cwd: projectPath,
                                    },
                                    deps,
                                    { signal, beforeDispatch },
                                );
                                if (result.message) context.output.error(result.message);
                            },
                        );
                    } finally {
                        await ledger.flush();
                        ledger.unsubscribe();
                    }
                }
                lastHoldKey = await recordIdleHold(context, recipient, wake.source, lastHoldKey);
                iteration++;
                continue;
            }
            // Consume this member's inbox (queued → injected). A non-empty drain yields a
            // prompt to run the agent on; an empty drain records the idle hold (R3).
            const {
                prompt,
                flags: rewritten,
                claimed,
            } = await drainIntoPrompt(undefined, context, {
                ...flags,
                drain: true,
            });
            if (prompt !== undefined) {
                // Reset per iteration: each drain is an independent delivery attempt.
                invocationStarted = false;
                const ledger = await attachSystemEventLedger(bus, context);
                try {
                    await svc.run(prompt, rewritten, deps);
                } finally {
                    // 0831 R4: settle even on abort; the loop keeps iterating either
                    // way — a released row redelivers on the next drain.
                    await settleClaimedMessages(context, claimed, invocationStarted ? 'accepted' : 'not-started');
                    await ledger.flush();
                    ledger.unsubscribe();
                }
                // The hold that described the previous idle stretch is stale: work
                // ran, so the next idle wake records a fresh hold row.
                lastHoldKey = '';
            } else {
                lastHoldKey = await recordIdleHold(context, recipient, wake.source, lastHoldKey);
            }
            iteration++;
        }
        return ownershipLost ? 2 : 0;
    } finally {
        if (ownerTimer !== undefined) clearInterval(ownerTimer);
        await renewal;
        if (owner) await claims.release(projectPath, 'orchestrator', recipient, owner.ownerEpoch);
    }
}

/** Read the latest cataloged invoke event for a runId from the system_events ledger. */
async function readLatestInvokeEvent(
    dao: SystemEventDao,
    runId: string,
): Promise<{ eventName: string; sequence: number | null } | null> {
    const rows: SystemEventRow[] = await dao.query({
        run_id: runId,
        names: ['agent.invoke.start', 'agent.invoke.exit'],
        limit: 1,
    });
    const row = rows[0];
    if (row === undefined) return null;
    return { eventName: row.event_name, sequence: row.sequence };
}

/**
 * `spur agent wait <specId> [--run <runId>] [--until ...] [--timeout <ms>] [--json]`.
 * Identity-pinned wait on an occupant run (G4 wave 2, task 0530 R4). Pins the
 * occupant's specId+runId+generation and waits for the first satisfied
 * `--until` (OR), failing with a typed error on replacement / stall / timeout.
 */
async function runAgentWait(
    context: CliContext,
    specId: string,
    options: { run?: string; until: WaitUntil[]; timeout?: number; json?: boolean; jsonEnvelope?: boolean },
): Promise<number> {
    const untilList = options.until;
    if (untilList.length === 0) untilList.push('idle');
    // `blocked` has no first-class signal in wave 2 → reject at usage time.
    if (untilList.length === 1 && untilList[0] === 'blocked') {
        return waitUsageError(
            context,
            options,
            '--until blocked has no first-class signal in this wave; use idle|working|invoke-exit',
        );
    }

    const agentService = context.agentService();
    const teamService = new TeamService(context);
    const eventDao = new SystemEventDao(await context.getDb());

    const controller = new AbortController();
    const onSignal = () => controller.abort();
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    try {
        // Snapshot once to resolve the default runId + initial pin before waiting.
        const occupant = await agentService.getOccupant({ specId });
        if (occupant === null) {
            return waitFail(context, options, 'occupant_gone', `no occupant for specId "${specId}"`);
        }
        const runId = options.run ?? occupant.runId;
        if (options.run !== undefined && options.run !== occupant.runId) {
            // Pin an explicit (possibly completed) run; read its own events.
        }
        const pin = { specId, runId, generation: occupant.generation };

        // First satisfied `--until` wins (OR semantics). Errors from the first
        // failing target surface as the wait result.
        let result: { pin: typeof pin; satisfied: WaitUntil } | null = null;
        let firstError: WaitError | null = null;
        for (const until of untilList) {
            try {
                result = await waitForOccupant(
                    {
                        getOccupant: (id) => agentService.getOccupant({ specId: id }),
                        countPending: (id) => teamService.countPending(id),
                        latestInvokeEvent: (r) => readLatestInvokeEvent(eventDao, r),
                        // Snapshot-then-follow over the shared ledger (G4 R8):
                        // only the pinned run's invoke events are followed.
                        follow: (afterSequence) =>
                            followSystemEventsAfter(context.getDb, {
                                afterSequence,
                                match: (row) =>
                                    row.run_id === runId &&
                                    (row.event_name === 'agent.invoke.start' || row.event_name === 'agent.invoke.exit'),
                                signal: controller.signal,
                            }),
                        now: () => Date.now(),
                        sleep: (ms) => loopSleep(ms, controller.signal),
                    },
                    {
                        pin,
                        until,
                        timeoutMs: options.timeout,
                        signal: controller.signal,
                    },
                );
                break;
            } catch (error) {
                if (error instanceof WaitError) {
                    firstError = error;
                    // `timeout`/`occupant_gone`/`run_replaced` are terminal — no point
                    // trying the next `--until`; only `wait_stalled` might differ.
                    if (error.code !== 'wait_stalled') break;
                } else {
                    throw error;
                }
            }
        }

        if (result !== null) {
            const payload = { satisfied: result.satisfied, pin: result.pin };
            if (options.json) {
                context.output.write(toEnvelopeJson(payload, { enveloped: options.jsonEnvelope }));
            } else {
                context.output.write(`${pin.specId}/${pin.runId} reached ${result.satisfied}`);
            }
            return 0;
        }
        const err = firstError ?? new WaitError('wait_stalled', 'no --until target satisfied');
        return waitFail(context, options, err.code, err.message);
    } finally {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
    }
}

/** Emit a usage error (exit 2) for `agent wait`. */
function waitUsageError(
    context: CliContext,
    options: { json?: boolean; jsonEnvelope?: boolean },
    message: string,
): number {
    if (options.json) {
        context.output.write(
            toEnvelopeJson(
                { error: { code: 'usage', message } },
                {
                    enveloped: options.jsonEnvelope,
                    error: { code: 'INTERNAL_ERROR', message: message, details: { cliCode: 'usage' } },
                },
            ),
        );
    } else {
        context.output.error(message);
    }
    return 2;
}

/** Emit a typed wait failure (exit 1) with the `--json` error envelope. */
function waitFail(
    context: CliContext,
    options: { json?: boolean; jsonEnvelope?: boolean },
    code: string,
    message: string,
): number {
    if (options.json) {
        context.output.write(
            toEnvelopeJson(
                { error: { code, message } },
                {
                    enveloped: options.jsonEnvelope,
                    error: { code: 'INTERNAL_ERROR', message: message, details: { cliCode: code } },
                },
            ),
        );
    } else {
        context.output.error(`${code}: ${message}`);
    }
    return 1;
}
