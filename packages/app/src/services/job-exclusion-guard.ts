/**
 * In-process exclusive-writer guard (task 0806 R6).
 *
 * Same-name scheduler jobs are already guarded by the `activeJobs` set in
 * `scheduler-custom-job-service.ts`; this guard coordinates ACROSS job kinds that
 * touch the same producer — specifically `history.refresh` (completion-triggered
 * `history daily`) and a configured `scheduler.custom` job whose command runs
 * `history daily`/`history import` (the 05:00 `history-daily-report` chain).
 * Without it, the completion trigger can start a second importer while the
 * scheduled chain's importer still holds the SQLite write lock — the demonstrated
 * `SQLiteError: database is locked` contention shape.
 *
 * Scope is honest and documented: this is a same-process advisory guard. The daemon
 * is the only process that runs these handlers, so it covers the server's own
 * overlap; a manual CLI `history daily` in another process is bounded by the
 * per-source busy-abort policy (task 0803 R3) and the queue watchdog instead.
 */

/** Active exclusive keys → owning job label (for the failure message). */
const activeExclusions = new Map<string, string>();

/**
 * Acquire `key` for `owner` or throw. A thrown attempt fails its own queue run
 * cleanly — the natural retry is the next completion/tick, never a second
 * concurrent writer.
 */
export function acquireExclusiveJob(key: string, owner: string): void {
    const current = activeExclusions.get(key);
    if (current !== undefined) {
        throw new Error(`history producer "${key}" is already running (${current}); skipping overlapping start`);
    }
    activeExclusions.set(key, owner);
}

/** Release `key` when the owner finishes (idempotent — release only your own key). */
export function releaseExclusiveJob(key: string, owner: string): void {
    if (activeExclusions.get(key) === owner) activeExclusions.delete(key);
}

/** Test seam: true when `key` is currently held. */
export function isExclusiveJobActive(key: string): boolean {
    return activeExclusions.has(key);
}

/**
 * The one shared history-producer exclusion key (task 0806 R6): held by the
 * completion-triggered `history.refresh` job and stamped on configured
 * `scheduler.custom` payloads whose command runs `history daily`/`history import`.
 */
export const HISTORY_PRODUCER_EXCLUSIVE_KEY = 'history-daily';

/**
 * Enqueue-side stamp predicate (task 0806 R6): returns the exclusive key when a
 * configured scheduler job's command runs a history producer (`history daily` or
 * `history import`), so its payload carries `exclusiveKey` and the handler joins
 * the same in-process exclusion the completion-triggered refresh holds.
 */
export function historyProducerExclusiveKeyFor(command: string): string | undefined {
    return /\bhistory\s+(daily|import)\b/.test(command) ? HISTORY_PRODUCER_EXCLUSIVE_KEY : undefined;
}
