import type {
    HistoryFilter,
    HistoryInsightsResponse,
    HistoryKpiTrendPoint,
    HistorySessionsInput,
    HistorySessionsResponse,
    HistorySourcesResponse,
    HistorySummaryResponse,
    HistoryTimelineInput,
    HistoryTimelineResponse,
    HistoryToolCallItem,
    HistoryToolCategory,
    HistoryToolSequenceInput,
    HistoryToolSequenceResponse,
    HistoryTriggerImportResponse,
} from '@gobing-ai/spur-contracts';

/**
 * Service interface for History Board API queries.
 */
export interface HistoryBoardService {
    getSummary(filter?: HistoryFilter): Promise<HistorySummaryResponse['data']>;
    getTimeline(input: HistoryTimelineInput): Promise<HistoryTimelineResponse['data']>;
    getToolSequence(input: HistoryToolSequenceInput): Promise<HistoryToolSequenceResponse['data']>;
    getSessions(input: HistorySessionsInput): Promise<HistorySessionsResponse['data']>;
    getInsights(filter?: HistoryFilter): Promise<HistoryInsightsResponse['data']>;
    getSources(): Promise<HistorySourcesResponse['data']>;
    triggerImport(mode: 'full' | 'incremental'): Promise<HistoryTriggerImportResponse['data']>;
}

interface RawMockSession {
    id: string;
    source: string;
    model: string;
    modelDetail?: string;
    start: number;
    durationMs: number;
    messages: number;
    toolCalls: number;
    errors: number;
    tokens: {
        billedTokens: number;
        cacheSavedTokens: number;
        cacheReadTokens: number;
        freshInputTokens: number;
        outputTokens: number;
    };
    toolMix: Record<string, number>;
    skillMix: Record<string, number>;
    state: string;
}

const SOURCES_CATALOG = [
    {
        id: 'claude',
        name: 'Claude Code',
        color: '#3987e5',
        w: 30,
        path: '~/.claude/projects/',
        pattern: '*.jsonl, state.json',
        files: 1428,
        size: 18.4,
    },
    {
        id: 'codex',
        name: 'Codex',
        color: '#d95926',
        w: 18,
        path: '~/.codex/sessions/',
        pattern: 'rollout-*.jsonl',
        files: 842,
        size: 9.8,
    },
    {
        id: 'agy',
        name: 'Antigravity CLI',
        color: '#c98500',
        w: 14,
        path: '~/.gemini/antigravity-cli/brain/',
        pattern: 'transcript.jsonl',
        files: 614,
        size: 6.2,
    },
    {
        id: 'omp',
        name: 'OMP',
        color: '#10b981',
        w: 10,
        path: '~/.omp/sessions/',
        pattern: 'session-*.jsonl',
        files: 430,
        size: 4.8,
    },
    {
        id: 'openclaw',
        name: 'OpenClaw',
        color: '#ec4899',
        w: 8,
        path: '~/.openclaw/history/',
        pattern: 'claw-*.jsonl',
        files: 360,
        size: 3.9,
    },
    {
        id: 'hermes',
        name: 'Hermes',
        color: '#8b5cf6',
        w: 8,
        path: '~/.hermes/runs/',
        pattern: 'hermes-run-*.jsonl',
        files: 310,
        size: 3.2,
    },
    {
        id: 'grok',
        name: 'Grok Build',
        color: '#d55181',
        w: 5,
        path: '~/.grok/runs/',
        pattern: 'run-*.jsonl',
        files: 280,
        size: 2.7,
    },
    {
        id: 'opencode',
        name: 'OpenCode',
        color: '#008300',
        w: 4,
        path: '~/.opencode/history/',
        pattern: '*.jsonl',
        files: 220,
        size: 2.1,
    },
    {
        id: 'pi',
        name: 'Pi',
        color: '#9085e9',
        w: 3,
        path: '~/.pi/logs/',
        pattern: 'pi-session-*.jsonl',
        files: 186,
        size: 1.9,
    },
];

const MODELS_CATALOG = [
    { id: 'claude-opus-4.6', label: 'claude-opus-4.6', color: '#3987e5', speed: 1200, err: 0.006 },
    { id: 'claude-sonnet-4.6', label: 'claude-sonnet-4.6', color: '#199e70', speed: 850, err: 0.009 },
    { id: 'gpt-5.6-sol', label: 'gpt-5.6-sol', color: '#9085e9', speed: 950, err: 0.011 },
    { id: 'grok-4.6', label: 'grok-4.6', color: '#d95926', speed: 650, err: 0.017 },
    { id: 'other', label: 'Other models', color: '#898781', speed: 700, err: 0.021 },
];

const TOOLS_CATALOG = [
    { id: 'Read', kind: 'read' as const, color: '#199e70', baseMs: 400 },
    { id: 'Bash', kind: 'bash' as const, color: '#3987e5', baseMs: 3200 },
    { id: 'Edit', kind: 'write' as const, color: '#d95926', baseMs: 1400 },
    { id: 'Grep', kind: 'search' as const, color: '#9085e9', baseMs: 600 },
    { id: 'Write', kind: 'write' as const, color: '#d95926', baseMs: 1100 },
    { id: 'Glob', kind: 'search' as const, color: '#9085e9', baseMs: 250 },
    { id: 'Task', kind: 'bash' as const, color: '#3987e5', baseMs: 28000 },
    { id: 'WebSearch', kind: 'search' as const, color: '#9085e9', baseMs: 4500 },
];

