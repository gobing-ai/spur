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

/** Result from resolving the agent name. */
export type AgentResolveResult = { ok: true; agent: AgentName } | { ok: false; exitCode: number; message: string };
/** Result from {@link AgentService.runCapture} — exit code + captured answer text. */
export interface AgentRunCaptureResult {
    exitCode: number;
    answer: string;
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
        return this.resolveAgent(flags, doctorRunner);
    }

    // -------------------------------------------------------------------------
    // Public: list
    // -------------------------------------------------------------------------

    async list(opts: { json: boolean }): Promise<number> {
        const agents = await new AgentDetector().detectAll();
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
        return { exitCode, answer: result.stdout };
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

        // resolve agent
        const resolved = await this.resolveAgent(flags, doctorRunner);
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

        // build PromptOptions
        const promptOptions: PromptOptions = {
            input,
            continue: continueFlag || undefined,
            model: stringFlag(flags, 'model', '') || undefined,
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
        flags: Record<string, string | boolean>,
        doctorRunner: DoctorRunner,
    ): Promise<AgentResolveResult> {
        const raw = stringFlag(flags, 'agent', 'auto');
        if (raw === 'auto') return this.resolveAgentAuto(doctorRunner);
        if (raw === 'current') return this.resolveAgentCurrent(doctorRunner);
        return this.resolveAgentExplicit(raw, doctorRunner);
    }

    private async resolveAgentAuto(doctorRunner: DoctorRunner): Promise<AgentResolveResult> {
        const results = await doctorRunner.runAll();
        for (const name of TIER1_PRIORITY) {
            const match = results.find((r) => r.agent === name);
            if (match?.usable) return { ok: true, agent: name };
        }
        return { ok: false, exitCode: 1, message: 'No usable Tier-1 agent found' };
    }

    private async resolveAgentCurrent(doctorRunner: DoctorRunner): Promise<AgentResolveResult> {
        const value = this.ctx.env.SPUR_AGENT;
        if (value === undefined) {
            return { ok: false, exitCode: 2, message: "SPUR_AGENT is not set (agent 'current' requires it)" };
        }
        return this.resolveAgentExplicit(value, doctorRunner);
    }

    private async resolveAgentExplicit(name: string, doctorRunner: DoctorRunner): Promise<AgentResolveResult> {
        const canonical = resolveAgentName(name);
        if (canonical === undefined) {
            return { ok: false, exitCode: 2, message: `Unknown agent: ${name}` };
        }
        const result = await doctorRunner.runOne(canonical);
        // Liveness-only gate (P0-a): usable = installed && version !== null. Auth is
        // NOT consulted — a logged-out agent is runnable and fails at runtime with
        // its own error. Fail fast before any long-running stage burns the timeout.
        if (!result.installed) {
            return {
                ok: false,
                exitCode: 1,
                message: `Agent '${canonical}' is not installed or not runnable — install it or select another agent (spur agent doctor)`,
            };
        }
        if (!result.usable) {
            return {
                ok: false,
                exitCode: 1,
                message: `Agent '${canonical}' is installed but not runnable (no version detected) — reinstall or select another agent (spur agent doctor)`,
            };
        }
        return { ok: true, agent: canonical };
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
