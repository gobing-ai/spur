import type { Command } from '@commander-js/extra-typings';
import { AgentCoordinationService } from '@gobing-ai/spur-app';
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

/**
 * `spur agent status [--json] [--server <url>]` — live status + member session per
 * agent spec (0897). The CLI never owns the supervisor: liveness and session come
 * from `GET /api/processes`; an unreachable server reports every spec `stopped`
 * with no session (same fallback as `list --specs`).
 */
async function runAgentStatus(
    context: CliContext,
    opts: { json?: boolean; jsonEnvelope?: boolean; server?: string },
): Promise<number> {
    const specs = await new AgentCoordinationService(context).listAgentSpecs();
    if (specs.length === 0) {
        if (opts.json) {
            context.output.write(toEnvelopeJson({ agents: [] }, { enveloped: opts.jsonEnvelope }));
            return 0;
        }
        context.output.write(NO_AGENT_SPECS_MESSAGE);
        return 0;
    }
    const server = await resolveAgentServer(context.cwd, opts.server, { warn: (m) => context.output.error(m) });
    const live = await fetchServerProcesses(server);
    if (live === null) {
        context.output.error(
            `Cannot reach server at ${server} — showing local specs as stopped. Is spur serve running?`,
        );
    }
    const rows = specs.map((spec) => {
        const proc = live?.get(spec.id);
        return {
            id: spec.id,
            name: spec.name,
            type: spec.type,
            status: proc === undefined ? ('stopped' as const) : proc.status,
            ...(proc?.pid !== undefined && proc.pid !== null ? { pid: proc.pid } : {}),
            ...(proc?.session !== undefined ? { session: proc.session } : {}),
            ...specOrigin(spec),
        };
    });
    if (opts.json) {
        context.output.write(toEnvelopeJson({ agents: rows }, { enveloped: opts.jsonEnvelope }));
        return 0;
    }
    context.output.write(
        rows
            .map((row) => {
                const pidSuffix = 'pid' in row && row.pid !== undefined ? ` pid=${row.pid}` : '';
                return `${row.id}\t${row.type}\t${row.status}${pidSuffix}\t${formatSessionColumn(row.session)}`;
            })
            .join('\n'),
    );
    return 0;
}

/** Register `spur agent status`. */
export function registerAgentStatusCommand(agent: Command, context: CliContext): void {
    agent
        .command('status')
        .description('Show agent specs with live process status and member session (requires spur serve).')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .option(
            '--server <url>',
            "Server API URL for live run status and member session (default: this project's registered serve, else http://localhost:3000/api)",
        )
        .action(async (options) => {
            const code = await runAgentStatus(context, {
                json: options.json,
                jsonEnvelope: options.jsonEnvelope,
                server: options.server,
            });
            context.setExitCode(code);
        });
}
