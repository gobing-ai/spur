import { isatty } from 'node:tty';
import {
    type CapabilityTier,
    getCanonicalStage,
    getNextFallback,
    isTierEligible,
    type ObjectiveEscalationSignal,
    type StageModelPolicy,
    type StageRecord,
    TIER_RANK,
} from '@gobing-ai/spur-domain';
import {
    AgentDetector,
    type AgentName,
    type AgentRunResult,
    AiRunner,
    type AuthState,
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
    configuredSecretValues,
} from '../observability/agent-execution';
import { bridgeEventBus } from './event-bridge';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Runtime dependencies injectable for tests. */
export interface AgentRunDeps {
    runner?: AiRunner;
    detector?: AgentDetector;
    doctorRunner?: DoctorRunner;
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
 */
export interface AgentConfig {
    default?: string;
    executors?: AgentExecutorConfig[];
    sessionAffinity?: boolean;
}

/** How an `auto` resolution chose its agent — carried for diagnostics/tests. */
export type AgentResolveSource = 'stage' | 'phase' | 'default' | 'priority' | 'explicit';

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
    | { ok: true; agent: AgentName; model?: string; source: AgentResolveSource; stage?: StageEscalationContext }
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
    /** Resolution source — phase/default/priority/explicit. */
    source: AgentResolveSource;
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
}

/** Output sink injected into AgentService. */
export interface AgentServiceOutput {
    write(message: string): void;
    error(message: string): void;
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

// ---------------------------------------------------------------------------
// AgentService
// ---------------------------------------------------------------------------

/** Application-layer orchestration for `spur agent` commands. */
export class AgentService {
    private readonly ctx: AgentServiceContext;

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
            deps?.doctorRunner ?? new DoctorRunner({ agentDetector: detector, runner, env: this.ctx.env });
        // Public resolve() has no prompt → no phase (R12): auto resolution derives
        // no phase and falls through default → priority, never throwing.
        return this.resolveAgent(undefined, flags, doctorRunner);
    }

    // -------------------------------------------------------------------------
    // Public: list
    // -------------------------------------------------------------------------

