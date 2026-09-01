import { oc } from '@orpc/contract';
import { z } from 'zod';
import { apiSuccessSchema } from './shared';

// ─── Filter & Parameter Schemas ──────────────────────────────────────────────

/** Supported date/time range presets for history filtering. */
export const historyRangeEnum = z.enum(['1h', '4h', '24h', '7d', '30d', 'all', 'custom']);
/** Inferred type for HistoryRange enum. */
export type HistoryRange = z.infer<typeof historyRangeEnum>;

/** Supported time aggregation bucket intervals. */
export const historyBucketEnum = z.enum(['auto', '5m', '10m', '30m', '1h', '4h', '1d']);
/** Inferred type for HistoryBucket enum. */
export type HistoryBucket = z.infer<typeof historyBucketEnum>;

/** Supported stacked-series dimensions for the Summary chart. */
export const historyDimensionEnum = z.enum(['model', 'source', 'tool', 'skill']);
/** Inferred type for HistoryDimension enum. */
export type HistoryDimension = z.infer<typeof historyDimensionEnum>;

/** Input filter schema for history queries. */
export const historyFilterSchema = z.object({
    range: historyRangeEnum.default('4h'),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    sources: z.array(z.string()).optional(),
    models: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    bucket: historyBucketEnum.default('auto'),
    dimension: historyDimensionEnum.default('model'),
});
/** Inferred type for HistoryFilter input. */
export type HistoryFilter = z.input<typeof historyFilterSchema>;

// ─── Token Telemetry DTO ─────────────────────────────────────────────────────

/** Pure token telemetry metrics schema. */
export const historyTokensSchema = z.object({
    billedTokens: z.number(),
    cacheSavedTokens: z.number(),
    cacheReadTokens: z.number(),
    freshInputTokens: z.number(),
    outputTokens: z.number(),
});
/** Inferred type for HistoryTokens. */
export type HistoryTokens = z.infer<typeof historyTokensSchema>;

// ─── Summary Tab DTOs ────────────────────────────────────────────────────────

/** Summary KPIs metrics schema. */
export const historySummaryKpisSchema = z.object({
    totalBilledTokens: z.number(),
    cacheSavedTokens: z.number(),
    cacheSavedPercent: z.number(),
    sessionsCount: z.number(),
    toolCallsCount: z.number(),
    errorRate: z.number(),
});
/** Inferred type for HistorySummaryKpis. */
export type HistorySummaryKpis = z.infer<typeof historySummaryKpisSchema>;

/** Daily KPI trend point schema (last-N-days daily rollup for delta sparklines). */
export const historyKpiTrendPointSchema = z.object({
    day: z.string(),
    totalBilledTokens: z.number(),
    cacheSavedTokens: z.number(),
    sessionsCount: z.number(),
    toolCallsCount: z.number(),
    cacheHitRatio: z.number(),
});
/** Inferred type for HistoryKpiTrendPoint. */
export type HistoryKpiTrendPoint = z.infer<typeof historyKpiTrendPointSchema>;

/** Single time series bucket data point schema. */
export const historyTimeSeriesPointSchema = z.object({
    bucketStart: z.string(),
    cacheHitRatio: z.number(),
    series: z.record(z.string(), z.number()),
});

/** Inferred type for HistoryTimeSeriesPoint. */
export type HistoryTimeSeriesPoint = z.infer<typeof historyTimeSeriesPointSchema>;

/** Top breakdown item schema (models, sources). */
export const historyTopItemSchema = z.object({
    id: z.string(),
    label: z.string(),
    color: z.string(),
    tokens: z.number(),
    share: z.number(),
});
/** Inferred type for HistoryTopItem. */
export type HistoryTopItem = z.infer<typeof historyTopItemSchema>;

/** Top tool execution item schema. */
export const historyTopToolSchema = z.object({
    id: z.string(),
    count: z.number(),
    errors: z.number(),
    errorRate: z.number(),
});
/** Inferred type for HistoryTopTool. */
export type HistoryTopTool = z.infer<typeof historyTopToolSchema>;

