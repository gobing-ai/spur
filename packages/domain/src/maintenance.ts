import type { DbAdapter } from './db';
import { databaseBytes, hasSufficientDiskSpace } from './retention';

/** Options for {@link maintainDatabase}. */
export interface DatabaseMaintenanceOptions {
    /** Whether to run VACUUM defragmentation and page compaction. Defaults to false. */
    vacuum?: boolean;
    /** Optional path to database file on disk, for free disk space verification before VACUUM. */
    dbPath?: string;
    /** Optional test seam for clock/date. */
    now?: Date;
}

/** Result of a {@link maintainDatabase} execution. */
export interface DatabaseMaintenanceResult {
    /** Whether PRAGMA optimize completed successfully. */
    optimized: boolean;
    /** Whether PRAGMA wal_checkpoint(TRUNCATE) completed successfully. */
    checkpointed: boolean;
    /** Whether VACUUM ran. */
    vacuumed: boolean;
    /** Reason if VACUUM was requested but skipped. */
    vacuumSkippedReason?: string;
    /** Database size in bytes before maintenance. */
    bytesBefore: number;
    /** Database size in bytes after maintenance. */
    bytesAfter: number;
    /** Bytes reclaimed by maintenance (positive difference, or 0). */
    bytesReclaimed: number;
    /** Total execution duration in milliseconds. */
    durationMs: number;
}

/**
 * Perform database maintenance operations:
 * 1. Optional VACUUM defragmentation (when `options.vacuum === true`).
 * 2. PRAGMA optimize (updates query planner statistics in sqlite_stat1).
 * 3. PRAGMA wal_checkpoint(TRUNCATE) (checkpoints all WAL changes and truncates WAL to 0 bytes).
 *
 * In SQLite WAL mode, VACUUM writes the entire rebuilt database into the WAL file, so
 * running `PRAGMA wal_checkpoint(TRUNCATE)` as the final step is essential to avoid leaving
 * multi-gigabyte WAL index files on disk.
 */
export async function maintainDatabase(
    db: DbAdapter,
    options: DatabaseMaintenanceOptions = {},
): Promise<DatabaseMaintenanceResult> {
    const start = performance.now();
    const bytesBefore = await databaseBytes(db);
    let optimized = false;
    let checkpointed = false;
    let vacuumed = false;
    let vacuumSkippedReason: string | undefined;

    // 1. Run VACUUM if requested
    if (options.vacuum) {
        let canVacuum = true;
        if (options.dbPath && !hasSufficientDiskSpace(options.dbPath, bytesBefore * 2)) {
            canVacuum = false;
            vacuumSkippedReason = 'insufficient-disk';
        }

        if (canVacuum) {
            try {
                await db.exec('VACUUM');
                vacuumed = true;
                const now = options.now ?? new Date();
                try {
                    await db.run(
                        "INSERT INTO spur_retention_meta (kind, ran_at) VALUES ('compaction', ?)",
                        now.getTime(),
                    );
                } catch {
                    // retention metadata record is non-fatal
                }
            } catch {
                vacuumed = false;
                vacuumSkippedReason = 'error';
            }
        }
    }

    // 2. Run PRAGMA optimize
    try {
        await db.exec('PRAGMA optimize;');
        optimized = true;
    } catch {
        optimized = false;
    }

    // 3. Always run PRAGMA wal_checkpoint(TRUNCATE)
    try {
        await db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        checkpointed = true;
    } catch {
        checkpointed = false;
    }

    const bytesAfter = await databaseBytes(db);
    const bytesReclaimed = Math.max(0, bytesBefore - bytesAfter);
    const durationMs = Math.round(performance.now() - start);

    return {
        optimized,
        checkpointed,
        vacuumed,
        ...(vacuumSkippedReason ? { vacuumSkippedReason } : {}),
        bytesBefore,
        bytesAfter,
        bytesReclaimed,
        durationMs,
    };
}
