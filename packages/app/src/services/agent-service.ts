import { stat } from 'node:fs/promises';
import { isatty } from 'node:tty';
import {
    AgentDetector,
    type AgentName,
    type AgentRunResult,
    AiRunner,
    DoctorRunner,
    getAgentShim,
    isAgentName,
    isClaudeStyleSlashCommand,
    type PromptOptions,
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
            this.ctx.output.write(
                results
                    .map((result) => {
                        const state = result.usable ? 'usable' : result.installed ? 'needs-auth' : 'missing';
                        return `${state} ${result.agent} tier=${result.tier}${result.version ? ` ${result.version}` : ''}`;
                    })
                    .join('\n'),
            );
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
        // validate --mode
        const mode = stringFlag(flags, 'mode', 'text');
        if (mode !== 'text' && mode !== 'json') {
            this.ctx.output.error(`Invalid mode: ${mode} (must be text or json)`);
            return 2;
        }

        // validate --cwd
        const cwd = stringFlag(flags, 'cwd', '');
        if (cwd !== '') {
            const cwdStat = await this.statCwd(cwd);
            if (cwdStat === null) {
                this.ctx.output.error(`Invalid --cwd: ${cwd} does not exist`);
                return 2;
            }
            if (!cwdStat.isDirectory()) {
                this.ctx.output.error(`Invalid --cwd: ${cwd} is not a directory`);
                return 2;
            }
        }

        // require prompt (except codex --continue)
        const continueFlag = booleanFlag(flags, 'continue');
        if (prompt === undefined && !continueFlag) {
            this.ctx.output.error('Prompt is required');
            return 2;
        }

        // determine output mode before executor construction
        const jsonOutput = booleanFlag(flags, 'json');
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
            this.ctx.output.error(resolved.message);
            return resolved.exitCode;
        }
        const agent = resolved.agent;

        // Tier-2 warning
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

        // dispatch diagnostics (suppressed in --json)
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
            this.ctx.output.error(error instanceof Error ? error.message : String(error));
            return 2;
        }

        // dispatch
        let result: AgentRunResult;
        try {
            result = await runner.runPromptCommand(agent, promptOptions, { cwd: cwd || undefined });
        } catch (error) {
            this.ctx.output.error(error instanceof Error ? error.message : String(error));
            return 2;
        }

        // output handling
        this.handleRunOutput(result, jsonOutput);

        // exit codes
        if (result.exitCode === 0) return 0;
        if (result.signal !== undefined) {
            this.ctx.output.error(`Agent terminated by signal: ${result.signal}`);
            return 3;
        }
        this.ctx.output.error(`Agent exited with code ${result.exitCode ?? 'null'}`);
        return 3;
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
        if (!isAgentName(name)) {
            return { ok: false, exitCode: 2, message: `Unknown agent: ${name}` };
        }
        const result = await doctorRunner.runOne(name);
        if (!result.installed) {
            return { ok: false, exitCode: 1, message: `Agent not installed: ${name}` };
        }
        return { ok: true, agent: name };
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

function stringFlag(flags: Record<string, string | boolean>, name: string, fallback: string): string {
    const value = flags[name];
    return typeof value === 'string' ? value : fallback;
}

function booleanFlag(flags: Record<string, string | boolean>, name: string): boolean {
    return flags[name] === true;
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
