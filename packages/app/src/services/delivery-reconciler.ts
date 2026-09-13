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

/**
 * Restart reconciliation over the two tables 0831 (delivery settle) and 0833
 * (completion receipts) leave behind (0834 R1). A pure classifier: every
 * ambiguous case here is one a machine must not resolve — a missing receipt may
 * mean the agent edited files — so the output is a report. The ONLY state it
 * writes is the terminal `attempts-exhausted` marking 0831's budget already
 * authorizes; nothing is requeued, released, or re-dispatched, and terminal
 * output / process lists are never consulted (artifacts come only from
 * persisted run rows that list the message in their receipt).
 *
 * Idempotent (R5): steps 1–3 are pure reads; step 4's `queued → failed` move
 * removes the row from step 4's own selection, so a second pass over the
 * marked rows claims them at step 1 (`delivery-failed`) and writes nothing.
 * A late receipt reclassifies `outcome-unknown → run-exit-only` on the next
 * pass — intended behavior, not a violation.
 *
 * Call sites: `runAgentLoop` startup (0834 R2) and `spur message inbox
 * --unresolved` / `--json` (0834 R6); G62's orchestrator runtime (0838) is the
 * designed third caller.
 */
export class DeliveryReconciler {
    constructor(private readonly ctx: DeliveryReconcilerContext) {}

    /**
     * Classify every non-delivered message (optionally one recipient's) against
     * completion receipts. Five-step precedence, first match wins (0834 Design):
     *
     * 1. `failed` → `delivery-failed` (reason from `injectError`).
     * 2. `injected` + a run row lists it → that run's `outcome`: `run-exit-only`
     *    → `run-exit-only`; `errored` → `delivery-failed`. A `verified` run is a
     *    finished request — omitted, not held.
     * 3. `injected` + no run row → `outcome-unknown` (the dangerous case: the
     *    drain consumed it and no sink ever reported). Artifacts stay empty —
     *    without a receipt-listing run row there are no persisted refs to
     *    attribute, and none may be inferred.
     * 4. `queued` at/over {@link MAX_INJECT_ATTEMPTS} → `attempts-exhausted`;
     *    marks the row `failed` — the only write.
     * 5. `queued` under budget → not unresolved; omitted.
     */
    /**
     * The PURE pass over steps 1, 2, 3 and 5 (0844 R5): every ambiguous case is
     * classified, nothing is written — a read-only caller (the Board's
     * `GET /api/project/requests`) must never trigger the terminal
     * `attempts-exhausted` marking. Queued rows are entirely steps 4/5's
     * business, so they are omitted here even at/over budget; {@link reconcile}
     * is {@link classify}'s output plus that marking, with its report unchanged.
     */
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
                unresolved.push({ ...base, reason: 'delivery-failed', artifacts: [] });
                continue;
            }

            // 2/3. Consumed by a drain: the receipt decides.
            if (row.status === 'injected') {
                const runRow = (await runs.listByMessageId(row.id))[0];
                if (runRow === undefined) {
                    unresolved.push({ ...base, reason: 'outcome-unknown', artifacts: [] });
                    continue;
                }
                if (runRow.outcome === 'run-exit-only' || runRow.outcome === 'errored') {
                    unresolved.push({
                        ...base,
                        reason: runRow.outcome === 'errored' ? 'delivery-failed' : 'run-exit-only',
                        runId: runRow.run_id,
                        ...(runRow.task_id !== null ? { taskId: runRow.task_id } : {}),
                        artifacts: parseArtifactRefs(runRow.artifact_refs_json),
                    });
                }
            }

            // 4/5. Still queued: step 4 (the budget marking) is reconcile()'s
            // only write; a pure classification omits every queued row.
        }
        return unresolved;
    }

    async reconcile(agentId?: string): Promise<ReconcileReport> {
        const db = await this.ctx.getDb();
        const rows: InboxUnfinishedRow[] = await new InboxUnfinishedDao(db).listUnfinished(agentId);
        const runs = new CoordinationRunDao(db);
        const inbox = new InboxMessageDao(db);
        const report: ReconcileReport = { unresolved: [], exhausted: [], scanned: rows.length };

        for (const row of rows) {
            const base = {
                messageId: row.id,
                toId: row.to_id,
                injectAttempts: row.inject_attempts,
                ...(row.inject_error !== null && row.inject_error !== '' ? { injectError: row.inject_error } : {}),
            };

            // 1. Terminal delivery failure — queryable hold, never repaired.
            if (row.status === 'failed') {
                report.unresolved.push({ ...base, reason: 'delivery-failed', artifacts: [] });
                continue;
            }

            // 2/3. Consumed by a drain: the receipt decides.
            if (row.status === 'injected') {
                const runRow = (await runs.listByMessageId(row.id))[0];
                if (runRow === undefined) {
                    report.unresolved.push({ ...base, reason: 'outcome-unknown', artifacts: [] });
                    continue;
                }
                if (runRow.outcome === 'run-exit-only' || runRow.outcome === 'errored') {
                    report.unresolved.push({
                        ...base,
                        reason: runRow.outcome === 'errored' ? 'delivery-failed' : 'run-exit-only',
                        runId: runRow.run_id,
                        ...(runRow.task_id !== null ? { taskId: runRow.task_id } : {}),
                        artifacts: parseArtifactRefs(runRow.artifact_refs_json),
                    });
                    continue;
                }
                // 'verified' (workflow verification completed the task) or any
                // other receipt outcome is a finished request — not held.
                continue;
            }

            // 4/5. Still queued: hold only when the attempt budget is gone.
            if (row.status === 'queued' && row.inject_attempts >= MAX_INJECT_ATTEMPTS) {
                await inbox.markFailed(row.id, `attempts exhausted after ${MAX_INJECT_ATTEMPTS} deliveries`);
                report.exhausted.push(row.id);
                report.unresolved.push({ ...base, reason: 'attempts-exhausted', artifacts: [] });
            }
            // 5. Under budget — redeliverable, omitted from the report.
        }
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