/** Skill execution breakdown item schema. */
export const historySkillItemSchema = z.object({
    id: z.string(),
    label: z.string(),
    color: z.string(),
    count: z.number(),
});
/** Inferred type for HistorySkillItem. */
export type HistorySkillItem = z.infer<typeof historySkillItemSchema>;

/** Cache efficiency summary metrics schema. */
export const historyCacheEfficiencySchema = z.object({
    hitRatio: z.number(),
    savedTokens: z.number(),
    totalRead: z.number(),
});
/** Inferred type for HistoryCacheEfficiency. */
export type HistoryCacheEfficiency = z.infer<typeof historyCacheEfficiencySchema>;

/** Summary tab response payload data schema. */
export const historySummaryResponseDataSchema = z.object({
    kpis: historySummaryKpisSchema,
    timeSeries: z.array(historyTimeSeriesPointSchema),
    topModels: z.array(historyTopItemSchema),
    topSources: z.array(historyTopItemSchema),
    topTools: z.array(historyTopToolSchema),
    skillsUsed: z.array(historySkillItemSchema),
    cacheEfficiency: historyCacheEfficiencySchema,
    kpiTrend: z.array(historyKpiTrendPointSchema),
    previousKpis: historySummaryKpisSchema.nullable(),
    skillTimeSeries: z.array(historyTimeSeriesPointSchema),
    modelTimeSeries: z.array(historyTimeSeriesPointSchema).optional(),
    sourceTimeSeries: z.array(historyTimeSeriesPointSchema).optional(),
    toolTimeSeries: z.array(historyTimeSeriesPointSchema).optional(),
});

/** Summary tab API response envelope schema. */
export const historySummaryResponseSchema = apiSuccessSchema(historySummaryResponseDataSchema);
/** Inferred type for HistorySummaryResponse. */
export type HistorySummaryResponse = z.infer<typeof historySummaryResponseSchema>;

// ─── Timeline Tab DTOs ───────────────────────────────────────────────────────

/** Kinds of events in session execution timeline. */
export const historyTimelineEventKindEnum = z.enum([
    'read',
    'write',
    'bash',
    'search',
    'run',
    'user',
    'assistant',
    'unknown',
]);
/** Inferred type for HistoryTimelineEventKind. */
export type HistoryTimelineEventKind = z.infer<typeof historyTimelineEventKindEnum>;

/** Duration source enum. */
export const historyDurationSourceEnum = z.enum(['measured', 'inferred', 'unmeasured']);
/** Inferred type for HistoryDurationSource. */
export type HistoryDurationSource = z.infer<typeof historyDurationSourceEnum>;

/** Correlation exactness enum for consolidated timeline blocks. */
export const historyCorrelationExactnessEnum = z.enum(['exact', 'estimated']);
/** Inferred type for HistoryCorrelationExactness. */
export type HistoryCorrelationExactness = z.infer<typeof historyCorrelationExactnessEnum>;

/** Discriminated input schema for session or consolidated timeline. */
export const historyTimelineInputSchema = z.discriminatedUnion('mode', [
    z.object({
        mode: z.literal('session'),
        source: z.string().min(1),
        sessionId: z.string().min(1),
    }),
    z.object({
        mode: z.literal('consolidated'),
        filter: historyFilterSchema.optional(),
        taskWbs: z.string().optional(),
        runId: z.string().optional(),
    }),
]);
/** Inferred type for HistoryTimelineInput. */
export type HistoryTimelineInput = z.infer<typeof historyTimelineInputSchema>;

/** Single event in session timeline schema. */
export const historyTimelineEventSchema = z.object({
    seq: z.number(),
    eventType: z.enum(['message', 'tool']),
    kind: historyTimelineEventKindEnum,
    title: z.string(),
    toolName: z.string().nullable(),
    durationMs: z.number().nullable(),
    durationSource: historyDurationSourceEnum,
    tokens: z.number(),
    freshInputTokens: z.number(),
    cacheReadTokens: z.number(),
    outputTokens: z.number(),
    promptTokens: historyTokensSchema.nullable(),
    exitCode: z.number().nullable(),
    payload: z.string().nullable(),
    agent: z.string(),
    model: z.string(),
});
/** Inferred type for HistoryTimelineEvent. */
export type HistoryTimelineEvent = z.infer<typeof historyTimelineEventSchema>;

