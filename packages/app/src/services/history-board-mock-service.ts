import type {
    HistoryFilter,
    HistoryInsightsResponse,
    HistorySessionsInput,
    HistorySessionsResponse,
    HistorySourcesResponse,
    HistorySummaryResponse,
    HistoryTimelineResponse,
    HistoryTriggerImportResponse,
} from '@gobing-ai/spur-contracts';

/**
 * Service interface for History Board API queries.
 */
export interface HistoryBoardService {
    getSummary(filter?: HistoryFilter): Promise<HistorySummaryResponse['data']>;
    getTimeline(sessionId: string): Promise<HistoryTimelineResponse['data']>;
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

        if (filter.range === '24h') {
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
                ? filter?.range === '24h'
                    ? '10m'
                    : filter?.range === '7d'
                      ? '30m'
                      : '1d'
                : filter.bucket;
        const bucketInterval = {
            '5m': 5 * 60_000,
            '10m': 10 * 60_000,
            '30m': 30 * 60_000,
            '1h': 60 * 60_000,
            '4h': 4 * 60 * 60_000,
            '1d': 86_400_000,
        }[bucket];
        const dimension = filter?.dimension ?? 'model';
        const buckets: Record<string, { total: number; cacheRead: number; series: Record<string, number> }> = {};

        for (const s of matching) {
            const bKey = new Date(Math.floor(s.start / bucketInterval) * bucketInterval).toISOString();
            if (!buckets[bKey]) buckets[bKey] = { total: 0, cacheRead: 0, series: {} };
            buckets[bKey].total += s.tokens.billedTokens;
            buckets[bKey].cacheRead += s.tokens.cacheReadTokens;
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

        const timeSeries = Object.entries(buckets)
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
                id,
                count: stats.count,
                errors: stats.errors,
                errorRate: stats.count > 0 ? Math.round((stats.errors / stats.count) * 1000) / 10 : 0,
            }))
            .sort((a, b) => b.count - a.count);

        const skillsUsed = SKILLS_CATALOG.map((sk) => ({
            id: sk.id,
            label: sk.label,
            color: sk.color,
            count: skillCounts[sk.id] ?? 0,
        })).sort((a, b) => b.count - a.count);

        const hitRatio = totalTokensWithCache > 0 ? Math.round((totalCacheRead / totalTokensWithCache) * 100) : 0;

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
                totalRead: totalCacheRead,
            },
        };
    }

    async getTimeline(sessionId: string): Promise<HistoryTimelineResponse['data']> {
        const session = this.sessions.find((s) => s.id === sessionId);
        if (!session) throw new Error(`History session not found: ${sessionId}`);
        const sessionStart = session.start;

        const blocks = [
            {
                turnIndex: 0,
                timestamp: new Date(sessionStart).toISOString(),
                source: session.source,
                model: session.model,
                totalDurationMs: 4200,
                totalTokens: 18500,
                operationCount: 3,
                events: [
                    {
                        seq: 1,
                        kind: 'user' as const,
                        title: 'User Prompt: Analyze repository architecture and find performance bottlenecks',
                        durationMs: 0,
                        tokens: 450,
                        freshInputTokens: 450,
                        cacheReadTokens: 0,
                        outputTokens: 0,
                        exitCode: null,
                        payload: 'User prompt content',
                        agent: session.source,
                        model: session.model,
                    },
                    {
                        seq: 2,
                        kind: 'search' as const,
                        title: 'Glob: src/**/*.ts',
                        durationMs: 320,
                        tokens: 4200,
                        freshInputTokens: 200,
                        cacheReadTokens: 3800,
                        outputTokens: 200,
                        exitCode: 0,
                        payload: 'Matched 48 files',
                        agent: session.source,
                        model: session.model,
                    },
                    {
                        seq: 3,
                        kind: 'read' as const,
                        title: 'Read: docs/03_ARCHITECTURE.md',
                        durationMs: 780,
                        tokens: 13850,
                        freshInputTokens: 600,
                        cacheReadTokens: 12500,
                        outputTokens: 750,
                        exitCode: 0,
                        payload: '# Architecture\n\nSystem components and dataflow...',
                        agent: session.source,
                        model: session.model,
                    },
                ],
            },
            {
                turnIndex: 1,
                timestamp: new Date(sessionStart + 60000).toISOString(),
                source: session.source,
                model: session.model,
                totalDurationMs: 8900,
                totalTokens: 32400,
                operationCount: 2,
                events: [
                    {
                        seq: 4,
                        kind: 'bash' as const,
                        title: 'Bash: bun run test',
                        durationMs: 6400,
                        tokens: 18200,
                        freshInputTokens: 800,
                        cacheReadTokens: 16500,
                        outputTokens: 900,
                        exitCode: 0,
                        payload: 'All 64 tests passed',
                        agent: session.source,
                        model: session.model,
                    },
                    {
                        seq: 5,
                        kind: 'write' as const,
                        title: 'Edit: packages/contracts/src/history.ts',
                        durationMs: 2500,
                        tokens: 14200,
                        freshInputTokens: 400,
                        cacheReadTokens: 13000,
                        outputTokens: 800,
                        exitCode: 0,
                        payload: 'Replaced 42 lines',
                        agent: session.source,
                        model: session.model,
                    },
                ],
            },
        ];

        return {
            session: {
                id: session.id,
                source: session.source,
                model: session.model,
                modelDetail: session.modelDetail,
                start: new Date(session.start).toISOString(),
                durationMs: session.durationMs,
                tokens: session.tokens,
                messageCount: session.messages,
                toolCallCount: session.toolCalls,
            },
            blocks,
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
            },
            agents,
            roots,
        };
    }

    async triggerImport(mode: 'full' | 'incremental'): Promise<HistoryTriggerImportResponse['data']> {
        return {
            runId: `run-${Date.now().toString(16)}`,
            status: 'completed',
            message: `Mock import completed in ${mode} mode: 9 sources checked, 0 new transcripts found.`,
        };
    }
}
