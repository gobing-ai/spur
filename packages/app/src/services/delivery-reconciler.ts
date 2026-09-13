import {
    type CoordinationArtifactRef,
    CoordinationRunDao,
    type DbAdapter,
    InboxMessageDao,
    InboxUnfinishedDao,
    type InboxUnfinishedRow,
} from '@gobing-ai/spur-domain';

/**
 * Bounded redelivery budget (0831 Q&A): attempts ARE counted by the drain
 * claim; promote to config only if a deployment needs it to vary. Hoisted here
 * from the CLI drain path (0834) so the drain's release-or-fail settle and the
 * restart reconciler share one constant — never re-derive the number.
 */
export const MAX_INJECT_ATTEMPTS = 3;

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
    runId?: string;
    taskId?: string;
    runStatus?: string;
    artifacts: CoordinationArtifactRef[];
}

/** Result of one reconciliation pass (0834 R1). */
export interface ReconcileReport {
    unresolved: UnresolvedDelivery[];
    /** Message ids marked `failed` by THIS pass (the only write; empty on a pure pass). */
    exhausted: string[];
    scanned: number;
}

/** DB source needed by the reconciler — satisfied structurally by CliContext. */
export interface DeliveryReconcilerContext {
    getDb(): Promise<DbAdapter>;
}

/** Classifies request outcomes separately from delivery; never requeues ambiguous work. */
export class DeliveryReconciler {
    constructor(private readonly ctx: DeliveryReconcilerContext) {}

    /** Read-only classification for the CLI, Board, and restart reconciler. */
    async classify(agentId?: string): Promise<UnresolvedDelivery[]> {
        const db = await this.ctx.getDb();
        const rows: InboxUnfinishedRow[] = await new InboxUnfinishedDao(db).listUnfinished(agentId);
        const runs = new CoordinationRunDao(db);
        const unresolved: UnresolvedDelivery[] = [];
        for (const row of rows) {
            const base = {
                messageId: row.id,
                toId: row.to_id,
                injectAttempts: row.inject_attempts,
                ...(row.inject_error !== null && row.inject_error !== '' ? { injectError: row.inject_error } : {}),
            };

            // 1. Terminal delivery failure — queryable hold, never repaired.
            if (row.status === 'failed') {
                unresolved.push({
                    ...base,
                    reason: row.inject_attempts >= MAX_INJECT_ATTEMPTS ? 'attempts-exhausted' : 'delivery-failed',
                    artifacts: [],
                });
                continue;
            }

            // 2/3. Consumed by a drain: the receipt decides.
            if (row.status === 'injected' || row.status === 'delivered') {
                const runRow = (await runs.listByMessageId(row.id))[0];
                if (runRow === undefined) {
                    unresolved.push({ ...base, reason: 'outcome-unknown', artifacts: [] });
                    continue;
                }
                const completed = runRow.completed_at !== null && runRow.status !== 'running';
                if (completed && runRow.outcome === 'verified') continue;
                unresolved.push({
                    ...base,
                    reason: !completed
                        ? 'outcome-unknown'
                        : runRow.outcome === 'errored'
                          ? 'delivery-failed'
                          : runRow.outcome === 'run-exit-only'
                            ? 'run-exit-only'
                            : 'outcome-unknown',
                    runId: runRow.run_id,
                    runStatus: runRow.status,
                    ...(runRow.task_id !== null ? { taskId: runRow.task_id } : {}),
                    artifacts: parseArtifactRefs(runRow.artifact_refs_json),
                });
            }

            // 4/5. Still queued: step 4 (the budget marking) is reconcile()'s
            // only write; a pure classification omits every queued row.
        }
        return unresolved;
    }

    async reconcile(agentId?: string): Promise<ReconcileReport> {
        const db = await this.ctx.getDb();
        const rows: InboxUnfinishedRow[] = await new InboxUnfinishedDao(db).listUnfinished(agentId);
        const inbox = new InboxMessageDao(db);
        const report: ReconcileReport = { unresolved: [], exhausted: [], scanned: rows.length };
        for (const row of rows) {
            if (row.status === 'queued' && row.inject_attempts >= MAX_INJECT_ATTEMPTS) {
                await inbox.markFailed(row.id, `attempts exhausted after ${MAX_INJECT_ATTEMPTS} deliveries`);
                report.exhausted.push(row.id);
            }
        }
        report.unresolved = await this.classify(agentId);
        return report;
    }
}

/** Parse a run row's path-only artifact refs; corrupt/absent JSON → []. */
function parseArtifactRefs(artifactRefsJson: string): CoordinationArtifactRef[] {
    try {
        const parsed: unknown = JSON.parse(artifactRefsJson);
        return Array.isArray(parsed) ? (parsed as CoordinationArtifactRef[]) : [];
    } catch {
        return [];
    }
}
