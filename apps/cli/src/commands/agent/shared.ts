import { dirname, resolve } from 'node:path';
import {
    AgentCoordinationService,
    type AgentLoopDeps,
    type AgentLoopRuntime,
    type AgentRunDeps,
    DEFAULT_LOOP_POLL_MS,
    DeliveryReconciler,
    FINDING_CODES,
    FleetDispatcher,
    FleetGuestService,
    FleetService,
    type InboxClaim,
    InboxService,
    isPortLive,
    MAX_DELIVERY_ATTEMPTS,
    normalizeProjectPath,
    ProjectRegistry,
    resolvePlanningFolders,
    runAgentLoopCore,
    StrategyRuntime,
    SUPERVISOR_RUN_MARKER,
} from '@gobing-ai/spur-app';
import { ExecutorDisabledError, type ProjectEntry, resolveExecutor } from '@gobing-ai/spur-config';
import { CoordinationRunDao, type MemberSessionObservation } from '@gobing-ai/spur-domain';
import { type AgentSpec, isAgentName } from '@gobing-ai/ts-ai-runner';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { attachSystemEventLedger } from '../../system-event-ledger';
import { makeCheckService, makeService } from '../task';

/**
 * Default `--follow` budget for `agent trace` (1076 R4): the same 10 minutes
 * `spur workflow trace --follow` uses when `--timeout` is absent.
 */
export const DEFAULT_TRACE_FOLLOW_TIMEOUT_MS = 600_000;

// ── Injectable fetch seam for the `spur serve` supervisor calls ───────
export let _testFetch: typeof fetch | undefined;

/** Replace the server fetch for the current test. Call resetAgentServerFetchForTesting in cleanup. */
export function setAgentServerFetchForTesting(fn: typeof fetch): void {
    _testFetch = fn;
}

/** Restore the platform fetch after a test. */
export function resetAgentServerFetchForTesting(): void {
    _testFetch = undefined;
}

/**
 * Fallback server API URL for agent start/stop and live `list --specs` status (requires spur
 * serve) — used only when this project has no live registry entry (1088 R1).
 */
export const DEFAULT_SERVER = 'http://localhost:3000/api';

/**
 * This project's `spur serve` API URL (1088 R1). `spur serve` records its port in the project
 * registry (`ProjectRegistry.setPort`), so an entry with `port > 0` names the serve that owns
 * THIS project; the hard-coded 3000 default pointed `agent status|stop|start` at a different
 * project's serve (or nothing at all) and reported every spec `stopped` while loops ran.
 * The port is rendered on host `localhost`, never the IPv4 literal `127.0.0.1`: the server binds
 * `Bun.serve({ hostname: options.host })` with `--host` defaulting to `localhost`, which Bun
 * resolves to IPv6 `[::1]` only, so a `127.0.0.1` client has no listener (ECONNREFUSED). The
 * name form resolves the same address family the server bound.
 * An explicit `--server` always wins, which is why the commander options declare no default.
 *
 * Resolving the default is a READ, so it uses `ProjectRegistry.peek()` — the read-only snapshot.
 * `getByPath` routes through `list()`, which heals tilde paths, purges deleted project
 * directories (signalling a purged entry's listener) and clears `port > 0` whenever a liveness
 * probe misses: a transient miss on a loaded host therefore cleared a live serve's port and
 * silently redirected the CLI to the 3000 default — possibly another project's serve. Liveness is
 * still checked here, with `isPortLive`, so the documented "no live entry → 3000" contract and its
 * diagnostic survive without the registry mutation.
 *
 * The lookup walks the cwd's ancestors: run from a subdirectory of a served project, the registry
 * entry for the project root must still be found instead of falling through to the 3000 default.
 */
