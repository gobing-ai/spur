import type {
    HistoryFilter,
    HistoryInsightsResponse,
    HistoryModelComparisonItem,
    HistoryRange,
    HistorySessionItem,
    HistorySessionsInput,
    HistorySessionsResponse,
    HistorySourcesResponse,
    HistorySummaryResponse,
    HistoryTimelineBlock,
    HistoryTimelineEvent,
    HistoryTimelineEventKind,
    HistoryTimelineResponse,
    HistoryTopItem,
    HistoryTriggerImportResponse,
} from '@gobing-ai/spur-contracts';
import {
    type ArtifactSelector,
    bucketedTokenSeries,
    bySession,
    bySkill,
    byTool,
    type DbAdapter,
    type HistoryBucket as DomainHistoryBucket,
    dailyTokenMatrix,
    type HistoryBoardDailyRollupRow,
    type HistoryBoardSourceRollupRow,
    type HistoryBoardSummaryRollup,
    historyBoardDatabaseBytes,
    historyBoardHeavySessionsFromRollup,
    historyBoardLoopsFromRollup,
    historyBoardModelComparisonFromRollup,
    historyBoardRankedStepsFromRollup,
    historyBoardRollupsFresh,
    historyBoardSessionsFromRollup,
    historyBoardSourcesFromRollup,
    historyBoardSummaryFromRollup,
    loops,
    messageRollup,
    modelComparison,
    sessionTimeline,
    sourceSummary,
    toolRollup,
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
        if (filter.range === '24h') {
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

function resolveBucket(bucket: string | undefined, range: HistoryRange = '30d'): DomainHistoryBucket {
    if (bucket && bucket !== 'auto') {
        return bucket as DomainHistoryBucket;
    }
    if (range === '24h') return '10m';
    if (range === '7d') return '30m';
    return '1d';
}

function classifyToolKind(toolName: string | null, role: string): HistoryTimelineEventKind {
    if (role === 'user') return 'user';
    if (!toolName) return 'read';
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

function projectSummary(rows: HistoryBoardSummaryRollup): HistorySummaryResponse['data'] {
    const tokenTotal = (row: { freshInputTokens: number; outputTokens: number }) =>
        row.freshInputTokens + row.outputTokens;
    const totalBilledTokens = rows.models.reduce((sum, row) => sum + tokenTotal(row), 0);
    const cacheSavedTokens = rows.models.reduce((sum, row) => sum + row.cacheReadTokens, 0);
    const cacheDenominator = totalBilledTokens + cacheSavedTokens;
    const timeSeries = new Map<string, { cacheRead: number; billed: number; series: Record<string, number> }>();
    for (const row of rows.buckets) {
        const point = timeSeries.get(row.bucketStart) ?? { cacheRead: 0, billed: 0, series: {} };
        const billed = (row.freshInputTokens ?? 0) + (row.outputTokens ?? 0);
        point.billed += billed;
        point.cacheRead += row.cacheReadTokens ?? 0;
        point.series[row.key] = (point.series[row.key] ?? 0) + billed;
        timeSeries.set(row.bucketStart, point);
    }

    const toTopItems = (items: HistoryBoardSummaryRollup['models'], sourceColors: boolean): HistoryTopItem[] =>
        items.slice(0, 5).map((row, index) => {
            const tokens = tokenTotal(row);
            return {
                id: row.key,
                label: row.key,
                color:
                    (sourceColors ? AGENT_CATALOG.find((agent) => agent.id === row.key)?.color : undefined) ??
                    SERIES_COLORS[index % SERIES_COLORS.length] ??
                    '#3987e5',
                tokens,
                share: totalBilledTokens > 0 ? Math.round((tokens / totalBilledTokens) * 100) : 0,
            };
        });

    return {
        kpis: {
            totalBilledTokens,
            cacheSavedTokens,
            cacheSavedPercent: cacheDenominator > 0 ? Math.round((cacheSavedTokens / cacheDenominator) * 100) : 0,
            sessionsCount: rows.sessions,
            toolCallsCount: rows.toolCalls,
            errorRate: rows.toolCalls > 0 ? Math.round((rows.toolErrors / rows.toolCalls) * 1000) / 10 : 0,
        },
        timeSeries: Array.from(timeSeries.entries()).map(([bucketStart, point]) => ({
            bucketStart,
            cacheHitRatio:
                point.billed + point.cacheRead > 0
                    ? Math.round((point.cacheRead / (point.billed + point.cacheRead)) * 100)
                    : 0,
            series: point.series,
        })),
        topModels: toTopItems(rows.models, false),
        topSources: toTopItems(rows.sources, true),
        topTools: rows.tools.slice(0, 10).map((row) => ({
            id: row.toolName,
            count: row.calls,
            errors: row.errors,
            errorRate: row.calls > 0 ? Math.round((row.errors / row.calls) * 1000) / 10 : 0,
        })),
        skillsUsed: rows.skills.map((row, index) => ({
            id: row.skillName,
            label: row.skillName,
            color: SERIES_COLORS[index % SERIES_COLORS.length] ?? '#3987e5',
            count: row.calls,
        })),
        cacheEfficiency: {
            hitRatio: cacheDenominator > 0 ? Math.round((cacheSavedTokens / cacheDenominator) * 100) : 0,
            savedTokens: cacheSavedTokens,
            totalRead: cacheSavedTokens + rows.models.reduce((sum, row) => sum + row.freshInputTokens, 0),
        },
    };
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
        const heatmapDays = Array.from({ length: 90 }, (_, index) => {
            const date = new Date(today.getTime() - (89 - index) * 86_400_000).toISOString().slice(0, 10);
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
    return {
        overview: {
            totalFiles: sources.reduce((sum, source) => sum + source.files, 0),
            corpusSizeBytes: databaseBytes,
            dateCoverage: { from, to },
            totalSessions: sources.reduce((sum, source) => sum + source.sessions, 0),
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
            };
        }

        const sel = toArtifactSelector(filter);
        const bucket = resolveBucket(filter?.bucket, filter?.range ?? '30d');
        const dimension = filter?.dimension ?? 'model';
        const exactSummaryRollup = (sel.tools?.length ?? 0) === 0 && (sel.skills?.length ?? 0) === 0;
        if (exactSummaryRollup && (await historyBoardRollupsFresh(db))) {
            return projectSummary(await historyBoardSummaryFromRollup(db, sel, bucket, dimension));
        }

        const [bucketRows, rollups, toolStats, skillStats, sessionRows] = await Promise.all([
            bucketedTokenSeries(db, sel, bucket, dimension),
            messageRollup(db, sel),
            byTool(db, sel, 1_000_000),
            bySkill(db, sel, 1_000_000),
            bySession(db, sel, 1_000_000),
        ]);
        const models = new Map<string, { freshInputTokens: number; cacheReadTokens: number; outputTokens: number }>();
        const sources = new Map<string, { freshInputTokens: number; cacheReadTokens: number; outputTokens: number }>();
        for (const row of rollups) {
            for (const [key, target] of [
                [row.model ?? 'unknown', models],
                [row.source, sources],
            ] as const) {
                const aggregate = target.get(key) ?? { freshInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
                aggregate.freshInputTokens += row.inputTokens ?? 0;
                aggregate.cacheReadTokens += row.cacheReadTokens ?? 0;
                aggregate.outputTokens += row.outputTokens ?? 0;
                target.set(key, aggregate);
            }
        }
        return projectSummary({
            buckets: bucketRows,
            models: Array.from(models, ([key, value]) => ({ key, ...value })).sort(
                (a, b) => b.freshInputTokens + b.outputTokens - a.freshInputTokens - a.outputTokens,
            ),
            sources: Array.from(sources, ([key, value]) => ({ key, ...value })).sort(
                (a, b) => b.freshInputTokens + b.outputTokens - a.freshInputTokens - a.outputTokens,
            ),
            tools: toolStats.map((row) => ({ toolName: row.toolName, calls: row.calls, errors: row.errors })),
            skills: skillStats,
            sessions: sessionRows.length,
            toolCalls: toolStats.reduce((sum, row) => sum + row.calls, 0),
            toolErrors: toolStats.reduce((sum, row) => sum + row.errors, 0),
        });
    }

    async getTimeline(sessionId: string): Promise<HistoryTimelineResponse['data']> {
        const db = await this.resolveDb();
        if (!db) {
            return {
                session: {
                    id: sessionId,
                    source: 'unknown',
                    model: 'unknown',
                    start: new Date(0).toISOString(),
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
                },
                blocks: [],
            };
        }

        if (sessionId === '' || sessionId === 'unknown' || sessionId === 'session') {
            throw new Error(`History session not found: ${sessionId || '(empty)'}`);
        }

        const events = await sessionTimeline(db, sessionId, 5000);
        if (events.length === 0) {
            throw new Error(`History session not found: ${sessionId}`);
        }
        let firstTs: string | null = null;
        let lastTs: string | null = null;
        let source = 'unknown';
        let model = 'unknown';
        let totalFresh = 0;
        let totalCache = 0;
        let totalOut = 0;
        let totalDuration = 0;
        let toolCallCount = 0;

        let messageCount = 0;
        const blocksByTurn = new Map<number, HistoryTimelineBlock>();
        for (const ev of events) {
            if (ev.ts && (firstTs === null || ev.ts < firstTs)) firstTs = ev.ts;
            if (ev.ts && (lastTs === null || ev.ts > lastTs)) lastTs = ev.ts;
            if (ev.source) source = ev.source;
            if (ev.model) model = ev.model;

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

            const event: HistoryTimelineEvent = {
                seq: ev.seq,
                kind: classifyToolKind(ev.toolName, ev.role),
                title: ev.toolName ? `${ev.toolName}` : `${ev.role} turn`,
                durationMs: dur,
                tokens: billed,
                freshInputTokens: fresh,
                cacheReadTokens: cache,
                outputTokens: out,
                exitCode: ev.exitCode,
                payload: ev.payload,
                agent: ev.source,
                model: ev.model ?? 'unknown',
            };
            const turn = blocksByTurn.get(ev.turnIndex) ?? {
                turnIndex: ev.turnIndex,
                timestamp: ev.ts ?? new Date(0).toISOString(),
                source: ev.source,
                model: ev.model ?? 'unknown',
                totalDurationMs: 0,
                totalTokens: 0,
                operationCount: 0,
                events: [],
            };
            turn.totalDurationMs += dur;
            turn.totalTokens += billed;
            turn.operationCount += 1;
            turn.events.push(event);
            blocksByTurn.set(ev.turnIndex, turn);
        }

        const totalBilled = totalFresh + totalOut;
        const startMs = firstTs ? Date.parse(firstTs) : 0;
        const endMs = lastTs ? Date.parse(lastTs) : startMs;
        const spanMs = Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;
        const sessionMeta = {
            id: sessionId,
            source,
            model,
            start: firstTs ?? new Date(0).toISOString(),
            durationMs: spanMs > 0 ? spanMs : totalDuration,
            tokens: {
                billedTokens: totalBilled,
                cacheSavedTokens: totalCache,
                cacheReadTokens: totalCache,
                freshInputTokens: totalFresh,
                outputTokens: totalOut,
            },
            messageCount,
            toolCallCount,
        };

        return {
            session: sessionMeta,
            blocks: Array.from(blocksByTurn.values()).sort((a, b) => a.turnIndex - b.turnIndex),
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
        const exactSessionRollup = (sel.tools?.length ?? 0) === 0 && (sel.skills?.length ?? 0) === 0;
        if (exactSessionRollup && (await historyBoardRollupsFresh(db))) {
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

        const rows = await bySession(db, sel, 1_000_000);

        const items: HistorySessionItem[] = rows.map((r) => {
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

        // Sorting
        const sortBy = input.sortBy ?? 'start';
        const sortDir = input.sortDir ?? 'desc';
        items.sort((a, b) => {
            let diff = 0;
            if (sortBy === 'start') {
                diff = new Date(a.start).getTime() - new Date(b.start).getTime();
            } else if (sortBy === 'duration') {
                diff = a.durationMs - b.durationMs;
            } else if (sortBy === 'messages') {
                diff = a.messages - b.messages;
            } else if (sortBy === 'toolCalls') {
                diff = a.toolCalls - b.toolCalls;
            } else if (sortBy === 'billedTokens') {
                diff = a.billedTokens - b.billedTokens;
            } else if (sortBy === 'cacheRead') {
                diff = a.cacheReadTokens - b.cacheReadTokens;
            } else if (sortBy === 'freshInput') {
                diff = a.freshInputTokens - b.freshInputTokens;
            }
            return sortDir === 'asc' ? diff : -diff;
        });

        const total = items.length;
        const startIdx = (page - 1) * pageSize;
        const paginated = items.slice(startIdx, startIdx + pageSize);

        return {
            items: paginated,
            total,
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
        const exactInsightRollup = (sel.tools?.length ?? 0) === 0 && (sel.skills?.length ?? 0) === 0;
        const rollupsFresh = exactInsightRollup && (await historyBoardRollupsFresh(db));
        const [loopRows, cacheWasteRows, sessionRows, largeSteps, slowStepsRows, modelCompRows] = rollupsFresh
            ? await Promise.all([
                  historyBoardLoopsFromRollup(db, sel, 100),
                  historyBoardRankedStepsFromRollup(db, sel, 'cache-waste', 10),
                  historyBoardHeavySessionsFromRollup(db, sel, 5),
                  historyBoardRankedStepsFromRollup(db, sel, 'tokens', 10),
                  historyBoardRankedStepsFromRollup(db, sel, 'duration', 10),
                  historyBoardModelComparisonFromRollup(db, sel),
              ])
            : await Promise.all([
                  loops(db, sel),
                  topCacheWasteSteps(db, sel, 10),
                  bySession(db, sel, 5),
                  topStepsByTokens(db, sel, 10),
                  topStepsByDuration(db, sel, 10),
                  modelComparison(db, sel),
              ]);

        const loopFindings = loopRows.map((l) => ({
            tool: l.toolName,
            argsHint: l.argsDigest ?? 'repeated execution',
            sessionId: l.sessionId,
            repeats: l.repeats,
            fromSeq: l.firstSeq,
            toSeq: l.lastSeq,
            wastedTokens: l.repeats * 250,
        }));

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
                },
                agents: [],
                roots: [],
            };
        }

        if (await historyBoardRollupsFresh(db)) {
            const result = await historyBoardSourcesFromRollup(db, 90);
            return projectSources(result.sources, result.daily, result.databaseBytes);
        }

        const selector = toArtifactSelector();
        const [summaries, matrix, messageRows, toolRows, sessions, databaseBytes] = await Promise.all([
            sourceSummary(db, selector),
            dailyTokenMatrix(db, 90),
            messageRollup(db, selector),
            toolRollup(db, selector),
            bySession(db, selector, 1_000_000),
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
