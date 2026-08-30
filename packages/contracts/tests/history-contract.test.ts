import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    contract,
    historyContract,
    historyFilterSchema,
    historyInsightsResponseSchema,
    historySessionsInputSchema,
    historySessionsResponseSchema,
    historySourcesResponseSchema,
    historySummaryResponseSchema,
    historyTimelineInputSchema,
    historyTimelineResponseSchema,
    historyTokensSchema,
    historyTriggerImportInputSchema,
    historyTriggerImportResponseSchema,
} from '../src';

describe('historyContract', () => {
    test('historyContract is mounted under contract.history with all 6 procedures', () => {
        expect(contract.history).toBeDefined();
        expect(contract.history.getSummary).toBe(historyContract.getSummary);
        expect(contract.history.getTimeline).toBe(historyContract.getTimeline);
        expect(contract.history.getSessions).toBe(historyContract.getSessions);
        expect(contract.history.getInsights).toBe(historyContract.getInsights);
        expect(contract.history.getSources).toBe(historyContract.getSources);
        expect(contract.history.triggerImport).toBe(historyContract.triggerImport);
    });

    test('timeline is POST and requires source-safe session or composable consolidated input', () => {
        const route = (historyContract.getTimeline as unknown as Record<string, unknown>)['~orpc'] as {
            route: { method: string; path: string };
        };
        expect(route.route).toMatchObject({ method: 'POST', path: '/history/timeline' });
        expect(historyTimelineInputSchema.parse({ mode: 'session', source: 'codex', sessionId: 'shared-id' })).toEqual({
            mode: 'session',
            source: 'codex',
            sessionId: 'shared-id',
        });
        expect(() => historyTimelineInputSchema.parse({ mode: 'session', sessionId: 'shared-id' })).toThrow();
        expect(
            historyTimelineInputSchema.parse({
                mode: 'consolidated',
                filter: { range: '24h', sources: ['agy'] },
                taskWbs: '0638',
                runId: 'run-1',
            }),
        ).toMatchObject({ mode: 'consolidated', taskWbs: '0638', runId: 'run-1' });
    });

    test('historyFilterSchema parses valid filters and assigns defaults', () => {
        const parsedDefault = historyFilterSchema.parse({});
        expect(parsedDefault.range).toBe('30d');
        expect(parsedDefault.bucket).toBe('auto');
        expect(parsedDefault.dimension).toBe('model');

        const parsedFull = historyFilterSchema.parse({
            range: 'custom',
            from: '2026-08-01T00:00:00.000Z',
            to: '2026-08-21T00:00:00.000Z',
            sources: ['claude', 'codex'],
            models: ['claude-opus-4.6'],
            tools: ['Read', 'Bash'],
            skills: ['sp-dev-run'],
            bucket: '1h',
            dimension: 'skill',
        });
        expect(parsedFull.range).toBe('custom');
        expect(parsedFull.sources).toEqual(['claude', 'codex']);
        expect(parsedFull.bucket).toBe('1h');
        expect(parsedFull.dimension).toBe('skill');
    });

    test('historyFilterSchema rejects invalid range or bucket values', () => {
        expect(() => historyFilterSchema.parse({ range: 'invalid_range' })).toThrow();
        expect(() => historyFilterSchema.parse({ bucket: '2d' })).toThrow();
        expect(() => historyFilterSchema.parse({ dimension: 'agent' })).toThrow();
        expect(() => historyFilterSchema.parse({ from: 'not-a-date' })).toThrow();
    });

    test('historyTokensSchema validates pure token accounting schema', () => {
        const tokens = historyTokensSchema.parse({
            billedTokens: 15000,
            cacheSavedTokens: 80000,
            cacheReadTokens: 80000,
            freshInputTokens: 10000,
            outputTokens: 5000,
        });
        expect(tokens.billedTokens).toBe(15000);
        expect(tokens.cacheSavedTokens).toBe(80000);
    });

    test('R2: Pure-token assertion — zero currency or cost fields in packages/contracts/src/history.ts', () => {
        const filePath = join(__dirname, '../src/history.ts');
        const content = readFileSync(filePath, 'utf-8');

        const forbiddenPatterns = [
            /\bcostUsd\b/i,
            /\bcost_usd\b/i,
            /\bcurrency\b/i,
            /\busd\b/i,
            /\bprice\b/i,
            /\bdollar\b/i,
        ];

        for (const pattern of forbiddenPatterns) {
            expect(content).not.toMatch(pattern);
        }
    });

    test('historySummaryResponseSchema parses valid summary envelope', () => {
        const parsed = historySummaryResponseSchema.parse({
            ok: true,
            data: {
                kpis: {
                    totalBilledTokens: 120000,
                    cacheSavedTokens: 450000,
                    cacheSavedPercent: 79,
                    sessionsCount: 15,
                    toolCallsCount: 88,
                    errorRate: 1.2,
                },
                timeSeries: [
                    {
                        bucketStart: '2026-08-20T00:00:00.000Z',
                        cacheHitRatio: 85,
                        series: { claude: 50000, codex: 70000 },
                    },
                ],
                topModels: [
                    { id: 'claude-opus-4.6', label: 'claude-opus-4.6', color: '#3987e5', tokens: 80000, share: 67 },
                ],
                topSources: [{ id: 'claude', label: 'Claude Code', color: '#3987e5', tokens: 80000, share: 67 }],
                topTools: [{ id: 'Read', count: 45, errors: 0, errorRate: 0 }],
                skillsUsed: [{ id: 'sp-dev-run', label: 'Sp Dev Run', color: '#199e70', count: 12 }],
                cacheEfficiency: { hitRatio: 79, savedTokens: 450000, totalRead: 450000 },
                kpiTrend: [
                    {
                        day: '2026-08-21',
                        totalBilledTokens: 120000,
                        cacheSavedTokens: 450000,
                        sessionsCount: 15,
                        toolCallsCount: 88,
                        cacheHitRatio: 79,
                    },
                ],
                previousKpis: {
                    totalBilledTokens: 100000,
                    cacheSavedTokens: 400000,
                    cacheSavedPercent: 80,
                    sessionsCount: 12,
                    toolCallsCount: 80,
                    errorRate: 1.0,
                },
                skillTimeSeries: [
                    {
                        bucketStart: '2026-08-20T00:00:00.000Z',
                        cacheHitRatio: 85,
                        series: { 'sp-dev-run': 12 },
                    },
                ],
            },
        });
        expect(parsed.ok).toBe(true);
        expect(parsed.data.kpis.totalBilledTokens).toBe(120000);
        expect(parsed.data.kpiTrend.length).toBe(1);
        expect(parsed.data.previousKpis?.sessionsCount).toBe(12);
        expect(parsed.data.skillTimeSeries[0]?.series['sp-dev-run']).toBe(12);
    });

    test('kpiTrend, previousKpis, and skillTimeSeries are REQUIRED on summary data', () => {
        const validData = historySummaryResponseSchema.parse({
            ok: true,
            data: {
                kpis: {
                    totalBilledTokens: 120000,
                    cacheSavedTokens: 450000,
                    cacheSavedPercent: 79,
                    sessionsCount: 15,
                    toolCallsCount: 88,
                    errorRate: 1.2,
                },
                timeSeries: [],
                topModels: [],
                topSources: [],
                topTools: [],
                skillsUsed: [],
                cacheEfficiency: { hitRatio: 79, savedTokens: 450000, totalRead: 450000 },
                kpiTrend: [],
                previousKpis: null,
                skillTimeSeries: [],
            },
        }).data;

        for (const field of ['kpiTrend', 'previousKpis', 'skillTimeSeries'] as const) {
            const missing = { ...validData } as Record<string, unknown>;
            delete missing[field];
            expect(() => historySummaryResponseSchema.parse({ ok: true, data: missing })).toThrow();
        }
    });

    test('previousKpis accepts null but rejects non-KPI shapes', () => {
        const data = {
            kpis: {
                totalBilledTokens: 1,
                cacheSavedTokens: 1,
                cacheSavedPercent: 1,
                sessionsCount: 1,
                toolCallsCount: 1,
                errorRate: 0,
            },
            timeSeries: [],
            topModels: [],
            topSources: [],
            topTools: [],
            skillsUsed: [],
            cacheEfficiency: { hitRatio: 1, savedTokens: 1, totalRead: 1 },
            kpiTrend: [],
            previousKpis: null,
            skillTimeSeries: [],
        };
        expect(historySummaryResponseSchema.parse({ ok: true, data }).data.previousKpis).toBeNull();
        expect(() =>
            historySummaryResponseSchema.parse({
                ok: true,
                data: { ...data, previousKpis: { totalBilledTokens: 'lots' } },
            }),
        ).toThrow();
    });
    test('historyTimelineResponseSchema parses valid timeline payload', () => {
        const parsed = historyTimelineResponseSchema.parse({
            ok: true,
            data: {
                mode: 'session',
                scope: {
                    sessionId: 'sess-1234',
                    source: 'claude',
                    model: 'claude-opus-4.6',
                    start: '2026-08-21T18:00:00.000Z',
                    end: '2026-08-21T18:00:45.000Z',
                    durationMs: 45000,
                    tokens: {
                        billedTokens: 5000,
                        cacheSavedTokens: 20000,
                        cacheReadTokens: 20000,
                        freshInputTokens: 4000,
                        outputTokens: 1000,
                    },
                    messageCount: 5,
                    toolCallCount: 12,
                    sessionCount: 1,
                },
                truncated: false,
                blocks: [
                    {
                        key: 'claude:::sess-1234:::0',
                        sessionId: 'sess-1234',
                        turnIndex: 0,
                        timestamp: '2026-08-21T18:00:00.000Z',
                        source: 'claude',
                        model: 'claude-opus-4.6',
                        correlationExactness: null,
                        totalDurationMs: 3200,
                        totalTokens: 12000,
                        operationCount: 1,
                        events: [
                            {
                                seq: 1,
                                eventType: 'message',
                                kind: 'assistant',
                                title: 'assistant turn',
                                toolName: null,
                                durationMs: 400,
                                durationSource: 'measured',
                                tokens: 5000,
                                freshInputTokens: 500,
                                cacheReadTokens: 4000,
                                outputTokens: 500,
                                promptTokens: null,
                                exitCode: null,
                                payload: 'File content',
                                agent: 'claude',
                                model: 'claude-opus-4.6',
                            },
                        ],
                    },
                ],
            },
        });
        expect(parsed.ok).toBe(true);
        expect(parsed.data.scope.sessionId).toBe('sess-1234');
    });

    test('historySessionsInputSchema parses pagination and sorting defaults', () => {
        const parsed = historySessionsInputSchema.parse({});
        expect(parsed.page).toBe(1);
        expect(parsed.pageSize).toBe(20);
        expect(parsed.sortBy).toBe('start');
        expect(parsed.sortDir).toBe('desc');
    });

    test('historySessionsResponseSchema parses valid sessions list', () => {
        const parsed = historySessionsResponseSchema.parse({
            ok: true,
            data: {
                items: [
                    {
                        id: 'sess-0001',
                        source: 'claude',
                        model: 'claude-opus-4.6',
                        start: '2026-08-21T12:00:00.000Z',
                        durationMs: 120000,
                        messages: 6,
                        toolCalls: 18,
                        billedTokens: 8500,
                        cacheReadTokens: 42000,
                        freshInputTokens: 6000,
                        outputTokens: 2500,
                        topTool: 'Read',
                        state: 'complete',
                    },
                ],
                total: 1,
                page: 1,
                pageSize: 20,
            },
        });
        expect(parsed.ok).toBe(true);
        expect(parsed.data.items.length).toBe(1);
    });

    test('historyInsightsResponseSchema parses valid insights data', () => {
        const parsed = historyInsightsResponseSchema.parse({
            ok: true,
            data: {
                loops: [
                    {
                        tool: 'Bash',
                        argsHint: 'bun test',
                        sessionId: 'sess-0001',
                        repeats: 3,
                        fromSeq: 10,
                        toSeq: 20,
                        wastedTokens: 35000,
                    },
                ],
                cacheWaste: [
                    {
                        sessionId: 'sess-0001',
                        timestamp: '2026-08-21T12:00:00.000Z',
                        freshTokens: 15000,
                        reason: 'Cache TTL expired',
                    },
                ],
                heavySessions: [
                    {
                        id: 'sess-0001',
                        source: 'claude',
                        model: 'claude-opus-4.6',
                        tokens: 45000,
                        durationMs: 180000,
                    },
                ],
                largestTokenSteps: [
                    {
                        stepIndex: 5,
                        sessionId: 'sess-0001',
                        toolName: 'Read',
                        tokens: 28000,
                        agent: 'claude',
                        model: 'claude-opus-4.6',
                    },
                ],
                slowSteps: [
                    {
                        stepIndex: 8,
                        sessionId: 'sess-0001',
                        toolName: 'Bash',
                        durationMs: 32000,
                        tokens: 12000,
                        agent: 'claude',
                        model: 'claude-opus-4.6',
                    },
                ],
                modelComparison: [
                    {
                        model: 'claude-opus-4.6',
                        speedMsMean: 850,
                        cacheRatio: 0.85,
                        reliability: 0.99,
                        outputRatio: 0.12,
                    },
                ],
            },
        });
        expect(parsed.ok).toBe(true);
        expect(parsed.data.loops.length).toBe(1);
    });

    test('historySourcesResponseSchema parses valid sources overview', () => {
        const parsed = historySourcesResponseSchema.parse({
            ok: true,
            data: {
                overview: {
                    totalFiles: 4200,
                    corpusSizeBytes: 52000000,
                    dateCoverage: { from: '2026-05-20T00:00:00.000Z', to: '2026-08-21T00:00:00.000Z' },
                    totalSessions: 850,
                    lastImportedAt: '2026-08-21T19:00:00.000Z',
                },
                agents: [
                    {
                        id: 'claude',
                        name: 'Claude Code',
                        color: '#3987e5',
                        importPath: '~/.claude/projects/',
                        filePattern: '*.jsonl',
                        filesCount: 1428,
                        sizeMb: null,
                        sessionCount: 320,
                        totalTokens: 5400000,
                        cacheSavedTokens: 18000000,
                        freshTokens: 4200000,
                        toolCalls: 1450,
                        firstDate: '2026-05-20T00:00:00.000Z',
                        lastDate: '2026-08-21T00:00:00.000Z',
                        heatmapDays: [{ date: '2026-08-21', tokens: 120000, sessions: 8 }],
                        maxDailyTokens: 250000,
                    },
                ],
                roots: [
                    {
                        agentId: 'claude',
                        agentName: 'Claude Code',
                        path: '~/.claude/projects/',
                        matchPattern: '*.jsonl',
                        fileCount: 1428,
                        status: 'active',
                    },
                ],
            },
        });
        expect(parsed.ok).toBe(true);
        expect(parsed.data.agents.length).toBe(1);
        expect(parsed.data.overview.lastImportedAt).toBe('2026-08-21T19:00:00.000Z');
    });

    test('overview.lastImportedAt is REQUIRED on sources data and nullable', () => {
        const validData = historySourcesResponseSchema.parse({
            ok: true,
            data: {
                overview: {
                    totalFiles: 4200,
                    corpusSizeBytes: 52000000,
                    dateCoverage: { from: null, to: null },
                    totalSessions: 850,
                    lastImportedAt: null,
                },
                agents: [],
                roots: [],
            },
        }).data;
        expect(validData.overview.lastImportedAt).toBeNull();

        const missing = { ...validData.overview } as Record<string, unknown>;
        delete missing.lastImportedAt;
        expect(() =>
            historySourcesResponseSchema.parse({
                ok: true,
                data: { ...validData, overview: missing },
            }),
        ).toThrow();
    });

    test('historyTriggerImportInputSchema and Response schema', () => {
        const input = historyTriggerImportInputSchema.parse({});
        expect(input.mode).toBe('incremental');

        // Task 0716 R4: the receipt status narrows to the single-flight writer's
        // outcomes — a synchronous 'completed' can no longer occur.
        const resp = historyTriggerImportResponseSchema.parse({
            ok: true,
            data: {
                runId: 'run-1234',
                status: 'queued',
                message: 'Import queued',
            },
        });
        expect(resp.data.runId).toBe('run-1234');
        expect(() =>
            historyTriggerImportResponseSchema.parse({
                ok: true,
                data: { runId: 'run-1234', status: 'completed', message: 'Import done' },
            }),
        ).toThrow();
    });
});
