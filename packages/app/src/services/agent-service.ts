import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { isatty } from 'node:tty';
import {
    type CapabilityTier,
    type CoordinationArtifactRef,
    type CoordinationRun,
    CoordinationRunDao,
    type DbAdapter,
    getCanonicalStage,
    getNextFallback,
    isTierEligible,
    type ObjectiveEscalationSignal,
    type OccupantRef,
    type StageModelPolicy,
    type StageRecord,
    TIER_RANK,
} from '@gobing-ai/spur-domain';
import {
    AgentDetector,
    type AgentName,
    type AgentRunResult,
    AiRunner,
    type DoctorResult,
    DoctorRunner,
    getAgentShim,
    isClaudeStyleSlashCommand,
    type ModelHealthResult,
    type PromptOptions,
    resolveAgentName,
    TIER1_PRIORITY,
    TIER2_AGENTS,
    translateSlashCommand,
} from '@gobing-ai/ts-ai-runner';
import type { EventBus } from '@gobing-ai/ts-infra';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import {
    createNodeFileSystem,
    NodeProcessExecutor,
    type OutputPolicy,
    type ProcessOptions,
    type ProcessRegistry,
    type ProcessResult,
} from '@gobing-ai/ts-runtime';
import {
    AgentExecutionLifecycle,
    type AgentExecutionOptions,
    type AgentRoutingAttribution,
    type CapabilityEvidenceEntry,
    configuredSecretValues,
} from '../observability/agent-execution';
import { toEnvelopeJson } from '../output/envelope';
import { type NormalizedAgentUsage, normalizeAgentUsage } from './agent-usage';
import {
    capabilityDiagnostic,
    capabilityEvidence,
    evaluateCapabilities,
    parseRequiresCapabilities,
    type RequiresCapabilities,
} from './capability-attestation';
import { bridgeEventBus, withInvokeRouting } from './event-bridge';
import { classifyDispatch } from './failure-classification';
import { RunSessionObserver, type RunSessionOverlapRegistry } from './run-session-observer';

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
 * A named executor profile: a canonical coding-agent plus an optional opaque
 * model override. Mirrors the CLI's `AgentExecutorConfig` zod shape structurally
 * (the app layer must not import from `apps/cli`, R3).
 *
 * Vocabulary (task 0405, R1): "executor" is the domain-layer term for the role
 * a stage dispatches (reasoned about by `getExecutorTier`, `isTierEligible`,
 * the eligible-executor list). The operator surface says "agent" (CLI `--agent`,
 * the `agent:` config key, this struct's `agent` field naming the canonical
 * tool). The split is deliberate; the boundary is recorded at
 * `AgentConfigSchema` in `@gobing-ai/spur-config`. No alias, no migration.
 */
export interface AgentExecutorConfig {
    name: string;
    agent: string;
    model?: string;
    tier?: CapabilityTier;
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
    env: Record<string, string | undefined>;
    output: AgentServiceOutput;
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
     * and `agent.*` event emitted by the underlying AiRunner/TeamOrchestrator
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
}

/**
 * Process executor that reports each dispatched subprocess's OS pid.
 *
 * `AiRunner` owns the `run()` options for an agent dispatch, so the pid sink
 * cannot be threaded through the call site — it is injected here instead, at
 * the one place Spur constructs the executor. Any `onSpawn` the caller supplied
 * still runs; this only appends an observer.
 */
export class PidObservingProcessExecutor extends NodeProcessExecutor {
    constructor(
        config: ConstructorParameters<typeof NodeProcessExecutor>[0],
        private readonly publishPid: (pid: number) => void,
    ) {
        super(config);
    }

    override async run(options: ProcessOptions): Promise<ProcessResult> {
        return super.run({
            ...options,
            onSpawn: (pid: number) => {
                options.onSpawn?.(pid);
                this.publishPid(pid);
            },
        });
    }
}

/**
 * Process executor that stamps the dispatching run's effective role into every
 * spawned subprocess environment as `SPUR_ROLE` (0551). Recursive by
 * construction: a child `spur agent run` reads it as its inherited role when it
 * declares none of its own. An empty value strips a parent's stale role
 * (stage/default/priority resolutions dispatch with no role). Preserves any
 * caller-supplied env (ai-runner correlation vars) — `SPUR_ROLE` is the only
 * key overridden.
 */
export class RolePropagatingProcessExecutor extends PidObservingProcessExecutor {
    private roleEnv = '';

    /** Set the role stamped into subsequent spawns; undefined strips. */
    setRoleEnv(role: string | undefined): void {
        this.roleEnv = role ?? '';
    }

    override async run(options: ProcessOptions): Promise<ProcessResult> {
        return super.run({ ...options, env: { ...options.env, SPUR_ROLE: this.roleEnv } });
    }
}

// ---------------------------------------------------------------------------
// AgentService
// ---------------------------------------------------------------------------

/** Application-layer orchestration for `spur agent` commands. */
export class AgentService {
    private readonly ctx: AgentServiceContext;
    /**
     * Shared per-process in-flight session-root registry (feature E6): two
     * concurrent runs of the same agent in the same root must not both claim
     * the same session file — the second watermark flags both as overlapping
     * (R3) and neither writes an exact mapping.
     */
    private readonly sessionRootRegistry: RunSessionOverlapRegistry = { active: new Map(), overlapped: new Set() };
    private readonly unreachableTierWarnings = new Set<string>();

