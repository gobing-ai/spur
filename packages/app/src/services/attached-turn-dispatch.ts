import { randomUUID } from 'node:crypto';
import type { TurnOutcome } from '@gobing-ai/ts-ai-runner';
import type { WarmTurnContext, WarmTurnDispatch } from '../observability/agent-execution';
import type { FleetDispatcher } from './fleet-dispatcher';
import { RECEIPT_POLL_INTERVAL_MS } from './fleet-dispatcher';
import type { InboxMessage } from './inbox-service';

/**
 * Attached-occupant stage execution (task 1282, design `fleet-attached-occupants` §5–6).
 *
 * A bound attached occupant has no host-owned loop: the pull loop IS the loop and the
 * occupant's live session IS the executor, so a stage turn resolves on the occupant's
 * **correlated reply**, not on a `coordination_runs` row (an in-session turn never writes
 * one). `createAttachedTurnDispatcher` owns exactly that: it sends the keyed request through
 * the single {@link FleetDispatcher.enqueue} path, then polls for the reply message whose
 * body carries the turn correlation and the host binding pin (§4). 1275's executor path is
 * unchanged — this is a `dispatchTurn` implementation, not a second success authority: a
 * completed correlation still passes the action's artifact/contract check downstream.
 *
 * Fencing mirrors the warm dispatcher (G74 R4): a reply tagged with another request, attempt,
 * owner epoch or occupant generation is diagnostic evidence only — it never certifies a turn
 * and never releases the write lease. A deadline or abort leaves the turn `outcome-unknown`
 * (the occupant may still be working; R2 forbids re-dispatching it).
 */

/** Identity the attached dispatcher pins — the binder's host binding pin (§4). */
export interface AttachedTurnBinding {
    memberId: string;
    ownerEpoch: number;
    occupantGeneration: number;
}

/** The correlation + pin payload an occupant's reply body must carry (R3). */
export interface AttachedTurnReply {
    requestId: string;
    attempt: number;
    ownerEpoch: number;
    occupancyGeneration: number;
    /** Artifact pointer (path or summary) the occupant produced; informational here. */
    artifact?: string;
}

/**
 * The receipt row one attached turn contributes (AC3): a supervised receipt's fields plus
 * `occupant: 'attached'`. Kept standalone — it is not a `TurnReceipt` subtype, because the
 * 1275 receipt's `mode` union has no attached value and the warm module is not this task's.
 */
export interface AttachedTurnReceipt {
    mode: 'attached';
    occupant: 'attached';
    requestId: string;
    attempt: number;
    memberId: string;
    ownerEpoch: number;
    occupantGeneration: number;
    /** The reply message that certified the turn. */
    replyMessageId?: string;
}

/** Diagnostic sink for stale/foreign turn evidence; absent → the evidence is dropped, never promoted. */
export type AttachedTurnDiagnostic = (detail: { event: string; reason: string; turn: AttachedTurnReceipt }) => void;

/** Injected seams — the keyed sender and the reply reader, never reimplemented here. */
export interface AttachedTurnDispatcherDeps {
    /** The single fleet enqueue path (idempotent request key — a replay cannot double-dispatch). */
    dispatcher: Pick<FleetDispatcher, 'enqueue'>;
    /**
     * Reply read path: inbox rows answering THIS dispatch (`inReplyTo === messageId`). A plain
     * inbox message without that linkage is never visible here, so a delivered message can
     * never complete a stage (R3).
     */
    replies: (messageId: string) => Promise<InboxMessage[]>;
    /** Loop-lifetime identity pinned onto every turn and receipt (§4). */
    binding: AttachedTurnBinding;
    /** Poll cadence; defaults to {@link RECEIPT_POLL_INTERVAL_MS}. */
    pollMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    /** Diagnostic sink (a `fleet.turn.stale` system event in production). */
    diagnose?: AttachedTurnDiagnostic;
}

/** What the executor hands the attached dispatcher and reads back afterwards. */
export interface AttachedTurnDispatcher {
    /** The `AgentExecutionOptions.dispatchTurn` seam — same shape as the warm dispatcher's. */
    dispatchTurn(context: WarmTurnContext): Promise<WarmTurnDispatch>;
    /** The receipt row of the most recent dispatch (undefined before the first call). */
    lastTurn(): AttachedTurnReceipt | undefined;
}

