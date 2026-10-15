import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { SHARED_OPTIONS } from '../shared-options';
import { resolveAgentServer, runAgentLifecycle } from './shared';

/** Register `spur agent stop`. */
export function registerAgentStopCommand(agent: Command, context: CliContext): void {
    agent
        .command('stop')
        .description('Stop a supervised agent process (requires spur serve).')
        .argument('<spec-id>', 'Agent spec id')
        .option(
            '--server <url>',
            "Server API URL (default: this project's registered serve, else http://localhost:3000/api)",
        )
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (specId, options) => {
            // Same threading contract as `agent start` (0697 AC4); same default-server
            // resolution (1088 R1).
            const code = await runAgentLifecycle(
                'stop',
                specId,
                {
                    server: await resolveAgentServer(context.cwd, options.server, {
                        warn: (m) => context.output.error(m),
                    }),
                    json: options.json,
                    jsonEnvelope: options.jsonEnvelope,
                },
                context,
            );
            context.setExitCode(code);
        });
}
