import { stat } from 'node:fs/promises';
import { isatty } from 'node:tty';
import {
    AgentDetector,
    type AgentName,
    type AgentRunResult,
    AiRunner,
    type AuthState,
    DoctorRunner,
    getAgentShim,
    isClaudeStyleSlashCommand,
    type PromptOptions,
    resolveAgentName,
    TIER1_PRIORITY,
    TIER2_AGENTS,
    translateSlashCommand,
} from '@gobing-ai/ts-ai-runner';
import { NodeProcessExecutor, type OutputPolicy } from '@gobing-ai/ts-runtime';

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
 */
export interface AgentExecutorConfig {
    name: string;
    agent: string;
    model?: string;
}

/**
 * The `agent` config block consumed by resolution. Structurally compatible with
 * the CLI's validated `agent` section; threaded in via {@link AgentServiceContext}.
 * Absent → resolution behaves exactly as the legacy Tier-1 priority path.
 */
export interface AgentConfig {
    default?: string;
    executors?: AgentExecutorConfig[];
    'default-by-phase'?: Record<string, string>;
}

/** How an `auto` resolution chose its agent — carried for diagnostics/tests. */
export type AgentResolveSource = 'phase' | 'default' | 'priority' | 'explicit';

/**
 * Result of resolving an execution profile from `--agent` + prompt + config.
 * On success carries the canonical {@link AgentName}, an optional model override
 * (applied only when the user passed no explicit `--model`), and the resolution
 * source for diagnostics.
 */
