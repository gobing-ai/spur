import { isatty } from 'node:tty';
import { type ExecutorAvailability, normalizeExecutorAvailability, type SpurConfig } from '@gobing-ai/spur-config';
import {
    type CapabilityTier,
    type CoordinationRun,
    CoordinationRunDao,
    type DbAdapter,
    type OccupantRef,
    type StageModelPolicy,
} from '@gobing-ai/spur-domain';
import { AgentDetector, type AgentName, type AgentRunResult, AiRunner, DoctorRunner } from '@gobing-ai/ts-ai-runner';
import type { EventBus } from '@gobing-ai/ts-infra';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { NodeProcessExecutor, type OutputPolicy, type ProcessRegistry } from '@gobing-ai/ts-runtime';
import type { DecisionCorrelation } from '../decision/decision-events';
import type { AgentExecutionOptions } from '../observability/agent-execution';
import { toEnvelopeJson } from '../output/envelope';
import { parseArtifactRefs } from './agent-invocation-sanitize';
import { AgentResolver } from './agent-resolver';
import { booleanFlag, jsonEnvelopeFlag, stringFlag } from './agent-run-flags';
import { type NormalizedAgentUsage, normalizeAgentUsage } from './agent-usage';
import type { AgentExecutorConfig } from './executor-tier';
import type { RunSessionObserver } from './run-session-observer';

export { _resetAgentServiceShimsForTest } from './agent-resolver';

import { AgentDoctorOps } from './agent-doctor-ops';
import { AgentRunExecutor } from './agent-run-executor';

export type { DoctorUsageInfo } from './agent-doctor-report';
export { executorFingerprint } from './agent-doctor-report';
export { PidObservingProcessExecutor, RolePropagatingProcessExecutor } from './agent-run-executor';

// Re-exported so the six existing `AgentExecutorConfig` importers stay untouched (0965 R3).
export type { AgentExecutorConfig } from './executor-tier';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Runtime dependencies injectable for tests. */
export interface AgentRunDeps {
    runner?: AiRunner;
    detector?: AgentDetector;
    doctorRunner?: DoctorRunner;
    /** Test seam (B4/0683 Q1): filesystem for the detection cache; defaults to the context cwd. */
    fileSystem?: FileSystem;
    /** Test seam (B4/0683 Q1): clock for cache TTL; defaults to Date.now. */
    now?: () => number;
    /**
     * Test seam (feature E6): override the run→session observer factory.
     * Receives the minted run id; default constructs a RunSessionObserver
     * bound to the service context (DB, output, home, overlap registry).
     */
    sessionObserverFactory?: (runId: string) => RunSessionObserver;
}

/**
 * The `agent` config block consumed by resolution. Structurally compatible with
 * the CLI's validated `agent` section; threaded in via {@link AgentServiceContext}.
 * Absent → resolution behaves exactly as the legacy Tier-1 priority path.
 *
 * `roles` (0572): optional per-role tier/stage overrides over the
 * `DEFAULT_AGENT_ROLES` SSOT (packages/config); the CLI boundary merges them
 * before threading {@link AgentServiceContext.roles}, so resolution never
 * reads this field — it rides here only so the validated section passes through
 * the CLI context unchanged.
 */
export interface AgentConfig {
    default?: string;
    executors?: AgentExecutorConfig[];
    roles?: Record<string, { tier?: CapabilityTier; stages?: string[] }>;
    sessionAffinity?: boolean;
}

/** How an `auto` resolution chose its agent — carried for diagnostics/tests. */
export type AgentResolveSource = 'stage' | 'phase' | 'default' | 'priority' | 'explicit' | 'role';

/**
 * Stage context carried on a stage-sourced resolution so {@link executeRun} can
 * auto-escalate on objective failure without operator involvement (0407).
 * Bundles the policy, the executor name that won (for `from-executor` on
 * re-resolve), and that executor's tier (for `getNextFallback` step-1).
 */
export interface StageEscalationContext {
    stageId: string;
    policy: StageModelPolicy;
    executorName: string;
    executorTier: CapabilityTier;
}

/**
 * Result of resolving an execution profile from `--agent` + prompt + config.
 * On success carries the canonical {@link AgentName}, an optional model override
 * (applied only when the user passed no explicit `--model`), the resolution
 * source for diagnostics, and — for stage-sourced resolutions — the escalation
 * context {@link executeRun} uses to retry on objective failure (0407).
 */
