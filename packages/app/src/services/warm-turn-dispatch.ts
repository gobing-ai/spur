import { randomUUID } from 'node:crypto';
import {
    type OpenTurnSessionResult,
    type TurnHandle,
    type TurnOutcome,
    type TurnOutcomeKind,
    type TurnSession,
    type TurnSessionPolicy,
    turnSessionPolicyDigest,
} from '@gobing-ai/ts-ai-runner';
import type { WarmFallbackReason, WarmTurnContext, WarmTurnDispatch } from '../observability/agent-execution';

/**
 * Correlated warm-turn eligibility (task 1275, G74 R1–R5; design
 * `fleet-task-turn-execution` §4–5, ADR-145).
 *
 * This module owns ONE decision: may this keyed request reuse the member's warm worker, and if
 * not, which named reason sends it back to the existing resume/one-shot path? It deliberately
 * owns no transport, protocol or process mechanics — those live in `@gobing-ai/ts-ai-runner`
 * (task 1284) — and it is NOT a second success authority: a warm `success` still has to pass the
 * action's artifact/contract check in `AgentRunActionRunner`.
 *
 * Fencing is the other half: a terminal (or progress frame) tagged with another request, attempt,
 * owner epoch or occupant generation is diagnostic evidence only. It never certifies a turn and
 * never releases the write lease (R4).
 */

/** Identity a warm session was opened for — a mismatch fences the whole session off. */
export interface TurnSessionBinding {
    memberId: string;
    ownerEpoch: number;
    occupantGeneration: number;
}

/** The member-owned slot the loop-lifetime session lives in (`MemberSession`). */
export interface WarmTurnSessionHolder {
    /** The open session, if any. */
    turnSession(): TurnSession | undefined;
    /** Identity the open session was adopted for. */
    turnBinding(): TurnSessionBinding | undefined;
    /** Close and forget the open session (policy change, generation transfer, reset, shutdown). */
    closeTurnSession(): Promise<void>;
    /** Adopt a freshly opened session under this identity. */
    adoptTurnSession(session: TurnSession, binding: TurnSessionBinding): void;
    /**
     * The resume id the fallback dispatch will actually use, if any (R2: the receipt's `mode`
     * must name the path taken, not the path the dispatcher guessed).
     */
    resumeId?(): string | undefined;
}

/**
 * The receipt row one turn contributes (R2): acceptance, native terminal outcome, and the
 * correlation a reader joins on. The action-contract verdict is NOT here — the receipt's own
 * `outcome`/`contract` fields stay the sole success authority.
 */
export interface TurnReceipt {
    mode: 'warm' | 'resume' | 'one-shot';
    fallbackReason?: WarmFallbackReason;
    policyDigest?: string;
    acceptedAt?: string;
    nativeOutcome?: TurnOutcomeKind;
    nativeSessionId?: string;
    nativeTurnId?: string;
    requestId: string;
    attempt: number;
    memberId: string;
    ownerEpoch: number;
    occupantGeneration: number;
}

/** Diagnostic sink for stale/foreign turn evidence; absent → the evidence is dropped, never promoted. */
export type WarmTurnDiagnostic = (detail: { event: string; reason: string; turn: TurnReceipt }) => void;

/** Loop-lifetime collaborators one warm-turn dispatcher is built with (fresh per drain). */
export interface WarmTurnDispatcherDeps {
    /** The runner facet the dispatcher opens sessions through (`AiRunner.openTurnSession`). */
    openSession(agent: string, policy: TurnSessionPolicy): Promise<OpenTurnSessionResult>;
    holder: WarmTurnSessionHolder;
    /** Loop-lifetime identity pinned onto every turn and receipt. */
    binding: TurnSessionBinding;
    /** Roles that must never share a conversation (ADR-121); the one list, no second copy. */
    freshRoles: readonly string[];
    /** Diagnostic sink (a `fleet.turn.stale` system event in production). */
    diagnose?: WarmTurnDiagnostic;
}

/** What the loop hands the executor and reads back afterwards. */
export interface WarmTurnDispatcher {
    /** The `AgentExecutionOptions.dispatchTurn` seam. */
    dispatchTurn(context: WarmTurnContext): Promise<WarmTurnDispatch>;
    /** The receipt row of the most recent dispatch (undefined before the first call). */
    lastTurn(): TurnReceipt | undefined;
}

