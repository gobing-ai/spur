import {
    type ArtifactSelector,
    cacheWasteAggregate,
    checkImporterSchemaVersion,
    type DbAdapter,
    historyBoardHistoryVersion,
    historyBoardRollupsFresh,
    refreshHistoryBoardRollupsIncremental,
} from '@gobing-ai/spur-domain';

const ALL_HISTORY: ArtifactSelector = {
    since: null,
    until: null,
    sources: null,
    models: null,
    tools: null,
    skills: null,
    sessionId: null,
    runId: null,
    taskWbs: null,
};

/** Outcome of an incremental History Board rollup refresh. */
export interface HistoryRollupRefreshResult {
    status: 'unchanged' | 'refreshed';
    historyVersion: string;
    cacheWasteSteps: number;
}

/**
 * Thrown by refreshHistoryRollups when the SQLite database schema version does not match
 * the installed importer package schema version.
 */
export class HistorySchemaVersionMismatchError extends Error {
    constructor(
        public readonly recorded: string | null,
        public readonly installed: string,
        public readonly remediation: string,
    ) {
        super(
            `History schema version mismatch: recorded version is "${recorded ?? 'none'}", installed version is "${installed}". Remediation: ${remediation}`,
        );
        this.name = 'HistorySchemaVersionMismatchError';
    }
}

/**
 * Refresh the measured History Board read models once per imported corpus version.
 * Existing forensic analyzers remain the only owners of aggregation semantics.
 */
export async function refreshHistoryRollups(db: DbAdapter): Promise<HistoryRollupRefreshResult> {
    const drift = await checkImporterSchemaVersion(db);
    if (drift) {
        throw new HistorySchemaVersionMismatchError(drift.recorded, drift.installed, drift.remediation);
    }

    if (await historyBoardRollupsFresh(db)) {
        return { status: 'unchanged', historyVersion: await historyBoardHistoryVersion(db), cacheWasteSteps: 0 };
    }

    await refreshHistoryBoardRollupsIncremental(db);

    const historyVersion = await historyBoardHistoryVersion(db);
    await db.run(
        `INSERT INTO history_board_rollup_meta (id, history_version, refreshed_at)
         VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET history_version = excluded.history_version, refreshed_at = excluded.refreshed_at`,
        historyVersion,
        new Date().toISOString(),
    );

    const waste = await cacheWasteAggregate(db, ALL_HISTORY);
    return { status: 'refreshed', historyVersion, cacheWasteSteps: waste?.steps ?? 0 };
}
