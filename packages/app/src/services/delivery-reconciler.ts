import type { CoordinationArtifactRef, DbAdapter, InboxRequestRow } from '@gobing-ai/spur-domain';
import { InboxService, MAX_DELIVERY_ATTEMPTS } from './inbox-service';

/**
 * Why an unfinished message is being held (0834 R4). Each reason derives from a
 * named field — never from one overloaded status column. G63's 0844 renders
 * these as the Board's distinct result states; the names are the contract.
 */
export type HoldReason = 'delivery-failed' | 'attempts-exhausted' | 'outcome-unknown' | 'run-exit-only';

/** One held message with its run correlation (0834 R3). */
export interface UnresolvedDelivery {
    messageId: string;
    toId: string;
    reason: HoldReason;
    injectAttempts: number;
    injectError?: string;
    /**
     * The row's `request_key` (0832 keyed-submission identity), or null for keyless traffic
     * (G71 R1). Carried so a consumer can tell a fleet dispatch from an operator/conversational
     * message without re-reading the inbox row. Never parsed — dispatch linkage lives in
     * `task_id`/`parent_run_id` (G11 R9).
     */
    requestKey: string | null;
    runId?: string;
    taskId?: string;
    runStatus?: string;
    artifacts: CoordinationArtifactRef[];
}

/** Result of one reconciliation pass (0834 R1). */
export interface ReconcileReport {
    unresolved: UnresolvedDelivery[];
    /** Message ids settled `failed` by THIS pass (empty on a pure pass). */
    exhausted: string[];
    scanned: number;
}

/** DB source needed by the reconciler — satisfied structurally by CliContext. */
export interface DeliveryReconcilerContext {
    getDb(): Promise<DbAdapter>;
}

/**
 * Classifies request outcomes separately from delivery; never requeues ambiguous work.
 *
 * G11 R4/R8: the reads and the one write all go through {@link InboxService} — request rows
 * (never chat) with their newest run receipt in a single join, and `sweep` before `classify`
 * so an expired claim is resolved by its receipt instead of being re-dispatched (0834 R2).
 */
export class DeliveryReconciler {
    constructor(private readonly ctx: DeliveryReconcilerContext) {}

    private async inbox(): Promise<InboxService> {
        return new InboxService({ getDb: () => this.ctx.getDb() });
    }

    /**
     * Read-only classification for the CLI, Board, and restart reconciler.
     *
     * `rows` lets {@link reconcile} hand over the request read it already did, so one pass
     * issues one query instead of two.
     */
    async classify(agentId?: string, rows?: readonly InboxRequestRow[]): Promise<UnresolvedDelivery[]> {
        const requests = rows ?? (await (await this.inbox()).requests(agentId));
        const unresolved: UnresolvedDelivery[] = [];
        for (const row of requests) {
            const base = {
                messageId: row.id,
                toId: row.toId,
                injectAttempts: row.attempts,
                requestKey: row.requestKey,
                ...(row.error !== null && row.error !== '' ? { injectError: row.error } : {}),
            };

            // 1. Terminal delivery failure — queryable hold, never repaired.
            if (row.status === 'failed') {
                unresolved.push({
                    ...base,
                    reason: row.attempts >= MAX_DELIVERY_ATTEMPTS ? 'attempts-exhausted' : 'delivery-failed',
                    artifacts: [],
                });
                continue;
            }

            // 2/3. Claimed or delivered: the run receipt decides.
            if (row.status === 'claimed' || row.status === 'delivered') {
                if (row.runId === null) {
                    // A delivered row always came from a claim, so a missing receipt is an
                    // absence of evidence, not a failure — never repaired here.
                    unresolved.push({ ...base, reason: 'outcome-unknown', artifacts: [] });
                    continue;
                }
                const completed = row.runStatus !== 'running';
                if (completed && row.runOutcome === 'verified') continue;
                unresolved.push({
                    ...base,
                    reason: !completed
                        ? 'outcome-unknown'
                        : row.runOutcome === 'errored'
                          ? 'delivery-failed'
                          : row.runOutcome === 'run-exit-only'
                            ? 'run-exit-only'
                            : 'outcome-unknown',
                    runId: row.runId,
                    ...(row.runStatus !== null ? { runStatus: row.runStatus } : {}),
                    ...(row.runTaskId !== null ? { taskId: row.runTaskId } : {}),
                    artifacts: parseArtifactRefs(row.runArtifactRefsJson),
                });
            }

            // 4. Still queued: nothing to classify — the member has not claimed it yet.
        }
        return unresolved;
    }

    /**
     * Sweep expired claims, then classify. The sweep is the pass's only write: it settles a
     * claim from its receipt, requeues an unclaimed work item, and fails a message whose
     * attempt budget is spent.
     */
    async reconcile(agentId?: string): Promise<ReconcileReport> {
        const service = await this.inbox();
        const swept = await service.sweep();
        // One request read per pass: the same rows are classified and counted.
        const rows = await service.requests(agentId);
        return { unresolved: await this.classify(agentId, rows), exhausted: swept.failed, scanned: rows.length };
    }
}

/** Parse a run row's path-only artifact refs; corrupt/absent JSON → []. */
function parseArtifactRefs(artifactRefsJson: string | null): CoordinationArtifactRef[] {
    if (artifactRefsJson === null) return [];
    try {
        const parsed: unknown = JSON.parse(artifactRefsJson);
        return Array.isArray(parsed) ? (parsed as CoordinationArtifactRef[]) : [];
    } catch {
        return [];
    }
}
