import type { Command } from '@commander-js/extra-typings';
import { type AgentRunDeps, AgentService, type AgentSpecInput, TeamService } from '@gobing-ai/spur-app';
import type { CliContext } from '../context';
import { toJson } from '../output';

export type { AgentRunDeps };

/** Register `spur agent` commands on the CLI program. */
export function registerAgentCommand(program: Command, context: CliContext): void {
    const agent = program.command('agent').summary('run and inspect supported coding agents');

    agent
        .command('list')
        .description('List detected coding agents, or team agent specs with --specs.')
        .option('--json', 'Output machine-readable JSON')
        .option('--specs', 'List team specs instead of detected agents')
        .action(async (options) => {
            const svc = new AgentService({ cwd: context.cwd, env: context.env, output: context.output });
            const code = await runAgentList(svc, context, { json: options.json, specs: options.specs });
            context.setExitCode(code);
        });

    agent
        .command('doctor')
        .description('Check agent readiness.')
        .option('--json', 'Output machine-readable JSON')
        .argument('[agent]', 'Agent to check')
        .action(async (agentName, options) => {
            const svc = context.agentService();
            const code = await svc.doctor({ json: options.json === true, agent: agentName }, undefined);
            context.setExitCode(code);
        });

    agent
        .command('run')
        .description('Execute a prompt or slash command via a coding agent.')
        .option('--agent <name>', 'Agent name or auto')
        .option('--continue', 'Resume the previous agent session')
        .option('--model <name>', 'Agent model argument')
        .option('--mode <mode>', 'Agent output mode: text|json')
        .option('--cwd <path>', 'Working directory for agent execution')
        .option('--json', 'Output machine-readable JSON where supported')
        .option('--drain', 'Prepend pending inbox messages for --agent <id>')
        .argument('<prompt>', 'The prompt or slash command to execute')
        .action(async (prompt, options) => {
            const flags = commanderOptionsToFlags(options);
            const code = await runAgentRun(prompt, context, flags);
            context.setExitCode(code);
        });

    agent
        .command('create')
        .description('Write a team agent spec to .spur/agents/<id>.yaml.')
        .option('--type <agent-type>', 'Agent spec type for create')
        .option('--tags <a,b>', 'Team identity tags')
        .option('--system-prompt <text>', 'Team identity system prompt')
        .option('--name <name>', 'Agent name')
        .option('--workspace <path>', 'Workspace path')
        .option('--purpose <text>', 'Team identity purpose')
        .option('--auto-start', 'Auto-start flag')
        .option('--model <name>', 'Agent model argument')
        .option('--autonomy <level>', 'Autonomy level')
        .option('--no-identity-preamble', 'Disable identity preamble')
        .option('--json', 'Output machine-readable JSON')
        .argument('<id>', 'Agent spec id')
        .action(async (id, options) => {
            const flags = commanderOptionsToFlags(options);
            const code = await runAgentCreate(id, context, flags);
            context.setExitCode(code);
        });

    agent
        .command('edit')
        .description('Open an agent spec in $EDITOR, or print its path.')
        .argument('<id>', 'Agent spec id')
        .action(async (id) => {
            const code = await runAgentEdit(id, context);
            context.setExitCode(code);
        });

    agent
        .command('delete')
        .description('Remove an agent spec.')
        .option('--force', 'Required for delete')
        .argument('<id>', 'Agent spec id')
        .action(async (id, options) => {
            const flags = commanderOptionsToFlags(options);
            const code = await runAgentDelete(id, context, flags);
            context.setExitCode(code);
        });
}

/** Map commander-style camelCase option keys to kebab-case flags internal handlers expect. */
function commanderOptionsToFlags(options: Record<string, unknown>): Record<string, string | boolean> {
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

/** `spur agent list [--json] [--specs]` — optionally list team agent specs instead of detection. */
async function runAgentList(
    svc: AgentService,
    context: CliContext,
    opts: { json?: boolean; specs?: boolean },
): Promise<number> {
    if (!opts.specs) {
        return svc.list({ json: opts.json ?? false });
    }
    const specs = await new TeamService(context).listAgentSpecs();
    if (opts.json) {
        context.output.write(
            toJson({
                specs: specs.map((spec) => ({
                    id: spec.id,
                    type: spec.type,
                    purpose: spec.purpose,
                    path: `.spur/agents/${spec.id}.yaml`,
                })),
            }),
        );
        return 0;
    }
    if (specs.length === 0) {
        context.output.write('No agent specs found in .spur/agents/');
        return 0;
    }
    context.output.write(specs.map((spec) => `${spec.id}\t${spec.type}\t${spec.purpose}`).join('\n'));
    return 0;
}

/** `spur agent create <id> --type <agent-type> [flags]` */
async function runAgentCreate(
    id: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
): Promise<number> {
    if (id === undefined) {
        context.output.error('agent create requires <id>');
        return 2;
    }
    const type = typeof flags.type === 'string' ? flags.type : '';
    if (type === '') {
        context.output.error('agent create requires --type <agent-type>');
        return 2;
    }
    const tags = typeof flags.tags === 'string' ? flags.tags : '';
    const systemPrompt = typeof flags.systemPrompt === 'string' ? flags.systemPrompt : '';
    const input: AgentSpecInput = {
        id,
        type,
        ...(typeof flags.name === 'string' ? { name: flags.name } : {}),
        ...(typeof flags.workspace === 'string' ? { workspace: flags.workspace } : {}),
        ...(typeof flags.purpose === 'string' ? { purpose: flags.purpose } : {}),
        ...(tags === '' ? {} : { tags: parseTags(tags) }),
        ...(flags.autoStart === true ? { autoStart: true } : {}),
        config: buildAgentConfig(flags, systemPrompt),
    };

    try {
        const spec = await new TeamService(context).createAgentSpec(input);
        if (flags.json === true) {
            context.output.write(toJson({ ok: true, spec }));
        } else {
            context.output.write(`created .spur/agents/${spec.id}.yaml`);
        }
        return 0;
    } catch (error) {
        context.output.error(error instanceof Error ? error.message : String(error));
        return 1;
    }
}

/** Split a comma-separated `--tags` value into trimmed, non-empty tags. */
function parseTags(raw: string): string[] {
    return raw
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
}

/** Collect spec-level config from create flags (model, autonomy, system prompt, preamble toggle). */
function buildAgentConfig(flags: Record<string, string | boolean>, systemPrompt: string): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    if (typeof flags.model === 'string') config.model = flags.model;
    if (typeof flags.autonomy === 'string') config.autonomy = flags.autonomy;
    if (systemPrompt !== '') config.systemPrompt = systemPrompt;
    if (flags['no-identity-preamble'] === true) config.identityPreamble = false;
    return config;
}

