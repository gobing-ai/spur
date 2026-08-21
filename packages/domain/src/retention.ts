import { readdirSync, rmSync, statSync } from 'node:fs';
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
    const result: RetentionResult = { ruleEvalRuns: 0, queueJobs: 0, ledgerRows: 0, backupFiles: 0 };

    result.ruleEvalRuns = await purgeRuleEvalRuns(db, now);
    result.queueJobs = await purgeQueueJobs(db, now);
    result.ledgerRows = await purgeLedger(db, now);
    result.backupFiles = pruneBackups(cwd, now);

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