export type AgentResolveResult =
    | {
          ok: true;
          agent: AgentName;
          model?: string;
          source: AgentResolveSource;
          stage?: StageEscalationContext;
          /** Role selector that produced this resolution (source `role`, 0536 R1). */
          role?: string;
          /** Whether the role was declared by the caller or inherited via SPUR_ROLE (0551). */
          roleOrigin?: 'declared' | 'inherited';
          /** Tier the role's row declares in the Layer-1 role table (DEFAULT_AGENT_ROLES SSOT, 0572/ADR-061; source `role`). */
          tier?: CapabilityTier;
          /** Executor entry name that won — role resolution or an executor pin. */
          executor?: string;
      }
    | { ok: false; exitCode: number; message: string };
/**
 * Result from {@link AgentService.runCapture} — exit code + captured answer text,
 * plus the diagnostic fields needed to build a timeout/failure handoff artifact
 * (R2b / G2): `durationMs` and `signal` are forwarded from the underlying
 * `AgentRunResult` (previously discarded here), `stderr` likewise. On a
 * validation failure (e.g. bad `--mode`) that never reaches the subprocess,
 * these are all `undefined`/`0`.
 */
export interface AgentRunCaptureResult {
    exitCode: number;
    answer: string;
    /** Wall-clock subprocess duration in ms, when available (R2b). */
    durationMs?: number;
    /** Termination signal when the subprocess was killed (e.g. timeout), if any (R2b). */
    signal?: string;
    /** Captured stderr, when available (R2b). */
    stderr?: string;
}

/**
 * Resolved agent invocation captured before dispatch (R1 / task 0295).
 *
 * Persists in the workflow run trace so a stalled or failed `agent.run` can be
 * reconstructed after the fact: which agent, which resolved argv (including the
 * translated slash-command), which cwd/mode/timeout, and whether the subprocess
 * was permitted to inherit the TTY. Prompt-bearing argv entries are reduced to
 * a trace-safe command summary before persistence; arbitrary prompts, purpose
 * preambles, system prompts, and secret-like flag values never enter the trace.
 */
export interface AgentRunInvocation {
    /** Canonical agent name (post-resolution). */
    agent: AgentName;
    /** Resolution source — stage/default/priority/explicit/role. */
    source: AgentResolveSource;
    /** Role selector that produced this resolution (source `role`, 0536 R1). */
    role?: string;
    /** Origin of the effective role — declared or inherited via SPUR_ROLE (0551). */
    roleOrigin?: 'declared' | 'inherited';
    /** Tier the role's row declares in the Layer-1 role table (DEFAULT_AGENT_ROLES SSOT, 0572/ADR-061; source `role`). */
    tier?: CapabilityTier;
    /** Executor entry name that won — role resolution or an executor pin. */
    executor?: string;
    /** Shim executable (e.g. `claude`, `codex`). */
    command: string;
    /** Resolved argv (post slash-command translation). */
    argv: string[];
    /** Working directory passed to the subprocess; undefined = inherit. */
    cwd?: string;
    /** Output mode. */
    mode: 'text' | 'json';
    /** Process output policy selected for this dispatch. */
    /** How child stdout/stderr was captured: buffered, TTY stream, or pipe-no-TTY (H83). */
    outputMode: 'buffered' | 'stream' | 'pipe';
    /** Effective timeout in ms; undefined = no timeout. */
    timeoutMs?: number;
    /** Effective continue flag (session latch). */
    continue: boolean;
    /** Whether stdin can read from an interactive terminal. Always false for one-shot runs. */
    stdinInteractive: boolean;
    /** Optional model override (explicit `--model` or executor-resolved). */
    model?: string;
    /**
     * Original prompt when a Claude-style slash command was translated to the
     * agent's dialect (e.g. `/sp:dev-run` → `/skill:sp-dev-run` on pi/omp).
     * Undefined when the prompt was passed through verbatim. Diagnostic only —
     * `argv` already contains the translated form. Arguments are redacted.
     */
    translatedFrom?: string;
    /**
     * Agent session/conversation id, when the agent exposes one. Used as the
     * primary join key connecting a workflow `agent.run` step to imported
     * history ETL records (R1a). Undefined when the agent does not expose a
     * session id — the heuristic time-window fallback (R1b) applies.
     */
    sessionId?: string;
}