/** Grouped turn block in session timeline schema. */
export const historyTimelineBlockSchema = z.object({
    key: z.string(),
    sessionId: z.string(),
    turnIndex: z.number(),
    timestamp: z.string().nullable(),
    source: z.string(),
    model: z.string(),
    correlationExactness: historyCorrelationExactnessEnum.nullable(),
    totalDurationMs: z.number(),
    totalTokens: z.number(),
    operationCount: z.number(),
    events: z.array(historyTimelineEventSchema),
});
/** Inferred type for HistoryTimelineBlock. */
export type HistoryTimelineBlock = z.infer<typeof historyTimelineBlockSchema>;

/** Scope metadata schema for timeline header. */
export const historyTimelineScopeSchema = z.object({
    sessionId: z.string().nullable(),
    source: z.string().nullable(),
    model: z.string().nullable(),
    start: z.string().nullable(),
    end: z.string().nullable(),
    durationMs: z.number(),
    tokens: historyTokensSchema,
    messageCount: z.number(),
    toolCallCount: z.number(),
    sessionCount: z.number(),
});
/** Inferred type for HistoryTimelineScope. */
export type HistoryTimelineScope = z.infer<typeof historyTimelineScopeSchema>;

/** Timeline tab response payload data schema. */
export const historyTimelineResponseDataSchema = z.object({
    mode: z.enum(['session', 'consolidated']),
    scope: historyTimelineScopeSchema,
    truncated: z.boolean(),
    blocks: z.array(historyTimelineBlockSchema),
});
/** Inferred type for HistoryTimelineResponseData. */
export type HistoryTimelineResponseData = z.infer<typeof historyTimelineResponseDataSchema>;

/** Timeline tab API response envelope schema. */
export const historyTimelineResponseSchema = apiSuccessSchema(historyTimelineResponseDataSchema);
/** Inferred type for HistoryTimelineResponse. */
export type HistoryTimelineResponse = z.infer<typeof historyTimelineResponseSchema>;

// ─── Sessions Tab DTOs ───────────────────────────────────────────────────────

/** Single session summary row item schema. */
export const historySessionItemSchema = z.object({
    id: z.string(),
    source: z.string(),
    model: z.string(),
    modelDetail: z.string().optional(),
    start: z.string(),
    durationMs: z.number(),
    messages: z.number(),
    toolCalls: z.number(),
    billedTokens: z.number(),
    cacheReadTokens: z.number(),
    freshInputTokens: z.number(),
    outputTokens: z.number(),
    topTool: z.string(),
    state: z.string(),
});
/** Inferred type for HistorySessionItem. */
export type HistorySessionItem = z.infer<typeof historySessionItemSchema>;

