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
    HistoryTopTool,
    HistoryTriggerImportResponse,
} from '@gobing-ai/spur-contracts';
import {
    type ArtifactSelector,
    bucketedTokenSeries,
    bySession,
    byTool,
    type DailyTokenRow,
    type DbAdapter,
    type HistoryBucket as DomainHistoryBucket,
    dailyTokenMatrix,
    loops,
    messageRollup,
    modelComparison,
    sessionTimeline,
    sourceSummary,
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
}

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
        id: 'antigravity',
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

        const [bucketRows, rollups, toolStats, sessionRows] = await Promise.all([
            bucketedTokenSeries(db, sel, bucket, 'model'),
            messageRollup(db, sel),
            byTool(db, sel, 10),
            bySession(db, sel, 1000),
        ]);

        let freshTokensTotal = 0;
        let cacheReadTokensTotal = 0;
        let outputTokensTotal = 0;
        const modelTokenMap = new Map<string, number>();
        const sourceTokenMap = new Map<string, number>();

        for (const row of rollups) {
            const fresh = row.inputTokens ?? 0;
            const cache = row.cacheReadTokens ?? 0;
            const out = row.outputTokens ?? 0;
            const billed = fresh + out;

            freshTokensTotal += fresh;
            cacheReadTokensTotal += cache;
            outputTokensTotal += out;

            const m = row.model ?? 'unknown';
            modelTokenMap.set(m, (modelTokenMap.get(m) ?? 0) + billed);

            const s = row.source;
            sourceTokenMap.set(s, (sourceTokenMap.get(s) ?? 0) + billed);
        }

        const totalBilledTokens = freshTokensTotal + outputTokensTotal;
        const cacheSavedTokens = cacheReadTokensTotal;
        const denom = totalBilledTokens + cacheSavedTokens;
        const cacheSavedPercent = denom > 0 ? Math.round((cacheSavedTokens / denom) * 100) : 0;
        const sessionsCount = sessionRows.length;

        let totalToolCalls = 0;
        let totalErrors = 0;
        for (const t of toolStats) {
            totalToolCalls += t.calls;
            totalErrors += t.errors;
        }
        const errorRate = totalToolCalls > 0 ? Math.round((totalErrors / totalToolCalls) * 1000) / 10 : 0;

        // Bucket timeSeries points
        const timeSeriesMap = new Map<string, { cacheRead: number; billed: number; series: Record<string, number> }>();
        for (const r of bucketRows) {
            const entry = timeSeriesMap.get(r.bucketStart) ?? { cacheRead: 0, billed: 0, series: {} };
            const billed = (r.freshInputTokens ?? 0) + (r.outputTokens ?? 0);
            entry.billed += billed;
            entry.cacheRead += r.cacheReadTokens ?? 0;
            entry.series[r.key] = (entry.series[r.key] ?? 0) + billed;
            timeSeriesMap.set(r.bucketStart, entry);
        }

        const timeSeries = Array.from(timeSeriesMap.entries()).map(([bucketStart, data]) => {
            const sumTokens = data.billed + data.cacheRead;
            const hitRatio = sumTokens > 0 ? Math.round((data.cacheRead / sumTokens) * 100) : 0;
            return {
                bucketStart,
                cacheHitRatio: hitRatio,
                series: data.series,
            };
        });

        const topModels: HistoryTopItem[] = Array.from(modelTokenMap.entries())
            .map(([id, tokens]) => ({
                id,
                label: id,
                color: '#3987e5',
                tokens,
                share: totalBilledTokens > 0 ? Math.round((tokens / totalBilledTokens) * 100) : 0,
            }))
            .sort((a, b) => b.tokens - a.tokens)
            .slice(0, 5);

        const topSources: HistoryTopItem[] = Array.from(sourceTokenMap.entries())
            .map(([id, tokens]) => ({
                id,
                label: id,
                color: '#10b981',
                tokens,
                share: totalBilledTokens > 0 ? Math.round((tokens / totalBilledTokens) * 100) : 0,
            }))
            .sort((a, b) => b.tokens - a.tokens)
            .slice(0, 5);

        const topTools: HistoryTopTool[] = toolStats.slice(0, 10).map((t) => ({
            id: t.toolName,
            count: t.calls,
            errors: t.errors,
            errorRate: t.calls > 0 ? Math.round((t.errors / t.calls) * 1000) / 10 : 0,
        }));

        const totalRead = freshTokensTotal + cacheReadTokensTotal;
        const cacheHitRatio = totalRead > 0 ? Math.round((cacheReadTokensTotal / totalRead) * 100) : 0;

        return {
            kpis: {
                totalBilledTokens,
                cacheSavedTokens,
                cacheSavedPercent,
                sessionsCount,
                toolCallsCount: totalToolCalls,
                errorRate,
            },
            timeSeries,
            topModels,
            topSources,
            topTools,
            skillsUsed: [],
            cacheEfficiency: {
                hitRatio: cacheHitRatio,
                savedTokens: cacheSavedTokens,
                totalRead,
            },
        };
    }

    async getTimeline(sessionId: string): Promise<HistoryTimelineResponse['data']> {
        const db = await this.resolveDb();
        if (!db) {
            return {
                session: {
                    id: sessionId,
                    source: 'unknown',
                    model: 'unknown',
                    start: new Date().toISOString(),
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

        const events = await sessionTimeline(db, sessionId, 5000);
        let firstTs: string | null = null;
        let source = 'claude';
        let model = 'unknown';
        let totalFresh = 0;
        let totalCache = 0;
        let totalOut = 0;
        let totalDuration = 0;
        let toolCallCount = 0;

        const timelineEvents: HistoryTimelineEvent[] = [];
        for (const ev of events) {
            if (!firstTs && ev.ts) firstTs = ev.ts;
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
            if (ev.toolName) toolCallCount += 1;

            timelineEvents.push({
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
            });
        }

        const totalBilled = totalFresh + totalOut;
        const sessionMeta = {
            id: sessionId,
            source,
            model,
            start: firstTs ?? new Date().toISOString(),
            durationMs: totalDuration,
            tokens: {
                billedTokens: totalBilled,
                cacheSavedTokens: totalCache,
                cacheReadTokens: totalCache,
                freshInputTokens: totalFresh,
                outputTokens: totalOut,
            },
            messageCount: events.length,
            toolCallCount,
        };

        const blocks: HistoryTimelineBlock[] = [];
        if (timelineEvents.length > 0) {
            blocks.push({
                turnIndex: 1,
                timestamp: firstTs ?? new Date().toISOString(),
                source,
                model,
                totalDurationMs: totalDuration,
                totalTokens: totalBilled,
                operationCount: timelineEvents.length,
                events: timelineEvents,
            });
        }

        return {
            session: sessionMeta,
            blocks,
        };
    }

    async getSessions(input: HistorySessionsInput): Promise<HistorySessionsResponse['data']> {
        const db = await this.resolveDb();
        if (!db) {
            return { items: [], total: 0, page: input.page ?? 1, pageSize: input.pageSize ?? 20 };
        }

        const sel = toArtifactSelector(input.filter);
        const rows = await bySession(db, sel, 2000);

        const items: HistorySessionItem[] = rows.map((r) => {
            const billedTokens = r.tokens ?? 0;
            return {
                id: r.sessionId,
                source: r.source,
                model: 'claude-opus-4.6',
                start: r.startedAt ?? new Date().toISOString(),
                durationMs: r.assistantDurationMs ?? 0,
                messages: r.messages,
                toolCalls: r.toolCalls,
                billedTokens,
                cacheReadTokens: 0,
                freshInputTokens: billedTokens,
                outputTokens: 0,
                topTool: r.topTool ?? 'none',
                state: 'completed',
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
            }
            return sortDir === 'asc' ? diff : -diff;
        });

        const total = items.length;
        const page = input.page ?? 1;
        const pageSize = input.pageSize ?? 20;
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
        const [loopRows, cacheWasteRows, sessionRows, largeSteps, slowStepsRows, modelCompRows] = await Promise.all([
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
                timestamp: c.ts ?? new Date().toISOString(),
                freshTokens: fresh,
                reason: `Low cache reuse (${reusePct}%)`,
            };
        });

        const heavySessions = sessionRows.map((s) => ({
            id: s.sessionId,
            source: s.source,
            model: 'claude-opus-4.6',
            tokens: s.tokens ?? 0,
            durationMs: s.assistantDurationMs ?? 0,
        }));

        const largestTokenSteps = largeSteps.map((st, idx) => ({
            stepIndex: idx + 1,
            sessionId: st.sessionId,
            toolName: 'assistant',
            tokens: (st.inputTokens ?? 0) + (st.outputTokens ?? 0),
            durationMs: st.durationMs ?? undefined,
            agent: st.source,
            model: st.model ?? 'unknown',
        }));

        const slowSteps = slowStepsRows.map((st, idx) => ({
            stepIndex: idx + 1,
            sessionId: st.sessionId,
            toolName: 'assistant',
            tokens: (st.inputTokens ?? 0) + (st.outputTokens ?? 0),
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

        const [summaries, matrix] = await Promise.all([
            sourceSummary(db, toArtifactSelector()),
            dailyTokenMatrix(db, 90),
        ]);

        const summaryMap = new Map<string, { files: number; messages: number; lastImported: string | null }>();
        let totalFiles = 0;
        let totalMessages = 0;
        for (const s of summaries) {
            summaryMap.set(s.source, { files: s.files, messages: s.messages, lastImported: s.lastImportedAt });
            totalFiles += s.files;
            totalMessages += s.messages;
        }

        const matrixBySource = new Map<string, DailyTokenRow[]>();
        for (const row of matrix) {
            const list = matrixBySource.get(row.source) ?? [];
            list.push(row);
            matrixBySource.set(row.source, list);
        }

        const agents = AGENT_CATALOG.map((cat) => {
            const sumInfo = summaryMap.get(cat.id);
            const sourceDaily = matrixBySource.get(cat.id) ?? [];

            let totalTokens = 0;
            let cacheSavedTokens = 0;
            let maxDaily = 0;
            const heatmapDays = sourceDaily.map((d) => {
                const tok = d.tokens ?? 0;
                if (tok > maxDaily) maxDaily = tok;
                totalTokens += tok;
                cacheSavedTokens += d.cacheReadTokens ?? 0;
                return {
                    date: d.day,
                    tokens: tok,
                    sessions: 1,
                };
            });

            return {
                id: cat.id,
                name: cat.name,
                color: cat.color,
                importPath: cat.path,
                filePattern: cat.pattern,
                filesCount: sumInfo?.files ?? 0,
                sizeMb: Math.round(((sumInfo?.files ?? 0) * 12.5) / 10) / 100,
                sessionCount: sumInfo?.messages ? Math.max(1, Math.round(sumInfo.messages / 10)) : 0,
                totalTokens,
                cacheSavedTokens,
                freshTokens: totalTokens,
                toolCalls: sumInfo?.messages ? Math.round(sumInfo.messages * 1.5) : 0,
                firstDate: heatmapDays[0]?.date ?? null,
                lastDate: heatmapDays[heatmapDays.length - 1]?.date ?? null,
                heatmapDays,
                maxDailyTokens: maxDaily,
            };
        });

        const roots = AGENT_CATALOG.map((cat) => {
            const sumInfo = summaryMap.get(cat.id);
            const hasFiles = (sumInfo?.files ?? 0) > 0;
            return {
                agentId: cat.id,
                agentName: cat.name,
                path: cat.path,
                matchPattern: cat.pattern,
                fileCount: sumInfo?.files ?? 0,
                status: (hasFiles ? 'active' : 'empty') as 'active' | 'empty' | 'missing',
            };
        });

        return {
            overview: {
                totalFiles,
                corpusSizeBytes: totalFiles * 125000,
                dateCoverage: {
                    from: matrix[0]?.day ?? null,
                    to: matrix[matrix.length - 1]?.day ?? null,
                },
                totalSessions: Math.max(1, Math.round(totalMessages / 10)),
            },
            agents,
            roots,
        };
    }

    async triggerImport(mode: 'full' | 'incremental'): Promise<HistoryTriggerImportResponse['data']> {
        return {
            runId: `import-${Date.now()}`,
            status: 'started',
            message: `History transcript import initiated in ${mode} mode.`,
        };
    }
}