/**
 * Result of {@link AgentService.runTraced} — a pipeline-oriented variant that
 * forces non-interactive (pipe-no-TTY) execution and returns the resolved invocation
 * alongside captured stdout/stderr and the diagnostic fields needed for the
 * partial-work handoff artifact (R2b / G2) and the workflow run trace (R1).
 *
 * On a validation failure (bad `--mode`, missing prompt, unknown agent) that
 * never reaches the subprocess, `invocation` is `undefined` and `exitCode`
 * reflects the validation error (typically 2); `stdout` is empty.
 */
export interface AgentRunTracedResult {
    /** Final mapped exit code (0 success, 3 agent failure, 2 validation error). */
    exitCode: number;
    /** Resolved invocation; absent only when validation failed before resolution. */
    invocation?: AgentRunInvocation;
    /** Captured agent stdout (accumulated for return; child uses pipe-no-TTY when nonInteractive). */
    stdout: string;
    /** Captured agent stderr, when available. */
    stderr?: string;
    /** Subprocess wall-clock duration in ms, when available. */
    durationMs?: number;
    /** Termination signal when the subprocess was killed (timeout/abort), if any. */
    signal?: string;
    /** Validation/dispatch error message (exitCode 2). */
    message?: string;
    /**
     * Normalized usage measurement (task 0707 R3). Set only when a dispatch ran;
     * absent for validation failures that never reached the subprocess. The
     * runner currently exposes no typed usage, so successful dispatches carry
     * the honest `unavailable` shape — never zero.
     */
    usage?: NormalizedAgentUsage;
}

/** Output sink injected into AgentService. */
export interface AgentServiceOutput {
    write(message: string): void;
    error(message: string): void;
}

/**
 * A Layer-1 role as declared in the `DEFAULT_AGENT_ROLES` SSOT (task 0572 / ADR-061;
 * `plugins/sp/references/roles.md` survives as a parity-gated projection).
 *
 * `stages` lists the canonical stage ids the role folds. It is not decoration:
 * it is how a dispatch that declares only a role still reaches the stage
 * registry's `model_policy`, and with it the escalation/fallback ladder. The
 * role's `tier` may not sit below the highest `min_tier` among these stages —
 * `plugins/sp/tests/roles.test.ts` R4 enforces that, which is what makes
 * deriving a stage from a role safe (it can never start cheaper than the role).
 */
export interface AgentRoleDefinition {
    tier: CapabilityTier;
    stages: readonly string[];
}

/** Context injected into AgentService. */
export interface AgentServiceContext {
    cwd: string;
    fs?: FileSystem;
    env: Record<string, string | undefined>;
    output: AgentServiceOutput;
    /**
     * Catalog rescue for a dispatch failure no `FAILURE_RULES` entry matched (task 1264 R4).
     *
     * The executor hands the RAW `stderr + "\n" + stdout` and never a network client, so the
     * composition root — the only place that reads `workflows.executorFailureDecisionMaker` —
     * owns redaction, the evidence tail and the decision call. Absent (the default) keeps the
     * narrow rule-based behaviour. A `resource-exhaustion`/`auth` answer enters the 1260
     * escalation path unchanged; `undefined` (declined, uncertain, or thrown) means no rescue,
     * so a rescue can never fail a run differently than it would have without one.
     */
    classifyUnmatchedFailure?: (
        evidence: string,
        correlation: DecisionCorrelation,
    ) => Promise<'resource-exhaustion' | 'auth' | undefined>;
    /**
     * Validated `agent` config block (executors + phase map). Optional — when
     * absent (un-init'd CLI, tests), `--agent auto` resolves via the legacy
     * Tier-1 priority path with no config lookup.
     */
    agentConfig?: AgentConfig;
    /**
     * Provenance of `roles` (R3): 'fallback' iff no config layer supplied an
     * `agent.roles` table. Absent → treated as 'config' (no fallback note).
     */
    rolesSource?: 'config' | 'fallback';
    /**
     * Layer-1 role map resolved at the CLI boundary (0536 R1) from the
     * `DEFAULT_AGENT_ROLES` SSOT (0572 / ADR-061) merged with the project's
     * `agent.roles` override. Absent → role selectors are not recognized
     * and fall through to the executor / binary lookup.
     */
    roles?: ReadonlyMap<string, AgentRoleDefinition>;
    /**
     * Optional canonical server EventBus. When provided, every `agent.invoke.*`
     * and `agent.*` event emitted by the underlying AiRunner
     * is also forwarded onto the bus so the system_events tap (R3) and SSE
     * stream can observe it. Same shape as `SystemEventBus`.
     */
    events?: EventBus<Record<string, (event: unknown) => void>>;
    /**
     * Optional shared ProcessRegistry (ts-runtime 0.4.10 / spur#0264). When set,
     * one-shot agent runs appear in the serve-local process watch list alongside
     * supervisor loops. CLI callers leave this unset.
     */
    processRegistry?: ProcessRegistry;
    /**
     * Optional DB accessor for coordination-facing run persistence (ADR-057 wave 1).
     * When set, a spec-id-addressed run persists an occupant pin + path-only
     * artifact refs to `coordination_runs`. Absent (tests without a DB) → no
     * occupant, run still succeeds.
     */
    getDb?: () => Promise<DbAdapter>;
    /**
     * Fresh merged global+project config (0858 R3). The fleet gate a spec-id
     * dispatch runs against reads `agent.fleet` from here — the 0835 carrier was
     * a file, so without this seam the gate would silently find no fleet.
     * Absent (tests) → no fleet declaration is seen.
     */
    reloadAgentConfig?: () => Promise<SpurConfig | null>;
}

