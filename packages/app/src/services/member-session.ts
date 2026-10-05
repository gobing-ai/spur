import { randomUUID } from 'node:crypto';
import {
    type DbAdapter,
    MEMBER_SESSION_RESET_EVENT,
    RunSessionDao,
    readMemberSessions,
    recordMemberSession,
    SystemEventDao,
} from '@gobing-ai/spur-domain';
import {
    type AgentProcessOptions,
    type AgentSpec,
    buildAgentCommand,
    getAgentSessionCapability,
    getAgentShim,
    resolveAgentName,
    TeamAgentProcess,
} from '@gobing-ai/ts-ai-runner';
import type { SessionCapabilityRecord } from './capability-attestation';

// ── Member session state (G66 / task 0896, design §6) ───────────────────────────

/**
 * How one fleet member keeps its coding-agent session across inbox drains
 * (G66 R1): `persistent` feeds every drained prompt into one long-lived
 * `TeamAgentProcess` over stdin, `resume` re-opens the previous drain's
 * session id, and `one-shot` keeps today's fresh process per drain. The mode
 * is chosen ONCE from the executor's runner capability record — the drain
 * path carries no per-agent branches.
 */
export type MemberSessionMode = 'persistent' | 'resume' | 'one-shot';

/**
 * Why a member session was deliberately reset (G66 R4): `restart` — the
 * member's persistent agent process exited under the supervisor's unchanged
 * restart policy; `operator` — `spur agent stop`/serve shutdown ended the
 * loop process; `failed-drains` — {@link MAX_CONSECUTIVE_FAILED_DRAINS}
 * consecutive drains failed. The loop's run record names the reason.
 */
export type MemberSessionResetReason = 'restart' | 'operator' | 'failed-drains';

/**
 * Structural subset of the runner's `TeamAgentProcess` the loop drives in
 * `persistent` mode (G66 R2). Declared as an interface so tests can stub the
 * process without spawning a real agent CLI.
 */
export interface MemberAgentProcess {
    start(): Promise<void>;
    stop(): Promise<void>;
    send(message: string): Promise<{ ok: boolean }>;
    getStatus(): 'running' | 'stopped' | 'errored';
    getExitCode(): number | null;
}

/**
 * Bounded failure budget for one member session (G66 R4/R7, constant per the
 * design — the threshold deliberately does not vary): this many consecutive
 * failed drains mark the session poisoned and reset it before the next drain.
 */
export const MAX_CONSECUTIVE_FAILED_DRAINS = 3;

/**
 * Whether the resolved member argv selects a persistent-stdin dispatch mode —
 * a process that keeps reading dispatch turns from stdin — rather than a
 * one-shot print argv (prompt carried in argv, process exits after its turn).
 *
 * The selector's presence is the honest discriminator: runner ≥ B8 wires the
 * persistent shims as `--mode rpc` (pi/omp) and `-p --input-format stream-json`
 * (claude — its CLI requires print for stream-json input, so `-p` alone is not
 * a hard negative). An argv with NO stdin-dispatch selector (every legacy
 * one-shot print argv, e.g. `--no-session -p '<preamble>' --mode text`) keeps
 * the gate shut: a `TeamAgentProcess` spawned from it cannot accept later
 * stdin sends (Review P2), so the mode degrades to resume instead.
 */
export function selectsPersistentStdinDispatch(argv: readonly string[]): boolean {
    let stdinDispatch = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--input-format' && argv[i + 1] === 'stream-json') stdinDispatch = true;
        else if (argv[i] === '--mode' && argv[i + 1] === 'rpc') stdinDispatch = true;
    }
    return stdinDispatch;
}

