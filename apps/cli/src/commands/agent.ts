import { type AgentRunDeps, AgentService } from '@gobing-ai/spur-app';
import { booleanFlag } from '../args';
import type { CliContext } from '../context';

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
    if (command === 'list') return svc.list({ json: booleanFlag(flags, 'json') });
    if (command === 'doctor') {
        const agent = typeof flags.agent === 'string' ? flags.agent : positionals[0];
        return svc.doctor({ json: booleanFlag(flags, 'json'), agent }, undefined);
    }
    if (command === 'run') return runAgentRun(positionals[0], context, flags);
    context.output.error(`Unknown agent command: ${command}`);
    return 1;
}

/** Execute `spur agent run <prompt> [flags]`. */
export async function runAgentRun(
    prompt: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
    deps?: AgentRunDeps,
): Promise<number> {
    const svc = new AgentService({ cwd: context.cwd, env: context.env, output: context.output });
    return svc.run(prompt, flags, deps);
}