/** Parse the reply correlation payload; `null` when the body is not the expected JSON shape. */
function parseReply(body: string): AttachedTurnReply | null {
    try {
        const parsed = JSON.parse(body) as Partial<AttachedTurnReply>;
        if (
            typeof parsed.requestId !== 'string' ||
            typeof parsed.attempt !== 'number' ||
            typeof parsed.ownerEpoch !== 'number' ||
            typeof parsed.occupancyGeneration !== 'number'
        ) {
            return null;
        }
        return {
            requestId: parsed.requestId,
            attempt: parsed.attempt,
            ownerEpoch: parsed.ownerEpoch,
            occupancyGeneration: parsed.occupancyGeneration,
            ...(typeof parsed.artifact === 'string' ? { artifact: parsed.artifact } : {}),
        };
    } catch {
        return null;
    }
}

/** Build the attached dispatcher for one stage execution (1275's seam, attached transport). */
export function createAttachedTurnDispatcher(deps: AttachedTurnDispatcherDeps): AttachedTurnDispatcher {
    const now = deps.now ?? (() => Date.now());
    const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const pollMs = deps.pollMs ?? RECEIPT_POLL_INTERVAL_MS;
    let receipt: AttachedTurnReceipt | undefined;
    return {
        lastTurn: () => receipt,
        async dispatchTurn(context: WarmTurnContext): Promise<WarmTurnDispatch> {
            const startedAt = new Date().toISOString();
            const { requestId, attempt } = context.correlation;
            const base: AttachedTurnReceipt = {
                mode: 'attached',
                occupant: 'attached',
                requestId,
                attempt,
                memberId: deps.binding.memberId,
                ownerEpoch: deps.binding.ownerEpoch,
                occupantGeneration: deps.binding.occupantGeneration,
            };
            const terminal = (outcome: TurnOutcome, finalReceipt?: AttachedTurnReceipt): WarmTurnDispatch => {
                receipt = {
                    ...base,
                    ...(finalReceipt !== undefined ? { replyMessageId: finalReceipt.replyMessageId } : {}),
                };
                return { kind: 'warm', outcome };
            };
            const unresolved = (reason: string): WarmTurnDispatch => {
                const at = new Date().toISOString();
                return terminal({
                    kind: 'outcome-unknown',
                    turnId: randomUUID(),
                    correlation: context.correlation,
                    reason,
                    startedAt,
                    terminalAt: at,
                });
            };
            // The keyed request: the same idempotent send every fleet dispatch uses, keyed on
            // the turn correlation so a replay cannot double-dispatch the stage (G71 R1).
            const { messageId } = await deps.dispatcher.enqueue({
                member: deps.binding.memberId,
                fromId: `workflow-${context.correlation.runId}`,
                body: context.prompt,
                requestKey: `fleet:task:${requestId}:${attempt}`,
            });
            const deadline = now() + TURN_DEADLINE_MS;
            for (;;) {
                if (context.signal?.aborted === true) return unresolved('attached turn aborted');
                for (const message of await deps.replies(messageId)) {
                    const reply = parseReply(message.body);
                    if (reply === null) {
                        deps.diagnose?.({ event: 'fleet.turn.stale', reason: 'unparseable-reply', turn: base });
                        continue;
                    }
                    if (reply.requestId !== requestId) {
                        deps.diagnose?.({ event: 'fleet.turn.stale', reason: 'foreign-request', turn: base });
                        continue;
                    }
                    if (reply.attempt !== attempt) {
                        deps.diagnose?.({ event: 'fleet.turn.stale', reason: 'stale-attempt', turn: base });
                        continue;
                    }
                    if (
                        reply.ownerEpoch !== deps.binding.ownerEpoch ||
                        reply.occupancyGeneration !== deps.binding.occupantGeneration
                    ) {
                        deps.diagnose?.({ event: 'fleet.turn.stale', reason: 'stale-pin', turn: base });
                        continue;
                    }
                    // Correlation certified; the artifact/contract check stays downstream (1275).
                    const at = new Date().toISOString();
                    return terminal(
                        {
                            kind: 'success',
                            turnId: randomUUID(),
                            correlation: context.correlation,
                            reason: reply.artifact,
                            finalText: reply.artifact,
                            startedAt,
                            acceptedAt: at,
                            terminalAt: at,
                        },
                        { ...base, replyMessageId: message.id },
                    );
                }
                if (now() >= deadline) return unresolved('attached turn deadline passed without a correlated reply');
                await sleep(pollMs);
            }
        },
    };
}

/**
 * Attached turns run on a human's live session — there is no process timeout to lean on, so
 * the dispatcher's own deadline only bounds the wait, never the work: expiry is
 * `outcome-unknown` (resumable), not failure. One hour matches a long human turn.
 */
const TURN_DEADLINE_MS = 60 * 60 * 1000;