    constructor(ctx: AgentServiceContext) {
        this.ctx = ctx;
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
        return this.resolveAgent(flags, doctorRunner);
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
        },
        deps?: AgentRunDeps,
    ): Promise<number> {
        const executors = this.ctx.agentConfig?.executors;
        const now = deps?.now ?? ((): number => Date.now());
        const fileSystem = deps?.fileSystem ?? createNodeFileSystem(this.ctx.cwd);
        // R1 (0622 F2/F4 residue): a Layer-1 role (`coder`, `planner`, …) is not an
        // executor. Resolve it through the SAME ranked doctor-walk dispatch uses
        // (`resolveRole`): cheapest eligible → most expensive, checking each until
        // one is usable. Never probe the literal role name (that fabricates
        // `{usable:false}`) and never stop at the first eligible without a
        // usability check (a quota-exhausted or missing executor must fall through
        // to the next rung, exactly as dispatch would).
        if (this.ctx.rolesSource === 'fallback' && !args.json) {
            this.ctx.output.error(
                'agent.roles: no config layer defines a table — built-in DEFAULT_AGENT_ROLES fallback in effect',
            );
        }
        // R1: DoctorRunner probes iff `executor.model` is set (doctor-runner.js:75/:89),
        // so handing it a model-stripped copy suppresses probing without touching the
        // runner. renderDoctor keeps reading the UNMODIFIED config array (R2).
        const runnerExecutors = args.probeHealth ? executors : executors?.map(({ name, agent }) => ({ name, agent }));
        const fingerprint = executorFingerprint(executors);
        let cacheInfo: DoctorCacheInfo = { hit: false, ageMs: null, path: DOCTOR_CACHE_REL };
        // Cache is active by default in production; an injected doctorRunner WITHOUT an
        // fs seam opts out (existing unit tests assert fresh stubbed runs and must not
        // see disk-cached rows), while an explicitly provided fileSystem always opts in
        // regardless of injections.
        // R7: --probe-health results are never cached and a set flag neither reads nor writes.
        // R5: --force-refresh skips the read too (re-runs and rewrites).
        const cacheOn = deps?.fileSystem !== undefined || deps?.doctorRunner === undefined;
        const serveCached =
            cacheOn && !args.probeHealth && !args.forceRefresh
                ? readFreshDoctorCache(fileSystem, fingerprint, now)
                : null;
        let doctorRunner =
            deps?.doctorRunner ?? new DoctorRunner({ env: this.ctx.env, executors: runnerExecutors, probeAuth: false });
        if (args.agent === undefined) {
            if (serveCached !== null) {
                cacheInfo = { hit: true, ageMs: serveCached.ageMs, path: DOCTOR_CACHE_REL };
                return this.renderDoctor(
                    serveCached.results,
                    executors,
                    args.json,
                    undefined,
                    cacheInfo,
                    args.enveloped,
                );
            }
            const results = await doctorRunner.runAll();
            if (cacheOn && !args.probeHealth) {
                // R5: a forced refresh rewrites the file so capturedAt advances.
                const writeErr = await writeDoctorCacheFile(fileSystem, fingerprint, results, now);
                if (writeErr !== null) {
                    this.ctx.output.error(`Warning: could not update ${DOCTOR_CACHE_REL}: ${writeErr}`);
                }
            }
            return this.renderDoctor(results, executors, args.json, undefined, cacheInfo, args.enveloped);
        }
        const roleDef = this.ctx.roles?.get(args.agent);
        if (roleDef !== undefined) {
            // R8: a role selector is served from a fresh, fingerprint-matching cache
            // covering every eligible executor; a miss runs what it needs and writes
            // nothing (a partial/full-but-unrequested rowset must not be persisted).
            if (serveCached !== null && roleCoveredByCache(serveCached.results, executors, roleDef.tier)) {
                cacheInfo = { hit: true, ageMs: serveCached.ageMs, path: DOCTOR_CACHE_REL };
                doctorRunner = cachedDoctorRunner(serveCached.results);
            }
            // R4: the role selector renders the FULL eligible ladder. One runAll()
            // returns every executor row; resolveRole picks the elected one via the
            // same doctor-walk dispatch uses. R8: resolveRole itself is untouched.
            const resolved = await this.resolveRole(args.agent, roleDef.tier, doctorRunner);
            const results = await doctorRunner.runAll();
            const rows = buildDoctorRows(results, executors, this.ctx.roles);
            const rowByName = new Map(rows.map((row) => [row.executor, row]));
            // Ladder rows in resolution order (cheapest eligible first).
            const executorsConfigured = this.ctx.agentConfig?.executors ?? [];
            const ladderRows = cheapestEligibleExecutors(executorsConfigured, roleDef.tier)
                .map((e) => rowByName.get(e.name))
                .filter((row): row is DoctorRow => row !== undefined);
            if (!resolved.ok) {
                // R5: the full tried ladder renders BEFORE the failure return —
                // per-row reasons supersede resolveRole's single joined `tried:`
                // line. Text surface only: --json stays stderr-clean (machine
                // consumers parse the single error envelope, R5 0609).
                if (args.json) {
                    this.ctx.output.write(
                        toEnvelopeJson(
                            { error: { code: 'agent-resolution', message: resolved.message } },
                            {
                                enveloped: args.enveloped,
                                error: {
                                    code: 'INTERNAL_ERROR',
                                    message: resolved.message,
                                    details: { cliCode: 'agent-resolution' },
                                },
                            },
                        ),
                    );
                } else {
                    this.ctx.output.error(renderRoleLadder(args.agent, roleDef.tier, ladderRows, undefined));
                }
                return resolved.exitCode;
            }
            const electedName = resolved.executor ?? resolved.agent;
            if (args.json) {
                // R7: agents[0] is the elected executor, then the remainder in
                // resolution order — doctor-probe.ts reads `.agents[0].agent`.
                const ordered = [
                    ...ladderRows.filter((row) => row.executor === electedName),
                    ...ladderRows.filter((row) => row.executor !== electedName),
                ];
                const entries = ordered.map((row) => {
                    const result = results.find((r) => r.agent === row.executor) as DoctorResult;
                    return {
                        ...withoutAuthenticated(result),
                        capabilityTier: row.capabilityTier,
                        model: row.model,
                        roles: row.roles,
                        elected: row.elected,
                    };
                });
                this.ctx.output.write(
                    toEnvelopeJson(
                        { agents: entries, rolesSource: this.ctx.rolesSource ?? 'config', cache: cacheInfo },
                        { enveloped: args.enveloped },
                    ),
                );
                return 0;
            }
            this.ctx.output.write(renderRoleLadder(args.agent, roleDef.tier, ladderRows, electedName));
            this.appendCacheNote(cacheInfo, args.json);
            return 0;
        }
        // R8: single-executor selector — served from a fresh matching cache when one
        // covers the name; on a miss run only what the selector needs and write nothing.
        const cachedSelectorRow = serveCached?.results.find((r) => r.agent === args.agent);
        if (cachedSelectorRow !== undefined) {
            cacheInfo = { hit: true, ageMs: serveCached?.ageMs ?? null, path: DOCTOR_CACHE_REL };
            return this.renderDoctor([cachedSelectorRow], executors, args.json, args.agent, cacheInfo, args.enveloped);
        }
        const results = [await doctorRunner.runOne(args.agent)];
        return this.renderDoctor(results, executors, args.json, args.agent, cacheInfo, args.enveloped);
    }

    /** R4: a cache hit prints its age — text surfaces get a trailing line, JSON carries it structurally. */
    private appendCacheNote(cache: DoctorCacheInfo, json: boolean): void {
        if (json || !cache.hit || cache.ageMs === null) return;
        this.ctx.output.write(
            `· cached ${Math.round(cache.ageMs / 1000)}s ago (${cache.path}) — --force-refresh to re-detect`,
        );
    }

    private renderDoctor(
        results: Awaited<ReturnType<DoctorRunner['runAll']>>,
        executors: readonly AgentExecutorConfig[] | undefined,
        json: boolean,
        agent?: string,
        cache?: DoctorCacheInfo,
        /** ADR-091 opt-in envelope decision threaded from `--json-envelope` (undefined → env). */
        enveloped?: boolean,
    ): number {
        // R6/AC5: warn (not block) when an executor's model is quota_exhausted or unavailable.
        const modelByExecutor = new Map(
            (executors ?? []).filter((e) => e.model !== undefined).map((e) => [e.name, e.model as string]),
        );
        for (const result of results) {
            if (
                result.modelStatus &&
                (result.modelStatus.status === 'quota_exhausted' || result.modelStatus.status === 'unavailable')
            ) {
                const model = modelByExecutor.get(result.agent) ?? '(unknown)';
                this.ctx.output.error(
                    `Warning: executor ${result.agent} (model ${model}) reports ${result.modelStatus.status}. Consider \`--agent <alt>\` or check token quota.`,
                );
            }
        }
        if (json) {
            // R3 (task 0487): expose the executor's *capability* tier so out-of-process
            // callers (the pipeline size precheck) can gate a large task on executor
            // strength without re-implementing the inference regex. Distinct from the
            // row's existing `tier`, which is the agent's support tier (1/2/3).
            // B4/0681 adds the routing fields the text view shows: model/roles/elected.
            const rows = buildDoctorRows(results, executors, this.ctx.roles);
            const entries = rows.map((row, i) => {
                const result = results[i] as DoctorResult;
                return {
                    ...withoutAuthenticated(result),
                    capabilityTier: row.capabilityTier,
                    model: row.model,
                    roles: row.roles,
                    elected: row.elected,
                };
            });
            const cacheField: DoctorCacheInfo = cache ?? { hit: false, ageMs: null, path: DOCTOR_CACHE_REL };
            this.ctx.output.write(
                toEnvelopeJson(
                    { agents: entries, rolesSource: this.ctx.rolesSource ?? 'config', cache: cacheField },
                    { enveloped },
                ),
            );
        } else {
            const rows = buildDoctorRows(results, executors, this.ctx.roles);
            // Single-executor mode keeps the detail view; full mode renders the table.
            this.ctx.output.write(agent !== undefined ? renderDoctorDetail(rows[0] ?? null) : renderDoctorTable(rows));
            this.appendCacheNote(cache ?? { hit: false, ageMs: null, path: DOCTOR_CACHE_REL }, false);
        }
        return results.some((result) => !result.usable && result.tier === 1) ? 1 : 0;
    }

    // -------------------------------------------------------------------------
    // Public: run
    // -------------------------------------------------------------------------

    async run(
        prompt: string | undefined,
        flags: Record<string, string | boolean>,
        deps?: AgentRunDeps,
    ): Promise<number> {
        const outcome = await this.executeRun(prompt, flags, deps, {
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
        const outcome = await this.executeRun(prompt, flags, deps, { silent: true });
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
        const outcome = await this.executeRun(prompt, flags, deps, {
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
                (result as unknown as { usage?: unknown }).usage,
                'runner result carries no structured usage',
            ),
        };
    }

    // -------------------------------------------------------------------------
    // Private: executeRun (shared by run and runCapture)
    // -------------------------------------------------------------------------

    /**
     * Core execution logic shared by {@link run}, {@link runCapture}, and
     * {@link runTraced}.
     *
     * @param options.silent  suppress all output and force buffered mode so the
     *   caller can read `result.stdout` (used by `runCapture` and `runTraced`).
     * @param options.nonInteractive force pipe-no-TTY output (live onOutput, no TTY) so
     *   the subprocess cannot perceive an interactive terminal (R3 / task 0295).
     *   Implies `silent` semantics for output-policy selection but does NOT
     *   suppress diagnostics on its own — pass `silent: true` too for that.
     *   Used by `runTraced`.
     */
    private async executeRun(
        prompt: string | undefined,
        flags: Record<string, string | boolean>,
        deps: AgentRunDeps | undefined,
        options: { silent: boolean; nonInteractive?: boolean; execution?: AgentExecutionOptions },
    ): Promise<
        | { ok: true; result: AgentRunResult; invocation: AgentRunInvocation; coordination?: { occupant: OccupantRef } }
        | { ok: false; exitCode: number; message: string }
    > {
        const silent = options.silent;
        const nonInteractive = options.nonInteractive === true;

        // validate --mode
        const mode = stringFlag(flags, 'mode', 'text');
        if (mode !== 'text' && mode !== 'json') {
            return { ok: false, exitCode: 2, message: `Invalid mode: ${mode} (must be text or json)` };
        }

        // validate --cwd
        const cwd = stringFlag(flags, 'cwd', '');
        if (cwd !== '') {
            const cwdStat = await this.statCwd(cwd);
            if (!cwdStat) {
                return { ok: false, exitCode: 2, message: `Invalid --cwd: ${cwd} does not exist` };
            }
            if (!cwdStat.isDirectory()) {
                return { ok: false, exitCode: 2, message: `Invalid --cwd: ${cwd} is not a directory` };
            }
        }

        // extract --timeout
        const timeoutMs = numberFlag(flags, 'timeout');
        if (timeoutMs === undefined && typeof flags.timeout === 'string') {
            return { ok: false, exitCode: 2, message: `Invalid --timeout=${flags.timeout}: must be a number` };
        }

        // require prompt (except codex --continue)
        const continueFlag = booleanFlag(flags, 'continue');
        if (prompt === undefined && !continueFlag) {
            return { ok: false, exitCode: 2, message: 'Prompt is required' };
        }

        // determine output mode.
        // - silent or --json → buffered (capture stdout)
        // - nonInteractive (pipeline agent.run / H83 R5): **pipe** — stdin ignore,
        //   no TTY inherit, stdout/stderr piped so onOutput fires mid-run. Do NOT use
        //   `{ mode: 'stream', isTTY: false }` — that path falls through to buffered
        //   `all: true` in ts-runtime and loses live streaming (task 0448 residual).
        // - otherwise (direct `spur agent run` from a TTY) → stream + inherit.
        const jsonOutput = silent || booleanFlag(flags, 'json');
        // nonInteractive (pipeline agent.run / H83 R5): pipe-no-TTY — stdin
        // ignore, no TTY inherit, stdout/stderr piped so onOutput fires mid-run
        // (@gobing-ai/ts-runtime ≥0.4.19). Do not use stream+isTTY:false — that
        // falls through to buffered `all: true` and loses live streaming.
        const outputPolicy: OutputPolicy = nonInteractive
            ? { mode: 'pipe' }
            : silent || jsonOutput
              ? { mode: 'buffered' }
              : { mode: 'stream', isTTY: isatty(1) };
        const outputMode = outputPolicy.mode;

        // Bridges the dispatched subprocess's pid to the lifecycle, which is
        // constructed below (it spans the whole escalation chain, so it cannot be
        // built before the runner). Assigned once that lifecycle exists; until
        // then a spawn simply has no observer.
        let publishPid: ((pid: number) => void) | undefined;

        // deps or defaults. When the service has a server EventBus, thread it
        // onto the runner so `agent.invoke.*` emits also reach the system_events
        // tap (task 0221 R3).
        // Constructed even when deps.runner is injected (then unused — it is
        // side-effect free): one shape for every caller of this method.
        const dispatchExecutor = new RolePropagatingProcessExecutor(
            {
                output: outputPolicy,
                ...(this.ctx.processRegistry !== undefined ? { registry: this.ctx.processRegistry } : {}),
            },
            (pid) => publishPid?.(pid),
        );
        // Routing decision attribution (0545 R1): the funnel's result is
        // stamped into the per-run invoke bridge after resolution and per
        // escalation hop, so the `agent.invoke.*` rows the ledger already
        // writes carry role/tier/executor/source. The holder is filled after
        // `resolveAgent` below and re-stamped on each escalation re-resolve —
        // the invoke bridge reads it at emit time.
        let routing: AgentRoutingAttribution | undefined;
        const invokeBridge = this.ctx.events !== undefined ? bridgeEventBus(this.ctx.events) : undefined;
        const runner =
            deps?.runner ??
            new AiRunner({
                processExecutor: dispatchExecutor,
                ...(invokeBridge !== undefined ? { events: withInvokeRouting(invokeBridge, () => routing) } : {}),
                ...(invokeBridge !== undefined ? { processEvents: invokeBridge } : {}),
            });

        const detector = deps?.detector ?? new AgentDetector({ runner });
        const doctorRunner =
            deps?.doctorRunner ??
            new DoctorRunner({ agentDetector: detector, runner, env: this.ctx.env, probeAuth: false });

        // resolve agent — prompt text never derives a stage (0536 R4)
        const resolved = await this.resolveAgent(flags, doctorRunner);
        if (!resolved.ok) {
            return { ok: false, exitCode: resolved.exitCode, message: resolved.message };
        }
        // 0545 R1: the funnel's decision is the attribution for this run's
        // lifecycle events (started event + agent.invoke.* payloads).
        routing = buildRoutingAttribution(resolved);
        // Escalation state (0407): mutable per-iteration tracking. `runFlags`
        // is a shallow copy so each escalation can inject `signal` +
        // `from-executor` without mutating the caller's flags.
        const runFlags: Record<string, string | boolean> = { ...flags };
        let currentAgent: AgentName = resolved.agent;
        let currentModel = resolved.model;
        let currentSource = resolved.source;
        let currentStage = resolved.stage;
        // Role attribution (0536 R1/R2): stable per run — role resolution never
        // escalates (no stage context) and pins carry no role in this task.
        let currentRole = resolved.role;
        let currentRoleOrigin = resolved.roleOrigin;
        // Propagate the effective role into every dispatched subprocess (0551):
        // doctor/detector probes spawned during resolution above ran with
        // SPUR_ROLE='' (stripped) — harmless; children need the resolved role.
        dispatchExecutor.setRoleEnv(currentRole);
        let currentTier = resolved.tier;
        let currentExecutor = resolved.executor;
        const attemptedExecutors = new Set<string>(currentStage ? [currentStage.executorName] : []);
        // 0540 R2: the tiers in play ride the exhaustion report alongside the
        // executors tried — a bare executor list cannot say how far the ladder
        // climbed.
        const tiersAttempted = new Set<string>(currentStage ? [currentStage.executorTier] : []);

        // Tier-2 warning (suppressed in json/silent mode) — first agent only.
        if (!jsonOutput && TIER2_AGENTS.has(currentAgent)) {
            this.ctx.output.error(`Warning: ${currentAgent} is a Tier-2 agent (TUI/gateway only)`);
        }

        // Flag-derived values that do not change across iterations.
        const explicitModel = stringFlag(flags, 'model', '') || undefined;
        const purpose = stringFlag(flags, 'purpose', '') || undefined;
        const tags = parseTagsFlag(flags);
        const systemPrompt = stringFlag(flags, 'system-prompt', '') || undefined;
        const taskId = stringFlag(flags, 'task', '') || undefined;
        const sessionDir = stringFlag(flags, 'session-dir', '') || stringFlag(flags, 'sessionDir', '') || undefined;
        const sessionId = stringFlag(flags, 'session-id', '') || stringFlag(flags, 'sessionId', '') || undefined;
        // Capability gate input (0706 R4): JSON-serialized axis → minimum-state
        // requirements from the workflow action. Parsed+validated once here;
        // invalid shapes fail closed (exit 2) before any resolution/spawn.
        const requiresCapabilitiesRaw =
            stringFlag(flags, 'requiresCapabilities', '') || stringFlag(flags, 'requires-capabilities', '');
        let requiresCapabilities: Partial<RequiresCapabilities> | undefined;
        if (requiresCapabilitiesRaw !== '') {
            let parsedJson: unknown;
            try {
                parsedJson = JSON.parse(requiresCapabilitiesRaw);
            } catch (error) {
                return {
                    ok: false,
                    exitCode: 2,
                    message: `agent.run: invalid requiresCapabilities JSON — ${error instanceof Error ? error.message : String(error)}`,
                };
            }
            const parsed = parseRequiresCapabilities(parsedJson);
            if (!parsed.ok) {
                return { ok: false, exitCode: 2, message: `agent.run: ${parsed.error}` };
            }
            requiresCapabilities = parsed.requires;
        }

        // Lifecycle + signal handlers set up ONCE, shared across all dispatches
        // (0407): a single AgentExecutionLifecycle spans the escalation chain,
        // and a single AbortController lets SIGTERM/SIGINT cancel any dispatch.
        const controller = new AbortController();
        const onTerminate = () => controller.abort();
        const onExternalAbort = () => controller.abort();
        const lifecycle = new AgentExecutionLifecycle(
            options.execution?.observer,
            options.execution?.correlation,
            configuredSecretValues(this.ctx.env),
            options.execution?.heartbeatMs,
        );
        publishPid = (pid) => lifecycle.setPid(pid);
        process.on('SIGTERM', onTerminate);
        process.on('SIGINT', onTerminate);
        options.execution?.signal?.addEventListener('abort', onExternalAbort, { once: true });
        if (options.execution?.signal?.aborted === true) controller.abort();

        // Occupant pin (ADR-057 wave 1 R1): when addressed by a spec id, persist a
        // coordination-facing run row so a sibling agent can address it by runId.
        // generation = max(generation for spec_id) + 1 — monotonic per spec. The
        // supervisor-process-shared-generation refinement is handoff 0530; Wave 1
        // only needs an addressable, monotonic pin (ponytail: one source of truth).
        const specId = stringFlag(flags, 'spec-id', '');
        const coordinationRunId =
            specId !== '' && options.execution?.correlation !== undefined
                ? options.execution.correlation.runId
                : undefined;
        let occupantRef: OccupantRef | undefined;
        if (specId !== '' && coordinationRunId !== undefined && this.ctx.getDb !== undefined) {
            try {
                const dao = new CoordinationRunDao(await this.ctx.getDb());
                const generation = ((await dao.maxGeneration(specId)) ?? 0) + 1;
                occupantRef = {
                    specId,
                    agentKind: currentAgent,
                    processId: null,
                    runId: coordinationRunId,
                    generation,
                };
                await dao.insertStart({
                    specId,
                    agentKind: currentAgent,
                    processId: null,
                    runId: coordinationRunId,
                    generation,
                    startedAt: new Date().toISOString(),
                });
            } catch (error) {
                // Non-fatal: the agent run is primary; coordination persistence is secondary.
                if (!jsonOutput) {
                    this.ctx.output.error(
                        `Warning: occupant persist failed: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            }
        }

        let result: AgentRunResult | undefined;
        let invocation: AgentRunInvocation | undefined;
        let dispatchStartedAt = Date.now();

        // Run→session observation (feature E6 / task 0557). When a DB is
        // available, watermark the agent's session root at dispatch and record
        // the run→session mapping at exit. A supplied session id (R2) skips
        // observation; resolution never fails the run (R5).
        const getDb = this.ctx.getDb;
        let sessionObserver: RunSessionObserver | undefined;
        if (getDb !== undefined) {
            const factory =
                deps?.sessionObserverFactory ??
                ((runId: string) =>
                    new RunSessionObserver({
                        runId,
                        getDb,
                        output: this.ctx.output,
                        registry: this.sessionRootRegistry,
                        home: homedir(),
                        cwd: cwd || this.ctx.cwd,
                        json: jsonOutput,
                    }));
            sessionObserver = factory(lifecycle.identity.runId);
            if (sessionId !== undefined) {
                sessionObserver.supply(currentAgent, sessionId);
            } else {
                await sessionObserver.watermark(currentAgent, sessionDir);
            }
        }

        try {
            for (let attempt = 0; ; attempt++) {
                const agent = currentAgent;
                const model = explicitModel ?? currentModel;

                // Capability gate (0706 R5): resolve-first, compare-before-spawn.
                // Evaluated per attempt — the escalation ladder may land on a
                // different executor whose attestation must satisfy the stage
                // requirements too. Unknown/unavailable fails closed BEFORE any
                // subprocess is created; no supervised override exists (0706 Q&A:
                // omit rather than add a permissive flag without an approval event).
                if (requiresCapabilities !== undefined && Object.keys(requiresCapabilities).length > 0) {
                    const executorEntry = this.ctx.agentConfig?.executors?.find(
                        (entry) => entry.name === (currentExecutor ?? ''),
                    );
                    const evaluation = evaluateCapabilities(requiresCapabilities, executorEntry);
                    if (!evaluation.ok) {
                        const selector = currentExecutor ?? currentAgent;
                        const diagnostic = capabilityDiagnostic(selector, evaluation);
                        this.ctx.output.error(diagnostic);
                        return { ok: false, exitCode: 2, message: diagnostic };
                    }
                    // 0706 R7: bounded redacted attestation evidence rides the
                    // routing attribution onto started/invoke events. The first
                    // attempt stamps before lifecycle.start consumes `routing`.
                    const evidence: CapabilityEvidenceEntry[] = capabilityEvidence(evaluation);
                    routing = routing === undefined ? routing : { ...routing, capabilities: evidence };
                }

                // slash-command translation (recomputed each iteration — agent
                // may change on escalation).
                const translated =
                    prompt !== undefined && isClaudeStyleSlashCommand(prompt)
                        ? translateSlashCommand(agent, prompt)
                        : undefined;
                const input = translated ?? prompt;

                const promptOptions: PromptOptions = {
                    input,
                    continue: continueFlag || undefined,
                    model,
                    mode: mode as 'text' | 'json',
                    ...(purpose !== undefined ? { purpose } : {}),
                    ...(tags !== undefined ? { tags } : {}),
                    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
                    ...(taskId !== undefined ? { taskId } : {}),
                    ...(sessionDir !== undefined ? { sessionDir } : {}),
                    ...(sessionId !== undefined ? { sessionId } : {}),
                };

                // Resolve shim command. On the first attempt a failure is a
                // hard error. On escalation attempts the prior result stands.
                let shimCommand: { command: string; args: string[] };
                try {
                    shimCommand =
                        typeof runner.buildPromptCommand === 'function'
                            ? runner.buildPromptCommand(agent, promptOptions, { cwd: cwd || undefined })
                            : getAgentShim(agent).getPromptCommand(promptOptions);
                    if (!jsonOutput) {
                        const version = (await detector.detectOne(agent)).version;
                        this.ctx.output.error(
                            `⚙️  ${agent}${version !== null ? ` v${version}` : ''}\n   ${shimCommand.command} ${shimCommand.args.join(' ')}`,
                        );
                    }
                } catch (error) {
                    if (attempt === 0) {
                        await sessionObserver?.resolve();
                        return {
                            ok: false,
                            exitCode: 2,
                            message: error instanceof Error ? error.message : String(error),
                        };
                    }
                    if (!jsonOutput) {
                        this.ctx.output.error(
                            `Escalation aborted: ${error instanceof Error ? error.message : String(error)}`,
                        );
                    }
                    break;
                }

                // Capture invocation for the workflow run trace.
                const traceInput = input === undefined ? undefined : traceSafePrompt(input);
                const attemptInvocation: AgentRunInvocation = {
                    agent,
                    source: currentSource,
                    ...(currentRole !== undefined ? { role: currentRole } : {}),
                    ...(currentRoleOrigin !== undefined ? { roleOrigin: currentRoleOrigin } : {}),
                    ...(currentTier !== undefined ? { tier: currentTier } : {}),
                    ...(currentExecutor !== undefined ? { executor: currentExecutor } : {}),
                    command: shimCommand.command,
                    argv: sanitizeInvocationArgv(shimCommand.args, input, traceInput),
                    ...(cwd !== '' ? { cwd } : {}),
                    mode: mode as 'text' | 'json',
                    outputMode,
                    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
                    continue: continueFlag,
                    stdinInteractive: false,
                    ...(model !== undefined ? { model } : {}),
                    ...(sessionId !== undefined ? { sessionId } : {}),
                    ...(translated !== undefined && prompt !== undefined
                        ? { translatedFrom: traceSafePrompt(prompt) }
                        : {}),
                };

                // Start lifecycle ONCE before first dispatch.
                if (attempt === 0) {
                    lifecycle.start({
                        agent,
                        ...(model !== undefined ? { model } : {}),
                        invocation: `${attemptInvocation.command} ${attemptInvocation.argv.join(' ')}`,
                        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
                        ...(routing !== undefined ? { routing } : {}),
                    });
                    dispatchStartedAt = Date.now();
                }

                // Watermark the session root right before dispatch (E6): a
                // cheap timestamp capture; on escalation the agent may change,
                // so re-watermark when the root does.
                await sessionObserver?.watermark(agent, sessionDir);

                // Dispatch
                try {
                    result = await runner.runPromptCommand(agent, promptOptions, {
                        cwd: cwd || undefined,
                        ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
                        signal: controller.signal,
                        correlation: lifecycle.identity,
                        onOutput: (output) => lifecycle.observe(output),
                    });
                } catch (error) {
                    if (attempt === 0) {
                        lifecycle.finish({
                            exitCode: null,
                            durationMs: Date.now() - dispatchStartedAt,
                            ...(controller.signal.aborted ? { reason: 'cancelled' } : {}),
                            ...(!controller.signal.aborted
                                ? { reason: error instanceof Error ? error.message : String(error) }
                                : {}),
                        });
                        await sessionObserver?.resolve();
                        return {
                            ok: false,
                            exitCode: 2,
                            message: error instanceof Error ? error.message : String(error),
                        };
                    }
                    // Escalation dispatch failure — prior result stands.
                    if (!jsonOutput) {
                        this.ctx.output.error(
                            `Escalation dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
                        );
                    }
                    break;
                }
                invocation = attemptInvocation;

                // Success — done.
                if (result.exitCode === 0) break;

                // Attempt escalation (0407 R1/R2/R6).
                const escalationSignal = classifyObjectiveFailure(result);
                if (escalationSignal === undefined || currentStage === undefined) {
                    break;
                }
                const matchingFallbacks = currentStage.policy.fallback.filter(
                    (fallback) => fallback.trigger === escalationSignal,
                );
                // Resource exhaustion is availability routing: the run-scoped
                // attempted set makes the executor walk finite and lets the next
                // resolution produce the honest chain-exhausted diagnostic. Other
                // signals retain the policy's explicit fallback-count bound.
                if (
                    matchingFallbacks.length === 0 ||
                    (escalationSignal !== 'resource-exhaustion' && attempt >= matchingFallbacks.length)
                ) {
                    break;
                }

                // Re-resolve with escalation flags to pick the next executor.
                // R3: exclude executors already attempted this run so the ladder
                // walks to the next eligible candidate instead of re-selecting the
                // same dead executor and breaking on attemptedExecutors.has(...).
                runFlags.signal = escalationSignal;
                runFlags['from-executor'] = currentStage.executorName;
                const nextResolved = await this.resolveAgent(runFlags, doctorRunner, attemptedExecutors);
                if (
                    !nextResolved.ok ||
                    nextResolved.stage === undefined ||
                    attemptedExecutors.has(nextResolved.stage.executorName)
                ) {
                    // Chain exhausted (R4 / 0540 R2) — name the stage, the
                    // tiers attempted, and the executors tried. The run then
                    // ends non-zero with the last result; it never falls
                    // through to agent.default or a bare binary.
                    if (!jsonOutput) {
                        this.ctx.output.error(
                            `Escalation chain exhausted after ${attempt + 1} attempt(s); stage=${currentStage.stageId}; tiers attempted: ${[...tiersAttempted].join(', ')}; executors tried: ${[...attemptedExecutors].join(', ')}`,
                        );
                    }
                    // Structured twin of the human diagnostic so --json runs are
                    // not silent about exhaustion (review 0540 minor: the stderr
                    // line was json-suppressed with no event equivalent).
                    if (this.ctx.events !== undefined) {
                        void this.ctx.events.emit('agent.invoke.exhausted', {
                            runId: lifecycle.identity.runId,
                            executionId: lifecycle.identity.executionId,
                            ...(lifecycle.identity.actionId !== undefined
                                ? { actionId: lifecycle.identity.actionId }
                                : {}),
                            stage: currentStage.stageId,
                            tiersAttempted: [...tiersAttempted],
                            executorsTried: [...attemptedExecutors],
                            attempts: attempt + 1,
                            severity: 'error',
                        });
                    }
                    break;
                }

                // Escalating (R3) — report which executor failed and why.
                if (!jsonOutput) {
                    this.ctx.output.error(
                        `Escalating: ${currentStage.executorName} (tier ${currentStage.executorTier}) failed with ${escalationSignal}; retrying on ${nextResolved.stage.executorName} (tier ${nextResolved.stage.executorTier})`,
                    );
                }
                // 0545 R2: the escalation is its OWN record — originating tier,
                // resulting tier, and the objective trigger — never a null-valued
                // field on the starting decision. Absence of this row is the
                // "did not escalate" signal; runs that never escalate emit none.
                // Correlation rides the payload so the row joins on run_id.
                if (this.ctx.events !== undefined) {
                    void this.ctx.events.emit('agent.invoke.escalated', {
                        runId: lifecycle.identity.runId,
                        executionId: lifecycle.identity.executionId,
                        ...(lifecycle.identity.actionId !== undefined ? { actionId: lifecycle.identity.actionId } : {}),
                        fromExecutor: currentStage.executorName,
                        fromTier: currentStage.executorTier,
                        toExecutor: nextResolved.stage.executorName,
                        toTier: nextResolved.stage.executorTier,
                        trigger: escalationSignal,
                        severity: 'warning',
                    });
                }
                currentAgent = nextResolved.agent;
                currentModel = nextResolved.model;
                currentSource = nextResolved.source;
                currentStage = nextResolved.stage;
                currentRole = nextResolved.role;
                currentRoleOrigin = nextResolved.roleOrigin;
                dispatchExecutor.setRoleEnv(currentRole);
                currentTier = nextResolved.tier;
                currentExecutor = nextResolved.executor;
                // 0545 R1: re-stamp the routing context so the next dispatch's
                // `agent.invoke.*` payloads carry the escalated decision.
                routing = buildRoutingAttribution(nextResolved);
                attemptedExecutors.add(nextResolved.stage.executorName);
                tiersAttempted.add(nextResolved.stage.executorTier);
            }
        } finally {
            process.off('SIGTERM', onTerminate);
            process.off('SIGINT', onTerminate);
            options.execution?.signal?.removeEventListener('abort', onExternalAbort);

            // Finalize the coordination run row (terminal status + artifact paths).
            if (occupantRef !== undefined && coordinationRunId !== undefined && this.ctx.getDb !== undefined) {
                try {
                    const dao = new CoordinationRunDao(await this.ctx.getDb());
                    const status: 'exited' | 'errored' = result?.exitCode === 0 ? 'exited' : 'errored';
                    const refs = await this.resolveArtifactRefs(coordinationRunId);
                    await dao.updateExit(coordinationRunId, status, new Date().toISOString(), JSON.stringify(refs));
                } catch (error) {
                    if (!jsonOutput) {
                        this.ctx.output.error(
                            `Warning: occupant exit persist failed: ${error instanceof Error ? error.message : String(error)}`,
                        );
                    }
                }
            }
        }

        // Impossible-state guard: the loop always dispatches at least once.
        if (result === undefined || invocation === undefined) {
            lifecycle.finish({
                exitCode: null,
                durationMs: Date.now() - dispatchStartedAt,
                reason: 'no dispatch attempted',
            });
            await sessionObserver?.resolve();
            return { ok: false, exitCode: 2, message: 'No dispatch attempted' };
        }

        lifecycle.finish({
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            usage: normalizeAgentUsage(
                (result as unknown as { usage?: unknown }).usage,
                'runner result carries no structured usage',
            ),
            ...(result.signal !== undefined ? { signal: result.signal } : {}),
            ...(controller.signal.aborted && result.signal === undefined ? { reason: 'cancelled' } : {}),
        });

        // Record the run→session mapping (E6) after the agent has exited — the
        // outcome is already decided, so resolution failure cannot affect it (R5).
        await sessionObserver?.resolve();

        return {
            ok: true,
            result,
            invocation,
            ...(occupantRef !== undefined ? { coordination: { occupant: occupantRef } } : {}),
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
    // Private: agent resolution
    // -------------------------------------------------------------------------

    private async resolveAgent(
        flags: Record<string, string | boolean>,
        doctorRunner: DoctorRunner,
        exclude?: ReadonlySet<string>,
    ): Promise<AgentResolveResult> {
        // 0687 R1: `inline` is the default selector; omission and explicit
        // `inline` resolve identically.
        const raw = stringFlag(flags, 'agent', 'inline');
        if (raw === 'auto') return this.resolveAgentAuto(flags, doctorRunner, exclude);
        // 0687 R3: the retired G5 headless rejection — an `inline` request that
        // reaches AgentService IS on a dispatch surface (a host-session inline
        // never gets here), so resolve through the tier chain and warn once
        // naming the substitution; never fail the dispatch over the selector.
        if (raw === 'inline') {
            const res = await this.resolveAgentAuto(flags, doctorRunner, exclude);
            if (res.ok) {
                const target =
                    res.role !== undefined
                        ? `${res.executor ?? res.agent} via role/${res.tier ?? res.role}`
                        : (res.executor ?? res.agent);
                this.ctx.output.error(
                    `--agent inline requested on a headless surface (no host session); resolved ${target} — substituted tier resolution`,
                );
            }
            return res;
        }
        // Executor-aware (0346): explicit `--agent <name>` reuses the same
        // executor-first lookup as `agent.default`; a role (0536 R1) is matched
        // first inside resolveExecutorSelector. No phase map is consulted
        // for the *starting* pick (R8: --agent wins; default-by-phase removed
        // 0452; prompt-regex phase removed 0536 R4). The pin chooses where a run
        // starts; it must not disable the escalation ladder (0482 R1) — see
        // resolvePinned.
        return this.resolvePinned(raw, flags, doctorRunner, exclude);
    }

    /**
     * Resolve a pinned executor (0482 R1). The pin decides which executor a run
     * *starts* on; it must not silently opt the run out of the resource-exhaustion
     * escalation ladder (the 0407 mechanism was unreachable because a pinned
     * dispatch resolved with no stage, so `currentStage`/`maxEscalations` were 0).
     * Two cases:
     *  - Escalation hop (`signal` present): the pin already chose the failed
     *    starting executor — route through the phase-resolved stage's model_policy
     *    so the fallback tier chain can move to the next eligible executor.
     *  - Initial pick: resolve the concrete pinned executor, then attach the
     *    phase-resolved stage context (policy only) so executeRun's escalation
     *    loop is reachable with `currentStage` populated.
     */
    private async resolvePinned(
        selector: string,
        flags: Record<string, string | boolean>,
        doctorRunner: DoctorRunner,
        exclude?: ReadonlySet<string>,
    ): Promise<AgentResolveResult> {
        if (stringFlag(flags, 'signal', '') !== '') {
            const stageRecord = this.resolveCanonicalStage(flags);
            if (stageRecord !== undefined) {
                const stageRes = await this.resolveStageModelPolicy(stageRecord, flags, doctorRunner, exclude);
                if (stageRes !== undefined) return stageRes;
            }
        }
        const base = await this.resolveExecutorSelector(selector, doctorRunner, 'explicit');
        if (!base.ok) return base;
        // Role attribution (0538 R2 / 0551 R2): the pin beats role routing, but a
        // declared role is still recorded on the resolution so the --json envelope
        // carries both values (0536 R2) — the reason survives removing the pin
        // later. With nothing declared, the run inherits the dispatcher's role
        // (0551) — recorded as roleOrigin: 'inherited'; the pin still wins routing.
        // `base.role === undefined` guards the `--agent <role>` selector, which
        // already resolved through the role and carries its own origin.
        const declaredRole = stringFlag(flags, 'role', '');
        let attributed = base;
        if (declaredRole !== '') {
            attributed = { ...base, role: declaredRole, roleOrigin: 'declared' };
        } else if (base.role === undefined) {
            const inherited = this.inheritedRole();
            if (inherited !== undefined && this.ctx.roles?.get(inherited) !== undefined) {
                attributed = { ...base, role: inherited, roleOrigin: 'inherited' };
            } else if (inherited !== undefined) {
                // Mirror the auto path's warning (0551 R3): a stale SPUR_ROLE under
                // a pin must not vanish silently — attribution is dropped but the
                // observation stays visible. Routing is unaffected (the pin wins).
                this.ctx.output.error(
                    `Warning: ignoring inherited role '${inherited}' — not in ${this.roleVocabulary()}`,
                );
            }
        }
        const stageRecord = this.resolveCanonicalStage(flags);
        // Role-resolved selectors carry the winning executor in `base.executor`;
        // the pin-attach below assumes the selector IS the executor name, so it
        // applies only to executor/binary pins (0536 R1).
        if (stageRecord !== undefined && base.source !== 'role') {
            const executors = this.ctx.agentConfig?.executors;
            const pinned = executors?.find((e) => e.name === selector);
            const tier = pinned !== undefined ? getExecutorTier(pinned) : stageRecord.model_policy.min_tier;
            return {
                ...attributed,
                stage: {
                    stageId: stageRecord.id,
                    policy: stageRecord.model_policy,
                    executorName: selector,
                    executorTier: tier,
                },
            };
        }
        return attributed;
    }

    /**
     * Resolve the canonical stage for this dispatch: an explicit `stage` flag when
     * one is supplied, otherwise the stage folded by the **declared role**.
     *
     * The role fallback is what makes stage routing reachable at all. Prompt-text
     * phase derivation was removed in 0536 R4 and `default-by-phase` in 0452, which
     * left the explicit flag as the only input — and no caller sets it: not the CLI
     * (`spur agent run` has no such option), not the workflow `agent.run` action,
     * not the server. So `model_policy`, the fallback tier chain, and
     * resource-exhaustion failover were unreachable outside tests, including the
     * 0482 R1 repair of exactly that condition. Roles are the input production
     * actually carries: every pipeline `agent.run` step declares one (0538 R2) and
     * the action forwards it as `flags.role`.
     *
     * Picking the role's highest-`min_tier` stage (ties → declaration order) keeps
     * the starting executor identical to plain role routing — roles.md R4 pins the
     * role's tier at that same floor — so this widens what the ladder can do
     * without moving where a run begins.
     */
    private resolveCanonicalStage(flags: Record<string, string | boolean>): StageRecord | undefined {
        const stageFlag = stringFlag(flags, 'stage', '');
        if (stageFlag !== '') return getCanonicalStage(stageFlag);

        const declared = stringFlag(flags, 'role', '') || this.inheritedRole() || '';
        if (declared === '') return undefined;
        return this.stageForRole(declared);
    }

    /**
     * The stage a role routes through: the folded stage with the highest
     * `min_tier`, ties broken by declaration order. Undefined when the role is
     * unknown, folds no stage, or names a stage absent from the registry.
     */
    private stageForRole(role: string): StageRecord | undefined {
        const stages = this.ctx.roles?.get(role)?.stages ?? [];
        let best: StageRecord | undefined;
        for (const id of stages) {
            const record = getCanonicalStage(id);
            if (record === undefined) continue;
            if (best === undefined || TIER_RANK[record.model_policy.min_tier] > TIER_RANK[best.model_policy.min_tier]) {
                best = record;
            }
        }
        return best;
    }

    /**
     * Resolve `--agent auto` using stage-registry model routing (R1/R2/R3):
     *  1. Resolve canonical `stage_id` from the explicit `--stage` flag.
     *  2. If stage found, consume `model_policy` and start on the cheapest eligible executor.
     *     Objective escalation signals (`--signal`) trigger fallback entries.
     *  3. No stage falls through to `agent.default` selector, then Tier-1 priority.
     * (`default-by-phase` removed in task 0452; prompt-regex phase removed in 0536 R4 —
     * stage model_policy is the only adaptive path, gated on the explicit flag.)
     */
    private async resolveAgentAuto(
        flags: Record<string, string | boolean>,
        doctorRunner: DoctorRunner,
        exclude?: ReadonlySet<string>,
    ): Promise<AgentResolveResult> {
        const config = this.ctx.agentConfig;

        // Escalation hop (`signal` present): the role already chose the executor that
        // failed, so re-resolving through the role would return it again and the loop
        // would read that as an exhausted chain. Route through the stage's
        // `model_policy` instead so the fallback tier can advance — the same carve-out
        // `resolvePinned` makes for pins (0482 R1). Initial dispatches carry no signal
        // and are unaffected.
        if (stringFlag(flags, 'signal', '') !== '') {
            const hopStage = this.resolveCanonicalStage(flags);
            if (hopStage !== undefined) {
                const hopRes = await this.resolveStageModelPolicy(hopStage, flags, doctorRunner, exclude);
                if (hopRes !== undefined) return hopRes;
            }
        }

        // Declared role (0538 R1/R2): `--agent auto` means "use the role the caller
        // declared" (command frontmatter or workflow step). The declared role picks
        // the starting tier; with nothing declared it falls to `agent.default`
        // (0542) then priority. Unknown declared role fails loudly — a stale
        // declaration must not silently route as a bare binary name.
        const declaredRole = stringFlag(flags, 'role', '');
        if (declaredRole !== '') {
            const roleTier = this.ctx.roles?.get(declaredRole)?.tier;
            if (roleTier === undefined) {
                return {
                    ok: false,
                    exitCode: 2,
                    message: `Unknown declared role: '${declaredRole}'. Accepted: ${this.roleVocabulary()}.`,
                };
            }
            return this.resolveRole(declaredRole, roleTier, doctorRunner, 'declared');
        }

        // Stage-registry adaptive model routing (R1/R2/R3). Explicit flag only:
        // a role-derived stage must not preempt the inherited-role branch below,
        // which owns `roleOrigin: 'inherited'` attribution (0551 R2). Role
        // dispatches still carry stage context — `resolveRole` attaches it.
        const stageRecord = stringFlag(flags, 'stage', '') !== '' ? this.resolveCanonicalStage(flags) : undefined;
        if (stageRecord !== undefined) {
            const stageRes = await this.resolveStageModelPolicy(stageRecord, flags, doctorRunner, exclude);
            if (stageRes !== undefined) {
                return stageRes;
            }
        }

        // Inherited role (0551 R2): nothing declared and no explicit stage — a
        // fan-out subagent inherits the dispatcher's effective role via SPUR_ROLE
        // and resolves through that role's tier. An unknown inherited role (stale
        // env) warns once and falls through to default/priority — inheritance
        // must never hard-fail a dispatch.
        const inherited = this.inheritedRole();
        if (inherited !== undefined) {
            const inheritedTier = this.ctx.roles?.get(inherited)?.tier;
            if (inheritedTier === undefined) {
                this.ctx.output.error(
                    `Warning: ignoring inherited role '${inherited}' — not in ${this.roleVocabulary()}`,
                );
            } else {
                return this.resolveRole(inherited, inheritedTier, doctorRunner, 'inherited');
            }
        }

        // No phase/stage mapping: try the default executor selector, then priority.
        if (config?.default !== undefined) {
            const viaDefault = await this.resolveExecutorSelector(config.default, doctorRunner, 'default');
            if (viaDefault.ok) return viaDefault;
            // R2 (0542): agent.default's value domain is roles — an unknown value
            // must fail loudly naming both accepted sets, never silently fall to
            // Tier-1 priority (the old legacy-agent fallthrough is retired).
            if (viaDefault.exitCode === 2) return viaDefault;
        }

        return this.resolveAgentPriority(doctorRunner);
    }

    /**
     * Consume `model_policy` for a canonical stage and pick starting/fallback executor.
     */
    private async resolveStageModelPolicy(
        stageRecord: StageRecord,
        flags: Record<string, string | boolean>,
        doctorRunner: DoctorRunner,
        exclude?: ReadonlySet<string>,
    ): Promise<AgentResolveResult | undefined> {
        const executors = this.ctx.agentConfig?.executors;
        if (!executors || executors.length === 0) {
            return undefined;
        }

        const policy = stageRecord.model_policy;
        const signalRaw = stringFlag(flags, 'signal', '');
        const signal = signalRaw.length > 0 ? (signalRaw as ObjectiveEscalationSignal) : undefined;
        const fromExecutor = stringFlag(flags, 'from-executor', '') || undefined;

        // R4 — sideways availability failover. A `resource-exhaustion` signal means
        // *this account/binary is dead right now* (a 5-hour usage limit), so the
        // answer is an availability failover onto a same-tier executor on a DIFFERENT
        // agent binary, not a quality escalation up-tier (which would land on another
        // executor sharing the same dead binary — 9 of 13 executors share `omp`).
        // Try same-tier, different-binary, not-yet-attempted executors in array order
        // first; only when none is usable fall through to the fallback-tier path.
        if (signal === 'resource-exhaustion' && fromExecutor !== undefined) {
            const failed = executors.find((e) => e.name === fromExecutor);
            if (failed !== undefined) {
                const failedTier = getExecutorTier(failed);
                const failedCanonical = resolveAgentName(failed.agent);
                // An exhaustion signal invalidates the underlying binary/account,
                // not only one executor alias. Derive every exhausted binary from
                // the run-scoped attempted set so the ladder never bounces back to
                // another model entry backed by the same dead account.
                const exhaustedAgents = new Set(
                    executors
                        .filter((executor) => executor.name === fromExecutor || (exclude?.has(executor.name) ?? false))
                        .map((executor) => resolveAgentName(executor.agent))
                        .filter((agent): agent is AgentName => agent !== undefined),
                );
                const sideways = executors.filter((e) => {
                    const canonical = resolveAgentName(e.agent);
                    return (
                        e.name !== fromExecutor &&
                        getExecutorTier(e) === failedTier &&
                        canonical !== failedCanonical &&
                        (canonical === undefined || !exhaustedAgents.has(canonical)) &&
                        !(exclude?.has(e.name) ?? false)
                    );
                });
                for (const executor of sideways) {
                    const canonical = resolveAgentName(executor.agent);
                    if (canonical === undefined) {
                        return {
                            ok: false,
                            exitCode: 2,
                            message: `Executor '${executor.name}' for stage '${stageRecord.id}' maps to unknown agent '${executor.agent}'`,
                        };
                    }
                    const usable = await this.checkUsable(canonical, doctorRunner);
                    if (usable.ok) {
                        this.ctx.output.error(
                            `Failover: ${fromExecutor} (tier ${failedTier}) exhausted; using same-tier ${executor.name} on a different binary`,
                        );
                        return {
                            ok: true,
                            agent: canonical,
                            model: executor.model,
                            source: 'stage',
                            stage: {
                                stageId: stageRecord.id,
                                policy,
                                executorName: executor.name,
                                executorTier: getExecutorTier(executor),
                            },
                        };
                    }
                }
                // Sideways list empty or none usable — fall through to fallback tier.
            }
        }

        let targetTier: CapabilityTier = policy.min_tier;

        if (signal !== undefined) {
            const currentExec = executors.find((e) => e.name === fromExecutor);
            const currentTier = currentExec ? getExecutorTier(currentExec) : undefined;
            const fallback = getNextFallback(policy, signal, currentTier);
            if (fallback) {
                targetTier = fallback.tier;
                if (fromExecutor) {
                    this.ctx.output.error(
                        `Stage escalation: stage=${stageRecord.id} signal=${signal} from=${fromExecutor} to tier=${targetTier}`,
                    );
                }
            }
        }

        // 0540 R3 — a tier with no configured executor is unreachable, not a
        // failed rung: a gap in the operator's tier ladder (e.g. `capable-2`
        // commented out) must be distinguished from exhaustion. The eligible
        // walk below continues from the next reachable tier (>= targetTier), so
        // the run proceeds instead of terminating as exhausted.
        if (!executors.some((e) => getExecutorTier(e) === targetTier)) {
            // Once per stage+tier per service instance (review 0540 minor:
            // the per-dispatch repetition made every run through a gap noisy
            // without adding information — the first warning carries it all).
            const warnKey = `${stageRecord.id}:${targetTier}`;
            if (!this.unreachableTierWarnings.has(warnKey)) {
                this.unreachableTierWarnings.add(warnKey);
                this.ctx.output.error(
                    `Stage '${stageRecord.id}': tier ${targetTier} is unreachable — no executor configured at this tier; continuing from the next reachable tier`,
                );
            }
        }

        // Filter candidate executors whose capability meets targetTier (R3: never
        // re-select an executor already attempted this run — exclusion empties the
        // list, resolveStageModelPolicy returns undefined, and the caller reports
        // "chain exhausted" instead of re-dispatching the same dead executor).
        const exhaustedAgents =
            signal === 'resource-exhaustion'
                ? new Set(
                      executors
                          .filter((executor) => exclude?.has(executor.name) ?? false)
                          .map((executor) => resolveAgentName(executor.agent))
                          .filter((agent): agent is AgentName => agent !== undefined),
                  )
                : undefined;
        const eligible = executors.filter((e) => {
            const canonical = resolveAgentName(e.agent);
            return (
                isTierEligible(getExecutorTier(e), targetTier) &&
                !(exclude?.has(e.name) ?? false) &&
                (canonical === undefined || !(exhaustedAgents?.has(canonical) ?? false))
            );
        });
        if (eligible.length === 0) {
            return undefined;
        }

        // Sort by tier ascending (cheapest eligible first)
        eligible.sort((a, b) => TIER_RANK[getExecutorTier(a)] - TIER_RANK[getExecutorTier(b)]);

        for (const executor of eligible) {
            const canonical = resolveAgentName(executor.agent);
            if (canonical === undefined) {
                return {
                    ok: false,
                    exitCode: 2,
                    message: `Executor '${executor.name}' for stage '${stageRecord.id}' maps to unknown agent '${executor.agent}'`,
                };
            }
            const usable = await this.checkUsable(canonical, doctorRunner);
            if (usable.ok) {
                return {
                    ok: true,
                    agent: canonical,
                    model: executor.model,
                    source: 'stage',
                    stage: {
                        stageId: stageRecord.id,
                        policy,
                        executorName: executor.name,
                        executorTier: getExecutorTier(executor),
                    },
                };
            }
        }

        return undefined;
    }

    /** Legacy static Tier-1 priority resolution (preserved fallback). */
    private async resolveAgentPriority(doctorRunner: DoctorRunner): Promise<AgentResolveResult> {
        const results = await doctorRunner.runAll();
        for (const name of TIER1_PRIORITY) {
            const match = results.find((r) => r.agent === name);
            if (match?.usable) return { ok: true, agent: name, source: 'priority' };
        }
        return { ok: false, exitCode: 1, message: 'No usable Tier-1 agent found' };
    }

    /**
     * Resolve an executor selector to an execution profile. Sources:
     *  - `phase` — legacy source tag (default-by-phase removed 0452).
     *  - `default` — from `agent.default`; falls through to legacy agent name.
     *  - `explicit` — from `--agent <name>` (0346); executor-first then binary (R8).
     *
     * Collision precedence (R3): when an executor and an agent binary share a
     * name, the executor wins. To reach a bare binary whose name is shadowed
     * by an executor entry, the user must remove or rename the executor.
     */
    private async resolveExecutorSelector(
        selector: string,
        doctorRunner: DoctorRunner,
        source: 'phase' | 'default' | 'explicit',
        phase?: string,
    ): Promise<AgentResolveResult> {
        // Role branch (0536 R1): a role selects the *starting* tier and resolution
        // starts from that tier's cheapest eligible executor. Role-first match —
        // 0537's collision guard proves roles and executor names pairwise disjoint.
        const roleTier = this.ctx.roles?.get(selector)?.tier;
        if (roleTier !== undefined) {
            return this.resolveRole(
                selector,
                roleTier,
                doctorRunner,
                // `--agent <role>` (explicit) is a declaration; `agent.default`
                // routing through a role value is config, not a declaration.
                source === 'explicit' ? 'declared' : undefined,
                // 0545 R1: a default-routed role is a *defaulted* selection, not a
                // declared role resolution — the four selection sources (role /
                // pin / default / escalated) must stay distinct in attribution.
                source === 'default' ? 'default' : 'role',
            );
        }

        const executor = this.ctx.agentConfig?.executors?.find((e) => e.name === selector);
        const phaseSuffix = phase !== undefined ? ` for phase '${phase}'` : '';

        if (executor !== undefined) {
            // R2 (0542): agent.default's value domain is now role ids; a configured
            // executor name is the legacy value — warn once under the registered shim.
            if (source === 'default') {
                warnAgentDefaultExecutorOnce(selector, this.ctx.output);
            }
            const canonical = resolveAgentName(executor.agent);
            if (canonical === undefined) {
                return {
                    ok: false,
                    exitCode: 2,
                    message: `Executor '${executor.name}'${phaseSuffix} maps to unknown agent '${executor.agent}'`,
                };
            }
            const usable = await this.checkUsable(canonical, doctorRunner);
            if (!usable.ok) {
                // A configured phase mapping must fail fast (R7); a default-path miss falls through.
                if (phase !== undefined) {
                    return {
                        ok: false,
                        exitCode: 1,
                        message: `Executor '${executor.name}'${phaseSuffix} agent '${canonical}' is not usable — ${usable.reason} (spur agent doctor)`,
                    };
                }
                return usable.result;
            }
            // R2 (0536): an explicit executor name is a permanent pin, not a shim —
            // no deprecation warning. The name is carried for the --json envelope,
            // and the executor's capability tier rides the result so routing
            // attribution (0545 R1) records the resolved tier for explicit/default
            // selections too (not only role/stage resolutions).
            return {
                ok: true,
                agent: canonical,
                model: executor.model,
                source,
                executor: executor.name,
                tier: getExecutorTier(executor),
            };
        }

        // No configured executor by this name.
        if (phase !== undefined) {
            // R7: an explicitly-mapped phase naming a missing executor exits 2.
            return {
                ok: false,
                exitCode: 2,
                message: `Unknown executor '${selector}'${phaseSuffix} — define it under agent.executors`,
            };
        }

        // R2 (0542): agent.default is a role now; a value that is neither a role
        // nor a configured executor fails naming both accepted sets — it must not
        // silently resolve as a legacy direct agent name (the value domain moved).
        if (source === 'default') {
            const roleNames = this.ctx.roles !== undefined ? [...this.ctx.roles.keys()].join(', ') : '';
            const names = this.ctx.agentConfig?.executors?.map((e) => e.name) ?? [];
            const roleList = roleNames !== '' ? `role (${roleNames})` : 'a role';
            const executorList =
                names.length > 0 ? `configured executor (${names.join(', ')})` : 'a configured executor';
            return {
                ok: false,
                exitCode: 2,
                message: `Unknown agent.default value: '${selector}'. Accepted: ${roleList} or ${executorList}.`,
            };
        }

        // Default/explicit path: treat the selector as a legacy direct agent name.
        const canonical = resolveAgentName(selector);
        if (canonical === undefined) {
            // Task 0413 (R8) / 0536 (R3): surface the accepted sets so a typo does
            // not look like an opaque failure. The agent-name space is open, so
            // name the closed role vocabulary and the configured executors.
            const roleNames = this.ctx.roles !== undefined ? [...this.ctx.roles.keys()].join(', ') : '';
            const names = this.ctx.agentConfig?.executors?.map((e) => e.name) ?? [];
            const roleList = roleNames !== '' ? `role (${roleNames})` : 'a role';
            const executorList =
                names.length > 0 ? `configured executor (${names.join(', ')})` : 'a configured executor';
            return {
                ok: false,
                exitCode: 2,
                message: `Unknown agent: '${selector}'. Accepted: ${roleList}, ${executorList}, 'inline', or 'auto'.`,
            };
        }
        // R3 (0536): a bare coding-agent binary name (no matching executor entry)
        // keeps working during the transition, under a registered shim — warn once.
        // Only the explicit `--agent` surface warns: the `agent.default` value
        // domain migration is task 0542's own three-way branch and shim.
        if (source === 'explicit') {
            warnBareBinaryOnce(selector, this.ctx.output);
        }
        const usable = await this.checkUsable(canonical, doctorRunner);
        if (!usable.ok) return usable.result;
        return { ok: true, agent: canonical, source };
    }

    /**
     * Resolve a role selector (0536 R1): role → tier → cheapest eligible executor.
     * Mirrors the stage-policy walk — eligible executors (tier at or above the
     * role's tier) sorted by tier ascending, first usable wins. No stage context
     * is attached: a role picks the *starting* tier; escalation stays
     * stage-policy-driven (0348). `role`/`tier`/`executor` ride the result for
     * the `--json` envelope (R1), along with `roleOrigin` when `origin` is set
     * (0551).
     */
    private async resolveRole(
        role: string,
        roleTier: CapabilityTier,
        doctorRunner: DoctorRunner,
        origin?: 'declared' | 'inherited',
        // 0545 R1: 'role' for declared/inherited role resolutions; 'default'
        // when the selector came from `agent.default` so the selection source
        // stays distinguishable in attribution.
        source: AgentResolveSource = 'role',
    ): Promise<AgentResolveResult> {
        const executors = this.ctx.agentConfig?.executors;
        if (executors === undefined || executors.length === 0) {
            return {
                ok: false,
                exitCode: 1,
                message: `No executors configured to serve role '${role}' (tier ${roleTier}) — define executors under agent.executors`,
            };
        }
        const eligible = cheapestEligibleExecutors(executors, roleTier);
        for (const executor of eligible) {
            const canonical = resolveAgentName(executor.agent);
            if (canonical === undefined) {
                return {
                    ok: false,
                    exitCode: 2,
                    message: `Executor '${executor.name}' for role '${role}' maps to unknown agent '${executor.agent}'`,
                };
            }
            const usable = await this.checkUsable(canonical, doctorRunner);
            if (usable.ok) {
                // Attach the role's stage context (0482 R1 did the same for pins):
                // without it `executeRun` sees no `currentStage`, `maxEscalations`
                // is 0, and the fallback ladder cannot run. The stage only supplies
                // the policy — the executor and tier above are already chosen, so
                // this widens what a failure can do without moving where the run starts.
                const stageRecord = this.stageForRole(role);
                return {
                    ok: true,
                    agent: canonical,
                    model: executor.model,
                    source,
                    role,
                    ...(origin !== undefined ? { roleOrigin: origin } : {}),
                    tier: roleTier,
                    executor: executor.name,
                    ...(stageRecord !== undefined
                        ? {
                              stage: {
                                  stageId: stageRecord.id,
                                  policy: stageRecord.model_policy,
                                  executorName: executor.name,
                                  executorTier: roleTier,
                              },
                          }
                        : {}),
                };
            }
        }
        const tried = eligible.length > 0 ? eligible.map((e) => e.name).join(', ') : 'none eligible';
        return {
            ok: false,
            exitCode: 1,
            message: `No usable executor for role '${role}' (tier ${roleTier}) — tried: ${tried} (spur agent doctor)`,
        };
    }

    /**
     * The dispatcher's effective role, threaded through SPUR_ROLE (0551 R2).
     * Absent/empty → undefined (top-level dispatch, no inheritance).
     */
    private inheritedRole(): string | undefined {
        const raw = this.ctx.env.SPUR_ROLE;
        return raw !== undefined && raw !== '' ? raw : undefined;
    }

    /**
     * Comma-joined Layer-1 role vocabulary for error messages. Falls back to the
     * frozen four ids when no role table was threaded (0536 R3 fallback list).
     */
    private roleVocabulary(): string {
        if (this.ctx.roles !== undefined && this.ctx.roles.size > 0) {
            return [...this.ctx.roles.keys()].join(', ');
        }
        return 'scribe, coder, reviewer, planner';
    }

    /**
     * Liveness-only readiness gate (P0-a): usable = installed && version !== null.
     * Auth is NOT consulted — a logged-out agent is runnable and fails at runtime
     * with its own error. Fails fast before any long-running stage burns the timeout.
     */
    private async checkUsable(
        canonical: AgentName,
        doctorRunner: DoctorRunner,
    ): Promise<{ ok: true } | { ok: false; reason: string; result: AgentResolveResult }> {
        const result = await doctorRunner.runOne(canonical);
        if (!result.installed) {
            const message = `Agent '${canonical}' is not installed or not runnable — install it or select another agent (spur agent doctor)`;
            return { ok: false, reason: 'not installed', result: { ok: false, exitCode: 1, message } };
        }
        if (!result.usable) {
            const message = `Agent '${canonical}' is installed but not runnable (no version detected) — reinstall or select another agent (spur agent doctor)`;
            return { ok: false, reason: 'no version detected', result: { ok: false, exitCode: 1, message } };
        }
        return { ok: true };
    }

    private async statCwd(cwd: string) {
        try {
            return await createNodeFileSystem(this.ctx.cwd).stat(cwd);
        } catch {
            return null;
        }
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

    /**
     * Collect path-only artifact refs for a finished run (design §4). Probes
     * project-relative paths that exist on disk; never embeds file bodies.
     */
    private async resolveArtifactRefs(runId: string): Promise<CoordinationArtifactRef[]> {
        const refs: CoordinationArtifactRef[] = [];
        const logPath = `.spur/run/${runId}.log`;
        try {
            await createNodeFileSystem(this.ctx.cwd).stat(logPath);
            refs.push({ kind: 'log', path: logPath });
        } catch {
            // missing file → no ref
        }
        return refs;
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

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

// --- Detection cache (B4/0683) ----------------------------------------------

const DOCTOR_CACHE_REL = '.spur/run/agent-doctor.json';
const DOCTOR_CACHE_TTL_MS = 60_000;

interface DoctorCacheInfo {
    hit: boolean;
    ageMs: number | null;
    path: string;
}

interface DoctorCacheFile {
    schemaVersion: 1;
    fingerprint: string;
    capturedAt: string;
    results: DoctorResult[];
}

/**
 * Executor-set identity (R3): name-ascending `name|agent|model?|tier` lines hashed
 * with sha256. Sorting makes the key independent of config ordering; including tier
 * invalidates when inference changes. Exported for direct unit pins.
 */
export function executorFingerprint(executors: readonly AgentExecutorConfig[] | undefined): string {
    const lines = [...(executors ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => `${e.name}|${e.agent}|${e.model ?? ''}|${getExecutorTier(e)}`);
    return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** Any read failure, malformed payload, wrong schema/fingerprint, or expired entry → miss (R6). */
function readFreshDoctorCache(
    fileSystem: FileSystem,
    fingerprint: string,
    now: () => number,
): { results: DoctorResult[]; ageMs: number } | null {
    try {
        const path = fileSystem.resolve(DOCTOR_CACHE_REL);
        if (fileSystem.exists(path) !== true) return null;
        const parsed = JSON.parse(fileSystem.readFile(path) as string) as DoctorCacheFile;
        if (
            parsed === null ||
            typeof parsed !== 'object' ||
            parsed.schemaVersion !== 1 ||
            typeof parsed.fingerprint !== 'string' ||
            typeof parsed.capturedAt !== 'string' ||
            !Array.isArray(parsed.results)
        ) {
            return null;
        }
        if (parsed.fingerprint !== fingerprint) return null;
        const ageMs = now() - Date.parse(parsed.capturedAt);
        if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= DOCTOR_CACHE_TTL_MS) return null;
        return { results: parsed.results, ageMs };
    } catch {
        return null;
    }
}

/** Atomic write (temp + rename); returns an error note on failure — never throws out of the cache layer (R6). */
async function writeDoctorCacheFile(
    fileSystem: FileSystem,
    fingerprint: string,
    results: readonly DoctorResult[],
    now: () => number,
): Promise<string | null> {
    try {
        const path = fileSystem.resolve(DOCTOR_CACHE_REL);
        const tmp = `${path}.tmp`;
        const body: DoctorCacheFile = {
            schemaVersion: 1,
            fingerprint,
            capturedAt: new Date(now()).toISOString(),
            results: [...results],
        };
        await fileSystem.writeFile(tmp, JSON.stringify(body));
        await fileSystem.rename(tmp, path);
        return null;
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}

/** A role selector is served only when every eligible executor has a cached row (R8). */
function roleCoveredByCache(
    results: readonly DoctorResult[],
    executors: readonly AgentExecutorConfig[] | undefined,
    tier: CapabilityTier,
): boolean {
    const needed = cheapestEligibleExecutors(executors ?? [], tier).map((e) => e.name);
    return needed.every((name) => results.some((r) => r.agent === name));
}

/** Wraps cached rows in the DoctorRunner surface resolveRole/runAll consume — no probe, no write. */
function cachedDoctorRunner(results: DoctorResult[]): DoctorRunner {
    const runAll = (): Promise<DoctorResult[]> => Promise.resolve([...results]);
    const runOne = (agent: string): Promise<DoctorResult> => {
        const row = results.find((r) => r.agent === agent);
        return Promise.resolve(
            row ??
                ({
                    agent,
                    usable: false,
                    tier: 3 as DoctorResult['tier'],
                    error: 'not covered by cache',
                } as DoctorResult),
        );
    };
    // SAFETY: runAll/runOne satisfy DoctorRunner structurally; row shape is
    // validated by the doctor cache builder, not expressible as a nominal type.
    return { runAll, runOne } as unknown as DoctorRunner;
}

const TRACE_SAFE_SLASH_COMMAND = /^(?:\/skill:(?:sp|rd3)-|\/(?:sp|rd3)[:-]|\$(?:sp|rd3)-)[A-Za-z0-9._-]+(?:\s|$)/;
const TRACE_SAFE_SLASH_TOKEN =
    /^(?:\d{4}|--(?:auto|next|force|bdd)|--(?:mode|fix|focus)|implement|test|review|verify|all|none|blockers-first|quick|requirements|background|constraints|acceptance)$/;
const SENSITIVE_FLAG = /^--?(?:api[-_]?key|authorization|credential|password|secret|token)$/i;
const SENSITIVE_INLINE_FLAG = /^(--?(?:api[-_]?key|authorization|credential|password|secret|token)=).+$/i;

/**
 * Preserve the diagnostic identity of a slash command without persisting its
 * free-form argument payload. Ordinary prompts are fully redacted because no
 * generic secret detector can prove arbitrary prose safe.
 */
function traceSafePrompt(prompt: string): string {
    const trimmed = prompt.trim();
    if (!TRACE_SAFE_SLASH_COMMAND.test(trimmed)) {
        return `[redacted prompt: ${prompt.length} chars]`;
    }
    const [command = '', ...tokens] = trimmed.split(/\s+/);
    const safeTokens = tokens.map((token) => (TRACE_SAFE_SLASH_TOKEN.test(token) ? token : '[redacted]'));
    return [command, ...safeTokens].join(' ');
}

/** Parse a coordination_runs `artifact_refs_json` column defensively. */
function parseArtifactRefs(json: string): CoordinationArtifactRef[] {
    try {
        const parsed: unknown = JSON.parse(json);
        return Array.isArray(parsed) ? (parsed as CoordinationArtifactRef[]) : [];
    } catch {
        return [];
    }
}

/** Redact prompt-bearing and secret-bearing argv entries before trace persistence. */
function sanitizeInvocationArgv(
    argv: string[],
    rawInput: string | undefined,
    traceInput: string | undefined,
): string[] {
    let redactNext = false;
    return argv.map((arg) => {
        if (redactNext) {
            redactNext = false;
            return '[redacted]';
        }
        if (SENSITIVE_FLAG.test(arg)) {
            redactNext = true;
            return arg;
        }
        if (rawInput !== undefined && traceInput !== undefined && arg.includes(rawInput)) {
            return traceInput;
        }
        return arg
            .replace(SENSITIVE_INLINE_FLAG, '$1[redacted]')
            .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
            .replace(/\b(?:sk|ghp|github_pat)-?[A-Za-z0-9_]{12,}\b/g, '[redacted]');
    });
}

/** `--agent` values already warned as bare binary names (warn once per process — 0536 R3). */
const warnedBareBinary = new Set<string>();

/**
 * One-time transition warning for a bare coding-agent binary name passed to
 * `--agent` (no matching executor entry). Reuses a module-level set so a retry
 * / escalation loop cannot spam the operator. Only the explicit `--agent`
 * surface warns — `agent.default` migration is owned by task 0542.
 */
// @transition-shim(agent-bare-binary-name) — a bare coding-agent binary name (`codex`, `omp`, `claude`
// with no matching executor entry) remains a valid --agent value during the role transition, warned
// once; removal: no bare-binary --agent value remains in docs/, .spur/workflows/, or plugins/sp/
function warnBareBinaryOnce(selector: string, output: AgentServiceOutput): void {
    if (warnedBareBinary.has(selector)) return;
    warnedBareBinary.add(selector);
    output.error(
        `Warning: --agent "${selector}" is a bare coding-agent binary name, not a role or a configured executor. It keeps working during the transition; prefer a role (scribe, coder, reviewer, planner) or an executor name (config/transition-shims.json: agent-bare-binary-name).`,
    );
}

/** `agent.default` values already warned as legacy executor names (warn once per process — 0542 R2). */
const warnedAgentDefaultExecutor = new Set<string>();

/**
 * One-time transition warning when `agent.default` holds a configured executor
 * name instead of the new default-role value (0542 R2). The executor keeps
 * working during the transition; the value domain moved to roles.
 */
// @transition-shim(agent-default-executor) — a configured executor name in agent.default still resolves
// during the transition, warned once; removal: no agent.default value names an agent.executors entry
// (scan .spur/config.yaml and config/config.example.yaml against the agent.executors names)
function warnAgentDefaultExecutorOnce(selector: string, output: AgentServiceOutput): void {
    if (warnedAgentDefaultExecutor.has(selector)) return;
    warnedAgentDefaultExecutor.add(selector);
    output.error(
        `Warning: agent.default "${selector}" is a configured executor name, not a role. It keeps working during the transition; prefer a role (scribe, coder, reviewer, planner) (config/transition-shims.json: agent-default-executor).`,
    );
}

/**
 * Reset the process-global warn-once markers. Test seam: `bun test` batches
 * several test files per worker process, so a marker consumed by one file is
 * invisible to another on some platforms/schedules — assertions on first-warn
 * behavior must reset first.
 */
export function _resetAgentServiceShimsForTest(): void {
    warnedBareBinary.clear();
    warnedAgentDefaultExecutor.clear();
}

/** Display row: DoctorResult joined with its executor config and role eligibility (B4/0681). */
type DoctorRow = {
    /** Executor name — the cell always held this; the old column header said AGENT. */
    executor: string;
    /** Underlying binary from AgentExecutorConfig.agent; falls back to the row name. */
    agentBinary: string;
    usable: boolean;
    /** Support tier (1/2) — backs the exit code only; never rendered as TIER. */
    tier: number;
    capabilityTier: CapabilityTier;
    /** Pinned config model string; null when undeclared (never fabricated). */
    model: string | null;
    /** Tier-eligible role ids, usability-independent. */
    roles: string[];
    /** Role ids this executor is elected for (requires usable). */
    elected: string[];
    version: string | null;
    /** Probe error when unavailable — the ladder's per-row reason. */
    error: string | null;
    modelStatus?: ModelHealthResult | null;
};

/**
 * Join raw doctor results with executor configs and the role table: eligibility
 * is a pure tier function computed regardless of usability; election walks
 * `cheapestEligibleExecutors` (the dispatch order) per role and takes the first
 * usable row. No extra probe is spawned — everything derives from the rows.
 */
function buildDoctorRows(
    results: readonly DoctorResult[],
    executors: readonly AgentExecutorConfig[] | undefined,
    roles: ReadonlyMap<string, AgentRoleDefinition> | undefined,
): DoctorRow[] {
    const executorByName = new Map((executors ?? []).map((e) => [e.name, e]));
    const joined = results.map((result) => {
        // No matching executor entry (a bare binary, or no `agent.executors`
        // block) keeps the name-based inference rather than an absent tier.
        const executor = executorByName.get(result.agent) ?? { name: result.agent, agent: result.agent };
        return { result, capabilityTier: getExecutorTier(executor), model: executor.model ?? (null as string | null) };
    });
    // Election: roleId -> winning executor name. Usable lookup across all rows
    // so a role elects exactly one star carrier (no star when none usable).
    const usableByName = new Set(joined.filter((j) => j.result.usable).map((j) => j.result.agent));
    const elections = new Map<string, string>();
    if (roles !== undefined && executors !== undefined && executors.length > 0) {
        for (const [roleId, roleDef] of roles) {
            const winner = cheapestEligibleExecutors(executors, roleDef.tier).find((e) => usableByName.has(e.name));
            if (winner !== undefined) elections.set(roleId, winner.name);
        }
    }
    return joined.map(({ result, capabilityTier, model }) => ({
        executor: result.agent,
        agentBinary: executorByName.get(result.agent)?.agent ?? result.agent,
        usable: result.usable,
        tier: result.tier,
        capabilityTier,
        model,
        roles: roles ? [...roles].filter(([, rd]) => isTierEligible(capabilityTier, rd.tier)).map(([id]) => id) : [],
        elected: [...elections].filter(([, executorName]) => executorName === result.agent).map(([id]) => id),
        version: result.version,
        error: result.error,
        modelStatus: result.modelStatus,
    }));
}

/** ROLES cell: `—` when the executor can serve no role (or is unusable), starred ids otherwise. */
function renderRolesCell(row: DoctorRow): string {
    if (!row.usable || row.roles.length === 0) return '—';
    return row.roles.map((id) => (row.elected.includes(id) ? `${id}*` : id)).join(',');
}

/**
 * B4/0682 R2: `authenticated` is a probe-only signal the surface no longer
 * carries — strip it explicitly from every `--json` spread so it cannot leak.
 */
function withoutAuthenticated<T extends { authenticated?: unknown }>(row: T): Omit<T, 'authenticated'> {
    const { authenticated: _drop, ...rest } = row;
    void _drop;
    return rest;
}

/** Render the `spur agent doctor` text output as an aligned table with a header,
 * a ✓/✗ state glyph, and a usage summary footer. `--json` output is unaffected
 * and keeps no auth field at all (0621 removed the column; 0682 dropped `authenticated`).
 * Columns (B4/0681): EXECUTOR holds the executor name, AGENT the underlying
 * binary, MODEL the pinned config model (`—` when undeclared), TIER the
 * capability tier, ROLES the eligible roles with `*` marking election.
 */
function renderDoctorTable(results: DoctorRow[]): string {
    const dash = '—';
    const rows = results.map((result) => {
        const usable = result.usable;
        return {
            glyph: usable ? '✓' : '✗',
            state: usable ? 'usable' : 'missing',
            executor: result.executor,
            agentBinary: result.agentBinary,
            model: result.model ?? dash,
            tier: String(result.capabilityTier),
            version: result.version ?? dash,
            roles: renderRolesCell(result),
        };
    });

    const header = {
        glyph: ' ',
        state: 'STATUS',
        executor: 'EXECUTOR',
        agentBinary: 'AGENT',
        model: 'MODEL',
        tier: 'TIER',
        version: 'VERSION',
        roles: 'ROLES',
    };
    const all = [header, ...rows];
    const width = (key: keyof typeof header) => Math.max(...all.map((row) => row[key].length));
    const wState = width('state');
    const wExecutor = width('executor');
    const wAgent = width('agentBinary');
    const wModel = width('model');
    const wTier = width('tier');
    const wVersion = width('version');

    const line = (row: (typeof all)[number]) =>
        `${row.glyph} ${row.state.padEnd(wState)}  ${row.executor.padEnd(wExecutor)}  ${row.agentBinary.padEnd(wAgent)}  ${row.model.padEnd(wModel)}  ${row.tier.padEnd(wTier)}  ${row.version.padEnd(wVersion)}  ${row.roles}`.trimEnd();

    const usableCount = rows.filter((row) => row.state === 'usable').length;
    // Support tier keeps its one remaining consumer: the footer counts are plain
    // (no support-tier naming — that confusion is what TIER now prevents).
    const missing = rows.length - usableCount;
    const footerLines = [
        `${usableCount} usable, ${missing} missing`,
        ...(results.some((result) => result.elected.length > 0) ? ['(* = elected executor for that role)'] : []),
    ];

    return [line(header), ...rows.map(line), '', ...footerLines].join('\n');
}

/**
 * Render a role selector's full eligible ladder in resolution order
 * (`cheapestEligibleExecutors`): elected executor marked, per-row reason on
 * each non-usable entry, summary line reporting eligible/usable/elected.
 */
function renderRoleLadder(
    role: string,
    roleTier: CapabilityTier,
    ladder: readonly DoctorRow[],
    electedExecutor: string | undefined,
): string {
    const lines = [`${role} (min tier ${roleTier}) — eligible ladder`, ''];
    if (ladder.length === 0) {
        lines.push('(no eligible executor)', '');
    }
    const wName = Math.max(...ladder.map((row) => row.executor.length));
    for (const row of ladder) {
        const glyph = row.usable ? '✓' : '✗';
        const status = row.usable ? 'usable' : 'missing';
        const note =
            row.executor === electedExecutor ? 'ELECTED' : row.usable ? 'eligible' : (row.error ?? 'not installed');
        lines.push(`${glyph} ${row.executor.padEnd(wName)}  ${status}${note.length > 0 ? `  ${note}` : ''}`);
    }
    const usableCount = ladder.filter((row) => row.usable).length;
    lines.push('', `${ladder.length} eligible, ${usableCount} usable, elected: ${electedExecutor ?? 'none'}`);
    return lines.join('\n');
}

/**
 * Render a single doctor result in detail mode — used when `spur agent doctor <name>`
 * is invoked for a specific executor. Shows the full model health status with
 * endpoint and detail fields, not just the compact table column.
 */
function renderDoctorDetail(result: DoctorRow | null): string {
    if (result === null) return 'No result.';
    const lines: string[] = [];
    const glyph = result.usable ? '✓' : '✗';
    lines.push(`${glyph} ${result.executor}  (${result.capabilityTier})`);
    lines.push(`  agent:      ${result.agentBinary}`);
    lines.push(`  status:     ${result.usable ? 'usable' : 'missing'}`);
    lines.push(`  version:    ${result.version ?? '—'}`);
    // Pinned config model — distinct from the probed model health below.
    lines.push(`  pinned:     ${result.model ?? '—'}`);
    if (result.modelStatus) {
        lines.push(`  health:     ${result.modelStatus.status}`);
        lines.push(`  checked:    ${result.modelStatus.checkedAt}`);
        if (result.modelStatus.detail) {
            lines.push(`  detail:     ${result.modelStatus.detail}`);
        }
    }
    return lines.join('\n');
}

function stringFlag(flags: Record<string, string | boolean>, name: string, fallback: string): string {
    const value = flags[name];
    return typeof value === 'string' ? value : fallback;
}

function booleanFlag(flags: Record<string, string | boolean>, name: string): boolean {
    return flags[name] === true;
}

/** ADR-091 tri-state `--json-envelope` read: explicit true/false wins, undefined defers to SPUR_JSON_ENVELOPE. */
function jsonEnvelopeFlag(flags: Record<string, string | boolean>): boolean | undefined {
    const value = flags.jsonEnvelope;
    return typeof value === 'boolean' ? value : undefined;
}

function numberFlag(flags: Record<string, string | boolean>, name: string): number | undefined {
    const value = flags[name];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') return undefined;
    const n = Number(value);
    if (Number.isNaN(n)) return undefined;
    return n;
}

/** Parse the comma-separated `--tags` flag into trimmed, non-empty tags, or undefined when absent. */
function parseTagsFlag(flags: Record<string, string | boolean>): string[] | undefined {
    const raw = stringFlag(flags, 'tags', '');
    if (raw === '') return undefined;
    const tags = raw
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
    return tags.length > 0 ? tags : undefined;
}

/**
 * Resolve an executor's capability tier (0343).
 * Declared `tier` wins. Inference may only yield `cheap`, `standard`, or
 * `capable-1` — never invent `capable-2`/`capable-3` from a regex.
 * Legacy bare `capable` (if still present on a raw config object) maps to
 * `capable-1`.
 */
export function getExecutorTier(executor: AgentExecutorConfig): CapabilityTier {
    if (executor.tier) {
        // Structural compat: configs that skip zod may still carry legacy `capable`.
        const declared = executor.tier as CapabilityTier | 'capable';
        return declared === 'capable' ? 'capable-1' : declared;
    }
    const combined = `${executor.name} ${executor.model ?? ''} ${executor.agent}`.toLowerCase();
    if (/\b(cheap|haiku|flash|lite|mini|fast)\b/.test(combined)) return 'cheap';
    if (/\b(capable|opus|pro|sonnet|r1|o1|o3|expert)\b/.test(combined)) return 'capable-1';
    return 'standard';
}

/**
 * The shared role → executor funnel (0543 R1): eligible executors (tier at or
 * above `minTier`) sorted by tier ascending — cheapest eligible first. One
 * selector, never two: `resolveRole` (`--agent <role>`) and
 * `TeamService.materializeTeam` (role-only members) both route through this, so
 * the two can never disagree. `resolveRole` doctor-walks the result; team
 * materialization takes the first entry (config-time, no liveness probe).
 */
export function cheapestEligibleExecutors(
    executors: readonly AgentExecutorConfig[],
    minTier: CapabilityTier,
): AgentExecutorConfig[] {
    return executors
        .filter((e) => isTierEligible(getExecutorTier(e), minTier))
        .sort((a, b) => TIER_RANK[getExecutorTier(a)] - TIER_RANK[getExecutorTier(b)]);
}

/**
 * Classify a dispatch result into an objective escalation signal (0407 R1).
 *
 * Biased toward precision: the multi-pattern match avoids false positives on
 * ordinary stderr noise. Only registry-backed resource-exhaustion/auth evidence
 * and subprocess termination signals map to escalation triggers — everything
 * else returns `undefined` and the result stands as-is.
 *
 * Trigger vocabulary mirrors {@link ObjectiveEscalationSignal} (0405 R8):
 * `resource-exhaustion`, `auth`, and `timeout` are auto-classifiable signals;
 * `gate-fail`, `insufficient-evidence`, and `retry-exhausted` require human or
 * upstream judgement and are never inferred from process output.
 */
function classifyObjectiveFailure(result: AgentRunResult): ObjectiveEscalationSignal | undefined {
    return classifyDispatch(result);
}

/**
 * Project a resolution result into the routing attribution carried on lifecycle
 * events (0545 R1). Resolutions without a tier or executor (legacy Tier-1
 * priority, bare-binary pins with no executor entry) carry no attribution —
 * there is no decision to record. Everything else records identifiers and the
 * selection source; role and tier ride along when the funnel produced them.
 */
function buildRoutingAttribution(result: AgentResolveResult): AgentRoutingAttribution | undefined {
    if (!result.ok) return undefined;
    const tier = result.tier ?? result.stage?.executorTier;
    const executor = result.executor ?? result.stage?.executorName;
    if (tier === undefined && executor === undefined) return undefined;
    return {
        ...(result.role !== undefined ? { role: result.role } : {}),
        tier: tier ?? 'unknown',
        executor: executor ?? result.agent,
        source: result.source,
        // 0679 R7: resolved model override, so agent.invoke.* payloads stop carrying
        // a universally-null $.data.model. Absent when nothing resolved one.
        ...(result.model !== undefined ? { model: result.model } : {}),
    };
}