/**
 * Split `$EDITOR` into argv tokens so multi-word values (`code -w`, `vim -f`)
 * spawn correctly. Whitespace-only input yields `[]`.
 */
export function splitEditorCommand(editor: string): string[] {
    return editor.trim().split(/\s+/).filter(Boolean);
}

/** `spur agent edit <id>` — open the spec in $EDITOR or print its path. */
async function runAgentEdit(id: string | undefined, context: CliContext): Promise<number> {
    if (id === undefined) {
        context.output.error('agent edit requires <id>');
        return 2;
    }
    const spec = (await new TeamService(context).listAgentSpecs()).find((entry) => entry.id === id);
    if (spec === undefined) {
        context.output.error(`No agent spec found: ${id}`);
        return 1;
    }
    // Use the spec's canonical (already-validated) id to build the path.
    const path = `${context.cwd}/.spur/agents/${spec.id}.yaml`;
    const editor = context.env.EDITOR;
    if (editor === undefined || editor === '') {
        context.output.write(path);
        return 0;
    }
    const editorArgv = splitEditorCommand(editor);
    if (editorArgv.length === 0) {
        context.output.write(path);
        return 0;
    }
    const proc = Bun.spawn([...editorArgv, path], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
    return await proc.exited;
}

/** `spur agent delete <id> [--force]` */
async function runAgentDelete(
    id: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
): Promise<number> {
    if (id === undefined) {
        context.output.error('agent delete requires <id>');
        return 2;
    }
    if (flags.force !== true) {
        context.output.error(`Refusing to delete ${id} without --force`);
        return 2;
    }
    try {
        await new TeamService(context).deleteAgentSpec(id);
        context.output.write(`deleted .spur/agents/${id}.yaml`);
        return 0;
    } catch (error) {
        context.output.error(error instanceof Error ? error.message : String(error));
        return 1;
    }
}

/** Execute `spur agent run <prompt> [flags]`. */
export async function runAgentRun(
    prompt: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
    deps?: AgentRunDeps,
): Promise<number> {
    // Use the context-built service so the validated `agent` config (executors +
    // phase map, 0126) is threaded into resolution. Constructing a bare service here
    // would drop agentConfig and silently disable phase-aware `--agent auto`.
    const svc = context.agentService();
    // `--drain` is DB-backed, so it is resolved in the command layer (where getDb
    // lives) rather than in the app service. The addressed `--agent <id>` names a
    // message recipient (an agent spec id), which is a different namespace from the
    // coding-agent type the runner resolves. When a matching spec exists we drain
    // its inbox into the prompt and rewrite `--agent` to the spec's underlying type
    // so resolution still works; in Phase 1-3 there is no live stdin, so prepending
    // is how deferred messages reach the agent.
    if (flags.drain === true) {
        const { prompt: drained, flags: rewritten } = await drainIntoPrompt(prompt, context, flags);
        return svc.run(drained, rewritten, deps);
    }
    return svc.run(prompt, flags, deps);
}

/**
 * Drain pending inbox messages for the addressed agent spec and prepend them to
 * the prompt. Returns possibly-rewritten flags (with `--agent` mapped from spec id
 * to the spec's coding-agent type when a spec is found).
 */
async function drainIntoPrompt(
    prompt: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
): Promise<{ prompt: string | undefined; flags: Record<string, string | boolean> }> {
    const recipient = typeof flags.agent === 'string' ? flags.agent : '';
    if (recipient === '' || recipient === 'auto') {
        context.output.error('--drain requires an explicit --agent <id> matching a message recipient');
        return { prompt, flags };
    }

    const team = new TeamService(context);
    const spec = (await team.listAgentSpecs()).find((entry) => entry.id === recipient);
    // Map spec id → coding-agent type so AgentService can resolve the runner.
    const flagsOut = spec === undefined ? flags : { ...flags, agent: spec.type };

    const inbox = await team.drainPending(recipient);
    if (inbox.count === 0) return { prompt, flags: flagsOut };

    const header = inbox.messages.map((m) => `- ${m.fromId ?? 'operator'}: ${m.body}`).join('\n');
    const block = `Pending messages:\n${header}`;
    const merged = prompt === undefined ? block : `${block}\n\n${prompt}`;
    return { prompt: merged, flags: flagsOut };
}