/** Policy a turn session is opened under — the digest of this is what reuse compares. */
function turnPolicy(context: WarmTurnContext): TurnSessionPolicy {
    return {
        workspace: context.cwd,
        role: context.role,
        ...(context.model !== undefined ? { model: context.model } : {}),
    };
}

/** Build the dispatcher one keyed drain uses (fresh per drain; the SESSION outlives it). */
export function createWarmTurnDispatcher(deps: WarmTurnDispatcherDeps): WarmTurnDispatcher {
    let receipt: TurnReceipt | undefined;

    const record = (context: WarmTurnContext, extra: Partial<TurnReceipt>): TurnReceipt => {
        receipt = {
            requestId: context.correlation.requestId,
            attempt: context.correlation.attempt,
            memberId: deps.binding.memberId,
            ownerEpoch: deps.binding.ownerEpoch,
            occupantGeneration: deps.binding.occupantGeneration,
            ...extra,
            mode: extra.mode ?? 'warm',
        };
        return receipt;
    };

    /** A fallback is named once and never retried here (R5: exactly one fallback attempt). */
    const fallback = (
        context: WarmTurnContext,
        reason: WarmFallbackReason,
        detail?: string,
        nativeOutcome?: TurnOutcome['kind'],
    ): WarmTurnDispatch => {
        // The executor continues on resume when the member has a session id, else one-shot;
        // the receipt names that path so R2's evidence is not a guess.
        const mode: TurnReceipt['mode'] =
            reason !== 'fresh-role' && deps.holder.resumeId?.() !== undefined ? 'resume' : 'one-shot';
        record(context, {
            mode,
            fallbackReason: reason,
            // A fallback replaces the warm receipt; retain its native outcome separately from
            // the fallback's eventual action-contract result.
            ...(nativeOutcome !== undefined ? { nativeOutcome } : {}),
        });
        return { kind: 'fallback', reason, ...(detail !== undefined ? { detail } : {}) };
    };

    /**
     * Fence a value against the current turn identity (R2/R4): a superseded attempt or a foreign
     * request is diagnostic evidence only, never certification.
     */
    const fence = (
        turn: TurnReceipt,
        correlation: WarmTurnContext['correlation'],
        expected: WarmTurnContext['correlation'],
    ): boolean => {
        if (
            correlation.runId === expected.runId &&
            correlation.executionId === expected.executionId &&
            correlation.requestId === expected.requestId &&
            correlation.attempt === expected.attempt
        )
            return false;
        deps.diagnose?.({
            event: 'fleet.turn.stale',
            reason:
                correlation.requestId !== turn.requestId
                    ? `foreign requestId ${correlation.requestId}`
                    : 'superseded run, execution or attempt',
            turn,
        });
        return true;
    };

    const dispatchTurn = async (context: WarmTurnContext): Promise<WarmTurnDispatch> => {
        // R3 / ADR-121: an independent reviewer never shares a conversation with the work it judges.
        if (deps.freshRoles.includes(context.role)) return fallback(context, 'fresh-role');

        const policy = turnPolicy(context);
        const session = deps.holder.turnSession();
        const adopted = deps.holder.turnBinding();
        const transferred =
            adopted !== undefined &&
            (adopted.memberId !== deps.binding.memberId ||
                adopted.ownerEpoch !== deps.binding.ownerEpoch ||
                adopted.occupantGeneration !== deps.binding.occupantGeneration);
        // R3: reuse needs the SAME policy (model/provider/reasoning/tools/permissions/workspace/role).
        const policyChanged =
            session !== undefined &&
            (session.agent !== context.agent || session.policyDigest !== turnSessionPolicyDigest(policy));
        if (session !== undefined && (transferred || policyChanged || session.state === 'closed')) {
            // An occupant transfer or a changed policy retires the old conversation; the NEW one
            // still runs warm, so this is a reset, not a fallback.
            await deps.holder.closeTurnSession();
        }
        let active = deps.holder.turnSession();
        if (active === undefined) {
            const opened = await deps.openSession(context.agent, policy);
            if (!opened.ok) return fallback(context, opened.reason, opened.detail);
            deps.holder.adoptTurnSession(opened.session, deps.binding);
            active = opened.session;
        }

        // One active turn per worker is an invariant, not a queue: a busy session means the
        // previous turn never settled, so this request stays UNCERTAIN rather than replaying a
        // write (R4). Closing settles the orphan; the receipt records the uncertainty.
        if (active.state === 'busy') {
            await deps.holder.closeTurnSession();
            const now = new Date().toISOString();
            const unresolved: TurnOutcome = {
                kind: 'outcome-unknown',
                turnId: randomUUID(),
                correlation: context.correlation,
                reason: 'turn session busy: the previous turn never settled',
                startedAt: now,
                terminalAt: now,
            };
            record(context, { mode: 'warm', policyDigest: active.policyDigest, nativeOutcome: 'outcome-unknown' });
            return { kind: 'warm', outcome: unresolved };
        }

        let handle: TurnHandle;
        try {
            handle = active.startTurn({
                prompt: context.prompt,
                correlation: context.correlation,
                ...(context.signal !== undefined ? { signal: context.signal } : {}),
            });
        } catch (error) {
            // A stdin that is already gone never accepted the turn — a named, non-retried fallback.
            await deps.holder.closeTurnSession();
            return fallback(context, 'not-started', error instanceof Error ? error.message : String(error));
        }

        const turn = record(context, { mode: 'warm', policyDigest: active.policyDigest });
        void pumpEvents(handle, context, turn);
        const outcome = await handle.outcome;
        if (outcome.acceptedAt !== undefined) turn.acceptedAt = outcome.acceptedAt;
        turn.nativeOutcome = outcome.kind;
        if (outcome.nativeSessionId !== undefined) turn.nativeSessionId = outcome.nativeSessionId;
        if (outcome.nativeTurnId !== undefined) turn.nativeTurnId = outcome.nativeTurnId;
        // The terminal is tagged with the correlation the turn was started under; a mismatched
        // tag means the answer belongs to another attempt, so the turn stays uncertified.
        const foreign = fence(turn, outcome.correlation, context.correlation);
        const currentBinding = deps.holder.turnBinding();
        const superseded =
            deps.holder.turnSession() !== active ||
            currentBinding?.memberId !== deps.binding.memberId ||
            currentBinding?.ownerEpoch !== deps.binding.ownerEpoch ||
            currentBinding?.occupantGeneration !== deps.binding.occupantGeneration;
        if (foreign || superseded) {
            if (superseded) {
                deps.diagnose?.({ event: 'fleet.turn.stale', reason: 'worker binding changed during the turn', turn });
            }
            if (deps.holder.turnSession() === active) await deps.holder.closeTurnSession();
            else await active.close();
            return {
                kind: 'warm',
                outcome: {
                    kind: 'outcome-unknown',
                    turnId: handle.turnId,
                    correlation: context.correlation,
                    startedAt: outcome.startedAt,
                    ...(outcome.acceptedAt !== undefined ? { acceptedAt: outcome.acceptedAt } : {}),
                    terminalAt: outcome.terminalAt,
                    reason: 'warm turn identity changed before terminal settlement',
                },
            };
        }

        // A turn that never started is the one post-`startTurn` fallback the contract allows (R5):
        // nothing was accepted, so resume/one-shot cannot double-execute.
        if (outcome.kind === 'not-started') {
            return fallback(context, 'not-started', outcome.reason, outcome.kind);
        }
        // Everything else — including outcome-unknown and contract-violation — is this turn's
        // answer; there is no fallback after acceptance.
        return { kind: 'warm', outcome };
    };

    /** Forward live output and route foreign/stale frames to the diagnostic sink (AC4). */
    const pumpEvents = async (handle: TurnHandle, context: WarmTurnContext, turn: TurnReceipt): Promise<void> => {
        try {
            for await (const event of handle.events) {
                if (event.type === 'output') {
                    const chunk = typeof event.data === 'string' ? event.data : '';
                    if (chunk !== '') context.onOutput?.(chunk);
                    continue;
                }
                if (event.type === 'diagnostic') {
                    // The facade routes a foreign turnId, a late duplicate or an unattributable
                    // frame here; it is evidence, never certification (R4/AC4).
                    deps.diagnose?.({
                        event: 'fleet.turn.stale',
                        reason: 'frame unattributable to the active turn (foreign or late)',
                        turn,
                    });
                }
            }
        } catch {
            // The stream is advisory; `handle.outcome` is the authority.
        }
    };

    return {
        dispatchTurn,
        lastTurn: () => receipt,
    };
}
