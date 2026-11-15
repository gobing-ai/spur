import type { A2aTurnResult, A2aWorkShape } from './a2a-member-transport';
import type { FleetDispatcher, FleetReceiptStatus } from './fleet-dispatcher';
import type { ResolvedFleetMember } from './fleet-service';
import { OPERATOR_INBOX_ID } from './inbox-service';

/**
 * One named-member dispatch (task 1333, ADR-148 §3.2): the delivery ladder a
 * `--agent <member>` address takes, and the reason it took it.
 *
 * | member state | delivery |
 * | --- | --- |
 * | live under `spur serve` | warm keyed inbox request (today's fleet turn) |
 * | not live, resolvable executor | cold subprocess on the member's executor (default-on) |
 * | disabled / no executor | `unavailable` with the fix named |
 *
 * The ladder steps DOWN only before anything is sent. Once the warm dispatch has
 * enqueued, its receipt is the answer: an `outcome-unknown` is reported, never
 * re-run on the cold rung (ADR-126 A4 / ADR-148 invariant 2).
 */
export type MemberDispatchResult =
    | { delivery: 'cold'; member: ResolvedFleetMember; reason: string }
    | {
          delivery: 'a2a';
          member: ResolvedFleetMember;
          status: FleetReceiptStatus;
          messageId: string;
          reason: string;
          output?: string;
          remoteBranch?: string;
      }
    | {
          delivery: 'warm';
          member: ResolvedFleetMember;
          status: FleetReceiptStatus;
          messageId: string;
          reason: string;
      }
    /**
     * Nothing can be dispatched. `addressMatched` separates the two cases a caller must
     * treat differently: `false` = the value is not a member at all, so the other
     * `--agent` rungs keep their meaning; `true` = a member (or an ambiguous address)
     * MATCHED and refuses — never a silent re-target (1333 review P2-1).
     */
    | { delivery: 'unavailable'; reason: string; addressMatched: boolean };

/**
 * Default bound on the warm receipt wait: the CLI's own wait budget
 * (`DEFAULT_TRACE_FOLLOW_TIMEOUT_MS`, 10 min), so a stuck member ends as
 * `outcome-unknown` instead of blocking the command forever (ADR-126 A4: a wait
 * that stops without a receipt is never re-run on another delivery).
 */
export const DEFAULT_MEMBER_WAIT_MS = 600_000;

/** Injected seams: the declared roster, the liveness probe and the one dispatch primitive. */
export interface MemberDispatchDeps {
    /** Declared + resolved fleet members (config only — no liveness). */
    members(): Promise<ResolvedFleetMember[]>;
    /** Is this instance live under `spur serve` right now? */
    live(instanceId: string): Promise<boolean>;
    /** The single fleet dispatch primitive; absent → the warm rung is not wired here. */
    dispatcher?: Pick<FleetDispatcher, 'dispatch'> & Partial<Pick<FleetDispatcher, 'enqueue'>>;
    /** In-process A2A turn driver (no serve); the live path still uses the keyed warm request. */
    a2a?: (
        member: ResolvedFleetMember,
        prompt: string,
        opts: {
            dispatcher: Pick<FleetDispatcher, 'enqueue'>;
            fromId: string;
            timeoutMs?: number;
            work?: A2aWorkShape;
        },
    ) => Promise<A2aTurnResult>;
    /** Artifact text for a completed warm A2A run. */
    a2aOutput?: (runId: string) => Promise<string | undefined>;
}

/**
 * Match an `--agent <address>` value against the declared roster: the full
 * instance id wins, then the member's local id (`coder` for `proj-coder`).
 * Both comparisons are EXACT — a fragment of an id is never a fuzzy pick, and
 * two local-id candidates are a declaration ambiguity, never a silent pick.
 *
 * Only ENABLED members resolve: `--agent` naming a disabled member is the same
 * refusal the role path already makes (`resolveMember` in `fleet-dispatch.ts`),
 * so the CLI and a workflow step share one resolution (1333 R5).
 */
export function resolveMemberAddress(
    members: readonly ResolvedFleetMember[],
    address: string,
): { member: ResolvedFleetMember } | { unavailable: string; addressMatched: boolean } {
    const enabled = members.filter((member) => member.enabled);
    const exact = enabled.find((member) => member.instanceId === address);
    if (exact !== undefined) return { member: exact };
    const local = enabled.filter((member) => member.localId === address);
    if (local.length === 1 && local[0] !== undefined) return { member: local[0] };
    const declared = members.map((member) => member.instanceId).join(', ') || 'none';
    if (local.length > 1) {
        return {
            unavailable: `"${address}" matches ${local.length} declared fleet members (${local
                .map((member) => member.instanceId)
                .join(', ')}) — address one by its full instance id`,
            addressMatched: true,
        };
    }
    const disabled = members.find(
        (member) => !member.enabled && (member.instanceId === address || member.localId === address),
    );
    if (disabled !== undefined) {
        return {
            unavailable: `member "${disabled.instanceId}" — ${memberDelivery(disabled, false).reason}`,
            addressMatched: true,
        };
    }
    return { unavailable: `no declared fleet member "${address}" (declared: ${declared})`, addressMatched: false };
}

