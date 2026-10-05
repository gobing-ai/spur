import type { CoordinationRunDao } from '@gobing-ai/spur-domain';
import type { AgentCoordinationService } from './agent-coordination-service';

/**
 * One fleet dispatch primitive (G71 R1/R2, ADR-126 amendment A4).
 *
 * Before this module there were two fleet dispatch paths: the workflow
 * `agent.run --agent fleet` branch (`packages/app/src/workflow/fleet-dispatch.ts`)
 * polled an `expectFile` and the GTD strategy ran `runTraced` in the planner
 * process. Both are replaced by this single sender: every fleet dispatch enqueues
 * one keyed inbox message and resolves on the `coordination_runs` receipt linked
 * to that message, pinned to the member occupant (ADR-075).
 *
 * A missing receipt is NEVER inferred as a failure. A wait that stops without one
 * — deadline or operator abort — reports `outcome-unknown` (R2), because the work
 * may still be running; only a definite `failed`/`not-started` receipt authorizes
 * a retry or a fallback.
 */
export type FleetReceiptStatus = 'completed' | 'failed' | 'not-started' | 'outcome-unknown';

/** A dispatch request. `member` is the concrete instance id (the occupant pin), never a role. */
export interface FleetDispatchRequest {
    /** Concrete instance id = the occupant the wait is pinned to. */
    member: string;
    /**
     * Sender identity. A member may reply to this id, so it must be real:
     * the orchestrator instance id for strategy dispatches, `workflow:<runId>`
     * for workflow dispatches.
     */
    fromId: string;
    /** Work prompt body (strategy: `/sp:dev-run <wbs> --auto`). */
    body: string;
    /** `fleet:task:<wbs>:<n>` for strategy dispatches, `<runId>/<state>` for workflow ones. */
    requestKey: string;
}

/** A resolved receipt. `runId` is present whenever a run row exists. */
export interface FleetReceipt {
    status: FleetReceiptStatus;
    messageId: string;
    runId?: string;
}

/** Receipt poll cadence for {@link FleetDispatcher.awaitReceipt}. */
export const RECEIPT_POLL_INTERVAL_MS = 250;

/** Injected seams — the receipt owners (0833) and the inbox, never reimplemented here. */
export interface FleetDispatcherDeps {
    coordination: Pick<AgentCoordinationService, 'sendMessage' | 'getMessage'>;
    runs: Pick<CoordinationRunDao, 'listByMessageId'>;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}

/**
 * The single fleet dispatch primitive (R5). Both callers — the workflow
 * `agent.run --agent fleet` branch and the strategy tick — go through it, so
 * there is exactly one enqueue path and one receipt interpretation.
 */
export class FleetDispatcher {
    private readonly now: () => number;
    private readonly sleep: (ms: number) => Promise<void>;

    constructor(private readonly deps: FleetDispatcherDeps) {
        this.now = deps.now ?? (() => Date.now());
        this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    }

    /**
     * Enqueue the keyed inbox message. `requestKey` is the idempotency identity
     * (0832): a replayed key returns the ORIGINAL message id and writes nothing, so
     * a crashed tick that re-enqueues the same attempt cannot double-dispatch.
     */
    async enqueue(req: FleetDispatchRequest): Promise<{ messageId: string; replayed: boolean }> {
        const sent = await this.deps.coordination.sendMessage(
            req.fromId,
            req.member,
            req.body,
            undefined,
            req.requestKey,
        );
        return { messageId: sent.msgId, replayed: sent.replayed === true };
    }

    /**
     * Non-blocking receipt read (R2). `null` means the dispatch is still
     * pending, claimed, or running — an absence of evidence, not a failure.
     * Only the newest run row for THIS message whose `spec_id` is the pinned
     * member counts; another occupant's row is ignored so a re-dispatch to a
     * different member cannot inherit the previous member's outcome.
     */
    async receipt(messageId: string, member: string): Promise<FleetReceipt | null> {
        const rows = await this.deps.runs.listByMessageId(messageId);
        const row = rows.find((candidate) => candidate.spec_id === member);
        if (row !== undefined) {
            if (row.status === 'exited') return { status: 'completed', messageId, runId: row.run_id };
            if (row.status === 'errored') return { status: 'failed', messageId, runId: row.run_id };
            return null;
        }
        // No run row at all: a settled-failed inbox row is the one definite
        // not-started signal (the delivery never reached an invoke).
        const message = await this.deps.coordination.getMessage(messageId);
        if (message !== null && message.status === 'failed') return { status: 'not-started', messageId };
        return null;
    }

    /**
     * Poll {@link receipt} until it resolves or the deadline passes. A stop
     * without a definite receipt is `outcome-unknown` — for a deadline AND for an
     * abort, because in both cases the member may still be working and R2 forbids
     * re-dispatching it.
     */
    async awaitReceipt(
        messageId: string,
        member: string,
        opts: { timeoutMs: number; signal?: AbortSignal },
    ): Promise<FleetReceipt> {
        const deadline = this.now() + opts.timeoutMs;
        for (;;) {
            if (opts.signal?.aborted === true) return { status: 'outcome-unknown', messageId };
            const receipt = await this.receipt(messageId, member);
            if (receipt !== null) return receipt;
            if (this.now() >= deadline) return { status: 'outcome-unknown', messageId };
            await this.sleep(RECEIPT_POLL_INTERVAL_MS);
        }
    }

    /** Enqueue then wait for the receipt (the one-call form both callers use). */
    async dispatch(
        req: FleetDispatchRequest,
        opts: { timeoutMs: number; signal?: AbortSignal },
    ): Promise<FleetReceipt> {
        const { messageId } = await this.enqueue(req);
        return this.awaitReceipt(messageId, req.member, opts);
    }
}
