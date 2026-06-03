import { type AgentRunDeps, AgentService, type AgentSpecInput, TeamService } from '@gobing-ai/spur-app';
import { booleanFlag, stringFlag } from '../args';
import type { CliContext } from '../context';
import { toJson } from '../output';

export type { AgentRunDeps };

/** Execute `spur agent` commands backed by @gobing-ai/ts-ai-runner. */
export async function runAgentCommand(
    subcommand: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: string[],
): Promise<number> {
    const command = subcommand ?? 'list';
    const svc = new AgentService({ cwd: context.cwd, env: context.env, output: context.output });
    if (command === 'list') return runAgentList(svc, context, flags);
    if (command === 'doctor') {
        const agent = typeof flags.agent === 'string' ? flags.agent : positionals[0];
        return svc.doctor({ json: booleanFlag(flags, 'json'), agent }, undefined);
    }
    if (command === 'run') return runAgentRun(positionals[0], context, flags);
    if (command === 'create') return runAgentCreate(positionals[0], context, flags);
    if (command === 'edit') return runAgentEdit(positionals[0], context);
    if (command === 'delete') return runAgentDelete(positionals[0], context, flags);
    context.output.error(`Unknown agent command: ${command}`);
    return 1;
}

/** `spur agent list [--json] [--specs]` — optionally list team agent specs instead of detection. */
async function runAgentList(
    svc: AgentService,
    context: CliContext,
    flags: Record<string, string | boolean>,
): Promise<number> {
    if (!booleanFlag(flags, 'specs')) {
        return svc.list({ json: booleanFlag(flags, 'json') });
    }
    const specs = new TeamService(context).listAgentSpecs();
    if (booleanFlag(flags, 'json')) {
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
    const type = stringFlag(flags, 'type', '');
    if (type === '') {
        context.output.error('agent create requires --type <agent-type>');
        return 2;
    }
    const tags = stringFlag(flags, 'tags', '');
    const systemPrompt = stringFlag(flags, 'system-prompt', '');
    const input: AgentSpecInput = {
        id,
        type,
        ...(typeof flags.name === 'string' ? { name: flags.name } : {}),
        ...(typeof flags.workspace === 'string' ? { workspace: flags.workspace } : {}),
        ...(typeof flags.purpose === 'string' ? { purpose: flags.purpose } : {}),
        ...(tags === '' ? {} : { tags: parseTags(tags) }),
        ...(booleanFlag(flags, 'auto-start') ? { autoStart: true } : {}),
        config: buildAgentConfig(flags, systemPrompt),
    };

    try {
        const spec = await new TeamService(context).createAgentSpec(input);
        if (booleanFlag(flags, 'json')) {
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
    if (booleanFlag(flags, 'no-identity-preamble')) config.identityPreamble = false;
    return config;
}

/** `spur agent edit <id>` — open the spec in $EDITOR or print its path. */
async function runAgentEdit(id: string | undefined, context: CliContext): Promise<number> {
    if (id === undefined) {
        context.output.error('agent edit requires <id>');
        return 2;
    }
    const spec = new TeamService(context).listAgentSpecs().find((entry) => entry.id === id);
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
    const proc = Bun.spawn([editor, path], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
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
    if (!booleanFlag(flags, 'force')) {
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
    const svc = new AgentService({ cwd: context.cwd, env: context.env, output: context.output });
    // `--drain` is DB-backed, so it is resolved in the command layer (where getDb
    // lives) rather than in the app service. The addressed `--agent <id>` names a
    // message recipient (an agent spec id), which is a different namespace from the
    // coding-agent type the runner resolves. When a matching spec exists we drain
    // its inbox into the prompt and rewrite `--agent` to the spec's underlying type
    // so resolution still works; in Phase 1-3 there is no live stdin, so prepending
    // is how deferred messages reach the agent.
    if (booleanFlag(flags, 'drain')) {
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
    const recipient = stringFlag(flags, 'agent', '');
    if (recipient === '' || recipient === 'auto' || recipient === 'current') {
        context.output.error('--drain requires an explicit --agent <id> matching a message recipient');
        return { prompt, flags };
    }

    const team = new TeamService(context);
    const spec = team.listAgentSpecs().find((entry) => entry.id === recipient);
    // Map spec id → coding-agent type so AgentService can resolve the runner.
    const flagsOut = spec === undefined ? flags : { ...flags, agent: spec.type };

    const inbox = await team.getInbox(recipient);
    if (inbox.count === 0) return { prompt, flags: flagsOut };

    const header = inbox.messages.map((m) => `- ${m.fromId ?? 'operator'}: ${m.body}`).join('\n');
    const block = `Pending messages:\n${header}`;
    const merged = prompt === undefined ? block : `${block}\n\n${prompt}`;
    return { prompt: merged, flags: flagsOut };
}
