import { existsSync, statSync } from 'node:fs';
import { isatty } from 'node:tty';
import {
    AgentDetector,
    type AgentName,
    type AgentRunResult,
    AiRunner,
    DoctorRunner,
    getAgentShim,
    isAgentName,
    type PromptOptions,
    TIER1_PRIORITY,
    TIER2_AGENTS,
} from '@gobing-ai/ts-ai-runner';
import { NodeProcessExecutor, type OutputPolicy } from '@gobing-ai/ts-runtime';
import { booleanFlag, stringFlag } from '../args';
import type { CliContext } from '../context';
import { toJson } from '../output';

// ---------------------------------------------------------------------------
// Slash-command translation (inline — Phase 1)
// TODO: promote to @gobing-ai/ts-ai-runner as src/slash-command.ts
// ---------------------------------------------------------------------------

const SLASH_COMMAND_RE = /^\/([a-zA-Z0-9._-]+):([a-zA-Z0-9._-]+)(\s.*)?$/;

function isClaudeStyleSlashCommand(input: string): boolean {
    return SLASH_COMMAND_RE.test(input);
}

function translateSlashCommand(agent: AgentName, input: string): string {
    const match = SLASH_COMMAND_RE.exec(input);
    if (!match) return input;
    const [, plugin, command, rest = ''] = match;
    const args = rest.trimStart();
    const suffix = args.length > 0 ? ` ${args}` : '';
    switch (agent) {
        case 'claude':
            return `/${plugin}:${command}${suffix}`;
        case 'codex':
            return `$${plugin}-${command}${suffix}`;
        case 'pi':
            return `/skill:${plugin}-${command}${suffix}`;
        default:
            return `/${plugin}-${command}${suffix}`;
    }
}

// ---------------------------------------------------------------------------
// Public command dispatch
// ---------------------------------------------------------------------------

/** Runtime dependencies injectable for tests. */
export interface AgentRunDeps {
    runner?: AiRunner;
    detector?: AgentDetector;
    doctorRunner?: DoctorRunner;
}

/** Execute `spur agent` commands backed by @gobing-ai/ts-ai-runner. */
export async function runAgentCommand(
    subcommand: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: string[],
): Promise<number> {
    const command = subcommand ?? 'list';
    if (command === 'list') return runAgentList(context, flags);
    if (command === 'doctor') return runAgentDoctor(context, flags, positionals);
    if (command === 'run') return runAgentRun(positionals[0], context, flags);
    context.output.error(`Unknown agent command: ${command}`);
    return 1;
}

// ---------------------------------------------------------------------------
// subcommand: list (existing)
// ---------------------------------------------------------------------------