/** Structural seams the member session needs — supplied by the calling transport. */
export interface MemberSessionDeps {
    /** `agentConfig?.executors`: executor name → agent binary lookup. */
    executors: readonly { name: string; agent?: string }[];
    env: Record<string, string | undefined>;
    getDb(): Promise<DbAdapter>;
    /** Warning sink — lifetime warnings and reset notices go here (CLI: `output.error`). */
    warn(message: string): void;
    /**
     * Test seam: overrides the `TeamAgentProcess` persistent member mode
     * spawns (never invoked in `resume`/`one-shot` modes). Default: the
     * runner's process class directly.
     */
    processFactory?: (options: AgentProcessOptions) => MemberAgentProcess;
    /**
     * Test seam: overrides the runner session-capability lookup, so the
     * `member-persistent-stdin-unwired` degrade (a record that vouches for
     * persistent stdin while the installed shim dispatches a one-shot argv) is
     * reachable without a runner that mis-declares the capability. Default:
     * the runner's `getAgentSessionCapability`.
     */
    sessionCapability?: (canonical: string) => SessionCapabilityRecord;
}

/**
 * Build the member's identity-preamble dispatch command via the shared runner
 * command seam — the argv the argv-shape gate inspects at mode resolution and
 * the persistent spawn itself uses.
 */
function memberDispatchCommand(
    spec: AgentSpec,
    canonical: Parameters<typeof buildAgentCommand>[0],
    persistentStdin: boolean,
) {
    return buildAgentCommand(
        canonical,
        {
            // The persistent candidate argv (`--mode rpc` / stream-json input):
            // both the argv-shape gate (below) and the actual member spawn must
            // probe/drive the stdin-listener dispatch, never the one-shot print
            // argv the shim falls back to without this flag.
            ...(persistentStdin ? { persistentStdin: true } : {}),
            purpose: spec.purpose,
            ...(typeof spec.config.systemPrompt === 'string' && spec.config.systemPrompt.length > 0
                ? { systemPrompt: spec.config.systemPrompt }
                : {}),
        },
        { workspace: spec.workspace },
    );
}

/**
 * Build the `TeamAgentProcess` options for a persistent member (G66 R2): the
 * same shared command-build seam the runner's orchestrator uses, so the
 * long-lived member gets the runner's canonical identity-preamble argv.
 */
