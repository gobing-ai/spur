import { readdirSync, rmSync, statfsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DbAdapter } from './db';

/**
 * Local data-plane retention (task 0622 R8): reclaim rows and files past their
 * retention windows so `.spur/` stays bounded without an operator remembering
 * to run anything. Invoked from {@link HistoryService.daily} beside the report
 * prune — the same run-once choke point the queue consumer's refresh job uses.
 *
 * All purges are best-effort: a retention failure must never abort the daily
 * pipeline. Safety invariants:
 * - `queue_jobs` purges terminal rows only (`completed` / `failed`) — the
 *   partial unique index `queue_jobs_history_refresh_pending_unique` makes a
 *   pending row delete-then-reinsert cycle observable, and `pending` rows are
 *   live work anyway.
 * - `history_import_ledger` age-purge is safe: target inserts are
 *   `INSERT … ON CONFLICT(record_hash) DO NOTHING`, full-mode reconciliation
 *   diffs desired-vs-ledger before touching anything, and incremental scans
 *   are checkpoint-governed — a purged ledger row simply re-imports.
 */

/** Retention windows in days. Constants, not config: nothing varies per project. */
const RULE_EVAL_RUN_RETENTION_DAYS = 90;
const QUEUE_JOB_RETENTION_DAYS = 30;
const LEDGER_RETENTION_DAYS = 180;
const BACKUP_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What one retention pass reclaimed. Counts are rows (files for backups). */
export interface RetentionResult {
    ruleEvalRuns: number;
    queueJobs: number;
    ledgerRows: number;
    backupFiles: number;
    /** Result of the optional database compaction pass. */
    compaction: CompactionResult;
}

/** Result of a database compaction attempt (task 0746). */
export interface CompactionResult {
    ran: boolean;
    /** Present only when `ran` is false — why compaction was skipped. */
    skippedReason?: string;
    bytesBefore: number;
    bytesAfter: number;
}

/** Minimum spacing between compaction runs — a multi-minute exclusive lock isn't a daily step. */
const COMPACTION_MIN_INTERVAL_DAYS = 7;

/**
 * The fraction of current database size below which compaction is skipped. `VACUUM` repacks
 * pages reclaimed by free-list slack or prior deletes; running it for a negligible gain costs
 * a long exclusive lock, so skip when the estimated reclaim is not worth the interruption.
 */
export const COMPACTION_MIN_RECLAIM_RATIO = 0.03;

/**
 * Estimate the bytes reclaimable by compaction, by summing the slack in `dbstat` pages.
 *
 * `VACUUM` rewrites the file with pages packed; the reclaim is the space in partially filled
 * pages. `dbstat` is a compile-time-optional SQLite module, so a missing virtual table degrades
 * to zero reclaim (and therefore a skip) rather than throwing — a hard dependency would turn a
 * missing feature into a daily-pipeline crash.
 */
export async function estimateReclaimableBytes(db: DbAdapter): Promise<number> {
    try {
        // dbstat is a virtual table; if unavailable, the prepare fails and we degrade to 0.
        const rows = await db.queryAll<{
            pageno: number;
            pagetype: string;
            ncell: number;
            payload: number;
            unused: number;
        }>('SELECT pageno, pagetype, ncell, payload, unused FROM dbstat ORDER BY pageno');
        // Slack = unused bytes on index pages plus page-level padding for table pages. The simple
        // accessible measure is `unused` (free bytes in each page). Sum it as an upper estimate.
        let slack = 0;
        for (const row of rows) slack += row.unused || 0;
        return Math.max(0, Math.min(slack, await databaseBytes(db)));
    } catch {
        return 0;
    }
}

/** Current database size in bytes (`page_count * page_size`), same as the board-read helper. */
async function databaseBytes(db: DbAdapter): Promise<number> {
    const [pageCount, pageSize] = await Promise.all([
        db.queryFirst<{ page_count: number }>('PRAGMA page_count'),
        db.queryFirst<{ page_size: number }>('PRAGMA page_size'),
    ]);
    return (pageCount?.page_count ?? 0) * (pageSize?.page_size ?? 0);
}

/**
 * Compact the database file with `VACUUM`, gated so it only runs when it will reclaim enough
 * to be worth its cost. `VACUUM` takes an exclusive lock for minutes and needs free disk space
 * roughly equal to the database size, so it must never run unconditionally.
 *
 * Gating precedence (each skip records why):
 * 1. A compaction ran within `COMPACTION_MIN_INTERVAL_DAYS`.
 * 2. Estimated reclaimable is below `COMPACTION_MIN_RECLAIM_RATIO` of the current size.
 * 3. Free disk on the database's filesystem is below the database size plus a margin.
 * 4. Otherwise run `VACUUM` and measure after.
 *
 * Best-effort: a failure records `ran: false` and never aborts the daily run.
 */