const SKILLS_CATALOG = [
    { id: 'sp-spur-cli', label: 'Sp Spur Cli', color: '#3987e5' },
    { id: 'sp-dev-verify', label: 'Sp Dev Verify', color: '#d95926' },
    { id: 'sp-dev-run', label: 'Sp Dev Run', color: '#199e70' },
    { id: 'sp-code-verification', label: 'Sp Code Verification', color: '#c98500' },
];

function generateDeterministicSessions(): RawMockSession[] {
    const sessions: RawMockSession[] = [];
    const baseDate = new Date('2026-08-21T20:00:00.000Z').getTime();
    const DAY_MS = 86400000;

    let seed = 42;
    function nextRnd(): number {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    }

    // Generate ~120 synthetic sessions spread across the last 90 days
    for (let i = 0; i < 120; i++) {
        const daysAgo = Math.floor(nextRnd() * 88);
        const dayOffset = daysAgo * DAY_MS;
        const timeOfDay = Math.floor(nextRnd() * DAY_MS);
        const start = baseDate - dayOffset + (timeOfDay - DAY_MS / 2);

        const srcIdx = Math.floor(nextRnd() * SOURCES_CATALOG.length);
        const modelIdx = Math.floor(nextRnd() * MODELS_CATALOG.length);
        const defaultSrc = SOURCES_CATALOG[0] ?? {
            id: 'claude',
            name: 'Claude Code',
            color: '#3987e5',
            w: 30,
            path: '~/.claude/projects/',
            pattern: '*.jsonl, state.json',
            files: 1428,
            size: 18.4,
        };
        const defaultModel = MODELS_CATALOG[0] ?? {
            id: 'claude-opus-4.6',
            label: 'claude-opus-4.6',
            color: '#3987e5',
            speed: 1200,
            err: 0.006,
        };
        const src = SOURCES_CATALOG[srcIdx] ?? defaultSrc;
        const model = MODELS_CATALOG[modelIdx] ?? defaultModel;

        const durationMin = 5 + Math.floor(nextRnd() * 45);
        const durationMs = durationMin * 60000;
        const toolCalls = 4 + Math.floor(nextRnd() * 30);
        const messages = 2 + Math.floor(nextRnd() * 8);

        const cacheReadTokens = toolCalls * (15000 + Math.floor(nextRnd() * 80000));
        const freshInputTokens = toolCalls * (800 + Math.floor(nextRnd() * 4000));
        const outputTokens = toolCalls * (200 + Math.floor(nextRnd() * 1200));
        const billedTokens = freshInputTokens + outputTokens;
        const cacheSavedTokens = cacheReadTokens;

        const toolMix: Record<string, number> = {};
        for (const t of TOOLS_CATALOG) {
            if (nextRnd() > 0.4) {
                toolMix[t.id] = 1 + Math.floor(nextRnd() * (toolCalls / 2));
            }
        }
        if (Object.keys(toolMix).length === 0) toolMix.Read = toolCalls;

        const skillMix: Record<string, number> = {};
        for (const s of SKILLS_CATALOG) {
            if (nextRnd() > 0.5) {
                skillMix[s.id] = 1 + Math.floor(nextRnd() * 4);
            }
        }

        const errCount = Math.floor(nextRnd() * 2);

        sessions.push({
            id: `sess-${String(i + 1).padStart(4, '0')}-${src.id}`,
            source: src.id,
            model: model.id,
            modelDetail: model.id === 'other' ? 'claude-haiku-4.5' : model.id,
            start,
            durationMs,
            messages,
            toolCalls,
            errors: errCount,
            tokens: {
                billedTokens,
                cacheSavedTokens,
                cacheReadTokens,
                freshInputTokens,
                outputTokens,
            },
            toolMix,
            skillMix,
            state: errCount > 0 ? 'error' : 'complete',
        });
    }

    return sessions.sort((a, b) => b.start - a.start);
}

/**
 * Mock implementation of HistoryBoardService for testing and initial UI development.
 */
export class MockHistoryBoardService implements HistoryBoardService {
    private readonly sessions: RawMockSession[];

    constructor(initialSessions?: RawMockSession[]) {
        this.sessions = initialSessions ?? generateDeterministicSessions();
    }

    private filterSessions(filter?: HistoryFilter): RawMockSession[] {
        if (!filter) return this.sessions;

        const now = new Date('2026-08-21T20:00:00.000Z').getTime();
        let minTime = 0;
        let maxTime = Number.POSITIVE_INFINITY;

        if (filter.range === '1h') {
            minTime = now - 1 * 3600 * 1000;
        } else if (filter.range === '4h') {
            minTime = now - 4 * 3600 * 1000;
        } else if (filter.range === '24h') {
            minTime = now - 24 * 3600 * 1000;
        } else if (filter.range === '7d') {
            minTime = now - 7 * 86400 * 1000;
        } else if (filter.range === '30d') {
            minTime = now - 30 * 86400 * 1000;
        } else if (filter.range === 'custom') {
            if (filter.from) minTime = new Date(filter.from).getTime();
            if (filter.to) maxTime = new Date(filter.to).getTime();
        }

        return this.sessions.filter((s) => {
            if (s.start < minTime || s.start > maxTime) return false;
            if (filter.sources && filter.sources.length > 0 && !filter.sources.includes(s.source)) return false;
            if (filter.models && filter.models.length > 0 && !filter.models.includes(s.model)) return false;
            if (filter.tools && filter.tools.length > 0) {
                const hasTool = filter.tools.some((t: string) => (s.toolMix[t] ?? 0) > 0);
                if (!hasTool) return false;
            }
            if (filter.skills && filter.skills.length > 0) {
                const hasSkill = filter.skills.some((sk: string) => (s.skillMix[sk] ?? 0) > 0);
                if (!hasSkill) return false;
            }
            return true;
        });
    }