    async list(opts: { json: boolean }, deps?: AgentRunDeps): Promise<number> {
        const detector = deps?.detector ?? new AgentDetector();
        const agents = await detector.detectAll();
        if (opts.json) {
            this.ctx.output.write(toJson({ agents }));
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

    async doctor(args: { json: boolean; agent?: string }, deps?: AgentRunDeps): Promise<number> {
        const executors = this.ctx.agentConfig?.executors;
        const doctorRunner = deps?.doctorRunner ?? new DoctorRunner({ env: this.ctx.env, executors });
        const results =
            args.agent === undefined ? await doctorRunner.runAll() : [await doctorRunner.runOne(args.agent)];
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
        if (args.json) {
            this.ctx.output.write(toJson({ agents: results }));
        } else if (args.agent !== undefined) {
            // Single-executor mode: show full model detail when available.
            this.ctx.output.write(renderDoctorDetail(results[0] ?? null));
        } else {
            this.ctx.output.write(renderDoctorTable(results));
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
        if (!outcome.ok) {
            this.ctx.output.error(outcome.message);
            return outcome.exitCode;
        }
        const result = outcome.result;
        const jsonOutput = booleanFlag(flags, 'json');
        this.handleRunOutput(result, jsonOutput);
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
        | { ok: true; result: AgentRunResult; invocation: AgentRunInvocation }
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
        const runner =
            deps?.runner ??
            new AiRunner({
                processExecutor: new PidObservingProcessExecutor(
                    {
                        output: outputPolicy,
                        ...(this.ctx.processRegistry !== undefined ? { registry: this.ctx.processRegistry } : {}),
                    },
                    (pid) => publishPid?.(pid),
                ),
                ...(this.ctx.events !== undefined ? { events: bridgeEventBus(this.ctx.events) } : {}),
                ...(this.ctx.events !== undefined ? { processEvents: bridgeEventBus(this.ctx.events) } : {}),
            });

        const detector = deps?.detector ?? new AgentDetector({ runner });
        const doctorRunner =
            deps?.doctorRunner ?? new DoctorRunner({ agentDetector: detector, runner, env: this.ctx.env });

        // resolve agent — thread the prompt so `auto` can derive the phase
        const resolved = await this.resolveAgent(prompt, flags, doctorRunner);
        if (!resolved.ok) {
            return { ok: false, exitCode: resolved.exitCode, message: resolved.message };
        }
        // Escalation state (0407): mutable per-iteration tracking. `runFlags`
        // is a shallow copy so each escalation can inject `signal` +
        // `from-executor` without mutating the caller's flags.
        const runFlags: Record<string, string | boolean> = { ...flags };
        let currentAgent: AgentName = resolved.agent;
        let currentModel = resolved.model;
        let currentSource = resolved.source;
        let currentStage = resolved.stage;
        const maxEscalations = currentStage?.policy.fallback.length ?? 0;
        const attemptedExecutors = new Set<string>(currentStage ? [currentStage.executorName] : []);

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

        let result: AgentRunResult | undefined;
        let invocation: AgentRunInvocation | undefined;
        let dispatchStartedAt = Date.now();

        try {
            for (let attempt = 0; ; attempt++) {
                const agent = currentAgent;
                const model = explicitModel ?? currentModel;

                // slash-command translation (recomputed each iteration — agent
                // may change on escalation).
                const translated =
                    prompt !== undefined && isClaudeStyleSlashCommand(prompt)
                        ? translateSlashCommand(agent, prompt)
                        : undefined;
                const input = translated ?? prompt;

                const sessionDir =
                    stringFlag(flags, 'session-dir', '') || stringFlag(flags, 'sessionDir', '') || undefined;
                const sessionId =
                    stringFlag(flags, 'session-id', '') || stringFlag(flags, 'sessionId', '') || undefined;

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
                    });
                    dispatchStartedAt = Date.now();
                }

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
                if (escalationSignal === undefined || currentStage === undefined || attempt >= maxEscalations) {
                    break;
                }

                // Re-resolve with escalation flags to pick the next executor.
                runFlags.signal = escalationSignal;
                runFlags['from-executor'] = currentStage.executorName;
                const nextResolved = await this.resolveAgent(prompt, runFlags, doctorRunner);
                if (
                    !nextResolved.ok ||
                    nextResolved.stage === undefined ||
                    attemptedExecutors.has(nextResolved.stage.executorName)
                ) {
                    // Chain exhausted (R4) — report executors attempted.
                    if (!jsonOutput) {
                        this.ctx.output.error(
                            `Escalation chain exhausted after ${attempt + 1} attempt(s); executors tried: ${[...attemptedExecutors].join(', ')}`,
                        );
                    }
                    break;
                }

                // Escalating (R3) — report which executor failed and why.
                if (!jsonOutput) {
                    this.ctx.output.error(
                        `Escalating: ${currentStage.executorName} (tier ${currentStage.executorTier}) failed with ${escalationSignal}; retrying on ${nextResolved.stage.executorName} (tier ${nextResolved.stage.executorTier})`,
                    );
                }
                currentAgent = nextResolved.agent;
                currentModel = nextResolved.model;
                currentSource = nextResolved.source;
                currentStage = nextResolved.stage;
                attemptedExecutors.add(nextResolved.stage.executorName);
            }
        } finally {
            process.off('SIGTERM', onTerminate);
            process.off('SIGINT', onTerminate);
            options.execution?.signal?.removeEventListener('abort', onExternalAbort);
        }

        // Impossible-state guard: the loop always dispatches at least once.
        if (result === undefined || invocation === undefined) {
            lifecycle.finish({
                exitCode: null,
                durationMs: Date.now() - dispatchStartedAt,
                reason: 'no dispatch attempted',
            });
            return { ok: false, exitCode: 2, message: 'No dispatch attempted' };
        }

        lifecycle.finish({
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            ...(result.signal !== undefined ? { signal: result.signal } : {}),
            ...(controller.signal.aborted && result.signal === undefined ? { reason: 'cancelled' } : {}),
        });

        return { ok: true, result, invocation };
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
        prompt: string | undefined,
        flags: Record<string, string | boolean>,
        doctorRunner: DoctorRunner,
    ): Promise<AgentResolveResult> {
        const raw = stringFlag(flags, 'agent', 'auto');
        if (raw === 'auto') return this.resolveAgentAuto(prompt, flags, doctorRunner);
        // ADR-047: omit and `inline` are identical. On a headless dispatch surface
        // (`spur agent run` / workflow agent.run) both resolve to `agent.default` —
        // a subprocess of the configured default executor — never a host-session
        // stage. The ADR-046-era sentinel reject is withdrawn; unknown executor
        // names still fail clearly below via resolveExecutorSelector.
        if (raw === 'inline') return this.resolveAgentAuto(prompt, flags, doctorRunner);
        // Executor-aware (0346): explicit `--agent <name>` reuses the same
        // executor-first lookup as `agent.default`. No phase map is consulted
        // for the *starting* pick (R8: --agent wins; default-by-phase removed
        // 0452). The pin chooses where a run starts; it must not disable the
        // escalation ladder (0482 R1) — see resolvePinned.
        return this.resolvePinned(raw, prompt, flags, doctorRunner);
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
        prompt: string | undefined,
        flags: Record<string, string | boolean>,
        doctorRunner: DoctorRunner,
    ): Promise<AgentResolveResult> {
        if (stringFlag(flags, 'signal', '') !== '') {
            const stageRecord = this.resolveCanonicalStage(prompt, flags);
            if (stageRecord !== undefined) {
                const stageRes = await this.resolveStageModelPolicy(stageRecord, flags, doctorRunner);
                if (stageRes !== undefined) return stageRes;
            }
        }
        const base = await this.resolveExecutorSelector(selector, doctorRunner, 'explicit');
        if (!base.ok) return base;
        const stageRecord = this.resolveCanonicalStage(prompt, flags);
        if (stageRecord !== undefined) {
            const executors = this.ctx.agentConfig?.executors;
            const pinned = executors?.find((e) => e.name === selector);
            const tier = pinned !== undefined ? getExecutorTier(pinned) : stageRecord.model_policy.min_tier;
            return {
                ...base,
                stage: {
                    stageId: stageRecord.id,
                    policy: stageRecord.model_policy,
                    executorName: selector,
                    executorTier: tier,
                },
            };
        }
        return base;
    }