/** Paginated session items response payload data schema. */
export const historySessionsResponseDataSchema = z.object({
    items: z.array(historySessionItemSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
});

/** Sessions tab API response envelope schema. */
export const historySessionsResponseSchema = apiSuccessSchema(historySessionsResponseDataSchema);
/** Inferred type for HistorySessionsResponse. */
export type HistorySessionsResponse = z.infer<typeof historySessionsResponseSchema>;

/** Sessions query input parameters schema. */
export const historySessionsInputSchema = z.object({
    filter: historyFilterSchema.optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
    sortBy: z
        .enum(['start', 'duration', 'messages', 'toolCalls', 'billedTokens', 'cacheRead', 'freshInput'])
        .default('start'),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
});
/** Inferred type for HistorySessionsInput. */
export type HistorySessionsInput = z.input<typeof historySessionsInputSchema>;

// ─── Tool Using Tab DTOs ─────────────────────────────────────────────────────

/** Supported tool category classification enum. */
export const historyToolCategoryEnum = z.enum(['read', 'write', 'bash', 'search', 'mcp', 'other']);
/** Inferred type for HistoryToolCategory. */
export type HistoryToolCategory = z.infer<typeof historyToolCategoryEnum>;

/** Tool status filter options enum. */
export const historyToolStatusFilterEnum = z.enum(['all', 'ok', 'error']);
/** Inferred type for HistoryToolStatusFilter. */
export type HistoryToolStatusFilter = z.infer<typeof historyToolStatusFilterEnum>;

/** Tool call sequence item schema. */
export const historyToolCallItemSchema = z.object({
    seq: z.number(),
    toolSeq: z.number(),
    ts: z.string().nullable(),
    toolName: z.string(),
    category: historyToolCategoryEnum,
    status: z.enum(['ok', 'error', 'unknown']),
    durationMs: z.number().nullable(),
    durationSource: historyDurationSourceEnum,
    resultBytes: z.number().nullable(),
    argsRaw: z.string().nullable(),
    argsDigest: z.string().nullable(),
    errorText: z.string().nullable(),
    callId: z.string().nullable(),
    messageHash: z.string(),
    sessionId: z.string(),
    source: z.string(),
    model: z.string().nullable(),
    tokens: historyTokensSchema,
});
/** Inferred type for HistoryToolCallItem. */
export type HistoryToolCallItem = z.infer<typeof historyToolCallItemSchema>;

/** Tool sequence scope statistics summary schema. */
export const historyToolSequenceScopeSchema = z.object({
    sessionId: z.string().nullable(),
    source: z.string().nullable(),
    model: z.string().nullable(),
    start: z.string().nullable(),
    end: z.string().nullable(),
    totalCalls: z.number(),
    uniqueTools: z.number(),
    errorCount: z.number(),
    errorRate: z.number(),
    totalDurationMs: z.number(),
    meanDurationMs: z.number(),
    durationUnmeasured: z.number(),
    sessionCount: z.number(),
    tokens: historyTokensSchema,
});
/** Inferred type for HistoryToolSequenceScope. */
export type HistoryToolSequenceScope = z.infer<typeof historyToolSequenceScopeSchema>;

/** Input parameters schema for tool sequence query. */
export const historyToolSequenceInputSchema = z.intersection(
    z.discriminatedUnion('mode', [
        z.object({ mode: z.literal('session'), source: z.string().min(1), sessionId: z.string().min(1) }),
        z.object({ mode: z.literal('consolidated'), filter: historyFilterSchema.optional() }),
    ]),
    z.object({
        toolNames: z.array(z.string()).optional(),
        status: historyToolStatusFilterEnum.default('all'),
        search: z.string().optional(),
    }),
);
/** Inferred type for HistoryToolSequenceInput. */
export type HistoryToolSequenceInput = z.input<typeof historyToolSequenceInputSchema>;

/** Response data payload schema for tool sequence query. */
export const historyToolSequenceResponseDataSchema = z.object({
    mode: z.enum(['session', 'consolidated']),
    scope: historyToolSequenceScopeSchema,
    truncated: z.boolean(),
    items: z.array(historyToolCallItemSchema),
});
/** Inferred type for HistoryToolSequenceResponseData. */
export type HistoryToolSequenceResponseData = z.infer<typeof historyToolSequenceResponseDataSchema>;

/** Tool sequence query API response envelope schema. */
export const historyToolSequenceResponseSchema = apiSuccessSchema(historyToolSequenceResponseDataSchema);
/** Inferred type for HistoryToolSequenceResponse. */
export type HistoryToolSequenceResponse = z.infer<typeof historyToolSequenceResponseSchema>;

// ─── Insights Tab DTOs ───────────────────────────────────────────────────────

/** Loop detection finding item schema. */
export const historyLoopFindingSchema = z.object({
    tool: z.string(),
    argsHint: z.string(),
    sessionId: z.string(),
    repeats: z.number(),
    fromSeq: z.number(),
    toSeq: z.number(),
    wastedTokens: z.number(),
});
/** Inferred type for HistoryLoopFinding. */
export type HistoryLoopFinding = z.infer<typeof historyLoopFindingSchema>;

/** Cache waste incident item schema. */
export const historyCacheWasteItemSchema = z.object({
    sessionId: z.string(),
    timestamp: z.string(),
    freshTokens: z.number(),
    reason: z.string(),
});
/** Inferred type for HistoryCacheWasteItem. */
export type HistoryCacheWasteItem = z.infer<typeof historyCacheWasteItemSchema>;

/** Heavy session item schema. */
export const historyHeavySessionSchema = z.object({
    id: z.string(),
    source: z.string(),
    model: z.string(),
    tokens: z.number(),
    durationMs: z.number(),
});
/** Inferred type for HistoryHeavySession. */
export type HistoryHeavySession = z.infer<typeof historyHeavySessionSchema>;

/** Ranked step item schema (largest token load or slowest duration). */
export const historyStepRankItemSchema = z.object({
    stepIndex: z.number(),
    sessionId: z.string(),
    toolName: z.string(),
    tokens: z.number(),
    durationMs: z.number().optional(),
    agent: z.string(),
    model: z.string(),
});
/** Inferred type for HistoryStepRankItem. */
export type HistoryStepRankItem = z.infer<typeof historyStepRankItemSchema>;

/** Multi-axis model benchmark comparison item schema. */
export const historyModelComparisonItemSchema = z.object({
    model: z.string(),
    speedMsMean: z.number(),
    cacheRatio: z.number(),
    reliability: z.number(),
    outputRatio: z.number(),
});
/** Inferred type for HistoryModelComparisonItem. */
export type HistoryModelComparisonItem = z.infer<typeof historyModelComparisonItemSchema>;

/** Insights tab response payload data schema. */
export const historyInsightsResponseDataSchema = z.object({
    loops: z.array(historyLoopFindingSchema),
    cacheWaste: z.array(historyCacheWasteItemSchema),
    heavySessions: z.array(historyHeavySessionSchema),
    largestTokenSteps: z.array(historyStepRankItemSchema),
    slowSteps: z.array(historyStepRankItemSchema),
    modelComparison: z.array(historyModelComparisonItemSchema),
});

/** Insights tab API response envelope schema. */
export const historyInsightsResponseSchema = apiSuccessSchema(historyInsightsResponseDataSchema);
/** Inferred type for HistoryInsightsResponse. */
export type HistoryInsightsResponse = z.infer<typeof historyInsightsResponseSchema>;

// ─── Sources Tab DTOs ────────────────────────────────────────────────────────

/** Single day token activity for heatmap schema. */
export const historyHeatmapDaySchema = z.object({
    date: z.string(),
    tokens: z.number(),
    sessions: z.number(),
});
/** Inferred type for HistoryHeatmapDay. */
export type HistoryHeatmapDay = z.infer<typeof historyHeatmapDaySchema>;

/** Agent source summary card data schema. */
export const historyAgentSourceCardSchema = z.object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
    importPath: z.string(),
    filePattern: z.string(),
    filesCount: z.number(),
    sizeMb: z.number().nullable(),
    sessionCount: z.number(),
    totalTokens: z.number(),
    cacheSavedTokens: z.number(),
    freshTokens: z.number(),
    toolCalls: z.number(),
    firstDate: z.string().nullable(),
    lastDate: z.string().nullable(),
    heatmapDays: z.array(historyHeatmapDaySchema),
    maxDailyTokens: z.number(),
});
/** Inferred type for HistoryAgentSourceCard. */
export type HistoryAgentSourceCard = z.infer<typeof historyAgentSourceCardSchema>;