    async getSummary(filter?: HistoryFilter): Promise<HistorySummaryResponse['data']> {
        const matching = this.filterSessions(filter);

        let totalBilled = 0;
        let totalCacheSaved = 0;
        let totalCacheRead = 0;
        let totalTools = 0;
        let totalErrors = 0;

        const modelTokens: Record<string, number> = {};
        const sourceTokens: Record<string, number> = {};
        const toolCounts: Record<string, { count: number; errors: number }> = {};
        const skillCounts: Record<string, number> = {};

        for (const s of matching) {
            totalBilled += s.tokens.billedTokens;
            totalCacheSaved += s.tokens.cacheSavedTokens;
            totalCacheRead += s.tokens.cacheReadTokens;
            totalTools += s.toolCalls;
            totalErrors += s.errors;

            modelTokens[s.model] = (modelTokens[s.model] ?? 0) + s.tokens.billedTokens;
            sourceTokens[s.source] = (sourceTokens[s.source] ?? 0) + s.tokens.billedTokens;

            for (const [tool, count] of Object.entries(s.toolMix)) {
                if (!toolCounts[tool]) toolCounts[tool] = { count: 0, errors: 0 };
                toolCounts[tool].count += count;
                if (s.errors > 0) toolCounts[tool].errors += Math.min(count, s.errors);
            }

            for (const [skill, count] of Object.entries(s.skillMix)) {
                skillCounts[skill] = (skillCounts[skill] ?? 0) + count;
            }
        }

        const totalTokensWithCache = totalBilled + totalCacheSaved;
        const cacheSavedPercent =
            totalTokensWithCache > 0 ? Math.round((totalCacheSaved / totalTokensWithCache) * 100) : 0;
        const errorRate = totalTools > 0 ? Math.round((totalErrors / totalTools) * 1000) / 10 : 0;

        // Build time series buckets
        const bucket =
            filter?.bucket === 'auto' || filter?.bucket === undefined
                ? filter?.range === '1h'
                    ? '1m'
                    : filter?.range === '4h'
                      ? '3m'
                      : filter?.range === '24h'
                        ? '10m'
                        : filter?.range === '7d'
                          ? '30m'
                          : '1d'
                : filter.bucket;
        const bucketInterval = {
            '1m': 1 * 60_000,
            '3m': 3 * 60_000,
            '5m': 5 * 60_000,
            '10m': 10 * 60_000,
            '30m': 30 * 60_000,
            '1h': 60 * 60_000,
            '4h': 4 * 60 * 60_000,
            '1d': 86_400_000,
        }[bucket];
        const dimension = filter?.dimension ?? 'model';
        const buckets: Record<string, { total: number; cacheRead: number; series: Record<string, number> }> = {};
        const modelBuckets: Record<string, { total: number; cacheRead: number; series: Record<string, number> }> = {};
        const sourceBuckets: Record<string, { total: number; cacheRead: number; series: Record<string, number> }> = {};
        const toolBuckets: Record<string, { total: number; cacheRead: number; series: Record<string, number> }> = {};
        const skillBuckets: typeof buckets = {};

        for (const s of matching) {
            const bKey = new Date(Math.floor(s.start / bucketInterval) * bucketInterval).toISOString();
            if (!buckets[bKey]) buckets[bKey] = { total: 0, cacheRead: 0, series: {} };
            if (!modelBuckets[bKey]) modelBuckets[bKey] = { total: 0, cacheRead: 0, series: {} };
            if (!sourceBuckets[bKey]) sourceBuckets[bKey] = { total: 0, cacheRead: 0, series: {} };
            if (!toolBuckets[bKey]) toolBuckets[bKey] = { total: 0, cacheRead: 0, series: {} };
            if (!skillBuckets[bKey]) skillBuckets[bKey] = { total: 0, cacheRead: 0, series: {} };

            buckets[bKey].total += s.tokens.billedTokens;
            buckets[bKey].cacheRead += s.tokens.cacheReadTokens;
            modelBuckets[bKey].total += s.tokens.billedTokens;
            modelBuckets[bKey].cacheRead += s.tokens.cacheReadTokens;
            sourceBuckets[bKey].total += s.tokens.billedTokens;
            sourceBuckets[bKey].cacheRead += s.tokens.cacheReadTokens;
            toolBuckets[bKey].total += s.tokens.billedTokens;
            toolBuckets[bKey].cacheRead += s.tokens.cacheReadTokens;
            skillBuckets[bKey].total += s.tokens.billedTokens;
            skillBuckets[bKey].cacheRead += s.tokens.cacheReadTokens;

            modelBuckets[bKey].series[s.model] = (modelBuckets[bKey].series[s.model] ?? 0) + s.tokens.billedTokens;
            sourceBuckets[bKey].series[s.source] = (sourceBuckets[bKey].series[s.source] ?? 0) + s.tokens.billedTokens;

            const toolWeight = Object.values(s.toolMix).reduce((sum, count) => sum + count, 0);
            for (const [tool, count] of Object.entries(s.toolMix)) {
                toolBuckets[bKey].series[tool] =
                    (toolBuckets[bKey].series[tool] ?? 0) +
                    (toolWeight > 0 ? (s.tokens.billedTokens * count) / toolWeight : 0);
            }

            const skillWeight = Object.values(s.skillMix).reduce((sum, count) => sum + count, 0);
            for (const [skill, count] of Object.entries(s.skillMix)) {
                skillBuckets[bKey].series[skill] =
                    (skillBuckets[bKey].series[skill] ?? 0) +
                    (skillWeight > 0 ? (s.tokens.billedTokens * count) / skillWeight : 0);
            }

            const dimensions: Array<[string, number]> =
                dimension === 'model'
                    ? [[s.model, s.tokens.billedTokens]]
                    : dimension === 'source'
                      ? [[s.source, s.tokens.billedTokens]]
                      : Object.entries(dimension === 'tool' ? s.toolMix : s.skillMix).map(([key, count]) => [
                            key,
                            count,
                        ]);
            const weight = dimensions.reduce((sum, [, count]) => sum + count, 0);
            for (const [key, count] of dimensions) {
                const tokens =
                    dimension === 'model' || dimension === 'source'
                        ? count
                        : weight > 0
                          ? (s.tokens.billedTokens * count) / weight
                          : 0;
                buckets[bKey].series[key] = (buckets[bKey].series[key] ?? 0) + tokens;
            }
        }

        const toTimeSeries = (map: typeof buckets) =>
            Object.entries(map)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([bKey, bVal]) => {
                    const denom = bVal.total + bVal.cacheRead;
                    const ratio = denom > 0 ? Math.round((bVal.cacheRead / denom) * 100) : 0;
                    return {
                        bucketStart: bKey,
                        cacheHitRatio: ratio,
                        series: bVal.series,
                    };
                });

