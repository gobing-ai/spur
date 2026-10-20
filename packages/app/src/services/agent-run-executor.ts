import { homedir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { isatty } from 'node:tty';
import {
    type CoordinationArtifactRef,
    CoordinationRunDao,
    type CoordinationRunReceipt,
    type OccupantRef,
} from '@gobing-ai/spur-domain';
import {
    AgentDetector,
    type AgentName,
    type AgentRunCorrelation,
    type AgentRunResult,
    AiRunner,
    DoctorRunner,
    getAgentSessionCapability,
    getAgentShim,
    isClaudeStyleSlashCommand,
    type PromptOptions,
    resolveAgentName,
    TIER2_AGENTS,
    translateSlashCommand,
} from '@gobing-ai/ts-ai-runner';
import { NodeProcessExecutor, type OutputPolicy, type ProcessOptions, type ProcessResult } from '@gobing-ai/ts-runtime';
import {
    AgentExecutionLifecycle,
    type AgentExecutionOptions,
    type AgentRoutingAttribution,
    type CapabilityEvidenceEntry,
    configuredSecretValues,
} from '../observability/agent-execution';
import { AgentRunLog } from '../observability/agent-run-log';
import { readWorkflowRunRecord } from '../workflow/run-record';
import { sanitizeInvocationArgv, traceSafePrompt } from './agent-invocation-sanitize';
import type { AgentResolver } from './agent-resolver';
import { buildRoutingAttribution, classifyObjectiveFailure } from './agent-routing-attribution';
import { booleanFlag, parseTagsFlag, stringFlag } from './agent-run-flags';
import { agentRunPreflight, parseRequiresCapabilitiesFlag } from './agent-run-preflight';
import type { AgentRunDeps, AgentRunInvocation, AgentServiceContext } from './agent-service';
import { normalizeAgentUsage } from './agent-usage';
import {
    capabilityDiagnostic,
    capabilityEvidence,
    evaluateCapabilities,
    evaluateSessionCapabilities,
    SESSION_CAPABILITY_AXES,
} from './capability-attestation';
import { bridgeEventBus, withInvokeRouting } from './event-bridge';
import { permissionFailureEvidence } from './failure-classification';
import { RunSessionObserver, type RunSessionOverlapRegistry } from './run-session-observer';
import { resolveRunRecordDir } from './run-storage';

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
    private specIdEnv = '';

    /** Set the role stamped into subsequent spawns; undefined strips. */
    setRoleEnv(role: string | undefined): void {
        this.roleEnv = role ?? '';
    }

    /**
     * Set the occupant spec id stamped into subsequent spawns (G73 R4, task 1080);
     * undefined strips. A drained `svc.run` member otherwise carries no fleet identity —
     * the supervisor path stamps persistent members, and this is the same stamp for a
     * member dispatched through `spur agent run --spec <id>`.
     */
    setSpecIdEnv(specId: string | undefined): void {
        this.specIdEnv = specId ?? '';
    }

    override async run(options: ProcessOptions): Promise<ProcessResult> {
        return super.run({
            ...options,
            env: { ...options.env, SPUR_ROLE: this.roleEnv, SPUR_SPEC_ID: this.specIdEnv },
        });
    }
}

/**
 * The dispatch core behind `spur agent run` for {@link AgentService} (shared by `run`, `runCapture`
 * and `runTraced`): launch validation, the execution lifecycle, the escalation ladder, session
 * observation and coordination-run persistence. Owns the per-service in-flight session-root
 * registry (feature E6).
 */
export class AgentRunExecutor {
    constructor(
        private readonly ctx: AgentServiceContext,
        private readonly resolver: AgentResolver,
    ) {}

