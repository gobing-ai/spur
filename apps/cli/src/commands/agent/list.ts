import type { Command } from '@commander-js/extra-typings';
import { AgentCoordinationService, AgentService } from '@gobing-ai/spur-app';
import type { MemberSessionObservation } from '@gobing-ai/spur-domain';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import {
    fetchServerProcesses,
    formatSessionColumn,
    NO_AGENT_SPECS_MESSAGE,
    resolveAgentServer,
    specOrigin,
} from './shared';

async function runAgentList(
    svc: AgentService,
    context: CliContext,
    opts: { json?: boolean; jsonEnvelope?: boolean; specs?: boolean; server?: string },
): Promise<number> {
    if (!opts.specs) {
        return svc.list({ json: opts.json ?? false, enveloped: opts.jsonEnvelope });
    }
    const specs = await new AgentCoordinationService(context).listAgentSpecs();
    if (specs.length === 0) {
        if (opts.json) {
            context.output.write(toEnvelopeJson({ specs: [] }, { enveloped: opts.jsonEnvelope }));
            return 0;
        }
        context.output.write(NO_AGENT_SPECS_MESSAGE);
        return 0;
    }
    // The CLI process never owns the supervisor — specs are spawned by `spur serve` —
    // so the local listing is only the desired state until the server's process table
    // overrides it. Unreachable server ⇒ every spec `stopped` plus a stderr warning,
    // so offline listing still works.
    const server = await resolveAgentServer(context.cwd, opts.server, { warn: (m) => context.output.error(m) });
    const live = await fetchServerProcesses(server);
    if (live === null) {
        context.output.error(
            `Cannot reach server at ${server} — showing local specs as stopped. Is spur serve running?`,
        );
    }
    const specFacts = (id: string): { status: string; pid?: number; session?: MemberSessionObservation } => {
        const proc = live?.get(id);
        if (proc === undefined) return { status: 'stopped' };
        return {
            status: proc.status,
            ...(proc.pid !== null ? { pid: proc.pid } : {}),
            ...(proc.session !== undefined ? { session: proc.session } : {}),
        };
    };
    if (opts.json) {
        context.output.write(
            toEnvelopeJson(
                {
                    specs: specs.map((spec) => ({
                        id: spec.id,
                        type: spec.type,
                        purpose: spec.purpose,
                        // 0544 R2: role and executor are DISTINCT fields — never merged.
                        ...(typeof spec.config?.role === 'string' && spec.config.role.length > 0
                            ? { role: spec.config.role }
                            : {}),
                        ...(spec.executor !== undefined ? { executor: spec.executor } : {}),
                        ...specFacts(spec.id),
                        ...specOrigin(spec),
                    })),
                },
                { enveloped: opts.jsonEnvelope },
            ),
        );
        return 0;
    }
    // 0544 R2/R4: role and executor are distinct columns; undeclared renders `unset`.
    // Live run status is the trailing column (`running pid=<n>` / `stopped`), then the
    // member session (0897): mode + shortened resume id, `-` when none.
    context.output.write(
        specs
            .map((spec) => {
                const role =
                    typeof spec.config?.role === 'string' && spec.config.role.length > 0 ? spec.config.role : 'unset';
                const executor = spec.executor ?? 'unset';
                const { status, pid, session } = specFacts(spec.id);
                const pidSuffix = pid === undefined ? '' : ` pid=${pid}`;
                return `${spec.id}\t${spec.type}\t${role}\t${executor}\t${spec.purpose}\t${status}${pidSuffix}\t${formatSessionColumn(session)}`;
            })
            .join('\n'),
    );
    return 0;
}

/** Register `spur agent list`. */
export function registerAgentListCommand(agent: Command, context: CliContext): void {
    agent
        .command('list')
        .description('List detected coding agents, or agent specs with --specs.')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .option('--specs', 'List agent specs instead of detected agents')
        .option(
            '--server <url>',
            "Server API URL for live run status (with --specs) (default: this project's registered serve, else http://localhost:3000/api)",
        )
        .action(async (options) => {
            const svc = new AgentService({ cwd: context.cwd, env: context.env, output: context.output });
            const code = await runAgentList(svc, context, {
                json: options.json,
                jsonEnvelope: options.jsonEnvelope,
                specs: options.specs,
                server: options.server,
            });
            context.setExitCode(code);
        });
}