async function runAgentList(context: CliContext, flags: Record<string, string | boolean>): Promise<number> {
    const agents = await new AgentDetector().detectAll();
    if (booleanFlag(flags, 'json')) {
        context.output.write(toJson({ agents }));
    } else {
        context.output.write(
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

// ---------------------------------------------------------------------------
// subcommand: doctor (existing)
// ---------------------------------------------------------------------------

async function runAgentDoctor(
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: string[],
): Promise<number> {
    const doctor = new DoctorRunner({ env: context.env });
    const requested = typeof flags.agent === 'string' ? flags.agent : positionals[0];
    const results = requested === undefined ? await doctor.runAll() : [await doctor.runOne(requested)];
    if (booleanFlag(flags, 'json')) {
        context.output.write(toJson({ agents: results }));
    } else {
        context.output.write(
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

// ---------------------------------------------------------------------------
// subcommand: run
// ---------------------------------------------------------------------------

/** Execute `spur agent run <prompt> [flags]`. */
export async function runAgentRun(
    prompt: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
    deps?: AgentRunDeps,
): Promise<number> {
    // ---- R5.1: validate --mode -------------------------------------------------
    const mode = stringFlag(flags, 'mode', 'text');
    if (mode !== 'text' && mode !== 'json') {
        context.output.error(`Invalid mode: ${mode} (must be text or json)`);
        return 2;
    }

    // ---- R4.2: validate --cwd --------------------------------------------------
    const cwd = stringFlag(flags, 'cwd', '');
    if (cwd !== '') {
        if (!existsSync(cwd)) {
            context.output.error(`Invalid --cwd: ${cwd} does not exist`);
            return 2;
        }
        if (!statSync(cwd).isDirectory()) {
            context.output.error(`Invalid --cwd: ${cwd} is not a directory`);
            return 2;
        }
    }

    // ---- R1.3: require prompt (except codex --continue) -----------------------
    const continueFlag = booleanFlag(flags, 'continue');
    if (prompt === undefined && !continueFlag) {
        context.output.error('Prompt is required');
        return 2;
    }

    // ---- R8: determine output mode (json vs text) before executor construction --
    const jsonOutput = booleanFlag(flags, 'json');
    const outputPolicy: OutputPolicy = jsonOutput ? { mode: 'buffered' } : { mode: 'stream', isTTY: isatty(1) };

    // ---- deps or defaults -----------------------------------------------------
    const runner = deps?.runner ?? new AiRunner({ processExecutor: new NodeProcessExecutor({ output: outputPolicy }) });
    const detector = deps?.detector ?? new AgentDetector({ runner });
    const doctorRunner = deps?.doctorRunner ?? new DoctorRunner({ agentDetector: detector, runner, env: context.env });

    // ---- R2: resolve agent ----------------------------------------------------
    const agent = await resolveAgent(flags, context, doctorRunner);
    if (typeof agent !== 'string') return agent; // exit code

    // ---- R10: Tier-2 warning --------------------------------------------------
    if (!jsonOutput && TIER2_AGENTS.has(agent)) {
        context.output.error(`Warning: ${agent} is a Tier-2 agent (TUI/gateway only)`);
    }

    // ---- R7: slash-command translation ----------------------------------------
    const input =
        prompt !== undefined && isClaudeStyleSlashCommand(prompt) ? translateSlashCommand(agent, prompt) : prompt;

    // ---- R3: build PromptOptions ----------------------------------------------
    const promptOptions: PromptOptions = {
        input,
        continue: continueFlag || undefined,
        model: stringFlag(flags, 'model', '') || undefined,
        mode: mode as 'text' | 'json',
    };

    // ---- R11: dispatch diagnostics (suppressed in --json) ---------------------
    let shimCommand: { command: string; args: string[] } | undefined;
    try {
        const shim = getAgentShim(agent);
        shimCommand = shim.getPromptCommand(promptOptions);
        if (!jsonOutput) {
            const version = (await detector.detectOne(agent)).version;
            context.output.error(
                `⚙️  ${agent}${version !== null ? ` v${version}` : ''}\n   ${shimCommand.command} ${shimCommand.args.join(' ')}`,
            );
        }
    } catch (error) {
        context.output.error(error instanceof Error ? error.message : String(error));
        return 2;
    }

    // ---- R3.2: dispatch -------------------------------------------------------
    let result: AgentRunResult;
    try {
        result = await runner.runPromptCommand(agent, promptOptions, { cwd: cwd || undefined });
    } catch (error) {
        // R6.1: codex resume-with-prompt throws; catch and map to exit 2
        context.output.error(error instanceof Error ? error.message : String(error));
        return 2;
    }

    // ---- R8: output handling --------------------------------------------------
    handleRunOutput(result, context, jsonOutput);

    // ---- R9: exit codes -------------------------------------------------------
    if (result.exitCode === 0) return 0;
    if (result.signal !== undefined) {
        context.output.error(`Agent terminated by signal: ${result.signal}`);
        return 3;
    }
    context.output.error(`Agent exited with code ${result.exitCode ?? 'null'}`);
    return 3;
}

// ---------------------------------------------------------------------------
// Agent resolution (R2)
// ---------------------------------------------------------------------------

async function resolveAgent(
    flags: Record<string, string | boolean>,
    context: CliContext,
    doctorRunner: DoctorRunner,
): Promise<AgentName | number> {
    const raw = stringFlag(flags, 'agent', 'auto');

    if (raw === 'auto') {
        return resolveAgentAuto(context, doctorRunner);
    }

    if (raw === 'current') {
        return resolveAgentCurrent(context, doctorRunner);
    }

    return resolveAgentExplicit(raw, doctorRunner, context);
}

async function resolveAgentAuto(context: CliContext, doctorRunner: DoctorRunner): Promise<AgentName | number> {
    const results = await doctorRunner.runAll();
    for (const name of TIER1_PRIORITY) {
        const match = results.find((r) => r.agent === name);
        if (match?.usable) return name;
    }
    context.output.error('No usable Tier-1 agent found');
    return 1;
}

async function resolveAgentCurrent(context: CliContext, doctorRunner: DoctorRunner): Promise<AgentName | number> {
    const value = context.env.SPUR_AGENT;
    if (value === undefined) {
        return errorExit("SPUR_AGENT is not set (agent 'current' requires it)", 2, context);
    }
    return resolveAgentExplicit(value, doctorRunner, context);
}

async function resolveAgentExplicit(
    name: string,
    doctorRunner: DoctorRunner,
    context: CliContext,
): Promise<AgentName | number> {
    if (!isAgentName(name)) {
        return errorExit(`Unknown agent: ${name}`, 2, context);
    }
    const result = await doctorRunner.runOne(name);
    if (!result.installed) {
        return errorExit(`Agent not installed: ${name}`, 1, context);
    }
    return name;
}

function errorExit(message: string, exitCode: number, context?: CliContext): number {
    if (context) context.output.error(message);
    // When called without context (resolveAgentAuto), the error is propagated up
    // and the caller handles output.
    return exitCode;
}

// ---------------------------------------------------------------------------
// Output handling (R8)
// ---------------------------------------------------------------------------

function handleRunOutput(result: AgentRunResult, context: CliContext, jsonOutput: boolean): void {
    if (jsonOutput) {
        // R8.3: JSON envelope
        context.output.write(
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

    // R8.1: TTY — executor already streamed; do NOT re-echo
    // R8.2: Non-TTY — executor buffered; echo
    const isTTY = isatty(1);
    if (!isTTY) {
        if (result.stdout.length > 0) context.output.write(result.stdout);
        if (result.stderr.length > 0) context.output.error(result.stderr);
    }
}