export async function resolveAgentServer(
    cwd: string,
    explicit?: string,
    deps: AgentServerResolveDeps = {},
): Promise<string> {
    if (explicit !== undefined && explicit !== '') return explicit;
    // The diagnostic sink is injected (the CLI passes `context.output.error`) — never raw stdio:
    // the `no-raw-stdout-stderr` rule keeps every CLI message on the output contract.
    const warn = deps.warn ?? (() => {});
    try {
        const registry = deps.registry ?? new ProjectRegistry();
        const { projects, unreadable } = registry.peek();
        if (unreadable) {
            // Previously indistinguishable from "this project has no entry": the parse failure was
            // collapsed into an empty roster and only the generic 3000 fallback showed.
            warn(
                `warning: project registry unreadable — falling back to ${DEFAULT_SERVER}; run 'spur projects list' to repair it`,
            );
            return DEFAULT_SERVER;
        }
        const isLive = deps.isLive ?? isPortLive;
        for (const candidate of ancestorDirs(cwd)) {
            const normalized = normalizeProjectPath(candidate);
            const entry = projects.find((p) => normalizeProjectPath(p.path) === normalized);
            if (entry === undefined || entry.port <= 0) continue;
            if (await isLive(entry.port)) return `http://localhost:${entry.port}/api`;
            // The registered port has no listener. Keep the documented 3000 fallback, but name
            // what was skipped: silence here reads as "no project registered" (1088 follow-up).
            warn(
                `warning: registered serve port ${entry.port} for ${entry.path} is not listening — falling back to ${DEFAULT_SERVER}`,
            );
            return DEFAULT_SERVER;
        }
    } catch {
        // An unreadable/unlockable registry means "no live entry", not a failed command: fall
        // back to the default port so the existing unreachable-server warning still fires.
    }
    return DEFAULT_SERVER;
}

/** `cwd`, then each of its parents up to the filesystem root — nearest first. */
export function ancestorDirs(cwd: string): string[] {
    const dirs: string[] = [];
    let current = resolve(cwd);
    for (;;) {
        dirs.push(current);
        const parent = dirname(current);
        if (parent === current) return dirs;
        current = parent;
    }
}

/** Test seams for {@link resolveAgentServer} — the registry snapshot, liveness, and the diagnostic sink. */
export interface AgentServerResolveDeps {
    registry?: { peek(): { projects: ProjectEntry[]; unreadable: boolean } };
    isLive?: (port: number) => Promise<boolean>;
    warn?: (message: string) => void;
}

/**
 * Build the guest service over this CLI context (G73, task 1081). Declared member ids come
 * from the same fleet listing `--role` resolves against, so a guest can never shadow a
 * declared member and role lookup never sees a guest.
 */
export function guestService(context: CliContext): FleetGuestService {
    return new FleetGuestService({
        cwd: context.cwd,
        fs: context.fs,
        getDb: () => context.getDb(),
        declaredMemberIds: async () =>
            (await new AgentCoordinationService(context).listFleetMembers()).map((m) => m.instanceId),
    });
}

/** Host session id this process belongs to, when the host exports one (Claude Code does). */
export function hostSessionId(context: CliContext, explicit?: string): string | undefined {
    if (explicit !== undefined && explicit !== '') return explicit;
    const fromEnv = context.env.CLAUDE_CODE_SESSION_ID;
    return fromEnv !== undefined && fromEnv !== '' ? fromEnv : undefined;
}

/** Shared guest usage-error shape: exit 2, JSON or plain. */
export function guestUsageError(
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
                    error: { code: 'VALIDATION_FAILED', message, details: { cliCode: 'usage' } },
                },
            ),
        );
    } else {
        context.output.error(message);
    }
    return 2;
}