// ---------------------------------------------------------------------------
// AgentService
// ---------------------------------------------------------------------------

/** Application-layer orchestration for `spur agent` commands. */
export class AgentService {
    private readonly ctx: AgentServiceContext;
    private readonly resolver: AgentResolver;
    private readonly doctorOps: AgentDoctorOps;
    private readonly runExecutor: AgentRunExecutor;

    constructor(ctx: AgentServiceContext) {
        this.ctx = ctx;
        this.resolver = new AgentResolver(this.ctx);
        this.doctorOps = new AgentDoctorOps(this.ctx, this.resolver);
        this.runExecutor = new AgentRunExecutor(this.ctx, this.resolver);
    }

    // Public: resolve
    // -------------------------------------------------------------------------

    async resolve(flags: Record<string, string | boolean>, deps?: AgentRunDeps): Promise<AgentResolveResult> {
        const outputPolicy: OutputPolicy = { mode: 'buffered' };
        const runner =
            deps?.runner ??
            new AiRunner({
                processExecutor: new NodeProcessExecutor({
                    output: outputPolicy,
                    ...(this.ctx.processRegistry !== undefined ? { registry: this.ctx.processRegistry } : {}),
                }),
            });
        const detector = deps?.detector ?? new AgentDetector({ runner });
        const doctorRunner =
            deps?.doctorRunner ??
            new DoctorRunner({ agentDetector: detector, runner, env: this.ctx.env, probeAuth: false });
        // Public resolve() has no prompt → no stage (0536 R4: prompt text never
        // derives a stage): auto resolution falls through default → priority.
        return this.resolver.resolveAgent(flags, doctorRunner);
    }

    /**
     * Current availability of one executor, read through the config loader
     * (B7 R6 / task 0895). The loader cache is keyed on config mtimes and
     * invalidated by the B6 drain's availability write, so this read sees a
     * mid-run disable without any event plumbing. No live loader (tests, old
     * compositions) → falls back to the construction-time roster. Unknown
     * executor or no roster → undefined (treated as enabled by callers).
     */
    async executorAvailability(executorName: string): Promise<ExecutorAvailability | undefined> {
        const fresh = this.ctx.reloadAgentConfig !== undefined ? await this.ctx.reloadAgentConfig() : null;
        const executors = fresh?.agent?.executors ?? this.ctx.agentConfig?.executors;
        const entry = executors?.find((e) => e.name === executorName);
        return entry !== undefined ? normalizeExecutorAvailability(entry.disabled) : undefined;
    }