export async function compactDatabase(db: DbAdapter, opts: { dbPath: string; now?: Date }): Promise<CompactionResult> {
    const bytesBefore = await databaseBytes(db);

    try {
        const lastRun = await db.queryFirst<{ ran_at: number }>(
            "SELECT COALESCE(MAX(ran_at), 0) AS ran_at FROM spur_retention_meta WHERE kind = 'compaction'",
        );
        const now = opts.now ?? new Date();
        const lastRunAt = lastRun?.ran_at ?? 0;
        if (
            lastRunAt !== undefined &&
            lastRunAt > 0 &&
            now.getTime() - lastRunAt < COMPACTION_MIN_INTERVAL_DAYS * DAY_MS
        ) {
            return { ran: false, skippedReason: 'recent-run', bytesBefore, bytesAfter: bytesBefore };
        }

        const reclaimable = await estimateReclaimableBytes(db);
        if (bytesBefore === 0) {
            return { ran: false, skippedReason: 'empty-db', bytesBefore, bytesAfter: bytesBefore };
        }
        if (reclaimable / bytesBefore < COMPACTION_MIN_RECLAIM_RATIO) {
            return { ran: false, skippedReason: 'reclaim-below-threshold', bytesBefore, bytesAfter: bytesBefore };
        }

        // Free-disk precondition: VACUUM writes a full copy of the file; running out mid-way
        // is the one way this operation can hurt. statfs gives the filesystem's free blocks.
        try {
            const fs = statfsSync(opts.dbPath);
            const freeBytes = fs.bavail * fs.bsize;
            if (freeBytes < bytesBefore * 2) {
                return { ran: false, skippedReason: 'insufficient-disk', bytesBefore, bytesAfter: bytesBefore };
            }
        } catch {
            // statfs unavailable (e.g. in-memory test DB) — do not block compaction for it.
        }

        await db.exec('VACUUM');
        const bytesAfter = await databaseBytes(db);
        await db.run("INSERT INTO spur_retention_meta (kind, ran_at) VALUES ('compaction', ?)", now.getTime());
        return { ran: true, bytesBefore, bytesAfter };
    } catch {
        return { ran: false, skippedReason: 'error', bytesBefore, bytesAfter: bytesBefore };
    }
}

/**
 * Run all retention purges. Never throws — each store is isolated in its own
 * try/catch and a failure records `0` for that store (best-effort, matching
 * {@link HistoryService}'s `pruneReports` contract).
 *
 * @param db migrated Spur database.
 * @param cwd project root containing `.spur/backups`.
 * @param now test seam for cutoff computation.
 */
export async function runRetention(db: DbAdapter, cwd: string, now: Date = new Date()): Promise<RetentionResult> {
    const result: RetentionResult = {
        ruleEvalRuns: 0,
        queueJobs: 0,
        ledgerRows: 0,
        backupFiles: 0,
        compaction: { ran: false, skippedReason: 'not-run', bytesBefore: 0, bytesAfter: 0 },
    };

    result.ruleEvalRuns = await purgeRuleEvalRuns(db, now);
    result.queueJobs = await purgeQueueJobs(db, now);
    result.ledgerRows = await purgeLedger(db, now);
    result.backupFiles = pruneBackups(cwd, now);
    // Compaction runs after the purges so the free pages they create are reclaimed in the same
    // pass, and so it inherits the purges' best-effort isolation. The DB path is derived from the
    // cwd's .spur/spur.db (the migrated DB). On failure it records ran:false and never aborts.
    result.compaction = await compactDatabase(db, { dbPath: join(cwd, '.spur', 'spur.db'), now });

    return result;
}

/** Purge finished rule evaluations older than the window. `created_at` is ISO TEXT. */
async function purgeRuleEvalRuns(db: DbAdapter, now: Date): Promise<number> {
    return purgeRows(
        db,
        `DELETE FROM rule_eval_runs WHERE created_at < ?`,
        new Date(now.getTime() - RULE_EVAL_RUN_RETENTION_DAYS * DAY_MS).toISOString(),
    );
}

/** Purge terminal queue jobs older than the window. `updated_at` is epoch ms. */
async function purgeQueueJobs(db: DbAdapter, now: Date): Promise<number> {
    return purgeRows(
        db,
        `DELETE FROM queue_jobs WHERE status IN ('completed', 'failed') AND updated_at < ?`,
        now.getTime() - QUEUE_JOB_RETENTION_DAYS * DAY_MS,
    );
}

/** Purge import-ledger rows older than the window (safe: re-import is idempotent). */
async function purgeLedger(db: DbAdapter, now: Date): Promise<number> {
    return purgeRows(
        db,
        `DELETE FROM history_import_ledger WHERE imported_at < ?`,
        new Date(now.getTime() - LEDGER_RETENTION_DAYS * DAY_MS).toISOString(),
    );
}

/** Reclaim `.spur/backups/*` files whose mtime is older than the window (mtime-based, like `cleanRunLogs`). */
function pruneBackups(cwd: string, now: Date): number {
    const dir = join(cwd, '.spur', 'backups');
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return 0; // dir absent — nothing to reclaim
    }

    const cutoffMs = now.getTime() - BACKUP_RETENTION_DAYS * DAY_MS;
    let reclaimed = 0;
    for (const name of entries) {
        const path = join(dir, name);
        try {
            const stat = statSync(path);
            if (!stat.isFile() || stat.mtimeMs >= cutoffMs) continue;
            rmSync(path, { force: true });
            reclaimed += 1;
        } catch {
            // best-effort: a stuck file must not abort retention
        }
    }
    return reclaimed;
}

/** One bounded DELETE with its changed-row count; a SQL failure is swallowed into `0`. */
async function purgeRows(db: DbAdapter, sql: string, cutoff: string | number): Promise<number> {
    try {
        await db.run(sql, cutoff);
        const row = await db.queryFirst<{ n: number }>('SELECT changes() AS n');
        return row?.n ?? 0;
    } catch {
        return 0; // best-effort: retention must never break the daily run
    }
}