/** Map commander-style camelCase option keys to kebab-case flags internal handlers expect. */
export function commanderOptionsToFlags(options: Record<string, unknown>): Record<string, string | boolean> {
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

/** Shorten a session id for human rendering — 8 chars is enough to tell sessions apart. */
export function shortSessionId(id: string): string {
    return id.slice(0, 8);
}

/** Human session column: `resume id=3f9c2a1d` / `one-shot`; `-` when the member has no session. */
export function formatSessionColumn(session: MemberSessionObservation | undefined): string {
    if (session === undefined) return '-';
    return session.id === undefined ? session.mode : `${session.mode} id=${shortSessionId(session.id)}`;
}

/** `spur agent list [--json] [--specs]` — optionally list fleet agent specs instead of detection. */
export const NO_AGENT_SPECS_MESSAGE = 'No agent specs found (.spur/agents/*.yaml or agent.fleet members)';

/**
 * Where a listed spec came from. Fleet members are derived in memory from
 * `agent.fleet` (G72 R2) and have no backing file, so only hand-authored specs
 * carry a `path`.
 */
export function specOrigin(spec: AgentSpec): { source: 'fleet' } | { source: 'file'; path: string } {
    return spec.tags?.includes('fleet:generated')
        ? { source: 'fleet' }
        : { source: 'file', path: `.spur/agents/${spec.id}.yaml` };
}

/**
 * Fetch live run status from the server supervisor (`GET /api/processes`).
 * Returns a `Map<agentId, { status, pid }>`, or `null` when the server is
 * unreachable / returns a non-OK response — callers fall back to local specs.
 */
/** Live facts the server supervisor reports for one agent id (`GET /api/processes`). */
export interface LiveProcess {
    status: FleetProcessStatus;
    pid: number | null;
    /** Member session state (0897) when the served project's ledger has one. */
    session?: MemberSessionObservation;
}

/** Live process table from the `spur serve` supervisor, keyed by spec id; null when the server is unreachable or answers non-OK. */
export async function fetchServerProcesses(server: string): Promise<Map<string, LiveProcess> | null> {
    try {
        const res = await (_testFetch ?? fetch)(`${server}/processes`, {
            method: 'GET',
            signal: AbortSignal.timeout(1500),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as {
            processes?: Array<{
                agentId: string;
                pid: number | null;
                status: string;
                session?: MemberSessionObservation;
            }>;
        };
        const map = new Map<string, LiveProcess>();
        for (const proc of body.processes ?? []) {
            map.set(proc.agentId, {
                status: mapServerStatus(proc.status),
                pid: proc.pid ?? null,
                ...(proc.session !== undefined ? { session: proc.session } : {}),
            });
        }
        return map;
    } catch {
        return null;
    }
}

/**
 * The process-status union `spur agent status` projects (1078 R1). The retired team-era status row
 * carried it; `packages/contracts` has no fleet process-status union, so it lives here locally
 * rather than becoming a new `packages/app` export (1078 Q&A).
 */
export type FleetProcessStatus = 'running' | 'stopped' | 'errored' | 'unknown';

/** Map a `SupervisorService` process status onto {@link FleetProcessStatus}. */
export function mapServerStatus(status: string): FleetProcessStatus {
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
export function errorText(raw: unknown): string | undefined {
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
export async function runAgentLifecycle(
    action: 'start' | 'stop',
    agentId: string,
    options: { server: string; json?: boolean; jsonEnvelope?: boolean },
    context: CliContext,
): Promise<number> {
    let res: Response;
    let body: { ok?: boolean; error?: unknown; pid?: number; status?: string };
    try {
        const url = `${options.server}/agents/${encodeURIComponent(agentId)}/${action}`;
        res = await (_testFetch ?? fetch)(url, {
            method: 'POST',
            // The server's hono `csrf()` middleware admits only a same-origin request: a bare
            // Bun fetch sends no `Origin`/`Sec-Fetch-Site`, is read as `text/plain`, and is
            // answered 403 — so `agent start|stop` could never reach the supervisor, no matter
            // how the server URL was resolved. The CLI is a same-origin local client, so it
            // sends the `Origin` such a caller would send.
            headers: { Origin: new URL(options.server).origin },
            signal: AbortSignal.timeout(3000),
        });
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
    claimed: InboxClaim[],
    outcome: 'accepted' | 'not-started',
): Promise<void> {
    if (claimed.length === 0) return;
    const inbox = new InboxService({ getDb: () => context.getDb() });
    if (outcome === 'accepted') {
        await inbox.settle(claimed, 'accepted');
        return;
    }
    // Not started: release within the claim budget, else a queryable terminal failure.
    const releasable: InboxClaim[] = [];
    const exhausted: InboxClaim[] = [];
    for (const claim of claimed) {
        const row = await inbox.get(claim.id);
        // Already settled on another path (e.g. the live stdin-injection delivery)
        // or gone — never re-settle someone else's row.
        if (row?.status !== 'claimed' || row.attempts !== claim.attempts) continue;
        if (row.attempts >= MAX_DELIVERY_ATTEMPTS) exhausted.push(claim);
        else releasable.push(claim);
    }
    if (releasable.length > 0) await inbox.release(releasable);
    if (exhausted.length > 0) {
        await inbox.settle(
            exhausted,
            'not-started',
            `delivery not accepted: invocation never started after ${MAX_DELIVERY_ATTEMPTS} inject attempts`,
        );
    }
}

/**
 * Drain pending inbox messages for the addressed agent spec and prepend them to
 * the prompt — or, with `--spec` alone, just address the occupant without
 * touching the inbox. Returns possibly-rewritten flags (with `--agent` mapped
 * from spec id to the spec's executor name when a spec is found; a spec without
 * an executor field fails).
 *
 * R1 (0542): the spec id is read from `--spec <id>` (canonical). A spec id
 * passed to the legacy `--agent <spec-id>` is still accepted as fallback
 * addressing; the deprecation warning was retired by 0849 once the flag-spec-id
 * scan proved no caller remains. `spec-id` is
 * set BEFORE the rewrite so AgentService.executeRun can persist an occupant pin
 * (ADR-057 wave 1 R1) — the flag survives even when the inbox is empty, because
 * runAgentLoop relies on it.
 */
export async function drainIntoPrompt(
    prompt: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
): Promise<{
    prompt: string | undefined;
    flags: Record<string, string | boolean>;
    claimed: InboxClaim[];
    /** Claimed rows' request keys (G71 R1) — a `fleet:task:*` key selects the keyed drain path. */
    requestKeys?: Array<string | null>;
}> {
    const specFlag = typeof flags.spec === 'string' ? flags.spec : '';
    const agentFlag = typeof flags.agent === 'string' ? flags.agent : '';
    const recipient = specFlag !== '' ? specFlag : agentFlag;
    if (recipient === '' || recipient === 'auto') {
        context.output.error('--drain requires an explicit --spec <id> matching a message recipient');
        return { prompt, flags, claimed: [] };
    }

    const coordination = new AgentCoordinationService(context);
    const spec = (await coordination.listAgentSpecs()).find((entry) => entry.id === recipient);
    const flagsOut =
        spec === undefined ? flags : { ...flags, 'spec-id': spec.id, agent: drainAgentSelector(spec, context) };

    // `--spec` without `--drain`: address the occupant, leave the inbox alone.
    if (flags.drain !== true) return { prompt, flags: flagsOut, claimed: [] };

    // G11 R5/R10: the drain claims through InboxService — the single writer charges the delivery
    // budget and writes each row's `message.claimed` event in the same transaction.
    const claimedRows = await new InboxService({ getDb: () => context.getDb() }).claim(
        recipient,
        flags.singleMessage === true ? 1 : 100,
    );
    if (claimedRows.length === 0) return { prompt, flags: flagsOut, claimed: [] };

    const header = claimedRows.map((m) => `- ${m.fromId || 'operator'}: ${m.body}`).join('\n');
    const block = `Pending messages:\n${header}`;
    const merged = prompt === undefined ? block : `${block}\n\n${prompt}`;
    const claimed = claimedRows.map(({ id, attempts }) => ({ id, attempts }));
    // G71 R1: a claimed fleet dispatch names its task, so the run's completion receipt
    // (`coordination_runs.task_id`) is attributable and the strategy's freshness read
    // sees the attempt. A keyless drain leaves `task` untouched.
    const fleetTask = claimedRows
        .map((message) => message.taskId ?? /^fleet:task:([^:]+):[1-9][0-9]*$/.exec(message.requestKey ?? '')?.[1])
        .find((wbs) => wbs !== undefined);
    // 1076 R3 (ADR-132): a workflow dispatch key `<runId>/<state>` names the run that dispatched
    // this turn, which is the lineage edge `spur agent trace` walks. The fleet's own
    // `fleet:task:<wbs>:<n>` keys are retry attempts, not lineage, so they are excluded.
    const parentRunId = claimedRows
        .map((message) => message.parentRunId ?? /^([^:/][^/]*)\/[^/]+$/.exec(message.requestKey ?? '')?.[1])
        .find((runId) => runId !== undefined);
    // 0833: the same ids ride into executeRun as the requestMessage flag (comma-
    // joined, dual spelling per the sessionDir convention) so the exit sink can
    // persist the run↔message receipt.
    const requestMessage = claimed.map((claim) => claim.id).join(',');
    // G71 R1: the loop decides between the stdin path and the run path from the batch's
    // request keys, so the claimed rows' keys ride out with the drain result.
    const requestKeys = claimedRows.map((message) => message.requestKey);
    return {
        prompt: merged,
        flags: {
            ...flagsOut,
            requestMessage,
            'request-message': requestMessage,
            ...(fleetTask !== undefined ? { task: fleetTask } : {}),
            ...(parentRunId !== undefined ? { parentRunId, 'parent-run-id': parentRunId } : {}),
        },
        claimed,
        requestKeys,
    };
}

/**
 * Resolve the `--agent` selector for a drained spec (0537, feature B2).
 *
 * A spec materialized with an `executor` name routes through that executor so the
 * operator's model + tier binding survives drain (R2). A dangling executor —
 * renamed or removed from `agent.executors` — fails loudly instead of silently
 * falling back to a bare binary on the default model (R5): the error names the
 * spec and the missing executor, and no process spawns. A spec with no executor
 * field also fails before spawn, naming the field to add.
 */
export function drainAgentSelector(spec: AgentSpec, context: CliContext): string {
    if (spec.executor === undefined) {
        // The spec-without-executor-field fallback to `spec.type` was removed: drain needs an
        // explicit executor binding so the operator's model + tier survive.
        throw new Error(
            `Spec "${spec.id}" has no executor field — add \`executor: <name>\` (an agent.executors entry) to the spec under .spur/agents/ or re-materialize it, then drain again`,
        );
    }
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
/** Parse the `--poll` backstop timeout; falls back to the default for non-positive/non-numeric input. */
export function parseLoopPoll(raw: string | boolean | undefined): number {
    if (typeof raw !== 'string') return DEFAULT_LOOP_POLL_MS;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_LOOP_POLL_MS;
}

/** Parse the `--timeout` flag as a positive-integer ms value, or undefined. */
export function parseTimeout(raw: string | boolean | undefined): number | undefined {
    if (raw === undefined || typeof raw === 'boolean') return undefined;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`invalid --timeout "${raw}" (expected a positive integer ms)`);
    }
    return n;
}

/** Build the fleet strategy runtime (coordination + delivery seams) over this CLI context. */
export async function makeFleetRuntime(context: CliContext): Promise<StrategyRuntime> {
    const coordination = new AgentCoordinationService(context);
    return new StrategyRuntime({
        openDb: () => context.getDb(),
        tasks: await makeService(context, undefined, true),
        fleet: new FleetService({
            spurConfig: await context.loadAgentConfig(context.cwd),
            roles: context.agentRoles,
            fs: context.fs,
            openDb: () => context.getDb(),
        }),
        // G71 R1: the one fleet dispatch primitive the strategy enqueues through —
        // without it a tick has decisions but no dispatch path, so it refuses loudly.
        dispatcher: new FleetDispatcher({
            coordination,
            runs: {
                listByMessageId: async (messageId: string) =>
                    new CoordinationRunDao(await context.getDb()).listByMessageId(messageId),
            },
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
        // G11 R3: guest leases expire on the write side of the tick, beside the reconcile. The
        // requests read no longer terminates a guest, so this is the one owner of that write.
        guestExpiry: async () => await guestService(context).expire(),
    });
}

/**
 * `spur agent loop --spec <id> [--poll <ms>]` — the self-draining wrapper the supervisor
 * spawns (0258 R6). The loop itself lives in `@gobing-ai/spur-app`
 * (`services/agent-loop-service.ts`, task 0968); this transport keeps the `--spec`
 * validation, `--poll` parsing, and the CLI-only collaborator bindings.
 */
export async function runAgentLoop(
    context: CliContext,
    flags: Record<string, string | boolean>,
    runtime: AgentLoopRuntime = {},
    deps?: AgentRunDeps,
): Promise<number> {
    const recipient = typeof flags.spec === 'string' ? flags.spec : '';
    if (recipient === '' || recipient === 'auto') {
        context.output.error('agent loop requires an explicit --spec <id> matching a fleet agent spec');
        return 2;
    }
    const pollMs = parseLoopPoll(flags.poll);
    const fleet = new FleetService({
        fs: context.fs,
        spurConfig: await context.loadAgentConfig(context.cwd),
        roles: context.agentRoles,
        openDb: () => context.getDb(),
    });
    const loopDeps: AgentLoopDeps = {
        cwd: context.cwd,
        getDb: () => context.getDb(),
        write: (text) => context.output.write(text),
        error: (text) => context.output.error(text),
        agentService: (bus) => context.agentService({ events: bus }),
        fleet,
        // 1076 R2: a supervised loop is a child process, so the run tag crosses as a stdout control line.
        setSupervisorRun: (_agentId, runId) => context.output.write(`${SUPERVISOR_RUN_MARKER}${runId ?? ''}`),
        makeStrategyRuntime: () => makeFleetRuntime(context),
        listAgentSpecs: () => new AgentCoordinationService(context).listAgentSpecs(),
        reconciler: new DeliveryReconciler(context),
        drain: (drainFlags) => drainIntoPrompt(undefined, context, { ...drainFlags, drain: true }),
        settle: (claimed, outcome) => settleClaimedMessages(context, claimed, outcome),
        attachLedger: (bus) => attachSystemEventLedger(bus, context),
        memberSession: {
            executors: context.agentConfig?.executors ?? [],
            env: context.env,
            getDb: () => context.getDb(),
            warn: (message) => context.output.error(message),
        },
    };
    return runAgentLoopCore(loopDeps, { recipient, pollMs, flags, runtime, runDeps: deps });
}