    /**
     * Re-resolve a role against a FRESH roster (B7 R6 / task 0895): the same
     * resolveRole walk dispatch uses, but availability comes from a live loader
     * read so an executor disabled mid-run is skipped by the eligibility
     * filter. No live loader → identical to {@link resolve} (degradation, never
     * a hard failure — the pin check is the safety net, not the roster).
     */
    async resolveRoleFresh(flags: Record<string, string | boolean>): Promise<AgentResolveResult> {
        const fresh = this.ctx.reloadAgentConfig !== undefined ? await this.ctx.reloadAgentConfig() : null;
        const freshExecutors = fresh?.agent?.executors;
        if (freshExecutors === undefined) return this.resolve(flags);
        const runner = new AiRunner({
            processExecutor: new NodeProcessExecutor({
                output: { mode: 'buffered' },
                ...(this.ctx.processRegistry !== undefined ? { registry: this.ctx.processRegistry } : {}),
            }),
        });
        const doctorRunner = new DoctorRunner({
            agentDetector: new AgentDetector({ runner }),
            runner,
            env: this.ctx.env,
            probeAuth: false,
        });
        return this.resolver.withRosterOverride(freshExecutors, () => this.resolver.resolveAgent(flags, doctorRunner));
    }

    // -------------------------------------------------------------------------
    // Public: list
    // -------------------------------------------------------------------------

    async list(opts: { json: boolean; enveloped?: boolean }, deps?: AgentRunDeps): Promise<number> {
        const detector = deps?.detector ?? new AgentDetector();
        const agents = await detector.detectAll();
        if (opts.json) {
            this.ctx.output.write(toEnvelopeJson({ agents }, { enveloped: opts.enveloped }));
        } else {
            this.ctx.output.write(
                agents
                    .map(
                        (agent) =>
                            `${agent.installed ? 'ok' : 'missing'} ${agent.name}${agent.version ? ` ${agent.version}` : ''}`,
                    )
                    .join('\n'),
            );
        }
        return 0;
    }

    // -------------------------------------------------------------------------
    // Public: doctor
    // -------------------------------------------------------------------------

    async doctor(
        args: {
            json: boolean;
            /** ADR-091 opt-in envelope decision threaded from `--json-envelope` (undefined → env). */
            enveloped?: boolean;
            agent?: string;
            /** B4/0683 R1: opt into model health probing; without it no probe fires. */
            probeHealth?: boolean;
            /** B4/0683 R5: bypass the detection cache, re-run, rewrite it. */
            forceRefresh?: boolean;
            /** 0893 R2: absolute path of the agent-usage snapshot to report; absent → `usage: none`. */
            usageSnapshotPath?: string;
        },
        deps?: AgentRunDeps,
    ): Promise<number> {
        return this.doctorOps.doctor(args, deps);
    }

    // -------------------------------------------------------------------------
    // Public: run
    // -------------------------------------------------------------------------

    async run(
        prompt: string | undefined,
        flags: Record<string, string | boolean>,
        deps?: AgentRunDeps,
    ): Promise<number> {
        const outcome = await this.runExecutor.executeRun(prompt, flags, deps, {
            silent: false,
            execution: this.defaultExecutionOptions(flags),
        });
        // agent.ts restores Commander's tri-state value under `jsonEnvelope` after the
        // generic camelCase-to-kebab conversion; absence still defers to the env.
        if (!outcome.ok) {
            if (booleanFlag(flags, 'json')) {
                this.ctx.output.write(
                    toEnvelopeJson(
                        { error: { code: 'agent-resolution', message: outcome.message } },
                        {
                            enveloped: jsonEnvelopeFlag(flags),
                            error: {
                                code: 'INTERNAL_ERROR',
                                message: outcome.message,
                                details: { cliCode: 'agent-resolution' },
                            },
                        },
                    ),
                );
            } else {
                this.ctx.output.error(outcome.message);
            }
            return outcome.exitCode;
        }
        const result = outcome.result;
        const jsonOutput = booleanFlag(flags, 'json');
        // Read back the terminal coordination row (if this was a spec-id run) so the
        // additive --json keys match getCoordinationRun's shape exactly.
        const coordination =
            outcome.coordination !== undefined
                ? ((await this.getCoordinationRun(outcome.coordination.occupant.runId)) ?? undefined)
                : undefined;
        this.handleRunOutput(result, jsonOutput, jsonEnvelopeFlag(flags), coordination, outcome.invocation);
        if (result.exitCode === 0) return 0;
        if (result.signal !== undefined) {
            this.ctx.output.error(`Agent terminated by signal: ${result.signal}`);
            return 3;
        }
        this.ctx.output.error(`Agent exited with code ${result.exitCode ?? 'null'}`);
        return 3;
    }