/** Source import root directory schema. */
export const historySourceRootSchema = z.object({
    agentId: z.string(),
    agentName: z.string(),
    path: z.string(),
    matchPattern: z.string(),
    fileCount: z.number(),
    status: z.enum(['active', 'empty', 'missing']),
});
/** Inferred type for HistorySourceRoot. */
export type HistorySourceRoot = z.infer<typeof historySourceRootSchema>;

/** Corpus overview summary schema. */
export const historySourcesOverviewSchema = z.object({
    totalFiles: z.number(),
    corpusSizeBytes: z.number(),
    dateCoverage: z.object({
        from: z.string().nullable(),
        to: z.string().nullable(),
    }),
    totalSessions: z.number(),
    lastImportedAt: z.string().nullable(),
});
/** Inferred type for HistorySourcesOverview. */
export type HistorySourcesOverview = z.infer<typeof historySourcesOverviewSchema>;

/** Sources tab response payload data schema. */
export const historySourcesResponseDataSchema = z.object({
    overview: historySourcesOverviewSchema,
    agents: z.array(historyAgentSourceCardSchema),
    roots: z.array(historySourceRootSchema),
});

/** Sources tab API response envelope schema. */
export const historySourcesResponseSchema = apiSuccessSchema(historySourcesResponseDataSchema);
/** Inferred type for HistorySourcesResponse. */
export type HistorySourcesResponse = z.infer<typeof historySourcesResponseSchema>;

