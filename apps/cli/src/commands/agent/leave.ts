import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { guestService, guestUsageError, hostSessionId } from './shared';

/**
 * `spur agent leave [id]` (G73 R2). Defaults to the guest joined by this host session,
 * so a host Stop hook (or the operator) can leave without knowing the generated id.
 */
export async function runAgentLeave(
    context: CliContext,
    flags: { id?: string; sessionId?: string; json: boolean; enveloped?: boolean },
): Promise<number> {
    const service = guestService(context);
    let id = flags.id;
    if (id === undefined || id === '') {
        const sessionId = hostSessionId(context, flags.sessionId);
        if (sessionId === undefined) {
            return guestUsageError(
                context,
                flags,
                'no guest id (pass one, or set CLAUDE_CODE_SESSION_ID / --session-id)',
            );
        }
        const joined = (await service.list()).find((guest) => guest.sessionId === sessionId);
        if (joined === undefined) {
            return guestUsageError(context, flags, `no guest joined by session ${sessionId}`);
        }
        id = joined.id;
    }
    const left = await service.leave(id);
    if (!left) {
        return guestUsageError(context, flags, `no joined guest "${id}"`);
    }
    if (flags.json) {
        context.output.write(toEnvelopeJson({ left: id }, { enveloped: flags.enveloped }));
    } else {
        context.output.write(`guest ${id} left the fleet`);
    }
    return 0;
}

/** Register `spur agent leave`. */
export function registerAgentLeaveCommand(agent: Command, context: CliContext): void {
    agent
        .command('leave')
        .description('Leave the fleet: release a guest occupant lease and retire its record.')
        .argument('[id]', 'Guest id (defaults to the guest joined by this session)')
        .option('--session-id <sid>', 'Host session id (defaults to CLAUDE_CODE_SESSION_ID)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (id, options) => {
            const code = await runAgentLeave(context, {
                ...(id !== undefined ? { id } : {}),
                ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
                json: options.json === true,
                enveloped: options.jsonEnvelope,
            });
            context.setExitCode(code);
        });
}