export type AgentResolveResult =
    | { ok: true; agent: AgentName; model?: string; source: AgentResolveSource }
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

    // -------------------------------------------------------------------------
    // Public: resolve
    // -------------------------------------------------------------------------

    async resolve(flags: Record<string, string | boolean>, deps?: AgentRunDeps): Promise<AgentResolveResult> {
        const outputPolicy: OutputPolicy = { mode: 'buffered' };
        const runner =
            deps?.runner ?? new AiRunner({ processExecutor: new NodeProcessExecutor({ output: outputPolicy }) });
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
        const doctorRunner = deps?.doctorRunner ?? new DoctorRunner({ env: this.ctx.env });
        const results =
            args.agent === undefined ? await doctorRunner.runAll() : [await doctorRunner.runOne(args.agent)];
        if (args.json) {
            this.ctx.output.write(toJson({ agents: results }));
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
        const outcome = await this.executeRun(prompt, flags, deps, false);
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
        const outcome = await this.executeRun(prompt, flags, deps, true);
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
    // Private: executeRun (shared by run and runCapture)
    // -------------------------------------------------------------------------

    /**
     * Core execution logic shared by {@link run} and {@link runCapture}.
     * When `silent` is true, suppresses all output and forces buffered mode
     * to ensure stdout is captured in the returned AgentRunResult.
     */
    private async executeRun(
        prompt: string | undefined,
        flags: Record<string, string | boolean>,
        deps: AgentRunDeps | undefined,
        silent: boolean,
    ): Promise<{ ok: true; result: AgentRunResult } | { ok: false; exitCode: number; message: string }> {
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

        // require prompt (except codex --continue)
        const continueFlag = booleanFlag(flags, 'continue');
        if (prompt === undefined && !continueFlag) {
            return { ok: false, exitCode: 2, message: 'Prompt is required' };
        }

        // determine output mode — silent forces buffered (captures stdout)
        const jsonOutput = silent || booleanFlag(flags, 'json');
        const outputPolicy: OutputPolicy = jsonOutput ? { mode: 'buffered' } : { mode: 'stream', isTTY: isatty(1) };

        // deps or defaults
        const runner =
            deps?.runner ?? new AiRunner({ processExecutor: new NodeProcessExecutor({ output: outputPolicy }) });
        const detector = deps?.detector ?? new AgentDetector({ runner });
        const doctorRunner =
            deps?.doctorRunner ?? new DoctorRunner({ agentDetector: detector, runner, env: this.ctx.env });

        // resolve agent — thread the prompt so `auto` can derive the phase
        const resolved = await this.resolveAgent(prompt, flags, doctorRunner);
        if (!resolved.ok) {
            return { ok: false, exitCode: resolved.exitCode, message: resolved.message };
        }
        const agent = resolved.agent;

        // Tier-2 warning (suppressed in json/silent mode)
        if (!jsonOutput && TIER2_AGENTS.has(agent)) {
            this.ctx.output.error(`Warning: ${agent} is a Tier-2 agent (TUI/gateway only)`);
        }

        // slash-command translation
        const input =
            prompt !== undefined && isClaudeStyleSlashCommand(prompt) ? translateSlashCommand(agent, prompt) : prompt;

        // team-mode identity flags map straight through to PromptOptions; the
        // shim renders them into the agent's identity preamble. `--task` reads the
        // task file (if present) so the agent gets the task id + title as context.
        const purpose = stringFlag(flags, 'purpose', '') || undefined;
        const tags = parseTagsFlag(flags);
        const systemPrompt = stringFlag(flags, 'system-prompt', '') || undefined;
        const taskId = stringFlag(flags, 'task', '') || undefined;

        // Model precedence (R6): explicit `--model` wins; otherwise the resolved
        // executor's model override (if any) applies.
        const explicitModel = stringFlag(flags, 'model', '') || undefined;
        const model = explicitModel ?? resolved.model;

        // build PromptOptions
        const promptOptions: PromptOptions = {
            input,
            continue: continueFlag || undefined,
            model,
            mode: mode as 'text' | 'json',
            ...(purpose !== undefined ? { purpose } : {}),
            ...(tags !== undefined ? { tags } : {}),
            ...(systemPrompt !== undefined ? { systemPrompt } : {}),
            ...(taskId !== undefined ? { taskId } : {}),
        };

        // dispatch diagnostics (suppressed in json/silent mode)
        try {
            const shim = getAgentShim(agent);
            const shimCommand = shim.getPromptCommand(promptOptions);
            if (!jsonOutput) {
                const version = (await detector.detectOne(agent)).version;
                this.ctx.output.error(
                    `⚙️  ${agent}${version !== null ? ` v${version}` : ''}\n   ${shimCommand.command} ${shimCommand.args.join(' ')}`,
                );
            }
        } catch (error) {
            return { ok: false, exitCode: 2, message: error instanceof Error ? error.message : String(error) };
        }

        // dispatch
        let result: AgentRunResult;
        const controller = new AbortController();
        const onTerminate = () => controller.abort();
        try {
            process.on('SIGTERM', onTerminate);
            process.on('SIGINT', onTerminate);
            result = await runner.runPromptCommand(agent, promptOptions, {
                cwd: cwd || undefined,
                ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
                signal: controller.signal,
            });
        } catch (error) {
            return { ok: false, exitCode: 2, message: error instanceof Error ? error.message : String(error) };
        } finally {
            process.off('SIGTERM', onTerminate);
            process.off('SIGINT', onTerminate);
        }

        return { ok: true, result };
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
        if (raw === 'auto') return this.resolveAgentAuto(prompt, doctorRunner);
        return this.resolveAgentExplicit(raw, doctorRunner, 'explicit');
    }

    /**
     * Resolve `--agent auto` as a two-stage selector (R4/R5/R7):
     *  1. Phase from the raw prompt (`/sp:dev-run` → `dev-run`); none if absent.
     *  2. A configured phase mapping resolves its named executor and FAILS FAST
     *     if broken (unknown name → exit 2; unusable agent → exit 1) — it does NOT
     *     fall back. Only an absent phase mapping falls through to the default.
     *  3. `agent.default` is resolved as an executor selector; on miss, the static
     *     Tier-1 priority resolver preserves legacy behavior.
     */
    private async resolveAgentAuto(
        prompt: string | undefined,
        doctorRunner: DoctorRunner,
    ): Promise<AgentResolveResult> {
        const config = this.ctx.agentConfig;
        const phase = extractPhase(prompt);
        const phaseMap = config?.['default-by-phase'];
        const phaseSelector = phase !== undefined ? phaseMap?.[phase] : undefined;

        // A configured phase mapping is authoritative — broken means fail, not fall back.
        if (phaseSelector !== undefined && phase !== undefined) {
            return this.resolveExecutorSelector(phaseSelector, doctorRunner, 'phase', phase);
        }

        // No phase mapping: try the default executor selector, then priority.
        if (config?.default !== undefined) {
            const viaDefault = await this.resolveExecutorSelector(config.default, doctorRunner, 'default');
            if (viaDefault.ok) return viaDefault;
        }

        return this.resolveAgentPriority(doctorRunner);
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
     * Resolve an executor selector (from a phase map or `agent.default`) to an
     * execution profile. The selector names a configured executor first, then a
     * legacy direct agent name. `phase` (when given) marks a hard mapping: an
     * unknown executor exits 2, an unusable agent exits 1 — no fallback.
     */
    private async resolveExecutorSelector(
        selector: string,
        doctorRunner: DoctorRunner,
        source: 'phase' | 'default',
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
        if (canonical === undefined) return { ok: false, exitCode: 2, message: `Unknown agent: ${selector}` };
        const usable = await this.checkUsable(canonical, doctorRunner);
        if (!usable.ok) return usable.result;
        return { ok: true, agent: canonical, source };
    }

    private async resolveAgentExplicit(
        name: string,
        doctorRunner: DoctorRunner,
        source: 'explicit',
    ): Promise<AgentResolveResult> {
        const canonical = resolveAgentName(name);
        if (canonical === undefined) {
            return { ok: false, exitCode: 2, message: `Unknown agent: ${name}` };
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

    private async statCwd(cwd: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
        try {
            return await stat(cwd);
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
};

/**
 * Render the `spur agent doctor` text output as an aligned table with a header,
 * a ✓/✗ state glyph, and a tier-1 summary footer. `--json` output is unaffected.
 * A missing agent (no version) renders `—` for both auth and version.
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
        };
    });

    const header = { glyph: ' ', state: 'STATUS', agent: 'AGENT', tier: 'TIER', auth: 'AUTH', version: 'VERSION' };
    const all = [header, ...rows];
    const width = (key: keyof typeof header) => Math.max(...all.map((row) => row[key].length));
    const wState = width('state');
    const wAgent = width('agent');
    const wTier = width('tier');
    const wAuth = width('auth');

    const line = (row: (typeof all)[number]) =>
        `${row.glyph} ${row.state.padEnd(wState)}  ${row.agent.padEnd(wAgent)}  ${row.tier.padEnd(wTier)}  ${row.auth.padEnd(wAuth)}  ${row.version}`.trimEnd();

    const usableCount = rows.filter((row) => row.state === 'usable').length;
    const missingTier1 = results.filter((result) => !result.usable && result.tier === 1).length;
    const footer =
        missingTier1 > 0
            ? `${usableCount} usable, ${missingTier1} missing (tier-1)`
            : `${usableCount} usable, ${rows.length - usableCount} missing`;

    return [line(header), ...rows.map(line), '', footer].join('\n');
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
    return typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : undefined;
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