function memberProcessOptions(spec: AgentSpec, binary: string, deps: MemberSessionDeps): AgentProcessOptions {
    const canonical = resolveAgentName(binary);
    if (canonical === undefined) {
        throw new Error(
            `member ${spec.id}: agent binary "${binary}" is unknown to the runner — persistent stdin unavailable`,
        );
    }
    const command = memberDispatchCommand(spec, canonical, true);
    // The shim's persistent-stdin framing (rpc dialect for pi/omp, claude's
    // stream-json envelope) wraps every sent prompt for the long-lived process.
    const shim = getAgentShim(canonical);
    return {
        spec,
        command: [command.command, ...command.args],
        cwd: spec.workspace,
        ...(shim.persistentStdinProtocol !== undefined ? { stdinFramer: shim.persistentStdinProtocol.frame } : {}),
        env: Object.fromEntries(
            Object.entries(deps.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
    };
}

/**
 * Read the session id one drained run produced (G66 R1, resume mode): the
 * E6 run→session mapping the invoke boundary observed (exact rows only — an
 * unresolved mapping carries no session id and the next drain stays fresh).
 */
async function drainedSessionId(db: DbAdapter, runId: string): Promise<string | undefined> {
    const rows = await new RunSessionDao(db).getByRunId(runId);
    const exact = rows.find((row) => row.exactness === 'exact' && row.session_id !== null);
    return exact?.session_id ?? undefined;
}

/**
 * One fleet member's coding-agent session across the agent loop's lifetime
 * (G66 / task 0896, design §6): the resolved mode, the resume id, the live
 * persistent process, and the failed-drain budget. The agent loop owns the
 * instance; every deliberate reset writes one
 * `fleet.member-session-reset` ledger row naming the reason, and the stderr
 * line is `member session: reset for <recipient> (reason: <reason>)`.
 */
export class MemberSession {
    mode: MemberSessionMode = 'one-shot';
    /** Resume mode: the previous drain's session id (undefined until one is observed). */
    id?: string;
    /** Persistent mode: the member's agent process (undefined until the first drained prompt). */
    process?: MemberAgentProcess;
    /** Consecutive failed drains since the last success/reset (G66 R4/R7). */
    private failedDrains = 0;

    constructor(
        private readonly deps: MemberSessionDeps,
        readonly recipient: string,
    ) {}

    /**
     * The runner-known agent binary a member's executor resolves to (G66 R1): an
     * executor entry's `agent` field names the binary; a bare spec type (legacy
     * specs without an executor field) IS the binary.
     */
    binary(spec: AgentSpec): string {
        const executorName = spec.executor ?? spec.type;
        const executorEntry = this.deps.executors.find((entry) => entry.name === executorName);
        return executorEntry?.agent ?? executorName;
    }

    /**
     * Resolve the member session mode from the executor's capability record
     * (G66 R1): `supportsPersistentStdin` wins, then `supportsResumeById`, then
     * the one-shot fallback. An agent binary unknown to the runner has no record
     * and degrades to one-shot. Persistent still requires
     * {@link selectsPersistentStdinDispatch} on the real dispatch argv; otherwise
     * the mode degrades with one `member-persistent-stdin-unwired` warning.
     * Sets {@link mode} and returns it — the loop resolves ONCE per lifetime.
     */
    resolveMode(spec: AgentSpec): MemberSessionMode {
        const binary = this.binary(spec);
        const canonical = resolveAgentName(binary);
        if (canonical === undefined) return 'one-shot';
        const record = (this.deps.sessionCapability ?? getAgentSessionCapability)(canonical);
        if (record.supportsPersistentStdin) {
            const dispatch = memberDispatchCommand(spec, canonical, true);
            if (selectsPersistentStdinDispatch([dispatch.command, ...dispatch.args])) return 'persistent';
            // Honest degrade (Review P2): the record vouches for the agent CLI, but
            // the installed shim dispatches a one-shot print argv — a persistent
            // process would exit after its preamble, so later sends would either
            // fail (3-strike reset cycle) or settle rows `delivered` unexecuted.
            // Exactly one warning per member lifetime (the G66 R3 discipline),
            // then the resume path.
            this.deps.warn(
                `Warning: member-persistent-stdin-unwired: agent "${binary}" declares persistent-stdin capability but the installed runner shim dispatches a one-shot print argv — member session degrades to ${record.supportsResumeById ? 'resume-by-id' : 'one-shot'} (G66; one warning per member lifetime)`,
            );
        }
        if (record.supportsResumeById) return 'resume';
        return 'one-shot';
    }

    /**
     * Resolve the session mode once per loop lifetime (G66 R1/R3) and mirror it
     * to the ledger (0897). A one-shot member gets exactly one
     * `member-no-session` warning — the loop process IS the member's lifetime.
     */
    async start(spec: AgentSpec): Promise<void> {
        this.mode = this.resolveMode(spec);
        // G71 R3: a RESUME member re-opens the conversation its last drain recorded. The
        // exact id already lives in the `fleet.member-session` ledger (recordDrain writes it),
        // so a restart seeds from that observation instead of losing it to process memory.
        // ORDER MATTERS: seed BEFORE mirroring the mode below — the mirror writes a fresh
        // `fleet.member-session` row, and a row without the id would become the latest
        // observation and hide the id this seeding exists to recover.
        // Persistent members carry no id (the live process IS the session) and one-shot
        // members never resume, so neither seeds here.
        if (this.mode === 'resume') {
            const observation = (
                await readMemberSessions(await this.deps.getDb(), [this.recipient]).catch(() => undefined)
            )?.get(this.recipient);
            if (observation?.id !== undefined && observation.id !== '') {
                this.id = observation.id;
            }
        }
        // 0897: mirror the resolved mode to the ledger so the fleet
        // snapshot / process entries / CLI can show it. Observability
        // only — a failed write never blocks the drain loop. The seeded id rides along so the
        // mirror never erases the resume identity it just recovered.
        await recordMemberSession(await this.deps.getDb(), this.recipient, {
            mode: this.mode,
            ...(this.id !== undefined ? { id: this.id } : {}),
        }).catch(() => undefined);
        if (this.mode === 'one-shot') {
            // G66 R3: exactly one warning per member lifetime — the loop
            // process IS the member's lifetime, not one per drain.
            this.deps.warn(
                `Warning: member-no-session: agent "${this.binary(spec)}" declares neither persistent stdin nor resume-by-id — each inbox drain runs a fresh one-shot session (G66; one warning per member lifetime)`,
            );
        }
    }

    /**
     * Return the member's live persistent process, resetting the session first
     * when the previous one exited between drains (G66 R2/R4: the exit is
     * reported and recorded under reason `restart`; the supervisor's restart
     * policy itself stays untouched), then start a fresh process.
     */
    async ensureProcess(spec: AgentSpec): Promise<MemberAgentProcess> {
        const existing = this.process;
        if (existing !== undefined) {
            if (existing.getStatus() === 'running') return existing;
            await this.reset('restart', { exitCode: existing.getExitCode() });
        }
        const factory = this.deps.processFactory ?? ((options: AgentProcessOptions) => new TeamAgentProcess(options));
        const process = factory(memberProcessOptions(spec, this.binary(spec), this.deps));
        await process.start();
        this.process = process;
        return process;
    }

    /**
     * Deliberately reset the member session (G66 R4): stop a still-running
     * persistent process, clear the resume id, and write the run record — one
     * `fleet.member-session-reset` ledger row naming the reset reason.
     */
    async reset(reason: MemberSessionResetReason, detail: Record<string, unknown> = {}): Promise<void> {
        const process = this.process;
        if (process !== undefined && process.getStatus() === 'running') {
            await process.stop().catch(() => undefined);
        }
        this.process = undefined;
        this.id = undefined;
        await new SystemEventDao(await this.deps.getDb()).insert({
            id: randomUUID(),
            event_name: MEMBER_SESSION_RESET_EVENT,
            occurred_at: new Date().toISOString(),
            actor: this.recipient,
            payload_json: JSON.stringify({ reason, mode: this.mode, ...detail }),
        });
        this.deps.warn(`member session: reset for ${this.recipient} (reason: ${reason})`);
    }

    /**
     * Failed-drain budget + resume capture (G66 R4/R7/R1): at the bounded limit
     * of consecutive failed drains the poisoned session resets deliberately (run
     * record names the reason) and the counter restarts with the fresh session.
     * Below the limit a resume drain captures the session id its run produced so
     * the next drain resumes it.
     */
    async recordDrain(failed: boolean, exitRunId: string | undefined): Promise<void> {
        this.failedDrains = failed ? this.failedDrains + 1 : 0;
        if (this.failedDrains >= MAX_CONSECUTIVE_FAILED_DRAINS) {
            await this.reset('failed-drains', { failedDrains: MAX_CONSECUTIVE_FAILED_DRAINS });
            this.failedDrains = 0;
        } else if (this.mode === 'resume' && exitRunId !== undefined) {
            const sessionId = await drainedSessionId(await this.deps.getDb(), exitRunId);
            if (sessionId !== undefined) {
                this.id = sessionId;
                await recordMemberSession(await this.deps.getDb(), this.recipient, {
                    mode: 'resume',
                    id: sessionId,
                }).catch(() => undefined);
            }
        }
    }

    /** Whether the session carries live state the loop shutdown must name a reset for (G66 R4). */
    hasLiveState(): boolean {
        return this.process !== undefined || this.id !== undefined;
    }
}
