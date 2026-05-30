import { AgentDetector, DoctorRunner } from '@gobing-ai/ts-ai-runner';
import { booleanFlag } from '../args';
import type { CliContext } from '../context';
import { toJson } from '../output';

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
    context.output.error(`Unknown agent command: ${command}`);
    return 1;
}

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
