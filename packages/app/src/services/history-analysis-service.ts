import {
    type ArtifactSelector,
    cacheWasteAggregate,
    type DbAdapter,
    historyBoardHistoryVersion,
    historyBoardRollupsFresh,
    loops,
    messageRollup,
    replaceHistoryBoardRollups,
    type StepRow,
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
 * Refresh the measured History Board read models once per imported corpus version.
 * Existing forensic analyzers remain the only owners of aggregation semantics.
 */
export async function refreshHistoryRollups(db: DbAdapter): Promise<HistoryRollupRefreshResult> {
    if (await historyBoardRollupsFresh(db)) {
        return { status: 'unchanged', historyVersion: await historyBoardHistoryVersion(db), cacheWasteSteps: 0 };
    }

    const historyVersion = await historyBoardHistoryVersion(db);
    const [messageRows, toolRows, loopRows, sourceRows, tokenSteps, durationSteps, waste, cacheWasteSteps] =
        await Promise.all([
            messageRollup(db, ALL_HISTORY),
            toolRollup(db, ALL_HISTORY),
            loops(db, ALL_HISTORY),
            sourceSummary(db, ALL_HISTORY),
            topStepsByTokens(db, ALL_HISTORY, RANK_DEPTH),
            topStepsByDuration(db, ALL_HISTORY, RANK_DEPTH),
            cacheWasteAggregate(db, ALL_HISTORY),
            topCacheWasteSteps(db, ALL_HISTORY, RANK_DEPTH),
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
    });
    return { status: 'refreshed', historyVersion, cacheWasteSteps: waste?.steps ?? 0 };
}
