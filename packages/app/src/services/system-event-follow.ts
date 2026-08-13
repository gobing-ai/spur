/**
 * Shared snapshot-then-follow helper over the `system_events` ledger
 * (G4 R8 / ADR-057 wave 3, task 0531).
 *
 * Wait and reconnect consumers (`agent wait`, `message send --wait`, future
 * Board SSE) follow ONE shared event source: the persisted `system_events`
 * table. The helper snapshots once (`afterSequence`) and streams rows with
 * `sequence > snapshot` in ascending order, advancing a cursor as it goes — no
 * separate in-memory event ring, no per-consumer event buffers.
 *
 * SQLite has no push channel for readers, so the ledger is polled at
 * {@link FOLLOW_POLL_INTERVAL_MS}. Each poll is a single cheap keyset query
 * (`sequence > cursor`); the wait loop races its own identity/stall/timeout
 * heartbeat against this stream, so a sparse stream cannot starve those checks.
 */
import { type DbAdapter, SystemEventDao, type SystemEventRow } from '@gobing-ai/spur-domain';

/** Options for {@link followSystemEventsAfter}. */
export interface FollowSystemEventsOptions {
    /** Follow rows strictly after this sequence (the wait-start snapshot). */
    afterSequence: number;
    /** Yield only rows matching this predicate (e.g. pinned runId + event family). */
    match: (row: SystemEventRow) => boolean;
    /** When aborted, the stream terminates cleanly (no further rows). */
    signal?: AbortSignal;
}

/** Ledger poll cadence for the follower (ms). */
export const FOLLOW_POLL_INTERVAL_MS = 100;

/** Max rows pulled per poll — a query batch, not an in-memory event ring. */
const FOLLOW_BATCH_SIZE = 512;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Yields rows with `sequence > afterSequence` (ascending) as they arrive.
 *
 * Re-snapshotting is the caller's job: pass a fresh `afterSequence` from a new
 * snapshot to resume after a gap. Rows written during a gap between polls are
 * still delivered by the next query (nothing between polls is lost), and rows
 * at/below the snapshot are never re-delivered (replay-after-snapshot).
 */
export async function* followSystemEventsAfter(
    getDb: () => DbAdapter | Promise<DbAdapter>,
    opts: FollowSystemEventsOptions,
): AsyncGenerator<SystemEventRow> {
    const dao = new SystemEventDao(await getDb());
    let cursor = opts.afterSequence;
    for (;;) {
        if (opts.signal?.aborted === true) return;
        // Raw SQL stays in the domain DAO (`raw-sql-only-in-domain`); the app
        // helper owns only the cursor/poll loop and the match filter.
        const rows = await dao.follow(cursor, FOLLOW_BATCH_SIZE);
        for (const row of rows) {
            const sequence = row.sequence;
            if (sequence === null || sequence <= cursor) continue;
            cursor = sequence;
            if (opts.match(row)) yield row;
        }
        await sleep(FOLLOW_POLL_INTERVAL_MS);
    }
}