    /**
     * Resolve the canonical stage from the explicit `--stage` flag or the prompt
     * phase/alias, if any.
     */
    private resolveCanonicalStage(
        prompt: string | undefined,
        flags: Record<string, string | boolean>,
    ): StageRecord | undefined {
        const phase = extractPhase(prompt);
        const stageFlag = stringFlag(flags, 'stage', '');
        const targetStageId = stageFlag !== '' ? stageFlag : phase !== undefined ? phase : undefined;
        if (targetStageId === undefined) return undefined;
        return getCanonicalStage(targetStageId);
    }

    /**
     * Resolve `--agent auto` using stage-registry model routing (R1/R2/R3):
     *  1. Resolve canonical `stage_id` from explicit `--stage` flag or prompt phase/alias.
     *  2. If stage found, consume `model_policy` and start on the cheapest eligible executor.
     *     Objective escalation signals (`--signal`) trigger fallback entries.
     *  3. No stage match falls through to `agent.default` selector, then Tier-1 priority.
     * (`default-by-phase` removed in task 0452 — stage model_policy is the only adaptive path.)
     */
    private async resolveAgentAuto(
        prompt: string | undefined,
        flags: Record<string, string | boolean>,
        doctorRunner: DoctorRunner,
    ): Promise<AgentResolveResult> {
        const config = this.ctx.agentConfig;

        // Stage-registry adaptive model routing (R1/R2/R3)
        const stageRecord = this.resolveCanonicalStage(prompt, flags);
        if (stageRecord !== undefined) {
            const stageRes = await this.resolveStageModelPolicy(stageRecord, flags, doctorRunner);
            if (stageRes !== undefined) {
                return stageRes;
            }
        }

        // No phase/stage mapping: try the default executor selector, then priority.
        if (config?.default !== undefined) {
            const viaDefault = await this.resolveExecutorSelector(config.default, doctorRunner, 'default');
            if (viaDefault.ok) return viaDefault;
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
    ): Promise<AgentResolveResult | undefined> {
        const executors = this.ctx.agentConfig?.executors;
        if (!executors || executors.length === 0) {
            return undefined;
        }

        const policy = stageRecord.model_policy;
        const signalRaw = stringFlag(flags, 'signal', '');
        const signal = signalRaw.length > 0 ? (signalRaw as ObjectiveEscalationSignal) : undefined;
        const fromExecutor = stringFlag(flags, 'from-executor', '') || undefined;

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

        // Filter candidate executors whose capability meets targetTier
        const eligible = executors.filter((e) => isTierEligible(getExecutorTier(e), targetTier));
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
        const executor = this.ctx.agentConfig?.executors?.find((e) => e.name === selector);
        const phaseSuffix = phase !== undefined ? ` for phase '${phase}'` : '';

        if (executor !== undefined) {
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
            return { ok: true, agent: canonical, model: executor.model, source };
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

        // Default path: treat the selector as a legacy direct agent name.
        const canonical = resolveAgentName(selector);
        if (canonical === undefined) {
            // Task 0413 (R8): surface the available executors so a typo does not
            // look like an opaque failure. The agent-name space is open, so list
            // configured executors only — those are the load-bearing targets.
            const names = this.ctx.agentConfig?.executors?.map((e) => e.name) ?? [];
            const available =
                names.length > 0 ? names.join(', ') : '(no executors configured; use a canonical agent name)';
            return {
                ok: false,
                exitCode: 2,
                message: `Unknown agent: '${selector}'. Available executors: ${available}.`,
            };
        }
        const usable = await this.checkUsable(canonical, doctorRunner);
        if (!usable.ok) return usable.result;
        return { ok: true, agent: canonical, source };
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

    private handleRunOutput(result: AgentRunResult, jsonOutput: boolean): void {
        if (jsonOutput) {
            this.ctx.output.write(
                toJson({
                    exitCode: result.exitCode,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    ...(result.signal !== undefined ? { signal: result.signal } : {}),
                    durationMs: result.durationMs,
                }),
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

function toJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
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

/**
 * Derive a dev phase from a raw slash-command prompt, BEFORE per-agent slash
 * translation. Recognizes the `sp`/`rd3` command namespaces in their three
 * surface forms and maps the command to its bare phase name:
 *   `/sp:dev-run 0126 …` → `dev-run`
 *   `/sp-dev-run 0126 …` → `dev-run`
 *   `/rd3:dev-run 0126 …` → `dev-run`
 * Any other prompt (or none) yields `undefined` — the resolver then uses the
 * configured default / Tier-1 priority path, never a phase mapping.
 */
function extractPhase(prompt: string | undefined): string | undefined {
    if (prompt === undefined) return undefined;
    const trimmed = prompt.trimStart();
    // Match the `sp`/`rd3` command in EVERY per-agent surface form, since
    // `spur agent run` may receive a prompt already translated for the target
    // agent (translateSlashCommand runs AFTER resolution). The captured token is
    // the bare phase (`dev-run`). Forms (see translateSlashCommand):
    //   claude          /sp:dev-run      /rd3:dev-run
    //   opencode/gemini /sp-dev-run      /rd3-dev-run
    //   pi/omp          /skill:sp-dev-run  /skill:rd3-dev-run
    //   codex           $sp-dev-run      $rd3-dev-run
    const match = trimmed.match(/^(?:\/skill:|\/|\$)(?:sp[:-]|rd3[:-])([a-z0-9-]+)/);
    return match?.[1];
}

/** Compact tri-state auth label for the doctor text table (display-only). */
function renderAuth(authenticated: AuthState): string {
    if (authenticated === 'authenticated') return 'yes';
    if (authenticated === 'unauthenticated') return 'no';
    return '?';
}
/** The doctor-result fields the text table reads (structural subset — display-only). */
type DoctorRow = {
    agent: string;
    usable: boolean;
    tier: number;
    authenticated: AuthState;
    version: string | null;
    modelStatus?: ModelHealthResult | null;
};

/** Model-status label for the doctor text table (R4/AC1 — full status enum or —). */
function renderModelStatus(status: ModelHealthResult | null | undefined): string {
    if (status === null || status === undefined) return '—';
    return status.status;
}

/**
 * Render the `spur agent doctor` text output as an aligned table with a header,
 * a ✓/✗ state glyph, and a tier-1 summary footer. `--json` output is unaffected.
 * A missing agent (no version) renders `—` for both auth and version.
 * The MODEL column shows compact model health when a probe was run.
 */
function renderDoctorTable(results: DoctorRow[]): string {
    const dash = '—';
    const rows = results.map((result) => {
        const usable = result.usable;
        return {
            glyph: usable ? '✓' : '✗',
            state: usable ? 'usable' : 'missing',
            agent: result.agent,
            tier: String(result.tier),
            // A missing agent has nothing meaningful to report for auth/version.
            auth: usable ? renderAuth(result.authenticated) : dash,
            version: result.version ?? dash,
            model: renderModelStatus(result.modelStatus),
        };
    });

    const header = {
        glyph: ' ',
        state: 'STATUS',
        agent: 'AGENT',
        tier: 'TIER',
        auth: 'AUTH',
        version: 'VERSION',
        model: 'MODEL',
    };
    const all = [header, ...rows];
    const width = (key: keyof typeof header) => Math.max(...all.map((row) => row[key].length));
    const wState = width('state');
    const wAgent = width('agent');
    const wTier = width('tier');
    const wAuth = width('auth');
    const wVersion = width('version');

    const line = (row: (typeof all)[number]) =>
        `${row.glyph} ${row.state.padEnd(wState)}  ${row.agent.padEnd(wAgent)}  ${row.tier.padEnd(wTier)}  ${row.auth.padEnd(wAuth)}  ${row.version.padEnd(wVersion)}  ${row.model}`.trimEnd();

    const usableCount = rows.filter((row) => row.state === 'usable').length;
    const missingTier1 = results.filter((result) => !result.usable && result.tier === 1).length;
    const footer =
        missingTier1 > 0
            ? `${usableCount} usable, ${missingTier1} missing (tier-1)`
            : `${usableCount} usable, ${rows.length - usableCount} missing`;

    return [line(header), ...rows.map(line), '', footer].join('\n');
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
    lines.push(`${glyph} ${result.agent}  (tier ${result.tier})`);
    lines.push(`  status:     ${result.usable ? 'usable' : 'missing'}`);
    lines.push(`  version:    ${result.version ?? '—'}`);
    lines.push(`  auth:       ${renderAuth(result.authenticated)}`);
    if (result.modelStatus) {
        lines.push(`  model:      ${result.modelStatus.status}`);
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
function getExecutorTier(executor: AgentExecutorConfig): CapabilityTier {
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
 * Classify a dispatch result into an objective escalation signal (0407 R1).
 *
 * Biased toward precision: the multi-pattern match avoids false positives on
 * ordinary stderr noise. Only well-known resource-exhaustion and timeout
 * signatures map to escalation triggers — everything else returns `undefined`
 * and the result stands as-is.
 *
 * Trigger vocabulary mirrors {@link ObjectiveEscalationSignal} (0405 R8):
 * `resource-exhaustion` and `timeout` are the only auto-classifiable signals;
 * `gate-fail`, `insufficient-evidence`, and `retry-exhausted` require human or
 * upstream judgement and are never inferred from process output.
 */
function classifyObjectiveFailure(result: AgentRunResult): ObjectiveEscalationSignal | undefined {
    // A signal on the result means the subprocess was killed (timeout-kill).
    if (result.signal !== undefined) return 'timeout';

    if (result.exitCode === 0) return undefined;
    const text = `${result.stderr} ${result.stdout}`.toLowerCase();
    if (
        /\b(rate[\s-]?limit|429|too many requests|quota|token limit|token budget|context length|maximum context|context window)\b/.test(
            text,
        )
    ) {
        return 'resource-exhaustion';
    }
    return undefined;
}
