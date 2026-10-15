import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { SHARED_OPTIONS } from '../shared-options';
import { resolveAgentServer, runAgentLifecycle } from './shared';

/** Register `spur agent start`. */
export function registerAgentStartCommand(agent: Command, context: CliContext): void {
    // (POST /api/agents/:id/{start,stop}).
    agent
        .command('start')
        .description('Start a supervised agent process (requires spur serve).')
        .argument('<spec-id>', 'Agent spec id')
        .option(
            '--server <url>',
            "Server API URL (default: this project's registered serve, else http://localhost:3000/api)",
        )
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (specId, options) => {
            // 0697 AC4: the advertised flag's decision rides visibly on the delegated options.
            // 1088 R1: the default server is resolved from this project's registry entry.
            const code = await runAgentLifecycle(
                'start',
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
