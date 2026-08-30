/**
 * CLI call site for the completion-triggered history refresh (task 0549).
 *
 * `spur task update <wbs> done` and a terminal `spur workflow run`/`continue` call
 * {@link maybeTriggerHistoryRefresh} AFTER their primary work succeeds. The helper is
 * best-effort by contract: the operation has already completed, so a trigger failure
 * warns on the error stream and never changes the command's exit code (R1 — the
 * operation returns unaffected).
 */
import { enqueueHistoryRefresh, type HistoryRefreshTriggerPoint, type SystemEventBus } from '@gobing-ai/spur-app';
import { EventBus } from '@gobing-ai/ts-infra';
import type { CliContext } from './context';
import { attachSystemEventLedger } from './system-event-ledger';

/** Structural subset of {@link CliContext} the trigger needs (keeps tests cheap). */
export type HistoryRefreshContext = Pick<CliContext, 'cwd' | 'env' | 'getDb' | 'output' | 'spurConfig'>;

/**
 * Fire the completion trigger: resolve the opt-in config, enqueue one coalesced
 * `history.refresh` job (or join the pending one), and emit `history.refresh.enqueued`
 * so the firing is observable (R3). Disabled config → no DB access, no job, no event.
 */
export async function maybeTriggerHistoryRefresh(
    context: HistoryRefreshContext,
    trigger: HistoryRefreshTriggerPoint,
    triggerId: string,
): Promise<void> {
    try {
        // Config is threaded from the composition root (A5/ADR-082); a load failure
        // there is already surfaced once. Unset/absent means no opt-in — treat as
        // disabled (same tolerance as resolveWorkflowPaths).
        const config = context.spurConfig ?? null;
        const db = await context.getDb();
        const result = await enqueueHistoryRefresh(db, { config, trigger, triggerId });
        if (result.status === 'disabled') return;

        // Observable firing (R3): a ledger row per enqueue/join, flushed before return.
        const bus = new EventBus() as unknown as SystemEventBus;
        const ledger = await attachSystemEventLedger(bus, context);
        try {
            await bus.emit('history.refresh.enqueued', {
                source: 'history',
                renderer: 'history-refresh',
                trigger,
                triggerId,
                jobId: result.jobId,
                coalesced: result.status === 'coalesced',
                outcome: result.status,
                windowStart: result.payload.windowStart,
                windowEnd: result.payload.windowEnd,
                severity: 'info',
            });
        } finally {
            await ledger.flush();
            ledger.unsubscribe();
        }
    } catch (error) {
        context.output.error(
            `warning: history refresh trigger failed (${trigger} ${triggerId}): ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }
}
