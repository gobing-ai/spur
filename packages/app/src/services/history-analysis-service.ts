import {
    type ArtifactSelector,
    cacheWasteAggregate,
    checkImporterSchemaVersion,
    type DbAdapter,
    historyBoardHistoryVersion,
    historyBoardRollupsFresh,
    loops,
    messageRollup,
    replaceHistoryBoardRollups,
    type StepRow,
    skillCallRollup,
    sourceSummary,
    toolRollup,
    topCacheWasteSteps,
    topStepsByDuration,
    topStepsByTokens,
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

const RANK_DEPTH = 1000;

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

    const historyVersion = await historyBoardHistoryVersion(db);
    const [messageRows, toolRows, loopRows, sourceRows, tokenSteps, durationSteps, waste, cacheWasteSteps, skillRows] =
        await Promise.all([
            messageRollup(db, ALL_HISTORY),
            toolRollup(db, ALL_HISTORY),
            loops(db, ALL_HISTORY),
            sourceSummary(db, ALL_HISTORY),
            topStepsByTokens(db, ALL_HISTORY, RANK_DEPTH),
            topStepsByDuration(db, ALL_HISTORY, RANK_DEPTH),
            cacheWasteAggregate(db, ALL_HISTORY),
            topCacheWasteSteps(db, ALL_HISTORY, RANK_DEPTH),
            skillCallRollup(db),
        ]);

    await replaceHistoryBoardRollups(db, {
        historyVersion,
        messageRows,
        toolRows,
        loopRows,
        sourceRows,
        tokenSteps: tokenSteps as readonly StepRow[],
        durationSteps: durationSteps as readonly StepRow[],
        cacheWasteSteps,
        skill5m: skillRows,
    });
    return { status: 'refreshed', historyVersion, cacheWasteSteps: waste?.steps ?? 0 };
}
