import { type DbAdapter, SystemEventDao } from '@gobing-ai/spur-domain';
import { followSystemEventsAfter } from '../services/system-event-follow';
import {
    type ProjectWorkflowProgressOptions,
    projectWorkflowProgress,
    type WorkflowProgressProjection,
} from './progress-projection';

/**
 * Options configuring live follow stream over workflow execution progress.
 */
export interface FollowWorkflowProgressOptions extends Omit<ProjectWorkflowProgressOptions, 'db'> {
    /** Database adapter instance or async factory resolving an adapter. */
    db: DbAdapter | (() => Promise<DbAdapter>);
    /** Polling interval in milliseconds for underlying system event follower. */
    pollIntervalMs?: number;
    /** Maximum duration in milliseconds to follow before aborting stream. */
    timeoutMs?: number;
    /** Abort signal to cancel progress follow stream. */
    signal?: AbortSignal;
}

/**
 * Returns the highest monotonic sequence currently recorded in the `system_events` table.
 *
 * @param db - Database adapter.
 * @returns Max recorded sequence number or 0 if unmigrated/empty.
 */
export async function getLatestSystemEventSequence(db: DbAdapter): Promise<number> {
    return await new SystemEventDao(db).latestSequence();
}

/**
 * Streams live workflow progress projections starting from snapshot state and following system event wakeups.
 * Re-reads persisted workflow state on each event without trusting event payloads for domain state mutations.
 *
 * @param runId - Workflow run identifier.
 * @param options - Follow options including DB adapter and abort signal.
 * @returns AsyncGenerator yielding workflow progress projections.
 */
export async function* followWorkflowProgress(
    runId: string,
    options: FollowWorkflowProgressOptions,
): AsyncGenerator<WorkflowProgressProjection> {
    const getDb = typeof options.db === 'function' ? options.db : async () => options.db as DbAdapter;
    const db = await getDb();

    // 1. Snapshot latest system-event sequence
    const snapshot = await getLatestSystemEventSequence(db);

    // 2. Initial projection from persistence
    const initial = await projectWorkflowProgress(runId, {
        ...options,
        db,
    });
    yield initial;

    if (initial.status === 'completed' || initial.status === 'failed' || initial.status === 'cancelled') {
        return;
    }

    const abortController = new AbortController();
    if (options.signal) {
        if (options.signal.aborted) {
            abortController.abort();
        } else {
            options.signal.addEventListener('abort', () => abortController.abort(), { once: true });
        }
    }
    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
        setTimeout(() => abortController.abort(), options.timeoutMs);
    }

    // 3. Follow system events strictly after the snapshot
    const eventStream = followSystemEventsAfter(getDb, {
        afterSequence: snapshot,
        match: (row) =>
            row.run_id === runId || (typeof row.payload_json === 'string' && row.payload_json.includes(runId)),
        signal: abortController.signal,
    });

    for await (const _event of eventStream) {
        if (abortController.signal.aborted) break;

        // Wakeup re-reads persisted workflow rows (never trusts event payload for mutation)
        const currentDb = await getDb();
        const projection = await projectWorkflowProgress(runId, {
            ...options,
            db: currentDb,
        });

        yield projection;

        if (projection.status === 'completed' || projection.status === 'failed' || projection.status === 'cancelled') {
            break;
        }
    }
}
