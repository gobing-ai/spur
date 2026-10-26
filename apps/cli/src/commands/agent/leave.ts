import type { Command } from '@commander-js/extra-typings';
import { ATTACHED_DRAIN_GRACE_MS, type GuestRecord } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { guestService, guestUsageError, hostSessionId } from './shared';

/** Drain poll cadence — same granularity as the receipt poll. */
const DRAIN_POLL_MS = 250;

/**
 * `spur agent leave [id]` (G73 R2). Defaults to the guest joined by this host session,
 * so a host Stop hook (or the operator) can leave without knowing the generated id.
 */
export async function runAgentLeave(
    context: CliContext,
    flags: { id?: string; sessionId?: string; drainTimeout?: string; json: boolean; enveloped?: boolean },
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
    // Task 1282 (design §6): a bound member's leave drains first — stop new assignment,
    // wait within the grace window for the in-flight turn to settle, then retire. An
    // unsettled turn stays outcome-unknown and resumable; no process is ever signalled.
    const record: GuestRecord | null = await service.read(id);
    let drained: boolean | undefined;
    if (record?.memberBinding !== undefined) {
        const binding = record.memberBinding;
        await service.beginMemberDrain(id, {
            ownerEpoch: binding.ownerEpoch,
            occupancyGeneration: binding.occupancyGeneration,
        });
        const drainMs = flags.drainTimeout === undefined ? ATTACHED_DRAIN_GRACE_MS : Number(flags.drainTimeout);
        if (!Number.isFinite(drainMs) || drainMs < 0) {
            return guestUsageError(
                context,
                flags,
                `--drain-timeout must be a non-negative number of ms (got ${flags.drainTimeout})`,
            );
        }
        const deadline = Date.now() + drainMs;
        drained = await service.memberDrainSettled(id);
        while (drained !== true && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
            drained = await service.memberDrainSettled(id);
        }
    }
    const left = await service.leave(id);
    if (!left) {
        return guestUsageError(context, flags, `no joined guest "${id}"`);
    }
    if (flags.json) {
        context.output.write(
            toEnvelopeJson({ left: id, ...(drained !== undefined ? { drained } : {}) }, { enveloped: flags.enveloped }),
        );
    } else {
        context.output.write(
            drained === undefined
                ? `guest ${id} left the fleet`
                : `guest ${id} left the fleet (drain ${drained ? 'settled' : 'timed out — outstanding turn stays resumable'})`,
        );
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
        .option(
            '--drain-timeout <ms>',
            `Max wait for an in-flight turn to settle before retiring (default ${ATTACHED_DRAIN_GRACE_MS}ms)`,
        )
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (id, options) => {
            const code = await runAgentLeave(context, {
                ...(id !== undefined ? { id } : {}),
                ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
                ...(options.drainTimeout !== undefined ? { drainTimeout: options.drainTimeout } : {}),
                json: options.json === true,
                enveloped: options.jsonEnvelope,
            });
            context.setExitCode(code);
        });
}