    // -------------------------------------------------------------------------
    // Public: runCapture
    // -------------------------------------------------------------------------

    /**
     * Execute an agent prompt and return the captured answer text.
     * Like {@link run} but suppresses all output (diagnostics, streaming,
     * error messages) and returns the agent's stdout as `answer`.
     * Uses buffered output mode to ensure the answer is captured.
     */
    async runCapture(
        prompt: string | undefined,
        flags: Record<string, string | boolean>,
        deps?: AgentRunDeps,
    ): Promise<AgentRunCaptureResult> {
        const outcome = await this.runExecutor.executeRun(prompt, flags, deps, { silent: true });
        if (!outcome.ok) {
            return { exitCode: outcome.exitCode, answer: '' };
        }
        const result = outcome.result;
        const exitCode = result.exitCode === 0 ? 0 : 3;
        // R2b: forward the diagnostic fields AiRunner already computed (exitCode
        // null + signal on timeout, durationMs always) instead of discarding them —
        // agent.run uses these to write a timeout/failure handoff artifact.
        return {
            exitCode,
            answer: result.stdout,
            durationMs: result.durationMs,
            ...(result.signal !== undefined ? { signal: result.signal } : {}),
            stderr: result.stderr,
        };
    }

    // -------------------------------------------------------------------------
    // Public: runTraced (pipeline / workflow-oriented; non-interactive by contract)
    // -------------------------------------------------------------------------

    /**
     * Execute an agent prompt under a non-interactive contract and return the
     * resolved {@link AgentRunInvocation} alongside captured stdout/stderr and
     * diagnostic fields. Designed for the pipeline `agent.run` action so a
     * translated slash command (e.g. `/sp:dev-run --mode implement … --auto`)
     * cannot stall waiting on an interactive stdin that never arrives (R3 /
     * task 0295), and so the workflow run trace can record what was actually
     * dispatched (R1).
     *
     * Contract:
     *  - Output is pipe-no-TTY (`{ mode: 'pipe' }`) when nonInteractive — the
     *    agent subprocess never inherits the parent's stdout, so it cannot
     *    perceive an interactive terminal. Direct `spur agent run` keeps its
     *    interactive streaming behavior because it uses {@link run}, not this.
     *  - Silent/json paths still use buffered mode.
     *  - Exit-code mapping matches {@link runCapture}: 0 success, 3 agent
     *    failure / signal, 2 validation/dispatch error.
     *
     * On validation failure (bad `--mode`, missing prompt, unknown agent),
     * `invocation` is `undefined` and `message` carries the reason.
     */
    async runTraced(
        prompt: string | undefined,
        flags: Record<string, string | boolean>,
        deps?: AgentRunDeps,
        execution?: AgentExecutionOptions,
    ): Promise<AgentRunTracedResult> {
        const outcome = await this.runExecutor.executeRun(prompt, flags, deps, {
            silent: true,
            nonInteractive: true,
            execution: execution ?? this.defaultExecutionOptions(flags),
        });
        if (!outcome.ok) {
            return { exitCode: outcome.exitCode, stdout: '', message: outcome.message };
        }
        const result = outcome.result;
        const exitCode = result.exitCode === 0 ? 0 : 3;
        return {
            exitCode,
            invocation: outcome.invocation,
            stdout: result.stdout,
            stderr: result.stderr,
            durationMs: result.durationMs,
            ...(result.signal !== undefined ? { signal: result.signal } : {}),
            // R2 (0707): read ONLY the typed `usage` field off the runner result —
            // human stdout/stderr is never parsed for accounting. The installed
            // runner exposes no structured usage, so this normalizes to the
            // honest `unavailable` shape until the facade supplies typed fields.
            usage: normalizeAgentUsage(
                // SAFETY: dispatchers attach `usage` onto the result object at
                // runtime; the visible AgentRunResult type predates that field.
                // pi-lens-ignore: require-safety-comment-for-as-unknown-as
                (result as unknown as { usage?: unknown }).usage,
                'runner result carries no structured usage',
            ),
        };
    }

    private defaultExecutionOptions(flags: Record<string, string | boolean>): AgentExecutionOptions {
        const runId = stringFlag(flags, 'run-id', '') || crypto.randomUUID();
        const observer =
            this.ctx.events === undefined
                ? undefined
                : (event: import('../observability/agent-execution').AgentExecutionEvent) => {
                      void this.ctx.events?.emit('agent.execution', event);
                  };
        return {
            correlation: { runId, executionId: crypto.randomUUID() },
            ...(observer !== undefined ? { observer } : {}),
        };
    }