// ─── Trigger Import DTOs ─────────────────────────────────────────────────────

/** Trigger import input parameters schema. */
export const historyTriggerImportInputSchema = z.object({
    mode: z.enum(['full', 'incremental']).default('incremental'),
});

/** Trigger import response payload data schema. */
export const historyTriggerImportResponseDataSchema = z.object({
    runId: z.string(),
    status: z.enum(['queued', 'coalesced', 'already-running']),
    message: z.string(),
});

/** Trigger import API response envelope schema. */
export const historyTriggerImportResponseSchema = apiSuccessSchema(historyTriggerImportResponseDataSchema);
/** Inferred type for HistoryTriggerImportResponse. */
export type HistoryTriggerImportResponse = z.infer<typeof historyTriggerImportResponseSchema>;

// ─── Contract Definition ─────────────────────────────────────────────────────

/** oRPC history board API contract definition. */
export const historyContract = {
    getSummary: oc
        .route({
            method: 'POST',
            path: '/history/summary',
            summary: 'Get conversation history analytics summary',
            tags: ['history'],
        })
        .input(historyFilterSchema.optional())
        .output(historySummaryResponseSchema),

    getTimeline: oc
        .route({
            method: 'POST',
            path: '/history/timeline',
            summary: 'Get chronological session or consolidated execution timeline',
            tags: ['history'],
        })
        .input(historyTimelineInputSchema)
        .output(historyTimelineResponseSchema),

    getToolSequence: oc
        .route({
            method: 'POST',
            path: '/history/tool-sequence',
            summary: 'Get ordered tool invocation sequence for a session or filtered scope',
            tags: ['history'],
        })
        .input(historyToolSequenceInputSchema)
        .output(historyToolSequenceResponseSchema),

    getSessions: oc
        .route({
            method: 'POST',
            path: '/history/sessions',
            summary: 'List and filter conversation sessions',
            tags: ['history'],
        })
        .input(historySessionsInputSchema)
        .output(historySessionsResponseSchema),

    getInsights: oc
        .route({
            method: 'POST',
            path: '/history/insights',
            summary: 'Get conversation forensic insights and loops',
            tags: ['history'],
        })
        .input(historyFilterSchema.optional())
        .output(historyInsightsResponseSchema),

    getSources: oc
        .route({
            method: 'GET',
            path: '/history/sources',
            summary: 'Get all-time agent sources overview and heatmaps',
            tags: ['history'],
        })
        .output(historySourcesResponseSchema),

    triggerImport: oc
        .route({
            method: 'POST',
            path: '/history/import',
            summary: 'Trigger history transcript import and analysis',
            tags: ['history'],
        })
        .input(historyTriggerImportInputSchema)
        .output(historyTriggerImportResponseSchema),
};
