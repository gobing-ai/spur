import type {
    HistoryFilter,
    HistoryInsightsResponse,
    HistoryKpiTrendPoint,
    HistoryModelComparisonItem,
    HistoryRange,
    HistorySessionItem,
    HistorySessionsInput,
    HistorySessionsResponse,
    HistorySkillBreakdown,
    HistorySourcesResponse,
    HistorySummaryKpis,
    HistorySummaryResponse,
    HistoryTimelineBlock,
    HistoryTimelineEvent,
    HistoryTimelineEventKind,
    HistoryTimelineInput,
    HistoryTimelineResponse,
    HistoryTimelineScope,
    HistoryTimeSeriesPoint,
    HistoryToolCallItem,
    HistoryToolCategory,
    HistoryToolSequenceInput,
    HistoryToolSequenceResponse,
    HistoryTopItem,
    HistoryTriggerImportResponse,
} from '@gobing-ai/spur-contracts';
import {
    type ArtifactSelector,
    type BucketedTokenRow,
    bucketedTokenSeries,
    bySession,
    bySessionPage,
    bySkill,
    byTool,
    consolidatedTimeline,
    type DbAdapter,
    type HistoryBucket as DomainHistoryBucket,
    dailyTokenMatrix,
    HISTORY_BOARD_ACTIVITY_DAYS,
    type HistoryBoardDailyRollupRow,
    type HistoryBoardKpiTrendRow,
    type HistoryBoardKpiWindowRow,
    type HistoryBoardSourceRollupRow,
    type HistoryBoardSummaryRollup,
    type HistoryDimension,
    hasHistoryBoardRollupRows,
    historyBoardBucketsFromRollup,
    historyBoardDatabaseBytes,
    historyBoardDimensionDailyFromMart,
    historyBoardHeavySessionsFromRollup,
    historyBoardKpiTrendFromRollup,
    historyBoardKpiWindowFromMart,
    historyBoardLoopsFromRollup,
    historyBoardModelComparisonFromRollup,
    historyBoardPreviousWindowKpiFromMart,
    historyBoardRankedStepsFromRollup,
    historyBoardRollupsFresh,
    historyBoardSessionsFromRollup,
    historyBoardSkillBreakdownFromRollup,
    historyBoardSourcesFromRollup,
    historyBoardSummaryFromMart,
    historyBoardSummaryFromRollup,
    historyKpiTrend,
    loopRepeatedCallsQuery,
    loops,
    type MartDimension,
    messageRollup,
    modelComparison,
    resolveSummaryReadPath,
    type SourceDelta,
    selectionPopulation,
    sessionTimeline,
    sourceDelta,
    sourceSummary,
    type TimelineQueryResult,
    type ToolSequenceFilters,
    toolCallErrorTotals,
    toolRollup,
    toolSequenceQuery,
    topCacheWasteSteps,
    topStepsByDuration,
    topStepsByTokens,
} from '@gobing-ai/spur-domain';
import type { HistoryBoardService } from './history-board-mock-service';

/**
 * Dependency options for initializing LiveHistoryBoardService.
 */
export interface LiveHistoryBoardServiceOptions {
    db?: DbAdapter;
    getDb?: () => Promise<DbAdapter | undefined> | DbAdapter | undefined;
    triggerImport?: (mode: 'full' | 'incremental') => Promise<HistoryTriggerImportResponse['data']>;
}

const SERIES_COLORS = ['#3987e5', '#199e70', '#d95926', '#9085e9', '#c98500', '#ec4899', '#14b8a6'];

/**
 * Bounded stale-path fallback caps (task 0743 R7). When rollups cannot be brought current the
 * raw fallback is bounded by a named row limit and a named time-range window — never an
 * unannounced full-corpus scan. Named so the ceiling is auditable and movable on measured cost.
 */
const STALE_FALLBACK_ROW_CAP = 25_000;
const STALE_FALLBACK_MAX_RANGE_DAYS = 30;

const AGENT_CATALOG: Array<{
    id: string;
    name: string;
    color: string;
    path: string;
    pattern: string;
}> = [
    {
        id: 'claude',
        name: 'Claude Code',
        color: '#3987e5',
        path: '~/.claude/projects/',
        pattern: '*.jsonl, state.json',
    },
    { id: 'codex', name: 'Codex', color: '#d95926', path: '~/.codex/sessions/', pattern: 'rollout-*.jsonl' },
    {
        id: 'agy',
        name: 'Antigravity CLI',
        color: '#c98500',
        path: '~/.gemini/antigravity-cli/brain/',
        pattern: 'transcript.jsonl',
    },
    { id: 'omp', name: 'OMP', color: '#10b981', path: '~/.omp/sessions/', pattern: 'session-*.jsonl' },
    { id: 'openclaw', name: 'OpenClaw', color: '#ec4899', path: '~/.openclaw/history/', pattern: 'claw-*.jsonl' },
    { id: 'hermes', name: 'Hermes', color: '#8b5cf6', path: '~/.hermes/sessions/', pattern: 'hermes-*.jsonl' },
    { id: 'grok', name: 'Grok Build', color: '#f59e0b', path: '~/.grok/sessions/', pattern: 'build-*.jsonl' },
    { id: 'opencode', name: 'OpenCode', color: '#6366f1', path: '~/.opencode/history/', pattern: 'opencode-*.jsonl' },
    { id: 'pi', name: 'Pi', color: '#14b8a6', path: '~/.pi/agent/', pattern: 'session-*.jsonl' },
];