/**
 * Which delivery a member takes now. Pure: liveness arrives from the caller's
 * probe, so the same function answers `spur agent doctor` and the run ladder.
 */
export function memberDelivery(
    member: ResolvedFleetMember,
    live: boolean,
): { delivery: 'warm' | 'cold' | 'a2a'; reason: string } | { delivery: 'unavailable'; reason: string } {
    if (!member.enabled) {
        return {
            delivery: 'unavailable',
            reason: 'member is disabled (agent.fleet.members[].enabled: false) — enable it or address another member',
        };
    }
    if (member.a2a !== undefined) {
        return {
            delivery: 'a2a',
            reason: live
                ? 'A2A member — live member loop drives the remote turn'
                : 'A2A member — remote turn runs in-process (no local executor)',
        };
    }
    if (member.executor === '') {
        return {
            delivery: 'unavailable',
            reason: 'member has no resolved executor — declare an executor or a resolvable role for it',
        };
    }
    if (live) {
        return { delivery: 'warm', reason: 'live under spur serve — warm inbox turn' };
    }
    return {
        delivery: 'cold',
        reason: `not live under spur serve — cold subprocess on executor '${member.executor}'`,
    };
}

/**
 * Dispatch one prompt to a named member. Returns the delivery taken and why —
 * a value, never a throw — so the caller (CLI or workflow) only maps it to an
 * exit status.
 */
export async function dispatchToNamedMember(
    address: string,
    prompt: string,
    deps: MemberDispatchDeps,
    opts: { timeoutMs?: number; signal?: AbortSignal; work?: A2aWorkShape } = {},
): Promise<MemberDispatchResult> {
    const resolution = resolveMemberAddress(await deps.members(), address);
    if ('unavailable' in resolution) {
        return { delivery: 'unavailable', reason: resolution.unavailable, addressMatched: resolution.addressMatched };
    }
    const member = resolution.member;
    const dispatcher = deps.dispatcher;
    const live = await deps.live(member.instanceId);
    const chosen = memberDelivery(member, live && dispatcher !== undefined);
    if (chosen.delivery === 'unavailable') {
        return {
            delivery: 'unavailable',
            reason: `member "${member.instanceId}" — ${chosen.reason}`,
            addressMatched: true,
        };
    }
    if (chosen.delivery === 'cold') {
        return { delivery: 'cold', member, reason: chosen.reason };
    }
    if (chosen.delivery === 'a2a' && !live) {
        if (deps.a2a === undefined || dispatcher?.enqueue === undefined) {
            return {
                delivery: 'unavailable',
                reason: `member "${member.instanceId}" declares a2a but no A2A turn service is wired`,
                addressMatched: true,
            };
        }
        const result = await deps.a2a(member, prompt, {
            dispatcher: { enqueue: dispatcher.enqueue.bind(dispatcher) },
            fromId: OPERATOR_INBOX_ID,
            ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
            ...(opts.work !== undefined ? { work: opts.work } : {}),
        });
        return {
            delivery: 'a2a',
            member,
            status: result.status,
            messageId: result.messageId,
            reason: result.reason ?? chosen.reason,
            ...(result.output !== undefined ? { output: result.output } : {}),
            ...(result.remoteBranch !== undefined ? { remoteBranch: result.remoteBranch } : {}),
        };
    }
    if (dispatcher === undefined) {
        return {
            delivery: 'unavailable',
            reason: `member "${member.instanceId}" has no wired fleet dispatcher`,
            addressMatched: true,
        };
    }
    // Warm rung: from here the receipt is the answer. No status re-runs the cold path.
    // `timeoutMs` is always finite (the caller derives it from the CLI wait budget): an
    // unbounded wait blocks the command forever on a live-but-stuck member, and the
    // `outcome-unknown` branch would be unreachable outside the unit tests.
    const receipt = await dispatcher.dispatch(
        // Sender is the human OPERATOR (the reserved inbox id), not the `spur` system
        // address: a manual dispatch IS the operator's request, and a member reply must
        // land in a mailbox somebody drains (1333 review P3).
        { member: member.instanceId, fromId: OPERATOR_INBOX_ID, body: prompt },
        {
            timeoutMs: opts.timeoutMs ?? DEFAULT_MEMBER_WAIT_MS,
            ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
        },
    );
    const output =
        member.a2a !== undefined && receipt.status === 'completed' && receipt.runId !== undefined
            ? await deps.a2aOutput?.(receipt.runId)
            : undefined;
    return {
        delivery: member.a2a !== undefined ? 'a2a' : 'warm',
        member,
        status: receipt.status,
        messageId: receipt.messageId,
        reason: chosen.reason,
        ...(output !== undefined ? { output } : {}),
    };
}