        const timeSeries = toTimeSeries(buckets);
        const modelTimeSeries = toTimeSeries(modelBuckets);
        const sourceTimeSeries = toTimeSeries(sourceBuckets);
        const toolTimeSeries = toTimeSeries(toolBuckets);
        const skillTimeSeries = toTimeSeries(skillBuckets);

        const topModels = MODELS_CATALOG.map((m) => {
            const tokens = modelTokens[m.id] ?? 0;
            const share = totalBilled > 0 ? Math.round((tokens / totalBilled) * 100) : 0;
            return { id: m.id, label: m.label, color: m.color, tokens, share };
        }).sort((a, b) => b.tokens - a.tokens);

        const topSources = SOURCES_CATALOG.map((s) => {
            const tokens = sourceTokens[s.id] ?? 0;
            const share = totalBilled > 0 ? Math.round((tokens / totalBilled) * 100) : 0;
            return { id: s.id, label: s.name, color: s.color, tokens, share };
        }).sort((a, b) => b.tokens - a.tokens);

        const topTools = Object.entries(toolCounts)
            .map(([id, stats]) => ({
                id: id && id.trim() !== '' ? id.trim() : 'unknown',
                count: stats.count,
                errors: stats.errors,
                errorRate: stats.count > 0 ? Math.round((stats.errors / stats.count) * 1000) / 10 : 0,
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 15);

        const skillsUsed = SKILLS_CATALOG.map((sk) => ({
            id: sk.id,
            label: sk.label,
            color: sk.color,
            count: skillCounts[sk.id] ?? 0,
        })).sort((a, b) => b.count - a.count);

        const hitRatio = totalTokensWithCache > 0 ? Math.round((totalCacheRead / totalTokensWithCache) * 100) : 0;

        const sourceCacheMap: Record<string, { saved: number; fresh: number; billed: number }> = {};
        for (const s of matching) {
            const entry = sourceCacheMap[s.source] ?? { saved: 0, fresh: 0, billed: 0 };
            entry.saved += s.tokens.cacheReadTokens;
            entry.fresh += s.tokens.freshInputTokens;
            entry.billed += s.tokens.billedTokens;
            sourceCacheMap[s.source] = entry;
        }
        const cacheBySource = SOURCES_CATALOG.map((s) => {
            const stats = sourceCacheMap[s.id] ?? { saved: 0, fresh: 0, billed: 0 };
            const totalRead = stats.saved + stats.fresh;
            const sourceHitRatio = totalRead > 0 ? Math.round((stats.saved / totalRead) * 100) : 0;
            return {
                source: s.id,
                sourceName: s.name,
                color: s.color,
                hitRatio: sourceHitRatio,
                savedTokens: stats.saved,
                freshTokens: stats.fresh,
                totalRead,
                billedTokens: stats.billed,
            };
        }).filter((item) => item.totalRead > 0 || item.billedTokens > 0);

        return {
            kpis: {
                totalBilledTokens: totalBilled,
                cacheSavedTokens: totalCacheSaved,
                cacheSavedPercent,
                sessionsCount: matching.length,
                toolCallsCount: totalTools,
                errorRate,
            },
            timeSeries,
            topModels,
            topSources,
            topTools,
            skillsUsed,
            cacheEfficiency: {
                hitRatio,
                savedTokens: totalCacheSaved,
                totalRead: totalCacheRead + matching.reduce((sum, session) => sum + session.tokens.freshInputTokens, 0),
                bySource: cacheBySource,
            },
            kpiTrend: this.buildKpiTrend(matching),
            previousKpis: null,
            skillTimeSeries,
            modelTimeSeries,
            sourceTimeSeries,
            toolTimeSeries,
        };
    }

    private buildKpiTrend(
        sessions: Array<{
            id: string;
            start: number;
            tokens: { billedTokens: number; cacheReadTokens: number };
            toolCalls: number;
        }>,
    ): HistoryKpiTrendPoint[] {
        const end = new Date();
        end.setUTCHours(0, 0, 0, 0);
        const byDay = new Map<
            string,
            { billed: number; cacheRead: number; sessions: Set<string>; toolCalls: number }
        >();
        for (const s of sessions) {
            const day = new Date(s.start).toISOString().slice(0, 10);
            const entry = byDay.get(day) ?? { billed: 0, cacheRead: 0, sessions: new Set<string>(), toolCalls: 0 };
            entry.billed += s.tokens.billedTokens;
            entry.cacheRead += s.tokens.cacheReadTokens;
            entry.sessions.add(s.id);
            entry.toolCalls += s.toolCalls;
            byDay.set(day, entry);
        }
        const points: HistoryKpiTrendPoint[] = [];
        for (let i = 29; i >= 0; i--) {
            const day = new Date(end.getTime() - i * 86_400_000).toISOString().slice(0, 10);
            const entry = byDay.get(day);
            const billed = entry?.billed ?? 0;
            const cacheRead = entry?.cacheRead ?? 0;
            points.push({
                day,
                totalBilledTokens: billed,
                cacheSavedTokens: cacheRead,
                sessionsCount: entry?.sessions.size ?? 0,
                toolCallsCount: entry?.toolCalls ?? 0,
                cacheHitRatio: billed + cacheRead > 0 ? Math.round((cacheRead / (billed + cacheRead)) * 100) : 0,
            });
        }
        return points;
    }

    async getTimeline(input: HistoryTimelineInput): Promise<HistoryTimelineResponse['data']> {
        if (input.mode === 'session') {
            const session = this.sessions.find((s) => s.id === input.sessionId);
            if (!session) throw new Error(`History session not found: ${input.sessionId}`);
            const sessionStart = session.start;

            const blocks = [
                {
                    key: `${session.source}:::${session.id}:::0`,
                    sessionId: session.id,
                    turnIndex: 0,
                    timestamp: new Date(sessionStart).toISOString(),
                    source: session.source,
                    model: session.model,
                    correlationExactness: null,
                    totalDurationMs: 4200,
                    totalTokens: 18500,
                    operationCount: 3,
                    events: [
                        {
                            seq: 1,
                            eventType: 'message' as const,
                            kind: 'user' as const,
                            title: 'user turn',
                            toolName: null,
                            durationMs: null,
                            durationSource: 'unmeasured' as const,
                            tokens: 450,
                            freshInputTokens: 450,
                            cacheReadTokens: 0,
                            outputTokens: 0,
                            promptTokens: {
                                billedTokens: 18050,
                                cacheSavedTokens: 16300,
                                cacheReadTokens: 16300,
                                freshInputTokens: 800,
                                outputTokens: 950,
                            },
                            exitCode: null,
                            payload: 'User prompt content',
                            agent: session.source,
                            model: session.model,
                        },
                        {
                            seq: 2,
                            eventType: 'tool' as const,
                            kind: 'search' as const,
                            title: 'src/**/*.ts',
                            toolName: 'Glob',
                            durationMs: 320,
                            durationSource: 'measured' as const,
                            tokens: 4200,
                            freshInputTokens: 200,
                            cacheReadTokens: 3800,
                            outputTokens: 200,
                            promptTokens: null,
                            exitCode: 0,
                            payload: 'Matched 48 files',
                            agent: session.source,
                            model: session.model,
                        },
                        {
                            seq: 3,
                            eventType: 'tool' as const,
                            kind: 'read' as const,
                            title: 'docs/03_ARCHITECTURE.md',
                            toolName: 'Read',
                            durationMs: 780,
                            durationSource: 'measured' as const,
                            tokens: 13850,
                            freshInputTokens: 600,
                            cacheReadTokens: 12500,
                            outputTokens: 750,
                            promptTokens: null,
                            exitCode: 0,
                            payload: '# Architecture\n\nSystem components and dataflow...',
                            agent: session.source,
                            model: session.model,
                        },
                    ],
                },
                {
                    key: `${session.source}:::${session.id}:::1`,
                    sessionId: session.id,
                    turnIndex: 1,
                    timestamp: new Date(sessionStart + 60000).toISOString(),
                    source: session.source,
                    model: session.model,
                    correlationExactness: null,
                    totalDurationMs: 8900,
                    totalTokens: 32400,
                    operationCount: 2,
                    events: [
                        {
                            seq: 4,
                            eventType: 'tool' as const,
                            kind: 'bash' as const,
                            title: 'bun run test',
                            toolName: 'Bash',
                            durationMs: 6400,
                            durationSource: 'measured' as const,
                            tokens: 18200,
                            freshInputTokens: 800,
                            cacheReadTokens: 16500,
                            outputTokens: 900,
                            promptTokens: null,
                            exitCode: 0,
                            payload: 'All 64 tests passed',
                            agent: session.source,
                            model: session.model,
                        },
                        {
                            seq: 5,
                            eventType: 'tool' as const,
                            kind: 'write' as const,
                            title: 'packages/contracts/src/history.ts',
                            toolName: 'Edit',
                            durationMs: 2500,
                            durationSource: 'measured' as const,
                            tokens: 14200,
                            freshInputTokens: 400,
                            cacheReadTokens: 13000,
                            outputTokens: 800,
                            promptTokens: null,
                            exitCode: 0,
                            payload: 'Replaced 42 lines',
                            agent: session.source,
                            model: session.model,
                        },
                    ],
                },
            ];

            return {
                mode: 'session',
                scope: {
                    sessionId: session.id,
                    source: session.source,
                    model: session.model,
                    start: new Date(session.start).toISOString(),
                    end: new Date(session.start + session.durationMs).toISOString(),
                    durationMs: session.durationMs,
                    tokens: session.tokens,
                    messageCount: session.messages,
                    toolCallCount: session.toolCalls,
                    sessionCount: 1,
                },
                truncated: false,
                blocks,
            };
        }

        return {
            mode: 'consolidated',
            scope: {
                sessionId: null,
                source: null,
                model: null,
                start: this.sessions[0] ? new Date(this.sessions[0].start).toISOString() : null,
                end:
                    this.sessions.length > 0 && this.sessions[this.sessions.length - 1]
                        ? new Date(this.sessions[this.sessions.length - 1]?.start ?? '').toISOString()
                        : null,
                durationMs: this.sessions.reduce((s, x) => s + x.durationMs, 0),
                tokens: {
                    billedTokens: this.sessions.reduce((s, x) => s + x.tokens.billedTokens, 0),
                    cacheSavedTokens: this.sessions.reduce((s, x) => s + x.tokens.cacheSavedTokens, 0),
                    cacheReadTokens: this.sessions.reduce((s, x) => s + x.tokens.cacheReadTokens, 0),
                    freshInputTokens: this.sessions.reduce((s, x) => s + x.tokens.freshInputTokens, 0),
                    outputTokens: this.sessions.reduce((s, x) => s + x.tokens.outputTokens, 0),
                },
                messageCount: this.sessions.reduce((s, x) => s + x.messages, 0),
                toolCallCount: this.sessions.reduce((s, x) => s + x.toolCalls, 0),
                sessionCount: this.sessions.length,
            },
            truncated: false,
            blocks: [],
        };
    }

    async getSessions(input: HistorySessionsInput): Promise<HistorySessionsResponse['data']> {
        const matching = this.filterSessions(input.filter);

        const sorted = [...matching].sort((a, b) => {
            let diff = 0;
            switch (input.sortBy) {
                case 'start':
                    diff = a.start - b.start;
                    break;
                case 'duration':
                    diff = a.durationMs - b.durationMs;
                    break;
                case 'messages':
                    diff = a.messages - b.messages;
                    break;
                case 'toolCalls':
                    diff = a.toolCalls - b.toolCalls;
                    break;
                case 'billedTokens':
                    diff = a.tokens.billedTokens - b.tokens.billedTokens;
                    break;
                case 'cacheRead':
                    diff = a.tokens.cacheReadTokens - b.tokens.cacheReadTokens;
                    break;
                case 'freshInput':
                    diff = a.tokens.freshInputTokens - b.tokens.freshInputTokens;
                    break;
                default:
                    diff = a.start - b.start;
            }
            return input.sortDir === 'asc' ? diff : -diff;
        });

        const page = input.page || 1;
        const pageSize = input.pageSize || 20;
        const startIdx = (page - 1) * pageSize;
        const paged = sorted.slice(startIdx, startIdx + pageSize);

        const items = paged.map((s) => {
            const topTool = Object.entries(s.toolMix).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'Read';
            return {
                id: s.id,
                source: s.source,
                model: s.model,
                modelDetail: s.modelDetail,
                start: new Date(s.start).toISOString(),
                durationMs: s.durationMs,
                messages: s.messages,
                toolCalls: s.toolCalls,
                billedTokens: s.tokens.billedTokens,
                cacheReadTokens: s.tokens.cacheReadTokens,
                freshInputTokens: s.tokens.freshInputTokens,
                outputTokens: s.tokens.outputTokens,
                topTool,
                state: s.state,
            };
        });

        return {
            items,
            total: matching.length,
            page,
            pageSize,
        };
    }

    async getInsights(filter?: HistoryFilter): Promise<HistoryInsightsResponse['data']> {
        const matching = this.filterSessions(filter);
        const s0 = matching[0];
        if (!s0) {
            return {
                loops: [],
                cacheWaste: [],
                heavySessions: [],
                largestTokenSteps: [],
                slowSteps: [],
                modelComparison: [],
            };
        }
        const s1 = matching[1] ?? s0;

        const loops = [
            {
                tool: 'Bash',
                argsHint: 'bun run typecheck (no source change)',
                sessionId: s0.id,
                repeats: 4,
                fromSeq: 12,
                toSeq: 24,
                wastedTokens: 84000,
            },
            {
                tool: 'Read',
                argsHint: 'docs/03_ARCHITECTURE.md (context re-read)',
                sessionId: s1.id,
                repeats: 3,
                fromSeq: 8,
                toSeq: 16,
                wastedTokens: 52000,
            },
        ];

        const cacheWaste = [
            {
                sessionId: s0.id,
                timestamp: new Date(Date.now() - 3600000).toISOString(),
                freshTokens: 42000,
                reason: 'Context compaction re-sent full AST',
            },
            {
                sessionId: s1.id,
                timestamp: new Date(Date.now() - 7200000).toISOString(),
                freshTokens: 28000,
                reason: 'Cache TTL expired mid-session',
            },
        ];

        const heavySessions = matching
            .slice()
            .sort((a, b) => b.tokens.billedTokens - a.tokens.billedTokens)
            .slice(0, 5)
            .map((s) => ({
                id: s.id,
                source: s.source,
                model: s.model,
                tokens: s.tokens.billedTokens,
                durationMs: s.durationMs,
            }));

        const largestTokenSteps = [
            {
                stepIndex: 8,
                sessionId: s0.id,
                toolName: 'Read',
                tokens: 48000,
                agent: s0.source,
                model: s0.model,
            },
            {
                stepIndex: 14,
                sessionId: s1.id,
                toolName: 'Bash',
                tokens: 34000,
                agent: s1.source,
                model: s1.model,
            },
        ];

        const slowSteps = [
            {
                stepIndex: 12,
                sessionId: s0.id,
                toolName: 'Task',
                durationMs: 45000,
                tokens: 28000,
                agent: s0.source,
                model: s0.model,
            },
            {
                stepIndex: 19,
                sessionId: s1.id,
                toolName: 'Bash',
                durationMs: 18500,
                tokens: 12000,
                agent: s1.source,
                model: s1.model,
            },
        ];

        const modelComparison = MODELS_CATALOG.map((m) => ({
            model: m.id,
            speedMsMean: m.speed,
            cacheRatio: 0.82,
            reliability: 1 - m.err,
            outputRatio: 0.15,
        }));

        return {
            loops,
            cacheWaste,
            heavySessions,
            largestTokenSteps,
            slowSteps,
            modelComparison,
        };
    }

    async getSources(): Promise<HistorySourcesResponse['data']> {
        const baseDate = new Date('2026-08-21T20:00:00.000Z').getTime();
        const DAY_MS = 86400000;

        const agents = SOURCES_CATALOG.map((src) => {
            const srcSessions = this.sessions.filter((s) => s.source === src.id);
            const totalTokens = srcSessions.reduce((acc, s) => acc + s.tokens.billedTokens, 0);
            const cacheSavedTokens = srcSessions.reduce((acc, s) => acc + s.tokens.cacheSavedTokens, 0);
            const freshTokens = srcSessions.reduce((acc, s) => acc + s.tokens.freshInputTokens, 0);
            const toolCalls = srcSessions.reduce((acc, s) => acc + s.toolCalls, 0);

            const heatmapDays: Array<{ date: string; tokens: number; sessions: number }> = [];
            for (let d = 89; d >= 0; d--) {
                const dayTs = baseDate - d * DAY_MS;
                const dKey = new Date(dayTs).toISOString().slice(0, 10);
                const daySessions = srcSessions.filter((s) => new Date(s.start).toISOString().slice(0, 10) === dKey);
                const dayTokens = daySessions.reduce((acc, s) => acc + s.tokens.billedTokens, 0);
                heatmapDays.push({
                    date: dKey,
                    tokens: dayTokens,
                    sessions: daySessions.length,
                });
            }

            const maxDailyTokens = Math.max(0, ...heatmapDays.map((h) => h.tokens));
            const hasData = srcSessions.length > 0;

            return {
                id: src.id,
                name: src.name,
                color: src.color,
                importPath: src.path,
                filePattern: src.pattern,
                filesCount: hasData ? src.files : 0,
                sizeMb: hasData ? src.size : 0,
                sessionCount: srcSessions.length,
                totalTokens,
                cacheSavedTokens,
                freshTokens,
                toolCalls,
                firstDate:
                    srcSessions.length > 0
                        ? new Date(Math.min(...srcSessions.map((s) => s.start))).toISOString()
                        : null,
                lastDate:
                    srcSessions.length > 0
                        ? new Date(Math.max(...srcSessions.map((s) => s.start))).toISOString()
                        : null,
                heatmapDays,
                maxDailyTokens,
            };
        });

        const totalFiles = agents.reduce((sum, agent) => sum + agent.filesCount, 0);
        const corpusSizeBytes = Math.round(agents.reduce((sum, agent) => sum + (agent.sizeMb ?? 0), 0) * 1024 * 1024);

        const roots = SOURCES_CATALOG.map((source) => {
            const files = agents.find((agent) => agent.id === source.id)?.filesCount ?? 0;
            return {
                agentId: source.id,
                agentName: source.name,
                path: source.path,
                matchPattern: source.pattern,
                fileCount: files,
                status: files > 0 ? ('active' as const) : ('empty' as const),
            };
        });
        const starts = this.sessions.map((session) => session.start);

        return {
            overview: {
                totalFiles,
                corpusSizeBytes,
                dateCoverage: {
                    from: starts.length > 0 ? new Date(Math.min(...starts)).toISOString() : null,
                    to: starts.length > 0 ? new Date(Math.max(...starts)).toISOString() : null,
                },
                totalSessions: this.sessions.length,
                lastImportedAt: starts.length > 0 ? new Date(Math.max(...starts)).toISOString() : null,
            },
            agents,
            roots,
        };
    }

    async triggerImport(mode: 'full' | 'incremental'): Promise<HistoryTriggerImportResponse['data']> {
        return {
            runId: `run-${Date.now().toString(16)}`,
            status: 'queued',
            message: `Mock import completed in ${mode} mode: 9 sources checked, 0 new transcripts found.`,
        };
    }

    async getToolSequence(input: HistoryToolSequenceInput): Promise<HistoryToolSequenceResponse['data']> {
        const sessions =
            input.mode === 'session'
                ? this.sessions.filter((s) => s.id === input.sessionId)
                : this.filterSessions(input.filter);

        if (input.mode === 'session' && sessions.length === 0) {
            throw new Error(`History session not found: ${input.sessionId}`);
        }

        const rawItems: HistoryToolCallItem[] = [];
        let globalSeq = 1;

        const defaultMockTools = [
            { name: 'Glob', cat: 'search' as HistoryToolCategory, dur: 120, args: '{"pattern":"**/*.ts"}' },
            { name: 'Read', cat: 'read' as HistoryToolCategory, dur: 450, args: '{"file":"src/index.ts"}' },
            { name: 'Write', cat: 'write' as HistoryToolCategory, dur: 310, args: '{"file":"src/test.ts"}' },
            { name: 'RunCommand', cat: 'bash' as HistoryToolCategory, dur: 1200, args: '{"cmd":"bun test"}' },
            { name: 'mcp__context__search', cat: 'mcp' as HistoryToolCategory, dur: 280, args: '{"q":"history"}' },
        ];

        for (const session of sessions) {
            let toolSeq = 1;
            for (const [toolName, count] of Object.entries(session.toolMix)) {
                for (let i = 0; i < count; i++) {
                    const preset = defaultMockTools.find((t) => t.name === toolName) ?? {
                        name: toolName,
                        cat: 'other' as HistoryToolCategory,
                        dur: 250,
                        args: `{"action":"${toolName}"}`,
                    };
                    const isError = i === 0 && session.errors > 0;
                    rawItems.push({
                        seq: globalSeq++,
                        toolSeq: toolSeq++,
                        ts: new Date(session.start + toolSeq * 1000).toISOString(),
                        toolName: preset.name,
                        category: preset.cat,
                        status: isError ? 'error' : 'ok',
                        durationMs: preset.dur,
                        durationSource: 'measured',
                        resultBytes: 1024,
                        argsRaw: preset.args,
                        argsDigest: `args(${preset.name})`,
                        errorText: isError ? `Tool execution failed: ${toolName} error` : null,
                        callId: `call-${globalSeq}`,
                        messageHash: `hash-${session.id}-${toolSeq}`,
                        sessionId: session.id,
                        source: session.source,
                        model: session.model,
                        tokens: {
                            billedTokens: 500,
                            cacheSavedTokens: 400,
                            cacheReadTokens: 400,
                            freshInputTokens: 100,
                            outputTokens: 400,
                        },
                    });
                }
            }
        }

        // Filter
        let filtered = rawItems;
        if (input.toolNames && input.toolNames.length > 0) {
            const set = new Set(input.toolNames);
            filtered = filtered.filter((item) => set.has(item.toolName));
        }
        if (input.status && input.status !== 'all') {
            filtered = filtered.filter((item) => item.status === input.status);
        }
        if (input.search && input.search.trim().length > 0) {
            const q = input.search.trim().toLowerCase();
            filtered = filtered.filter(
                (item) =>
                    item.toolName.toLowerCase().includes(q) ||
                    (item.argsRaw?.toLowerCase().includes(q) ?? false) ||
                    (item.errorText?.toLowerCase().includes(q) ?? false),
            );
        }

        // Re-index sequence
        const items = filtered.map((item, idx) => ({ ...item, seq: idx + 1 }));

        let totalDurationMs = 0;
        let measuredCount = 0;
        let unmeasuredCount = 0;
        let errorCount = 0;
        const uniqueToolsSet = new Set<string>();
        const sessionsSet = new Set<string>();
        let billedTokensTotal = 0;
        let cacheSavedTokensTotal = 0;
        let cacheReadTokensTotal = 0;
        let freshInputTokensTotal = 0;
        let outputTokensTotal = 0;

        for (const item of items) {
            uniqueToolsSet.add(item.toolName);
            sessionsSet.add(item.sessionId);
            if (item.status === 'error') errorCount++;
            if (item.durationMs != null && item.durationMs > 0) {
                totalDurationMs += item.durationMs;
                measuredCount++;
            } else {
                unmeasuredCount++;
            }
            billedTokensTotal += item.tokens.billedTokens;
            cacheSavedTokensTotal += item.tokens.cacheSavedTokens;
            cacheReadTokensTotal += item.tokens.cacheReadTokens;
            freshInputTokensTotal += item.tokens.freshInputTokens;
            outputTokensTotal += item.tokens.outputTokens;
        }

        const totalCalls = items.length;
        const errorRate = totalCalls > 0 ? Math.round((errorCount / totalCalls) * 1000) / 1000 : 0;
        const meanDurationMs = measuredCount > 0 ? Math.round(totalDurationMs / measuredCount) : 0;

        return {
            mode: input.mode,
            scope: {
                sessionId: input.mode === 'session' ? input.sessionId : null,
                source: input.mode === 'session' ? input.source : null,
                model: sessions.length === 1 ? (sessions[0]?.model ?? null) : null,
                start: items.length > 0 ? (items[0]?.ts ?? null) : null,
                end: items.length > 0 ? (items[items.length - 1]?.ts ?? null) : null,
                totalCalls,
                uniqueTools: uniqueToolsSet.size,
                errorCount,
                errorRate,
                totalDurationMs,
                meanDurationMs,
                durationUnmeasured: unmeasuredCount,
                sessionCount: sessionsSet.size,
                tokens: {
                    billedTokens: billedTokensTotal,
                    cacheSavedTokens: cacheSavedTokensTotal,
                    cacheReadTokens: cacheReadTokensTotal,
                    freshInputTokens: freshInputTokensTotal,
                    outputTokens: outputTokensTotal,
                },
            },
            truncated: false,
            items,
        };
    }
}
