import type { Command } from '@commander-js/extra-typings';
import { AgentCoordinationService } from '@gobing-ai/spur-app';
import { MEMBER_LIFECYCLE_STATES, type MemberLifecycleState } from '@gobing-ai/spur-domain';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { guestService } from './shared';

/**
 * Run `spur agent report` (G73 R1, task 1080) — the host hooks' only CLI call.
 *
 * Thin by design: validation, the member-id default (`--spec`, else `SPUR_SPEC_ID`)
 * and the monotonic guard all resolve here or in the domain; the service call is one
 * hop. A missing member id is a usage error (exit 2), never a silent no-op, so a
 * misconfigured hook surfaces instead of dropping reports.
 */
export async function runAgentReport(
    context: CliContext,
    flags: {
        state?: string;
        seq?: string;
        spec?: string;
        pin?: string;
        json: boolean;
        enveloped?: boolean;
    },
): Promise<number> {
    const state = flags.state;
    if (state === undefined || !MEMBER_LIFECYCLE_STATES.includes(state as MemberLifecycleState)) {
        return agentReportUsageError(
            context,
            flags,
            `--state must be one of ${MEMBER_LIFECYCLE_STATES.join('|')} (got ${state ?? 'nothing'})`,
        );
    }
    const seq = flags.seq === undefined || flags.seq.trim() === '' ? Number.NaN : Number(flags.seq);
    if (!Number.isFinite(seq)) {
        return agentReportUsageError(
            context,
            flags,
            `--seq must be a number in nanoseconds (got ${flags.seq ?? 'nothing'})`,
        );
    }
    const memberId = flags.spec !== undefined && flags.spec !== '' ? flags.spec : context.env.SPUR_SPEC_ID;
    if (memberId === undefined || memberId === '') {
        return agentReportUsageError(context, flags, 'no member id (set SPUR_SPEC_ID or --spec)');
    }
    // Task 1282 (design §4): a lifecycle report may update a BOUND member only when the
    // caller presents the host binding pin (`--pin <ownerEpoch>:<occupancyGeneration>`).
    // The first matching report completes the attached handshake. Plain guests and declared
    // members without an occupant record take the unchanged path below.
    const record = await guestService(context).read(memberId);
    if (record?.memberBinding !== undefined) {
        const binding = record.memberBinding;
        const pin = parseBindingPin(flags.pin);
        if (pin === null) {
            return agentReportUsageError(
                context,
                flags,
                `member "${memberId}" is bound — reports need --pin <ownerEpoch>:<occupancyGeneration>`,
            );
        }
        if (pin.ownerEpoch !== binding.ownerEpoch || pin.occupancyGeneration !== binding.occupancyGeneration) {
            return agentReportUsageError(
                context,
                flags,
                `binding pin mismatch for "${memberId}" — the occupant generation moved`,
            );
        }
        await guestService(context).fenceMemberReport(memberId, pin);
    }
    const result = await new AgentCoordinationService(context).reportLifecycle(
        memberId,
        state as MemberLifecycleState,
        seq,
    );
    if (flags.json) {
        context.output.write(
            toEnvelopeJson(
                { member: memberId, state, seq, accepted: result.accepted, observation: result.observation ?? null },
                { enveloped: flags.enveloped },
            ),
        );
    } else {
        context.output.write(
            result.accepted
                ? `agent ${memberId}: ${state} (seq ${seq})`
                : `agent ${memberId}: ignored stale report (seq ${seq} <= ${result.observation?.seq ?? 'last'})`,
        );
    }
    return 0;
}

/** Parse `--pin <ownerEpoch>:<occupancyGeneration>`; null when absent or malformed. */
function parseBindingPin(raw: string | undefined): { ownerEpoch: number; occupancyGeneration: number } | null {
    if (raw === undefined) return null;
    const [epoch, generation, extra] = raw.split(':');
    const ownerEpoch = Number(epoch);
    const occupancyGeneration = Number(generation);
    if (
        extra !== undefined ||
        epoch === undefined ||
        generation === undefined ||
        !Number.isInteger(ownerEpoch) ||
        ownerEpoch < 0 ||
        !Number.isInteger(occupancyGeneration) ||
        occupancyGeneration < 1
    ) {
        return null;
    }
    return { ownerEpoch, occupancyGeneration };
}

/** Shared usage-error shape for `agent report` — exit 2, JSON or plain. */
function agentReportUsageError(
    context: CliContext,
    options: { json?: boolean; jsonEnvelope?: boolean },
    message: string,
): number {
    if (options.json) {
        context.output.write(
            toEnvelopeJson(
                { error: { code: 'usage', message } },
                {
                    enveloped: options.jsonEnvelope,
                    error: { code: 'VALIDATION_FAILED', message, details: { cliCode: 'usage' } },
                },
            ),
        );
    } else {
        context.output.error(message);
    }
    return 2;
}

/** Register `spur agent report`. */
export function registerAgentReportCommand(agent: Command, context: CliContext): void {
    agent
        .command('report')
        .description('Report a fleet member lifecycle state (working|idle|blocked) from a host hook.')
        .requiredOption('--state <state>', 'Lifecycle state: working, idle, or blocked')
        .requiredOption('--seq <ns>', 'Monotonic report sequence (wall-clock nanoseconds); must increase')
        .option('--spec <id>', 'Member spec id (defaults to SPUR_SPEC_ID)')
        .option(
            '--pin <epoch:generation>',
            'Host binding pin for a bound member (ownerEpoch:occupancyGeneration; completes the handshake)',
        )
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const code = await runAgentReport(context, {
                state: options.state,
                seq: options.seq,
                ...(options.spec !== undefined ? { spec: options.spec } : {}),
                ...(options.pin !== undefined ? { pin: options.pin } : {}),
                json: options.json === true,
                enveloped: options.jsonEnvelope,
            });
            context.setExitCode(code);
        });
}