    // -------------------------------------------------------------------------
    // Private: output handling
    // -------------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Public: coordination (ADR-057 wave 1)
    // -----------------------------------------------------------------------

    /**
     * Resolve the live occupant for a spec id. A kind-only lookup is rejected
     * (R1): an occupant must be addressed by specId since multiple specs can
     * share the same coding-agent type. Returns null when no DB is wired or no
     * run exists for the spec.
     */
    async getOccupant(by: { specId: string } | { agentKind: string }): Promise<OccupantRef | null> {
        if ('agentKind' in by) {
            throw new Error('occupant_lookup_kind_rejected: address the occupant by specId, not agentKind');
        }
        if (this.ctx.getDb === undefined) return null;
        const dao = new CoordinationRunDao(await this.ctx.getDb());
        const row = await dao.getLatestBySpecId(by.specId);
        if (row === null) return null;
        return {
            specId: row.spec_id,
            agentKind: row.agent_kind,
            processId: row.process_id,
            runId: row.run_id,
            generation: row.generation,
        };
    }

    /**
     * Read a coordination-facing run by runId — the shape a sibling agent receives
     * (R2). Returns occupant pin + path-only artifact refs; never stdout/stderr
     * bodies. Null when no DB or no such run.
     */
    async getCoordinationRun(runId: string): Promise<CoordinationRun | null> {
        if (this.ctx.getDb === undefined) return null;
        const dao = new CoordinationRunDao(await this.ctx.getDb());
        const row = await dao.getByRunId(runId);
        if (row === null) return null;
        return {
            occupant: {
                specId: row.spec_id,
                agentKind: row.agent_kind,
                processId: row.process_id,
                runId: row.run_id,
                generation: row.generation,
            },
            status: row.status as CoordinationRun['status'],
            startedAt: row.started_at,
            completedAt: row.completed_at,
            artifactRefs: parseArtifactRefs(row.artifact_refs_json),
        };
    }

    // -----------------------------------------------------------------------
    // Private: output handling
    // -----------------------------------------------------------------------

    private handleRunOutput(
        result: AgentRunResult,
        jsonOutput: boolean,
        /** ADR-091 opt-in envelope decision threaded from `--json-envelope` (undefined → env). */
        enveloped: boolean | undefined,
        coordination?: CoordinationRun,
        invocation?: AgentRunInvocation,
    ): void {
        if (jsonOutput) {
            this.ctx.output.write(
                toEnvelopeJson(
                    {
                        exitCode: result.exitCode,
                        stdout: result.stdout,
                        stderr: result.stderr,
                        ...(result.signal !== undefined ? { signal: result.signal } : {}),
                        durationMs: result.durationMs,
                        // Resolution attribution (0536 R1/R2): the resolved agent,
                        // source, and — when role-resolved or executor-pinned — the
                        // role, its tier, and the executor entry that won.
                        ...(invocation !== undefined
                            ? {
                                  resolved: {
                                      ...(invocation.role !== undefined ? { role: invocation.role } : {}),
                                      ...(invocation.roleOrigin !== undefined
                                          ? { roleOrigin: invocation.roleOrigin }
                                          : {}),
                                      ...(invocation.tier !== undefined ? { tier: invocation.tier } : {}),
                                      ...(invocation.executor !== undefined ? { executor: invocation.executor } : {}),
                                      agent: invocation.agent,
                                      source: invocation.source,
                                  },
                              }
                            : {}),
                        ...(coordination?.occupant !== undefined ? { occupant: coordination.occupant } : {}),
                        ...(coordination !== undefined
                            ? {
                                  run: {
                                      status: coordination.status,
                                      startedAt: coordination.startedAt,
                                      completedAt: coordination.completedAt,
                                      artifactRefs: coordination.artifactRefs,
                                  },
                              }
                            : {}),
                    },
                    { enveloped },
                ),
            );
            return;
        }

        const isTTY = isatty(1);
        if (!isTTY) {
            if (result.stdout.length > 0) this.ctx.output.write(result.stdout);
            if (result.stderr.length > 0) this.ctx.output.error(result.stderr);
        }
    }
}