function toArtifactSelector(filter?: HistoryFilter): ArtifactSelector {
    if (!filter) {
        return {
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
    }

    let since = filter.from ?? null;
    const until = filter.to ?? null;

    if (!since && filter.range && filter.range !== 'all' && filter.range !== 'custom') {
        const now = Date.now();
        if (filter.range === '1h') {
            since = new Date(now - 1 * 60 * 60 * 1000).toISOString();
        } else if (filter.range === '4h') {
            since = new Date(now - 4 * 60 * 60 * 1000).toISOString();
        } else if (filter.range === '24h') {
            since = new Date(now - 24 * 60 * 60 * 1000).toISOString();
        } else if (filter.range === '7d') {
            since = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
        } else if (filter.range === '30d') {
            since = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
        }
    }

    return {
        since,
        until,
        sources: filter.sources && filter.sources.length > 0 ? filter.sources : null,
        models: filter.models && filter.models.length > 0 ? filter.models : null,
        tools: filter.tools && filter.tools.length > 0 ? filter.tools : null,
        skills: filter.skills && filter.skills.length > 0 ? filter.skills : null,
        sessionId: null,
        runId: null,
        taskWbs: null,
    };
}

function resolveBucket(bucket: string | undefined, range: HistoryRange = '4h'): DomainHistoryBucket {
    if (bucket && bucket !== 'auto') {
        return bucket as DomainHistoryBucket;
    }
    if (range === '1h') return '1m';
    if (range === '4h') return '1m';
    if (range === '24h') return '10m';
    if (range === '7d') return '30m';
    return '1d';
}

function classifyTimelineKind(toolName: string | null, role: string): HistoryTimelineEventKind {
    if (!toolName) {
        if (role === 'user') return 'user';
        if (role === 'assistant') return 'assistant';
        return 'unknown';
    }
    const lower = toolName.toLowerCase();
    if (
        lower.includes('read') ||
        lower.includes('glob') ||
        lower.includes('grep') ||
        lower.includes('view') ||
        lower.includes('list')
    ) {
        return 'read';
    }
    if (lower.includes('write') || lower.includes('edit') || lower.includes('replace') || lower.includes('patch')) {
        return 'write';
    }
    if (lower.includes('bash') || lower.includes('command') || lower.includes('exec') || lower.includes('terminal')) {
        return 'bash';
    }
    if (lower.includes('search') || lower.includes('find')) {
        return 'search';
    }
    return 'run';
}

function extractToolTitle(payload: string | null): string {
    if (payload == null || payload.trim().length === 0) return '';
    try {
        const parsed = JSON.parse(payload);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return '';
        const summaryKeys = ['path', 'file_path', 'target', 'cmd', 'command', 'query', 'pattern', 'url'] as const;
        for (const key of summaryKeys) {
            const val = parsed[key];
            if (val !== undefined && val !== null) {
                if (typeof val === 'string' && val.length > 0) return val;
                if (typeof val === 'number' || typeof val === 'boolean') return String(val);
            }
        }
    } catch {
        // Not JSON
    }
    return '';
}

/** The number of whole days spanned by the selector, or `null` when unbounded (`all`/custom). */
function rangeDaysFromSelector(sel: ArtifactSelector): number | null {
    if (sel.since === null) return null;
    const until = sel.until === null ? Date.now() : new Date(sel.until).getTime();
    const since = new Date(sel.since).getTime();
    return Math.max(0, Math.floor((until - since) / 86_400_000));
}

/** Clamp the stale fallback to a bounded time window so it never becomes an unannounced full-corpus
 * scan. A genuinely unbounded (`all`) request is left intact so the stale read keeps the same data
 * window as the materialized read (task 0629 equality); its scan is bounded instead by the row cap. */
function boundStaleSelector(sel: ArtifactSelector): ArtifactSelector {
    // An unbounded (all) stale read is left intact so it keeps the same data window as the
    // materialized read (task 0629 cold-start equality); the named row cap bounds each raw
    // analyzer instead. A bounded request older than the time-range cap is clamped to it.
    if (sel.since === null) return sel;
    const minSince = new Date(Date.now() - STALE_FALLBACK_MAX_RANGE_DAYS * 86_400_000).toISOString();
    if (sel.since < minSince) return { ...sel, since: minSince };
    return sel;
}

/** Project a mart KPI-window row into the wire HistorySummaryKpis shape. */
function kpiWindowRowToKpis(row: HistoryBoardKpiWindowRow): HistorySummaryKpis {
    const fresh = row.freshInputTokens ?? 0;
    const output = row.outputTokens ?? 0;
    const totalBilled = fresh + output;
    const cacheSaved = row.cacheReadTokens ?? 0;
    const cacheDenominator = totalBilled + cacheSaved;
    const toolCalls = row.toolCalls ?? 0;
    const toolErrors = row.toolErrors ?? 0;
    return {
        totalBilledTokens: totalBilled,
        cacheSavedTokens: cacheSaved,
        cacheSavedPercent: cacheDenominator > 0 ? Math.round((cacheSaved / cacheDenominator) * 100) : 0,
        sessionsCount: row.sessions ?? 0,
        toolCallsCount: toolCalls,
        errorRate: toolCalls > 0 ? Math.round((toolErrors / toolCalls) * 1000) / 10 : 0,
    };
}

/** Compute the Summary extras (trend, previous window, dimension series) from the mart tables. */
async function computeSummaryExtrasFromMart(
    db: DbAdapter,
    sel: ArtifactSelector,
    bucket: DomainHistoryBucket,
    dimension: HistoryDimension,
    activeBuckets: BucketedTokenRow[] | undefined,
): Promise<SummaryExtras> {
    const trendSel = resolveTrendSelector(sel);
    const endDay = trendSel.until.slice(0, 10);
    const { trend } = await historyBoardKpiWindowFromMart(db, trendSel);
    // Previous-window KPIs come from the daily mart re-aggregated over the SHIFTED prior
    // window (mirroring the rollup read path), never from a static all-time `'previous'` row.
    const previousKpisRow = await historyBoardPreviousWindowKpiFromMart(db, sel);
    const series = (d: MartDimension): Promise<BucketedTokenRow[]> => {
        if (d === (dimension as MartDimension) && activeBuckets && activeBuckets.length > 0) {
            return Promise.resolve(activeBuckets);
        }
        return historyBoardDimensionDailyFromMart(db, sel, d);
    };
    const [modelBuckets, sourceBuckets, toolBuckets, skillBuckets, skillBreakdownRaw] = await Promise.all([
        series('model'),
        series('source'),
        series('tool'),
        series('skill'),
        historyBoardSkillBreakdownFromRollup(db, sel, bucket),
    ]);
    return {
        kpiTrend: projectKpiTrend(trend, endDay),
        previousKpis: previousKpisRow ? kpiWindowRowToKpis(previousKpisRow) : null,
        modelTimeSeries: projectSkillTimeSeries(modelBuckets),
        sourceTimeSeries: projectSkillTimeSeries(sourceBuckets),
        toolTimeSeries: projectSkillTimeSeries(toolBuckets),
        skillTimeSeries: projectSkillTimeSeries(skillBuckets),
        skillBreakdown: {
            bySkill: skillBreakdownRaw.bySkill,
            bySource: skillBreakdownRaw.bySource,
            byInvocationKind: skillBreakdownRaw.byInvocationKind,
            trend: projectSkillTimeSeries(skillBreakdownRaw.trend),
            fresh: true,
        },
    };
}

function projectSummary(rows: HistoryBoardSummaryRollup, extras: SummaryExtras): HistorySummaryResponse['data'] {
    const tokenTotal = (row: { freshInputTokens: number; outputTokens: number }) =>
        row.freshInputTokens + row.outputTokens;
    const totalBilledTokens = rows.models.reduce((sum, row) => sum + tokenTotal(row), 0);
    const cacheSavedTokens = rows.models.reduce((sum, row) => sum + row.cacheReadTokens, 0);
    const cacheDenominator = totalBilledTokens + cacheSavedTokens;

    const totalBucketTokens = rows.buckets.reduce(
        (sum, row) => sum + (row.freshInputTokens ?? 0) + (row.outputTokens ?? 0),
        0,
    );
    const useCalls = totalBucketTokens === 0;
    const timeSeries = new Map<
        string,
        { cacheRead: number; billed: number; output: number; series: Record<string, number> }
    >();
    for (const row of rows.buckets) {
        const point = timeSeries.get(row.bucketStart) ?? { cacheRead: 0, billed: 0, output: 0, series: {} };
        const fresh = row.freshInputTokens ?? 0;
        const output = row.outputTokens ?? 0;
        const billed = useCalls ? (row.calls ?? 0) : fresh + output;
        point.billed += billed;
        point.output += output;
        point.cacheRead += row.cacheReadTokens ?? 0;
        point.series[row.key] = (point.series[row.key] ?? 0) + billed;
        timeSeries.set(row.bucketStart, point);
    }

    const toTopItems = (items: HistoryBoardSummaryRollup['models'], sourceColors: boolean): HistoryTopItem[] =>
        items.slice(0, 5).map((row, index) => {
            // Headline value matches the Token Activity chart (fresh + output) so the two
            // views stay consistent; cached reads ride the same request but are exposed as a
            // dedicated segment (cacheReadTokens) instead of inflating the ranking.
            const freshInputTokens = row.freshInputTokens ?? 0;
            const cacheReadTokens = row.cacheReadTokens ?? 0;
            const outputTokens = row.outputTokens ?? 0;
            const tokens = freshInputTokens + outputTokens;
            return {
                id: row.key,
                label: row.key,
                color:
                    (sourceColors ? AGENT_CATALOG.find((agent) => agent.id === row.key)?.color : undefined) ??
                    SERIES_COLORS[index % SERIES_COLORS.length] ??
                    '#3987e5',
                tokens,
                freshInputTokens,
                cacheReadTokens,
                outputTokens,
                share: totalBilledTokens > 0 ? Math.round((tokens / totalBilledTokens) * 100) : 0,
            };
        });

    // Shares describe the displayed top-15 ranking: denominators must come from the same rows,
    // or each share column sums below 100% once more than 15 distinct tools exist.
    const topToolRows = rows.tools.slice(0, 15);
    const totalToolCalls = topToolRows.reduce((sum, row) => sum + row.calls, 0);
    const totalToolDuration = topToolRows.reduce((sum, row) => sum + (row.durationMs ?? 0), 0);
    const totalToolTokens = topToolRows.reduce((sum, row) => sum + (row.billedTokens ?? 0), 0);

    return {
        kpis: {
            totalBilledTokens,
            cacheSavedTokens,
            cacheSavedPercent: cacheDenominator > 0 ? Math.round((cacheSavedTokens / cacheDenominator) * 100) : 0,
            sessionsCount: rows.sessions,
            toolCallsCount: rows.toolCalls,
            errorRate: rows.toolCalls > 0 ? Math.round((rows.toolErrors / rows.toolCalls) * 1000) / 10 : 0,
        },
        timeSeries: Array.from(timeSeries.entries()).map(([bucketStart, point]) => {
            const totalTokens = point.billed + point.cacheRead;
            return {
                bucketStart,
                cacheHitRatio: totalTokens > 0 ? Math.round((point.cacheRead / totalTokens) * 100) : 0,
                gainRatio: totalTokens > 0 ? Math.round((point.output / totalTokens) * 1000) / 10 : 0,
                series: point.series,
            };
        }),
        topModels: toTopItems(rows.models, false),
        topSources: toTopItems(rows.sources, true),
        topTools: topToolRows.map((row) => ({
            id: row.toolName && row.toolName.trim() !== '' ? row.toolName.trim() : 'unknown',
            count: row.calls,
            errors: row.errors,
            errorRate: row.calls > 0 ? Math.round((row.errors / row.calls) * 1000) / 10 : 0,
            durationMs: row.durationMs ?? 0,
            tokens: row.billedTokens ?? 0,
            usageShare: totalToolCalls > 0 ? Math.round((row.calls / totalToolCalls) * 1000) / 10 : 0,
            timeShare: totalToolDuration > 0 ? Math.round(((row.durationMs ?? 0) / totalToolDuration) * 1000) / 10 : 0,
            tokenShare: totalToolTokens > 0 ? Math.round(((row.billedTokens ?? 0) / totalToolTokens) * 1000) / 10 : 0,
        })),
        skillsUsed: rows.skills
            .filter((row) => row.skillName && row.skillName.trim() !== '' && row.skillName !== 'unknown')
            .map((row, index) => ({
                id: row.skillName,
                label: row.skillName,
                color: SERIES_COLORS[index % SERIES_COLORS.length] ?? '#3987e5',
                count: row.calls,
            })),
        cacheEfficiency: {
            hitRatio: cacheDenominator > 0 ? Math.round((cacheSavedTokens / cacheDenominator) * 100) : 0,
            savedTokens: cacheSavedTokens,
            totalRead: cacheSavedTokens + rows.models.reduce((sum, row) => sum + row.freshInputTokens, 0),
            bySource: rows.sources.map((row) => {
                const catalog = AGENT_CATALOG.find((agent) => agent.id === row.key);
                const savedTokens = row.cacheReadTokens ?? 0;
                const freshTokens = row.freshInputTokens ?? 0;
                const outputTokens = row.outputTokens ?? 0;
                const totalRead = savedTokens + freshTokens;
                const billedTokens = freshTokens + outputTokens;
                const hitRatio = totalRead > 0 ? Math.round((savedTokens / totalRead) * 100) : 0;
                return {
                    source: row.key,
                    sourceName: catalog?.name ?? row.key,
                    color: catalog?.color ?? '#3987e5',
                    hitRatio,
                    savedTokens,
                    freshTokens,
                    totalRead,
                    billedTokens,
                };
            }),
            byModel: rows.models.map((row, index) => {
                const savedTokens = row.cacheReadTokens ?? 0;
                const freshTokens = row.freshInputTokens ?? 0;
                const outputTokens = row.outputTokens ?? 0;
                const totalRead = savedTokens + freshTokens;
                const billedTokens = freshTokens + outputTokens;
                const hitRatio = totalRead > 0 ? Math.round((savedTokens / totalRead) * 100) : 0;
                return {
                    model: row.key,
                    modelName: row.key,
                    color: SERIES_COLORS[index % SERIES_COLORS.length] ?? '#3987e5',
                    hitRatio,
                    savedTokens,
                    freshTokens,
                    totalRead,
                    billedTokens,
                };
            }),
            byAgentModel: rows.sourceModels.map((row) => {
                const catalog = AGENT_CATALOG.find((agent) => agent.id === row.source);
                const savedTokens = row.cacheReadTokens ?? 0;
                const freshTokens = row.freshInputTokens ?? 0;
                const outputTokens = row.outputTokens ?? 0;
                const totalRead = savedTokens + freshTokens;
                const billedTokens = freshTokens + outputTokens;
                const hitRatio = totalRead > 0 ? Math.round((savedTokens / totalRead) * 100) : 0;
                return {
                    source: row.source,
                    sourceName: catalog?.name ?? row.source,
                    model: row.model,
                    modelName: row.model,
                    color: catalog?.color ?? '#3987e5',
                    hitRatio,
                    savedTokens,
                    totalRead,
                    billedTokens,
                };
            }),
        },
        kpiTrend: extras.kpiTrend,
        previousKpis: extras.previousKpis,
        skillTimeSeries: extras.skillTimeSeries,
        modelTimeSeries: extras.modelTimeSeries,
        sourceTimeSeries: extras.sourceTimeSeries,
        toolTimeSeries: extras.toolTimeSeries,
        skillBreakdown: extras.skillBreakdown,
    };
}

/** Extra summary fields (KPI trend, previous window, skill series) computed alongside the rollup. */
interface SummaryExtras {
    kpiTrend: HistoryKpiTrendPoint[];
    previousKpis: HistorySummaryKpis | null;
    skillTimeSeries: HistoryTimeSeriesPoint[];
    modelTimeSeries?: HistoryTimeSeriesPoint[];
    sourceTimeSeries?: HistoryTimeSeriesPoint[];
    toolTimeSeries?: HistoryTimeSeriesPoint[];
    skillBreakdown: HistorySkillBreakdown;
}

/** Trend-selector resolution: end = bounded custom upper bound else current UTC day; start = end - 29d. */
function resolveTrendSelector(sel: ArtifactSelector): ArtifactSelector & { until: string } {
    let until = sel.until;
    if (until === null) {
        const now = new Date();
        now.setUTCHours(0, 0, 0, 0);
        until = now.toISOString();
    }
    const end = new Date(until);
    end.setUTCHours(23, 59, 59, 999);
    const start = new Date(end.getTime() - 29 * 86_400_000);
    start.setUTCHours(0, 0, 0, 0);
    return { ...sel, since: start.toISOString(), until: end.toISOString() };
}

/** Zero-fill 30 UTC day buckets ending at the trend window end; domain returns only days with rows. */
function projectKpiTrend(rows: HistoryBoardKpiTrendRow[], endDay: string): HistoryKpiTrendPoint[] {
    const byDay = new Map(rows.map((row) => [row.day, row]));
    const points: HistoryKpiTrendPoint[] = [];
    const end = new Date(`${endDay}T00:00:00Z`);
    for (let i = 29; i >= 0; i--) {
        const date = new Date(end.getTime() - i * 86_400_000);
        const day = date.toISOString().slice(0, 10);
        const row = byDay.get(day);
        const fresh = row?.freshInputTokens ?? 0;
        const output = row?.outputTokens ?? 0;
        points.push({
            day,
            totalBilledTokens: fresh + output,
            cacheSavedTokens: row?.cacheReadTokens ?? 0,
            sessionsCount: row?.sessions ?? 0,
            toolCallsCount: row?.toolCalls ?? 0,
            cacheHitRatio:
                fresh + output + (row?.cacheReadTokens ?? 0) > 0
                    ? Math.round(((row?.cacheReadTokens ?? 0) / (fresh + output + (row?.cacheReadTokens ?? 0))) * 100)
                    : 0,
        });
    }
    return points;
}

/** Shift both time bounds back by the inclusive window duration to get the previous comparable window. */
function previousWindowSelector(sel: ArtifactSelector): ArtifactSelector | null {
    if (sel.since === null) return null;
    const until = sel.until === null ? Date.now() : new Date(sel.until).getTime();
    const since = new Date(sel.since).getTime();
    const duration = until - since + 1;
    return {
        ...sel,
        since: new Date(since - duration).toISOString(),
        until: new Date(until - duration).toISOString(),
    };
}

/** Project skill-dimension buckets into the wire skillTimeSeries shape. */
function projectSkillTimeSeries(buckets: BucketedTokenRow[]): HistoryTimeSeriesPoint[] {
    const totalTokens = buckets.reduce((sum, row) => sum + (row.freshInputTokens ?? 0) + (row.outputTokens ?? 0), 0);
    const useCalls = totalTokens === 0;
    const byBucket = new Map<
        string,
        { cacheRead: number; billed: number; output: number; series: Record<string, number> }
    >();
    for (const row of buckets) {
        const point = byBucket.get(row.bucketStart) ?? { cacheRead: 0, billed: 0, output: 0, series: {} };
        const fresh = row.freshInputTokens ?? 0;
        const output = row.outputTokens ?? 0;
        const val = useCalls ? (row.calls ?? 0) : fresh + output;
        point.billed += val;
        point.output += output;
        point.cacheRead += row.cacheReadTokens ?? 0;
        point.series[row.key] = (point.series[row.key] ?? 0) + val;
        byBucket.set(row.bucketStart, point);
    }
    return Array.from(byBucket.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([bucketStart, point]) => {
            const totalTokens = point.billed + point.cacheRead;
            return {
                bucketStart,
                cacheHitRatio: totalTokens > 0 ? Math.round((point.cacheRead / totalTokens) * 100) : 0,
                gainRatio: totalTokens > 0 ? Math.round((point.output / totalTokens) * 1000) / 10 : 0,
                series: point.series,
            };
        });
}

/** KPIs of a rollup-shaped summary — used for the previous window baseline. */
function projectPreviousKpis(rows: HistoryBoardSummaryRollup): HistorySummaryKpis {
    const totalBilledTokens = rows.models.reduce((sum, row) => sum + row.freshInputTokens + row.outputTokens, 0);
    const cacheSavedTokens = rows.models.reduce((sum, row) => sum + row.cacheReadTokens, 0);
    const cacheDenominator = totalBilledTokens + cacheSavedTokens;
    return {
        totalBilledTokens,
        cacheSavedTokens,
        cacheSavedPercent: cacheDenominator > 0 ? Math.round((cacheSavedTokens / cacheDenominator) * 100) : 0,
        sessionsCount: rows.sessions,
        toolCallsCount: rows.toolCalls,
        errorRate: rows.toolCalls > 0 ? Math.round((rows.toolErrors / rows.toolCalls) * 1000) / 10 : 0,
    };
}

/** Previous-window KPIs via exact (non-rollup) reads. */
async function previousExactKpis(db: DbAdapter, sel: ArtifactSelector): Promise<HistorySummaryKpis> {
    const [rollups, pop, toolStatsRow] = await Promise.all([
        messageRollup(db, sel),
        selectionPopulation(db, sel),
        toolCallErrorTotals(db, sel),
    ]);
    const totalBilledTokens = rollups.reduce((sum, row) => sum + (row.inputTokens ?? 0) + (row.outputTokens ?? 0), 0);
    const cacheSavedTokens = rollups.reduce((sum, row) => sum + (row.cacheReadTokens ?? 0), 0);
    const cacheDenominator = totalBilledTokens + cacheSavedTokens;
    const toolCalls = toolStatsRow.calls;
    const toolErrors = toolStatsRow.errors;
    return {
        totalBilledTokens,
        cacheSavedTokens,
        cacheSavedPercent: cacheDenominator > 0 ? Math.round((cacheSavedTokens / cacheDenominator) * 100) : 0,
        sessionsCount: pop.sessions,
        toolCallsCount: toolCalls,
        errorRate: toolCalls > 0 ? Math.round((toolErrors / toolCalls) * 1000) / 10 : 0,
    };
}

/** Compute trend/previous-window/skill-series extras alongside the primary summary reads. */
async function computeSummaryExtras(
    db: DbAdapter,
    sel: ArtifactSelector,
    bucket: DomainHistoryBucket,
    dimension: HistoryDimension,
    exact: boolean,
    activeBuckets: BucketedTokenRow[] | undefined,
): Promise<SummaryExtras> {
    const trendSel = resolveTrendSelector(sel);
    const endDay = trendSel.until.slice(0, 10);
    const previousSel = previousWindowSelector(sel);
    const [trendRows, previousKpis, modelBuckets, sourceBuckets, toolBuckets, skillBuckets, skillBreakdownRaw] =
        await Promise.all([
            exact ? historyKpiTrend(db, trendSel) : historyBoardKpiTrendFromRollup(db, trendSel),
            (async () => {
                if (previousSel === null) return null;
                if (exact) return await previousExactKpis(db, previousSel);
                // Bounded previous-window KPIs: fixed daily bucket + model projection keeps the
                // read on history_daily_stats regardless of the active (possibly sub-day) bucket.
                return projectPreviousKpis(await historyBoardSummaryFromRollup(db, previousSel, '1d', 'model'));
            })(),
            (async () => {
                if (dimension === 'model' && activeBuckets && activeBuckets.length > 0) return activeBuckets;
                if (exact) return await bucketedTokenSeries(db, sel, bucket, 'model');
                return await historyBoardBucketsFromRollup(db, sel, bucket, 'model');
            })(),
            (async () => {
                if (dimension === 'source' && activeBuckets && activeBuckets.length > 0) return activeBuckets;
                if (exact) return await bucketedTokenSeries(db, sel, bucket, 'source');
                return await historyBoardBucketsFromRollup(db, sel, bucket, 'source');
            })(),
            (async () => {
                if (dimension === 'tool' && activeBuckets && activeBuckets.length > 0) return activeBuckets;
                if (exact) return await bucketedTokenSeries(db, sel, bucket, 'tool');
                return await historyBoardBucketsFromRollup(db, sel, bucket, 'tool');
            })(),
            (async () => {
                if (dimension === 'skill' && activeBuckets && activeBuckets.length > 0) return activeBuckets;
                if (exact) return await bucketedTokenSeries(db, sel, bucket, 'skill');
                return await historyBoardBucketsFromRollup(db, sel, bucket, 'skill');
            })(),
            (() => historyBoardSkillBreakdownFromRollup(db, sel, bucket))(),
        ]);
    return {
        kpiTrend: projectKpiTrend(trendRows, endDay),
        previousKpis,
        modelTimeSeries: projectSkillTimeSeries(modelBuckets),
        sourceTimeSeries: projectSkillTimeSeries(sourceBuckets),
        toolTimeSeries: projectSkillTimeSeries(toolBuckets),
        skillTimeSeries: projectSkillTimeSeries(skillBuckets),
        skillBreakdown: {
            bySkill: skillBreakdownRaw.bySkill,
            bySource: skillBreakdownRaw.bySource,
            byInvocationKind: skillBreakdownRaw.byInvocationKind,
            trend: projectSkillTimeSeries(skillBreakdownRaw.trend),
            // AC5: the not-fresh (`exact`) path reads a rollup that may not yet be rebuilt
            // (between import and analyze); surface that explicitly instead of a silent-empty
            // "no skill activity" for skill rows that exist but are not yet rolled up.
            fresh: !exact,
        },
    };
}

function earlier(a: string | null, b: string | null): string | null {
    if (a === null) return b;
    if (b === null) return a;
    return a < b ? a : b;
}

function later(a: string | null, b: string | null): string | null {
    if (a === null) return b;
    if (b === null) return a;
    return a > b ? a : b;
}

/** Fold the trailing-corpus delta into the materialized per-source rollup rows. */
function foldSourceDelta(
    sources: readonly HistoryBoardSourceRollupRow[],
    delta: SourceDelta,
): HistoryBoardSourceRollupRow[] {
    const deltaBySource = new Map(delta.bySource.map((d) => [d.source, d]));
    const merged = sources.map((s) => {
        const d = deltaBySource.get(s.source);
        if (!d) return s;
        return {
            ...s,
            messages: s.messages + d.messages,
            sessions: s.sessions + d.sessions,
            freshInputTokens: s.freshInputTokens + d.freshInputTokens,
            cacheReadTokens: s.cacheReadTokens + d.cacheReadTokens,
            outputTokens: s.outputTokens + d.outputTokens,
            toolCalls: s.toolCalls + d.toolCalls,
            firstDate: earlier(s.firstDate, d.firstDate),
            lastDate: later(s.lastDate, d.lastDate),
            // `files` intentionally stays at the materialized value: a delta file may already
            // be counted by the rollup, so folding distinct-file counts would double-count.
            // New files surface on the next rollup refresh.
        };
    });
    const existing = new Set(sources.map((s) => s.source));
    const added = delta.bySource
        .filter((d) => !existing.has(d.source))
        .map((d) => ({
            source: d.source,
            files: d.files,
            messages: d.messages,
            lastImportedAt: d.lastDate,
            sessions: d.sessions,
            freshInputTokens: d.freshInputTokens,
            cacheReadTokens: d.cacheReadTokens,
            outputTokens: d.outputTokens,
            toolCalls: d.toolCalls,
            firstDate: d.firstDate,
            lastDate: d.lastDate,
        }));
    return [...merged, ...added];
}

/** Fold the trailing-corpus delta into the materialized per-(source, day) rows. */
function foldDailyDelta(
    daily: readonly HistoryBoardDailyRollupRow[],
    delta: SourceDelta,
): HistoryBoardDailyRollupRow[] {
    const byKey = new Map(daily.map((r) => [`${r.source}\u0000${r.day}`, { ...r }]));
    for (const d of delta.byDay) {
        const key = `${d.source}\u0000${d.day}`;
        const existing = byKey.get(key);
        if (existing) {
            existing.freshInputTokens += d.freshInputTokens;
            existing.cacheReadTokens += d.cacheReadTokens;
            existing.outputTokens += d.outputTokens;
            existing.sessions += d.sessions;
            existing.toolCalls += d.toolCalls;
        } else {
            byKey.set(key, {
                source: d.source,
                day: d.day,
                freshInputTokens: d.freshInputTokens,
                cacheReadTokens: d.cacheReadTokens,
                outputTokens: d.outputTokens,
                sessions: d.sessions,
                toolCalls: d.toolCalls,
            });
        }
    }
    return Array.from(byKey.values());
}

function projectSources(
    sources: readonly HistoryBoardSourceRollupRow[],
    daily: readonly HistoryBoardDailyRollupRow[],
    databaseBytes: number,
): HistorySourcesResponse['data'] {
    const sourceMap = new Map(sources.map((row) => [row.source, row]));
    const dailyMap = new Map(daily.map((row) => [`${row.source}\0${row.day}`, row]));
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const agents = AGENT_CATALOG.map((catalog) => {
        const source = sourceMap.get(catalog.id);
        const heatmapDays = Array.from({ length: HISTORY_BOARD_ACTIVITY_DAYS }, (_, index) => {
            const date = new Date(today.getTime() - (HISTORY_BOARD_ACTIVITY_DAYS - 1 - index) * 86_400_000)
                .toISOString()
                .slice(0, 10);
            const row = dailyMap.get(`${catalog.id}\0${date}`);
            return {
                date,
                tokens: (row?.freshInputTokens ?? 0) + (row?.outputTokens ?? 0),
                sessions: row?.sessions ?? 0,
            };
        });
        return {
            id: catalog.id,
            name: catalog.name,
            color: catalog.color,
            importPath: catalog.path,
            filePattern: catalog.pattern,
            filesCount: source?.files ?? 0,
            sizeMb: null,
            sessionCount: source?.sessions ?? 0,
            totalTokens: (source?.freshInputTokens ?? 0) + (source?.outputTokens ?? 0),
            cacheSavedTokens: source?.cacheReadTokens ?? 0,
            freshTokens: source?.freshInputTokens ?? 0,
            toolCalls: source?.toolCalls ?? 0,
            firstDate: source?.firstDate ?? null,
            lastDate: source?.lastDate ?? null,
            heatmapDays,
            maxDailyTokens: Math.max(0, ...heatmapDays.map((day) => day.tokens)),
        };
    });
    const from = sources.reduce<string | null>(
        (earliest, source) =>
            source.firstDate !== null && (earliest === null || source.firstDate < earliest)
                ? source.firstDate
                : earliest,
        null,
    );
    const to = sources.reduce<string | null>(
        (latest, source) =>
            source.lastDate !== null && (latest === null || source.lastDate > latest) ? source.lastDate : latest,
        null,
    );
    const lastImportedAt = sources.reduce<string | null>(
        (latest, source) =>
            source.lastImportedAt !== null && (latest === null || source.lastImportedAt > latest)
                ? source.lastImportedAt
                : latest,
        null,
    );
    return {
        overview: {
            totalFiles: sources.reduce((sum, source) => sum + source.files, 0),
            corpusSizeBytes: databaseBytes,
            dateCoverage: { from, to },
            totalSessions: sources.reduce((sum, source) => sum + source.sessions, 0),
            lastImportedAt,
        },
        agents,
        roots: AGENT_CATALOG.map((catalog) => {
            const files = sourceMap.get(catalog.id)?.files ?? 0;
            return {
                agentId: catalog.id,
                agentName: catalog.name,
                path: catalog.path,
                matchPattern: catalog.pattern,
                fileCount: files,
                status: files > 0 ? ('active' as const) : ('empty' as const),
            };
        }),
    };
}

/**
 * Map a tool name to a standardized forensic tool category using substring precedence matching.
 */
export function toolCategory(toolName: string): HistoryToolCategory {
    const lower = toolName.toLowerCase();
    if (/mcp|task|agent|subagent|skill/.test(lower)) return 'mcp';
    if (/grep|glob|search|find|webfetch|websearch/.test(lower)) return 'search';
    if (/write|edit|patch|apply|notebook/.test(lower)) return 'write';
    if (/read|cat|view|open/.test(lower)) return 'read';
    if (/bash|shell|exec|run|command|terminal/.test(lower)) return 'bash';
    return 'other';
}

/**
 * Live database-backed implementation of HistoryBoardService.
 */
export class LiveHistoryBoardService implements HistoryBoardService {
    constructor(private readonly deps: LiveHistoryBoardServiceOptions = {}) {}

    private async resolveDb(): Promise<DbAdapter | undefined> {
        if (this.deps.db) return this.deps.db;
        if (this.deps.getDb) return await this.deps.getDb();
        return undefined;
    }

    async getSummary(filter?: HistoryFilter): Promise<HistorySummaryResponse['data']> {
        const db = await this.resolveDb();
        if (!db) {
            return {
                kpis: {
                    totalBilledTokens: 0,
                    cacheSavedTokens: 0,
                    cacheSavedPercent: 0,
                    sessionsCount: 0,
                    toolCallsCount: 0,
                    errorRate: 0,
                },
                timeSeries: [],
                topModels: [],
                topSources: [],
                topTools: [],
                skillsUsed: [],
                cacheEfficiency: { hitRatio: 0, savedTokens: 0, totalRead: 0 },
                kpiTrend: [],
                previousKpis: null,
                skillTimeSeries: [],
                modelTimeSeries: [],
                sourceTimeSeries: [],
                toolTimeSeries: [],
                skillBreakdown: {
                    bySkill: [],
                    bySource: [],
                    byInvocationKind: [],
                    trend: [],
                    fresh: true,
                },
            };
        }

        const sel = toArtifactSelector(filter);
        const bucket = resolveBucket(filter?.bucket, filter?.range ?? '4h');
        const dimension = filter?.dimension ?? 'model';
        const fresh = await historyBoardRollupsFresh(db);
        // 0743: route through the dimension-mart read path when the request qualifies, driven by
        // the frozen four-condition routing rule. Non-qualifying requests resolve from the
        // five-minute rollups (never the raw tables) while fresh.
        const path = resolveSummaryReadPath({
            fresh,
            bucket,
            rangeDays: rangeDaysFromSelector(sel),
            dimension: dimension as HistoryDimension,
            selector: sel,
        });
        if (path === 'mart') {
            return await this.summaryFromMart(db, sel, bucket, dimension);
        }
        if (fresh) {
            const rows = await historyBoardSummaryFromRollup(db, sel, bucket, dimension);
            const extras = await computeSummaryExtras(db, sel, bucket, dimension, false, rows.buckets);
            return projectSummary(rows, extras);
        }

        // Bounded stale-path fallback (R7): when rollups cannot be brought current the raw fallback
        // is bounded by a named row cap and a named time-range window — never an unannounced
        // full-corpus scan. Freshness is reported through the existing response fields.
        const boundedSel = boundStaleSelector(sel);
        const [bucketRows, rollups, toolStats, skillStats, sessionRows] = await Promise.all([
            bucketedTokenSeries(db, boundedSel, bucket, dimension),
            messageRollup(db, boundedSel),
            byTool(db, boundedSel, STALE_FALLBACK_ROW_CAP),
            bySkill(db, boundedSel, STALE_FALLBACK_ROW_CAP),
            bySession(db, boundedSel, STALE_FALLBACK_ROW_CAP),
        ]);

        const models = new Map<string, { freshInputTokens: number; cacheReadTokens: number; outputTokens: number }>();
        const sources = new Map<string, { freshInputTokens: number; cacheReadTokens: number; outputTokens: number }>();
        const sourceModels = new Map<
            string,
            { source: string; model: string; freshInputTokens: number; cacheReadTokens: number; outputTokens: number }
        >();
        for (const row of rollups) {
            const modelKey = row.model ?? 'unknown';
            for (const [key, target] of [
                [modelKey, models],
                [row.source, sources],
            ] as const) {
                const aggregate = target.get(key) ?? { freshInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
                aggregate.freshInputTokens += row.inputTokens ?? 0;
                aggregate.cacheReadTokens += row.cacheReadTokens ?? 0;
                aggregate.outputTokens += row.outputTokens ?? 0;
                target.set(key, aggregate);
            }
            const pairKey = `${row.source}\u0000${modelKey}`;
            const pair = sourceModels.get(pairKey) ?? {
                source: row.source,
                model: modelKey,
                freshInputTokens: 0,
                cacheReadTokens: 0,
                outputTokens: 0,
            };
            pair.freshInputTokens += row.inputTokens ?? 0;
            pair.cacheReadTokens += row.cacheReadTokens ?? 0;
            pair.outputTokens += row.outputTokens ?? 0;
            sourceModels.set(pairKey, pair);
        }
        const extras = await computeSummaryExtras(db, boundedSel, bucket, dimension, true, bucketRows);
        return projectSummary(
            {
                buckets: bucketRows,
                models: Array.from(models, ([key, value]) => ({ key, ...value })).sort(
                    (a, b) => b.freshInputTokens + b.outputTokens - a.freshInputTokens - a.outputTokens,
                ),
                sources: Array.from(sources, ([key, value]) => ({ key, ...value })).sort(
                    (a, b) => b.freshInputTokens + b.outputTokens - a.freshInputTokens - a.outputTokens,
                ),
                sourceModels: Array.from(sourceModels.values()),
                tools: toolStats.map((row) => ({
                    toolName: row.toolName,
                    calls: row.calls,
                    errors: row.errors,
                    durationMs: row.durationMsTotal ?? 0,
                    billedTokens: row.billedTokens ?? 0,
                })),
                skills: skillStats,
                sessions: sessionRows.length,
                toolCalls: toolStats.reduce((sum, row) => sum + row.calls, 0),
                toolErrors: toolStats.reduce((sum, row) => sum + row.errors, 0),
            },
            extras,
        );
    }

    /** Serve a mart-eligible Summary request from the day-grain dimension marts. */
    private async summaryFromMart(
        db: DbAdapter,
        sel: ArtifactSelector,
        bucket: DomainHistoryBucket,
        dimension: HistoryDimension,
    ): Promise<HistorySummaryResponse['data']> {
        const rows = await historyBoardSummaryFromMart(db, sel, dimension as MartDimension);
        const extras = await computeSummaryExtrasFromMart(db, sel, bucket, dimension, rows.buckets);
        return projectSummary(rows, extras);
    }

    async getTimeline(input: HistoryTimelineInput): Promise<HistoryTimelineResponse['data']> {
        const db = await this.resolveDb();
        if (!db) {
            return {
                mode: input.mode,
                scope: {
                    sessionId: input.mode === 'session' ? input.sessionId : null,
                    source: input.mode === 'session' ? input.source : null,
                    model: null,
                    start: null,
                    end: null,
                    durationMs: 0,
                    tokens: {
                        billedTokens: 0,
                        cacheSavedTokens: 0,
                        cacheReadTokens: 0,
                        freshInputTokens: 0,
                        outputTokens: 0,
                    },
                    messageCount: 0,
                    toolCallCount: 0,
                    sessionCount: 0,
                },
                truncated: false,
                blocks: [],
            };
        }

        let queryResult: TimelineQueryResult;
        if (input.mode === 'session') {
            if (input.sessionId === '' || input.sessionId === 'unknown' || input.sessionId === 'session') {
                throw new Error(`History session not found: ${input.sessionId || '(empty)'}`);
            }
            if (input.source === '' || input.source === 'unknown') {
                throw new Error(`History source not found: ${input.source || '(empty)'}`);
            }
            queryResult = await sessionTimeline(db, input.source, input.sessionId, 5000);
            if (queryResult.events.length === 0) {
                throw new Error(`History session not found: ${input.sessionId}`);
            }
        } else {
            const sel = toArtifactSelector(input.filter);
            if (input.runId) sel.runId = input.runId;
            if (input.taskWbs) sel.taskWbs = input.taskWbs;
            queryResult = await consolidatedTimeline(db, sel, 5000);
        }

        const events = queryResult.events;
        if (events.length === 0) {
            return {
                mode: input.mode,
                scope: {
                    sessionId: input.mode === 'session' ? input.sessionId : null,
                    source: input.mode === 'session' ? input.source : null,
                    model: null,
                    start: null,
                    end: null,
                    durationMs: 0,
                    tokens: {
                        billedTokens: 0,
                        cacheSavedTokens: 0,
                        cacheReadTokens: 0,
                        freshInputTokens: 0,
                        outputTokens: 0,
                    },
                    messageCount: 0,
                    toolCallCount: 0,
                    sessionCount: 0,
                },
                truncated: false,
                blocks: [],
            };
        }

        const projectedEvents: Array<
            HistoryTimelineEvent & {
                source: string;
                sessionId: string;
                turnIndex: number;
                ts: string | null;
                correlationExactness?: 'exact' | 'estimated' | null;
            }
        > = [];

        let totalFresh = 0;
        let totalCache = 0;
        let totalOut = 0;
        let totalDuration = 0;
        let toolCallCount = 0;
        let messageCount = 0;
        const uniqueSources = new Set<string>();
        const uniqueModels = new Set<string>();
        const uniqueSessions = new Set<string>();
        let firstTs: string | null = null;
        let lastTs: string | null = null;

        for (const ev of events) {
            if (ev.ts) {
                if (firstTs === null || ev.ts < firstTs) firstTs = ev.ts;
                if (lastTs === null || ev.ts > lastTs) lastTs = ev.ts;
            }
            if (ev.source) uniqueSources.add(ev.source);
            if (ev.model) uniqueModels.add(ev.model);
            if (ev.sessionId) uniqueSessions.add(`${ev.source}:::${ev.sessionId}`);

            const fresh = ev.inputTokens ?? 0;
            const cache = ev.cacheReadTokens ?? 0;
            const out = ev.outputTokens ?? 0;
            const billed = fresh + out;
            const dur = ev.durationMs ?? 0;

            totalFresh += fresh;
            totalCache += cache;
            totalOut += out;
            totalDuration += dur;
            if (ev.eventType === 'tool') toolCallCount += 1;
            else messageCount += 1;

            const title =
                ev.eventType === 'tool'
                    ? extractToolTitle(ev.payload)
                    : ev.role === 'user'
                      ? 'user turn'
                      : `${ev.role} turn`;

            projectedEvents.push({
                seq: ev.seq,
                eventType: ev.eventType,
                kind: classifyTimelineKind(ev.toolName, ev.role),
                title,
                toolName: ev.toolName,
                durationMs: ev.durationMs,
                durationSource: ev.durationSource,
                tokens: billed,
                freshInputTokens: fresh,
                cacheReadTokens: cache,
                outputTokens: out,
                promptTokens: null,
                exitCode: ev.exitCode,
                payload: ev.payload,
                agent: ev.source,
                model: ev.model ?? 'unknown',
                source: ev.source,
                sessionId: ev.sessionId,
                turnIndex: ev.turnIndex,
                ts: ev.ts,
                correlationExactness: ev.correlationExactness,
            });
        }

        // Build promptTokens in a separate per-(source, sessionId) scan
        const eventsBySession = new Map<string, typeof projectedEvents>();
        for (const ev of projectedEvents) {
            const sKey = `${ev.source}:::${ev.sessionId}`;
            let list = eventsBySession.get(sKey);
            if (list === undefined) {
                list = [];
                eventsBySession.set(sKey, list);
            }
            list.push(ev);
        }

        for (const sessionEvents of eventsBySession.values()) {
            let activeUserEvent: (typeof projectedEvents)[number] | null = null;
            let accFresh = 0;
            let accCache = 0;
            let accOut = 0;

            for (const ev of sessionEvents) {
                if (ev.kind === 'user' || (ev.eventType === 'message' && ev.title === 'user turn')) {
                    if (activeUserEvent !== null) {
                        activeUserEvent.promptTokens = {
                            billedTokens: accFresh + accOut,
                            cacheSavedTokens: accCache,
                            cacheReadTokens: accCache,
                            freshInputTokens: accFresh,
                            outputTokens: accOut,
                        };
                    }
                    activeUserEvent = ev;
                    accFresh = 0;
                    accCache = 0;
                    accOut = 0;
                } else {
                    accFresh += ev.freshInputTokens;
                    accCache += ev.cacheReadTokens;
                    accOut += ev.outputTokens;
                }
            }
            if (activeUserEvent !== null) {
                activeUserEvent.promptTokens = {
                    billedTokens: accFresh + accOut,
                    cacheSavedTokens: accCache,
                    cacheReadTokens: accCache,
                    freshInputTokens: accFresh,
                    outputTokens: accOut,
                };
            }
        }

        // Group into blocks keyed by `${source}:::${sessionId}:::${turnIndex}`
        const blocksByKey = new Map<string, HistoryTimelineBlock>();
        for (const ev of projectedEvents) {
            const blockKey = `${ev.source}:::${ev.sessionId}:::${ev.turnIndex}`;
            let block = blocksByKey.get(blockKey);
            if (block === undefined) {
                block = {
                    key: blockKey,
                    sessionId: ev.sessionId,
                    turnIndex: ev.turnIndex,
                    timestamp: ev.ts,
                    source: ev.source,
                    model: ev.model,
                    correlationExactness: ev.correlationExactness ?? null,
                    totalDurationMs: 0,
                    totalTokens: 0,
                    operationCount: 0,
                    events: [],
                };
                blocksByKey.set(blockKey, block);
            }
            block.totalDurationMs += ev.durationMs ?? 0;
            block.totalTokens += ev.tokens;
            block.operationCount += 1;
            if (block.timestamp === null && ev.ts !== null) {
                block.timestamp = ev.ts;
            }
            const { source: _s, sessionId: _sid, turnIndex: _t, ts: _ts, correlationExactness: _ce, ...cleanEv } = ev;
            block.events.push(cleanEv);
        }

        // Sort blocks by timestamp ascending (nulls last) and stable key
        const sortedBlocks = Array.from(blocksByKey.values()).sort((a, b) => {
            const aTs = a.timestamp ? Date.parse(a.timestamp) : Infinity;
            const bTs = b.timestamp ? Date.parse(b.timestamp) : Infinity;
            if (aTs !== bTs) return (Number.isNaN(aTs) ? Infinity : aTs) - (Number.isNaN(bTs) ? Infinity : bTs);
            return a.key.localeCompare(b.key);
        });

        const totalBilled = totalFresh + totalOut;
        const startMs = firstTs ? Date.parse(firstTs) : 0;
        const endMs = lastTs ? Date.parse(lastTs) : startMs;
        const spanMs = Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;

        const firstSource = Array.from(uniqueSources)[0] ?? null;
        const firstModel = Array.from(uniqueModels)[0] ?? null;

        const scope: HistoryTimelineScope = {
            sessionId: input.mode === 'session' ? input.sessionId : null,
            source: input.mode === 'session' ? input.source : uniqueSources.size === 1 ? firstSource : null,
            model:
                input.mode === 'session'
                    ? uniqueModels.size > 0
                        ? firstModel
                        : null
                    : uniqueModels.size === 1
                      ? firstModel
                      : null,
            start: firstTs,
            end: lastTs,
            durationMs: input.mode === 'session' && spanMs > 0 ? spanMs : totalDuration,
            tokens: {
                billedTokens: totalBilled,
                cacheSavedTokens: totalCache,
                cacheReadTokens: totalCache,
                freshInputTokens: totalFresh,
                outputTokens: totalOut,
            },
            messageCount,
            toolCallCount,
            sessionCount: input.mode === 'session' ? 1 : uniqueSessions.size,
        };

        return {
            mode: input.mode,
            scope,
            truncated: queryResult.truncated,
            blocks: sortedBlocks,
        };
    }

    /**
     * Map a tool name to a standardized forensic tool category using substring precedence matching.
     */
    static toolCategory(toolName: string): HistoryToolCategory {
        const lower = toolName.toLowerCase();
        if (/mcp|task|agent|subagent|skill/.test(lower)) return 'mcp';
        if (/grep|glob|search|find|webfetch|websearch/.test(lower)) return 'search';
        if (/write|edit|patch|apply|notebook/.test(lower)) return 'write';
        if (/read|cat|view|open/.test(lower)) return 'read';
        if (/bash|shell|exec|run|command|terminal/.test(lower)) return 'bash';
        return 'other';
    }

    async getToolSequence(input: HistoryToolSequenceInput): Promise<HistoryToolSequenceResponse['data']> {
        const db = await this.resolveDb();
        if (!db) {
            return {
                mode: input.mode,
                scope: {
                    sessionId: input.mode === 'session' ? input.sessionId : null,
                    source: input.mode === 'session' ? input.source : null,
                    model: null,
                    start: null,
                    end: null,
                    totalCalls: 0,
                    uniqueTools: 0,
                    errorCount: 0,
                    errorRate: 0,
                    totalDurationMs: 0,
                    meanDurationMs: 0,
                    durationUnmeasured: 0,
                    sessionCount: 0,
                    tokens: {
                        billedTokens: 0,
                        cacheSavedTokens: 0,
                        cacheReadTokens: 0,
                        freshInputTokens: 0,
                        outputTokens: 0,
                    },
                },
                truncated: false,
                items: [],
            };
        }

        let scope:
            | { mode: 'session'; source: string; sessionId: string }
            | { mode: 'consolidated'; sel: ArtifactSelector };
        if (input.mode === 'session') {
            if (input.sessionId === '' || input.sessionId === 'unknown' || input.sessionId === 'session') {
                throw new Error(`History session not found: ${input.sessionId || '(empty)'}`);
            }
            if (input.source === '' || input.source === 'unknown') {
                throw new Error(`History source not found: ${input.source || '(empty)'}`);
            }
            scope = { mode: 'session', source: input.source, sessionId: input.sessionId };
        } else {
            const sel = toArtifactSelector(input.filter);
            scope = { mode: 'consolidated', sel };
        }

        const filters: ToolSequenceFilters = {
            toolNames: input.toolNames,
            status: input.status,
            search: input.search,
        };

        const queryResult = await toolSequenceQuery(db, scope, filters, 5000);
        const rows = queryResult.rows;

        let totalDurationMs = 0;
        let measuredCount = 0;
        let unmeasuredCount = 0;
        let errorCount = 0;
        const uniqueToolsSet = new Set<string>();
        const sessionsSet = new Set<string>();
        let freshTokensTotal = 0;
        let cacheReadTokensTotal = 0;
        let outputTokensTotal = 0;
        let firstTs: string | null = null;
        let lastTs: string | null = null;
        let commonModel: string | null = null;
        let modelMixed = false;

        const items: HistoryToolCallItem[] = rows.map((row, index) => {
            const category = toolCategory(row.toolName);
            uniqueToolsSet.add(row.toolName);
            sessionsSet.add(row.sessionId);

            if (index === 0) {
                firstTs = row.ts;
                commonModel = row.model;
            } else {
                if (row.model !== commonModel) {
                    modelMixed = true;
                }
            }
            if (row.ts) {
                lastTs = row.ts;
            }

            const isError = row.status === 'error';
            if (isError) {
                errorCount++;
            }

            let durationSource: HistoryToolCallItem['durationSource'] = 'unmeasured';
            if (row.durationMs != null && row.durationMs > 0) {
                durationSource = 'measured';
                totalDurationMs += row.durationMs;
                measuredCount++;
            } else {
                unmeasuredCount++;
            }

            // Token split across links. Shares stay unrounded so they sum back to the
            // message totals exactly (0724 R2/R6); this matches the timeline convention in
            // `packages/domain/src/analytics/forensic-query.ts:1199`.
            const linkCount = Math.max(row.links, 1);
            const fresh = (row.inputTokens ?? 0) / linkCount;
            const cacheRead = (row.cacheReadTokens ?? 0) / linkCount;
            const output = (row.outputTokens ?? 0) / linkCount;
            const billed = fresh + output;
            const cacheSaved = cacheRead;

            freshTokensTotal += fresh;
            cacheReadTokensTotal += cacheRead;
            outputTokensTotal += output;

            return {
                seq: index + 1,
                toolSeq: row.toolSeq,
                ts: row.ts,
                toolName: row.toolName,
                category,
                status: row.status === 'ok' || row.status === 'error' ? row.status : 'unknown',
                durationMs: durationSource === 'measured' ? row.durationMs : null,
                durationSource,
                resultBytes: row.resultBytes,
                argsRaw: row.argsRaw,
                argsDigest: row.argsDigest,
                errorText: row.errorText,
                callId: row.callId,
                messageHash: row.messageHash,
                sessionId: row.sessionId,
                source: row.source,
                model: row.model,
                tokens: {
                    billedTokens: billed,
                    cacheSavedTokens: cacheSaved,
                    cacheReadTokens: cacheRead,
                    freshInputTokens: fresh,
                    outputTokens: output,
                },
            };
        });

        const totalCalls = rows.length;
        const errorRate = totalCalls > 0 ? Math.round((errorCount / totalCalls) * 1000) / 1000 : 0;
        const meanDurationMs = measuredCount > 0 ? Math.round(totalDurationMs / measuredCount) : 0;

        return {
            mode: input.mode,
            scope: {
                sessionId: input.mode === 'session' ? input.sessionId : null,
                source: input.mode === 'session' ? input.source : null,
                model: modelMixed ? null : commonModel,
                start: firstTs,
                end: lastTs,
                totalCalls,
                uniqueTools: uniqueToolsSet.size,
                errorCount,
                errorRate,
                totalDurationMs,
                meanDurationMs,
                durationUnmeasured: unmeasuredCount,
                sessionCount: sessionsSet.size,
                tokens: {
                    billedTokens: freshTokensTotal + outputTokensTotal,
                    cacheSavedTokens: cacheReadTokensTotal,
                    cacheReadTokens: cacheReadTokensTotal,
                    freshInputTokens: freshTokensTotal,
                    outputTokens: outputTokensTotal,
                },
            },
            truncated: queryResult.truncated,
            items,
        };
    }

    async getSessions(input: HistorySessionsInput): Promise<HistorySessionsResponse['data']> {
        const db = await this.resolveDb();
        if (!db) {
            return { items: [], total: 0, page: input.page ?? 1, pageSize: input.pageSize ?? 20 };
        }

        const sel = toArtifactSelector(input.filter);
        const page = input.page ?? 1;
        const pageSize = input.pageSize ?? 20;
        if (await historyBoardRollupsFresh(db)) {
            const result = await historyBoardSessionsFromRollup(db, sel, {
                page,
                pageSize,
                sortBy: input.sortBy ?? 'start',
                sortDir: input.sortDir ?? 'desc',
            });
            return {
                items: result.items.map((row) => {
                    const start = row.startedAt ?? new Date(0).toISOString();
                    const span = row.endedAt ? Math.max(0, Date.parse(row.endedAt) - Date.parse(start)) : 0;
                    return {
                        id: row.sessionId,
                        source: row.source,
                        model: row.model,
                        start,
                        durationMs: span > 0 ? span : row.assistantDurationMs,
                        messages: row.messages,
                        toolCalls: row.toolCalls,
                        billedTokens: row.freshInputTokens + row.outputTokens,
                        cacheReadTokens: row.cacheReadTokens,
                        freshInputTokens: row.freshInputTokens,
                        outputTokens: row.outputTokens,
                        topTool: row.topTool ?? 'none',
                        state: row.state,
                    };
                }),
                total: result.total,
                page,
                pageSize,
            };
        }

        // Task 0744: the stale-fallback session listing must sort and paginate in SQL.
        // Ordering, LIMIT/OFFSET, and the unpaged total are all the database's work; the
        // returned rows ARE the page, so nothing is sorted or sliced in JavaScript here.
        const pageResult = await bySessionPage(db, sel, {
            sortBy: input.sortBy ?? 'start',
            sortDir: input.sortDir ?? 'desc',
            limit: pageSize,
            offset: (page - 1) * pageSize,
        });

        const items: HistorySessionItem[] = pageResult.items.map((r) => {
            const start = r.startedAt ?? new Date(0).toISOString();
            const span = r.endedAt ? Math.max(0, Date.parse(r.endedAt) - Date.parse(start)) : 0;
            return {
                id: r.sessionId,
                source: r.source,
                model: r.model ?? 'unknown',
                start,
                durationMs: span > 0 ? span : (r.assistantDurationMs ?? 0),
                messages: r.messages,
                toolCalls: r.toolCalls,
                billedTokens: (r.inputTokens ?? 0) + (r.outputTokens ?? 0),
                cacheReadTokens: r.cacheReadTokens ?? 0,
                freshInputTokens: r.inputTokens ?? 0,
                outputTokens: r.outputTokens ?? 0,
                topTool: r.topTool ?? 'none',
                state: r.state,
            };
        });

        return {
            items,
            total: pageResult.total,
            page,
            pageSize,
        };
    }

    async getInsights(filter?: HistoryFilter): Promise<HistoryInsightsResponse['data']> {
        const db = await this.resolveDb();
        if (!db) {
            return {
                loops: [],
                cacheWaste: [],
                heavySessions: [],
                largestTokenSteps: [],
                slowSteps: [],
                modelComparison: [],
            };
        }

        const sel = toArtifactSelector(filter);
        const rollupsFresh = await historyBoardRollupsFresh(db);
        const hasRollupRows = await hasHistoryBoardRollupRows(db, 'history_board_loop_findings');
        const useRollup = rollupsFresh || hasRollupRows;
        const effectiveSel = rollupsFresh ? sel : boundStaleSelector(sel);
        const [loopRows, cacheWasteRows, sessionRows, largeSteps, slowStepsRows, modelCompRows] = useRollup
            ? await Promise.all([
                  historyBoardLoopsFromRollup(db, sel, 100),
                  historyBoardRankedStepsFromRollup(db, sel, 'cache-waste', 10),
                  historyBoardHeavySessionsFromRollup(db, sel, 5),
                  historyBoardRankedStepsFromRollup(db, sel, 'tokens', 10),
                  historyBoardRankedStepsFromRollup(db, sel, 'duration', 10),
                  historyBoardModelComparisonFromRollup(db, sel),
              ])
            : await Promise.all([
                  loops(db, effectiveSel),
                  topCacheWasteSteps(db, effectiveSel, 10),
                  bySession(db, effectiveSel, 5),
                  topStepsByTokens(db, effectiveSel, 10),
                  topStepsByDuration(db, effectiveSel, 10),
                  modelComparison(db, effectiveSel),
              ]);

        const EAGER_LOOP_DETAIL_LIMIT = 10;
        const loopFindings = await Promise.all(
            loopRows.map(async (l, idx) => {
                let repeatedCalls: HistoryToolCallItem[] | undefined;
                let avgTokens = 250;
                if (idx < EAGER_LOOP_DETAIL_LIMIT) {
                    try {
                        const callRows = await loopRepeatedCallsQuery(db, {
                            source: l.source,
                            sessionId: l.sessionId,
                            toolName: l.toolName,
                            argsDigest: l.argsDigest,
                            model: l.model,
                            limit: 50,
                        });

                        if (callRows.length > 0) {
                            const totalSampleTokens = callRows.reduce(
                                (acc, r) => acc + r.inputTokens + r.outputTokens,
                                0,
                            );
                            avgTokens = Math.max(1, Math.round(totalSampleTokens / callRows.length));
                        }

                        repeatedCalls = callRows.map((row) => {
                            const category = toolCategory(row.toolName);
                            const billedTokens = row.inputTokens + row.outputTokens;
                            return {
                                seq: row.toolSeq,
                                toolSeq: row.toolSeq,
                                ts: row.ts,
                                toolName: row.toolName,
                                category,
                                status: row.status === 'ok' ? 'ok' : row.status === 'error' ? 'error' : 'unknown',
                                durationMs: row.durationMs,
                                durationSource: row.durationMs !== null ? 'measured' : 'unmeasured',
                                resultBytes: row.resultBytes,
                                argsRaw: row.argsRaw,
                                argsDigest: row.argsDigest,
                                errorText: row.errorText,
                                callId: row.callId,
                                messageHash: row.messageHash,
                                sessionId: row.sessionId,
                                source: row.source,
                                model: row.model,
                                tokens: {
                                    billedTokens,
                                    freshInputTokens: row.inputTokens,
                                    cacheReadTokens: row.cacheReadTokens,
                                    outputTokens: row.outputTokens,
                                    cacheSavedTokens: 0,
                                },
                            };
                        });
                    } catch {
                        repeatedCalls = [];
                    }
                }

                const wastedTokens = Math.max(0, l.repeats - 1) * avgTokens;

                return {
                    tool: l.toolName,
                    argsHint: l.argsDigest ?? 'repeated execution',
                    sessionId: l.sessionId,
                    repeats: l.repeats,
                    fromSeq: l.firstSeq,
                    toSeq: l.lastSeq,
                    wastedTokens,
                    repeatedCalls,
                };
            }),
        );

        const cacheWaste = cacheWasteRows.map((c) => {
            const fresh = c.inputTokens ?? 0;
            const cache = c.cacheReadTokens ?? 0;
            const total = fresh + cache;
            const reusePct = total > 0 ? Math.round((cache / total) * 100) : 0;
            return {
                sessionId: c.sessionId,
                timestamp: c.ts ?? new Date(0).toISOString(),
                freshTokens: fresh,
                reason: `Low cache reuse (${reusePct}%)`,
            };
        });

        const heavySessions = sessionRows.map((s) => ({
            id: s.sessionId,
            source: s.source,
            model: s.model ?? 'unknown',
            tokens: 'freshInputTokens' in s ? s.freshInputTokens + s.outputTokens : (s.tokens ?? 0),
            durationMs: s.assistantDurationMs ?? 0,
        }));

        const largestTokenSteps = largeSteps.map((st, idx) => ({
            stepIndex: idx + 1,
            sessionId: st.sessionId,
            toolName: 'assistant',
            tokens: (st.inputTokens ?? 0) + (st.cacheReadTokens ?? 0) + (st.outputTokens ?? 0),
            durationMs: st.durationMs ?? undefined,
            agent: st.source,
            model: st.model ?? 'unknown',
        }));

        const slowSteps = slowStepsRows.map((st, idx) => ({
            stepIndex: idx + 1,
            sessionId: st.sessionId,
            toolName: 'assistant',
            tokens: (st.inputTokens ?? 0) + (st.cacheReadTokens ?? 0) + (st.outputTokens ?? 0),
            durationMs: st.durationMs ?? undefined,
            agent: st.source,
            model: st.model ?? 'unknown',
        }));

        const compItems: HistoryModelComparisonItem[] = modelCompRows.map((m) => ({
            model: m.model,
            speedMsMean: Math.round(m.speedMsMean ?? 0),
            cacheRatio: Math.round((m.cacheRatio ?? 0) * 100) / 100,
            reliability: Math.round((m.reliability ?? 1.0) * 100) / 100,
            outputRatio: Math.round((m.outputRatio ?? 0) * 100) / 100,
        }));

        return {
            loops: loopFindings,
            cacheWaste,
            heavySessions,
            largestTokenSteps,
            slowSteps,
            modelComparison: compItems,
        };
    }

    async getSources(): Promise<HistorySourcesResponse['data']> {
        const db = await this.resolveDb();
        if (!db) {
            return {
                overview: {
                    totalFiles: 0,
                    corpusSizeBytes: 0,
                    dateCoverage: { from: null, to: null },
                    totalSessions: 0,
                    lastImportedAt: null,
                },
                agents: [],
                roots: [],
            };
        }

        // Materialized rollups are rebuilt atomically and cover every message through the
        // last refresh. Read them whenever they exist; when stale (messages imported since),
        // fold in only that trailing delta with a bounded scan — exact, and never re-scans
        // the whole corpus. Raw scans remain only for the cold start (no rollup yet).
        const result = await historyBoardSourcesFromRollup(db, HISTORY_BOARD_ACTIVITY_DAYS);
        if (result.sources.length > 0) {
            if (!(await historyBoardRollupsFresh(db))) {
                const delta = await sourceDelta(db, HISTORY_BOARD_ACTIVITY_DAYS);
                return projectSources(
                    foldSourceDelta(result.sources, delta),
                    foldDailyDelta(result.daily, delta),
                    result.databaseBytes,
                );
            }
            return projectSources(result.sources, result.daily, result.databaseBytes);
        }

        // Bounded cold-start fallback (0743 R7): the raw source/tool/session analyzers never scan an
        // unannounced full corpus — the selector is clamped to the named time-range cap and the
        // session analyzer is bounded by the named row cap.
        const selector = boundStaleSelector(toArtifactSelector());
        const [summaries, matrix, messageRows, toolRows, sessions, databaseBytes] = await Promise.all([
            sourceSummary(db, selector),
            dailyTokenMatrix(db, HISTORY_BOARD_ACTIVITY_DAYS),
            messageRollup(db, selector),
            toolRollup(db, selector),
            bySession(db, selector, STALE_FALLBACK_ROW_CAP),
            historyBoardDatabaseBytes(db),
        ]);
        const sources = new Map<string, HistoryBoardSourceRollupRow>();
        for (const row of summaries) {
            sources.set(row.source, {
                source: row.source,
                files: row.files,
                messages: row.messages,
                lastImportedAt: row.lastImportedAt,
                sessions: 0,
                freshInputTokens: 0,
                cacheReadTokens: 0,
                outputTokens: 0,
                toolCalls: 0,
                firstDate: null,
                lastDate: null,
            });
        }
        for (const row of messageRows) {
            const source = sources.get(row.source);
            if (!source) continue;
            source.freshInputTokens += row.inputTokens ?? 0;
            source.cacheReadTokens += row.cacheReadTokens ?? 0;
            source.outputTokens += row.outputTokens ?? 0;
        }
        for (const row of sessions) {
            const source = sources.get(row.source);
            if (!source) continue;
            source.sessions += 1;
            if (row.startedAt && (source.firstDate === null || row.startedAt < source.firstDate)) {
                source.firstDate = row.startedAt;
            }
            if (row.endedAt && (source.lastDate === null || row.endedAt > source.lastDate)) {
                source.lastDate = row.endedAt;
            }
        }
        for (const row of toolRows) {
            const source = sources.get(row.source);
            if (source) source.toolCalls += row.toolCalls;
        }
        const daily: HistoryBoardDailyRollupRow[] = matrix.map((row) => ({
            source: row.source,
            day: row.day,
            freshInputTokens: row.freshInputTokens ?? 0,
            cacheReadTokens: row.cacheReadTokens ?? 0,
            outputTokens: (row.tokens ?? 0) - (row.freshInputTokens ?? 0),
            sessions: row.sessions,
            toolCalls: row.toolCalls,
        }));
        return projectSources(Array.from(sources.values()), daily, databaseBytes);
    }

    async triggerImport(mode: 'full' | 'incremental'): Promise<HistoryTriggerImportResponse['data']> {
        if (!this.deps.triggerImport) {
            throw new Error('History import queue is not configured');
        }
        return this.deps.triggerImport(mode);
    }
}
