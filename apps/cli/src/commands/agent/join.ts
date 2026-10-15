import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { guestService, guestUsageError, hostSessionId } from './shared';

/**
 * `spur agent join` (G73 R2/R3, task 1081). Registers a guest occupant with a heartbeat
 * lease; the guest is never supervised and never a stage target. Expired guests are
 * retired first, so a stale record can never block a re-join with the same id.
 */
export async function runAgentJoin(
    context: CliContext,
    flags: {
        role: string;
        id?: string;
        sessionId?: string;
        pid?: number;
        executor?: string;
        json: boolean;
        enveloped?: boolean;
    },
): Promise<number> {
    const service = guestService(context);
    await service.expire();
    const result = await service.join({
        role: flags.role,
        ...(flags.id !== undefined ? { id: flags.id } : {}),
        ...(hostSessionId(context, flags.sessionId) !== undefined
            ? { sessionId: hostSessionId(context, flags.sessionId) }
            : {}),
        pid: flags.pid ?? process.pid,
        ...(flags.executor !== undefined ? { executor: flags.executor } : {}),
    });
    if (!result.ok) {
        return guestUsageError(context, flags, result.message);
    }
    const { guest } = result;
    if (flags.json) {
        context.output.write(toEnvelopeJson({ guest }, { enveloped: flags.enveloped }));
    } else {
        context.output.write(
            `guest ${guest.id} joined as ${guest.role}${guest.sessionId !== null ? ` (session ${guest.sessionId})` : ''}`,
        );
    }
    return 0;
}

/** Register `spur agent join`. */
export function registerAgentJoinCommand(agent: Command, context: CliContext): void {
    agent
        .command('join')
        .description('Join the fleet as a guest occupant (a live session that pulls its own work).')
        .requiredOption('--role <name>', 'Layer-1 role the guest occupies (scribe | coder | reviewer | planner)')
        .option('--id <id>', 'Guest id (defaults to <role>-g<n>)')
        .option('--session-id <sid>', 'Host session id (defaults to CLAUDE_CODE_SESSION_ID)')
        .option('--pid <n>', 'Process id to record (defaults to this process)')
        .option('--executor <name>', 'Executor name to record (informational; a guest is never dispatched to)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const code = await runAgentJoin(context, {
                role: options.role,
                ...(options.id !== undefined ? { id: options.id } : {}),
                ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
                ...(options.pid !== undefined ? { pid: Number(options.pid) } : {}),
                ...(options.executor !== undefined ? { executor: options.executor } : {}),
                json: options.json === true,
                enveloped: options.jsonEnvelope,
            });
            context.setExitCode(code);
        });
}