    /**
     * Shared per-process in-flight session-root registry (feature E6): two
     * concurrent runs of the same agent in the same root must not both claim
     * the same session file — the second watermark flags both as overlapping
     * (R3) and neither writes an exact mapping.
     */
    private readonly sessionRootRegistry: RunSessionOverlapRegistry = { active: new Map(), overlapped: new Set() };

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
    async executeRun(
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

        // Launch guard + flag validation (fleet spec, --mode, --cwd, --timeout, prompt).
        const launch = await agentRunPreflight(this.ctx, prompt, flags);
        if (!launch.ok) return launch;
        const { requestMessageIds, mode, cwd, timeoutMs, continueFlag } = launch;

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
        // 0869 R3: the dispatching run's correlation identity, computed once and
        // shared by the invoke bridge and the execution lifecycle. Resolution
        // probes (version/auth) run before the lifecycle exists and emit
        // `agent.invoke.*` without a correlation, so the bridge stamps this same
        // id onto them — every invoke event is attributable to the run that paid
        // for it, never inferred at read time.
        const runCorrelation: AgentRunCorrelation = options.execution?.correlation ?? {
            runId: crypto.randomUUID(),
            executionId: crypto.randomUUID(),
        };
        const invokeBridge = this.ctx.events !== undefined ? bridgeEventBus(this.ctx.events) : undefined;
        let receiptRunId: string | undefined;
        const pendingExits: Record<string, unknown>[] = [];
        const publishExit = async (detail: Record<string, unknown>): Promise<void> => {
            const correlation = detail.correlation;
            if (
                receiptRunId !== undefined &&
                correlation !== null &&
                typeof correlation === 'object' &&
                'runId' in correlation &&
                correlation.runId === receiptRunId
            ) {
                pendingExits.push(detail);
            } else {
                await this.ctx.events?.emit('agent.invoke.exit', detail);
            }
        };
        const runner =
            deps?.runner ??
            new AiRunner({
                processExecutor: dispatchExecutor,
                ...(invokeBridge !== undefined
                    ? {
                          events: withInvokeRouting(
                              invokeBridge,
                              () => routing,
                              publishExit,
                              () => runCorrelation,
                          ),
                      }
                    : {}),
                ...(invokeBridge !== undefined ? { processEvents: invokeBridge } : {}),
            });

        const detector = deps?.detector ?? new AgentDetector({ runner });
        const doctorRunner =
            deps?.doctorRunner ??
            new DoctorRunner({ agentDetector: detector, runner, env: this.ctx.env, probeAuth: false });

        // resolve agent — prompt text never derives a stage (0536 R4)
        const resolved = await this.resolver.resolveAgent(flags, doctorRunner);
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
        // 0799 R3: structured quota exhaustion excludes the executor from THIS
        // invocation's fallback set immediately — the event is filtered to this
        // run's correlation id, so only executors this run actually drove are
        // captured; the durable application is the separate consumer's job.
        const runQuotaExhaustedExecutors = new Set<string>();
        const onQuotaExhausted = (event: unknown): void => {
            const candidate = event as
                | { attribution?: { executor?: string }; correlation?: { runId?: string } }
                | undefined;
            if (candidate?.correlation?.runId !== lifecycle.identity.runId) return;
            const executor = candidate.attribution?.executor ?? currentExecutor;
            if (typeof executor === 'string' && executor.length > 0) runQuotaExhaustedExecutors.add(executor);
        };
        const quotaEventBridge = this.ctx.events;
        if (quotaEventBridge !== undefined) quotaEventBridge.on('agent.quota.exhausted', onQuotaExhausted);
        // 0540 R2: the tiers in play ride the exhaustion report alongside the
        // executors tried — a bare executor list cannot say how far the ladder
        // climbed.
        const tiersAttempted = new Set<string>(currentStage ? [currentStage.executorTier] : []);

        // Tier-2 warning (suppressed in json/silent mode) — first agent only.
        if (!jsonOutput && TIER2_AGENTS.has(currentAgent)) {
            this.ctx.output.error(`Warning: ${currentAgent} is a Tier-2 agent (TUI/gateway only)`);
        }

        // Flag-derived values that do not change across iterations.
        // 1255 R1/R2: this is the model chosen for the SELECTED executor — an explicit
        // caller/action override, or the executor pin's own model forwarded by the action.
        // It binds to that executor for the initial dispatch only: `currentModel` below is
        // the current executor's model, and an escalation replaces the executor (0407), so
        // the frozen preference must not follow the run onto a different executor.
        const explicitModel = stringFlag(flags, 'model', '') || undefined;
        const purpose = stringFlag(flags, 'purpose', '') || undefined;
        const tags = parseTagsFlag(flags);
        const systemPrompt = stringFlag(flags, 'system-prompt', '') || undefined;
        const taskId = stringFlag(flags, 'task', '') || undefined;
        const sessionDir = stringFlag(flags, 'session-dir', '') || stringFlag(flags, 'sessionDir', '') || undefined;
        const sessionId = stringFlag(flags, 'session-id', '') || stringFlag(flags, 'sessionId', '') || undefined;
        // Capability gate input (0706 R4): parsed+validated once here; invalid shapes fail
        // closed (exit 2) before any resolution/spawn.
        const capabilityFlag = parseRequiresCapabilitiesFlag(flags);
        if (!capabilityFlag.ok) return capabilityFlag;
        const requiresCapabilities = capabilityFlag.requiresCapabilities;

        // Lifecycle + signal handlers set up ONCE, shared across all dispatches
        // (0407): a single AgentExecutionLifecycle spans the escalation chain,
        // and a single AbortController lets SIGTERM/SIGINT cancel any dispatch.
        const controller = new AbortController();
        const onTerminate = () => controller.abort();
        const onExternalAbort = () => controller.abort();
        const lifecycle = new AgentExecutionLifecycle(
            options.execution?.observer,
            runCorrelation,
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
        // G73 R4 (1080): the report hooks read SPUR_SPEC_ID from the child env, so a
        // spec-id-addressed run stamps it here — the same seam as SPUR_ROLE above, and the
        // only place a drained `svc.run` member learns its fleet identity (the supervisor
        // path stamps persistent members; this covers everyone else).
        dispatchExecutor.setSpecIdEnv(specId);
        const coordinationRunId = runCorrelation.runId;
        // 1076 R3 (ADR-132): the lineage edge. A workflow dispatch names its parent in the
        // request key (`<runId>/<state>`, set by `drainIntoPrompt`); a nested agent run inherits
        // `SPUR_RUN_ID` from the run that spawned it (ts-ai-runner injects that name verbatim).
        // A strategy dispatch has neither and is a root.
        const flagParentRunId = stringFlag(flags, 'parentRunId', '') || stringFlag(flags, 'parent-run-id', '');
        const envParentRunId = this.ctx.env.SPUR_RUN_ID ?? '';
        const parentRunId =
            flagParentRunId !== ''
                ? flagParentRunId
                : envParentRunId !== '' && envParentRunId !== coordinationRunId
                  ? envParentRunId
                  : undefined;
        // 1076 R1 (ADR-132): every execution gets a durable record. Opened beside the workflow
        // run records so one trace reader covers both, and closed in the `finally` below. An
        // unwritable directory leaves it inert — the record never fails the run (R8).
        const agentLog = new AgentRunLog({
            dir: join(this.ctx.cwd, '.spur', 'memory', 'runs'),
            runId: coordinationRunId,
            secrets: configuredSecretValues(this.ctx.env),
        });
        agentLog.writeHeader(
            `spur agent run ${coordinationRunId} — ${currentAgent} — started ${new Date().toISOString()}`,
        );
        let occupantRef: OccupantRef | undefined;
        if (this.ctx.getDb !== undefined) {
            receiptRunId = coordinationRunId;
            try {
                const dao = new CoordinationRunDao(await this.ctx.getDb());
                const generation = ((await dao.maxGeneration(specId)) ?? 0) + 1;
                if (specId !== '')
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
                    messageIds: requestMessageIds,
                    ...(taskId !== undefined ? { taskId } : {}),
                    ...(parentRunId !== undefined ? { parentRunId } : {}),
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
                // 1255 R1/R2: the model preference applies to the initial dispatch only. Every
                // later attempt ran because the ladder replaced the executor, and a replacement
                // dispatches its OWN model — a pin- or caller-derived name from the previous
                // executor must never travel with it (tasks 0407/0482 escalation, 0894 reroll).
                const model = (attempt === 0 ? explicitModel : undefined) ?? currentModel;

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
                    // B8 R4 (defense-in-depth): session axes are runner-declared, not
                    // operator-attested — evaluate them against the capability record
                    // for THIS attempt's canonical agent, so an escalation to a
                    // different executor cannot land on an incapable agent. Still
                    // pre-spawn: exit 2 before any subprocess is created.
                    if (SESSION_CAPABILITY_AXES.some((axis) => requiresCapabilities[axis] !== undefined)) {
                        const canonical = resolveAgentName(agent);
                        const record = canonical !== undefined ? getAgentSessionCapability(canonical) : undefined;
                        const sessionEvaluation = evaluateSessionCapabilities(requiresCapabilities, record, agent);
                        if (!sessionEvaluation.ok) {
                            const diagnostic = `agent dispatch blocked by session capability (B8 R4): ${sessionEvaluation.reason}. Stage requiresCapabilities names a session axis the runner record does not declare; pick a capable executor or drop the requirement.`;
                            this.ctx.output.error(diagnostic);
                            return { ok: false, exitCode: 2, message: diagnostic };
                        }
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

                // 1260 R3: the policy hook receives THIS attempt's identity — the escalation loop
                // may already have replaced the executor, so a pre-dispatch pin is not the subject.
                // A refusal is terminal for the run: it must not spawn this attempt, and it must not
                // fall to the escalation branch's "prior result stands" either.
                try {
                    await options.execution?.beforeDispatch?.({
                        agent,
                        ...(currentExecutor !== undefined ? { executor: currentExecutor } : {}),
                        ...(model !== undefined ? { model } : {}),
                    });
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    lifecycle.finish({ exitCode: null, durationMs: Date.now() - dispatchStartedAt, reason: message });
                    await sessionObserver?.resolve();
                    return { ok: false, exitCode: 2, message };
                }

                // Dispatch
                try {
                    result = await runner.runPromptCommand(agent, promptOptions, {
                        cwd: cwd || undefined,
                        ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
                        signal: controller.signal,
                        correlation: lifecycle.identity,
                        // 0799 R1: exact attribution rides every dispatch so the
                        // runner's quota events name this project + executor verbatim.
                        ...(currentExecutor !== undefined
                            ? {
                                  quotaContext: {
                                      projectId: this.ctx.cwd,
                                      executor: currentExecutor,
                                      agent,
                                      ...(model !== undefined ? { model } : {}),
                                  },
                              }
                            : {}),
                        onOutput: (output) => {
                            lifecycle.observe(output);
                            // 1076 R1: the same frame that reaches the live observer is the
                            // one persisted — redacted and byte-capped at the boundary.
                            agentLog.append(output.stream, output.chunk);
                        },
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
                // 0799 R3: a structured quota event for the current executor is a
                // confirmed resource-exhaustion signal even when the bounded prose
                // classifier misses the provider's phrasing — the ladder escalates
                // and the run-scoped attempted set excludes the exhausted executor.
                const quotaConfirmed = currentExecutor !== undefined && runQuotaExhaustedExecutors.has(currentExecutor);
                const classifiedSignal = classifyObjectiveFailure(result);
                let escalationSignal = quotaConfirmed ? ('resource-exhaustion' as const) : classifiedSignal;
                // 1264 R2/R3: the catalog rescue covers only the residue the rules left behind.
                // A rule match, a timeout, a permission denial (0687 R9) or a confirmed quota
                // event keeps today's route untouched, and a rescue that declines, throws or
                // reports uncertainty resolves to `undefined` — exactly the no-rescue behaviour.
                if (
                    escalationSignal === undefined &&
                    result.signal === undefined &&
                    this.ctx.classifyUnmatchedFailure !== undefined
                ) {
                    const text = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
                    if (text.trim() !== '' && permissionFailureEvidence(text) === undefined) {
                        escalationSignal = await this.ctx
                            .classifyUnmatchedFailure(text, { runId: lifecycle.identity.runId })
                            .catch(() => undefined);
                    }
                }
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
                const nextResolved = await this.resolver.resolveAgent(runFlags, doctorRunner, attemptedExecutors);
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
            if (quotaEventBridge !== undefined) quotaEventBridge.off('agent.quota.exhausted', onQuotaExhausted);
            process.off('SIGTERM', onTerminate);
            process.off('SIGINT', onTerminate);
            options.execution?.signal?.removeEventListener('abort', onExternalAbort);

            // Finalize the coordination run row (terminal status + artifact paths).
            // 1076 R1: close the durable record first so a trace never reads a live file as a
            // finished run's stream (the coordination row is the state, the file is the stream).
            agentLog.close();
            if (this.ctx.getDb !== undefined) {
                try {
                    const dao = new CoordinationRunDao(await this.ctx.getDb());
                    const status: 'exited' | 'errored' = result?.exitCode === 0 ? 'exited' : 'errored';
                    const refs = await this.resolveArtifactRefs(coordinationRunId);
                    // Completion receipt (0833 R1): correlates the run with its
                    // originating message(s) and task, persisted before any
                    // notification is attempted (R2). Outcome precedence: a zero
                    // exit with no verification result is 'run-exit-only' (R4) —
                    // this sink NEVER writes 'verified'; only the workflow
                    // verification path may (R3).
                    const receipt: CoordinationRunReceipt = {
                        messageIds: requestMessageIds,
                        ...(taskId !== undefined ? { taskId } : {}),
                        outcome: result?.exitCode === 0 ? 'run-exit-only' : 'errored',
                    };
                    await dao.updateExit(
                        coordinationRunId,
                        status,
                        new Date().toISOString(),
                        JSON.stringify(refs),
                        receipt,
                    );
                    for (const detail of pendingExits) await this.ctx.events?.emit('agent.invoke.exit', detail);
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
                // SAFETY: dispatchers attach `usage` onto the result object at
                // runtime; the visible AgentRunResult type predates that field.
                // pi-lens-ignore: require-safety-comment-for-as-unknown-as
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

    /**
     * Collect path-only artifact refs for a finished run (design §4). Probes
     * project-relative paths that exist on disk; never embeds file bodies.
     *
     * Read through the shared two-file record seam (task 0927 R4 — the last declared
     * `.log` reader migrated): a pair record refs the `<runId>.md` human log; a run
     * that predates the pair keeps its legacy `<runId>.log` ref in place. Missing
     * record → no ref.
     */
    private async resolveArtifactRefs(runId: string): Promise<CoordinationArtifactRef[]> {
        const refs: CoordinationArtifactRef[] = [];
        // 0927: read through the shared two-file record seam; keep the persisted ref
        // path project-relative, exactly as the legacy `.log` probe reported it.
        // 1026 R1: records resolve outside scratch (durable first, legacy fallback).
        const runDir = resolveRunRecordDir(this.ctx.cwd, runId);
        const relDir = relative(this.ctx.cwd, runDir);
        const record = readWorkflowRunRecord(runDir, runId);
        if (record.kind === 'pair' || record.kind === 'incomplete') {
            refs.push({ kind: 'log', path: join(relDir, basename(record.markdownPath)) });
        } else if (record.kind === 'legacy-log') {
            refs.push({ kind: 'log', path: join(relDir, basename(record.logPath)) });
        }
        return refs;
    }
}
