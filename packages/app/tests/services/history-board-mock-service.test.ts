import { describe, expect, test } from 'bun:test';
import { MockHistoryBoardService } from '../../src';

describe('MockHistoryBoardService', () => {
    const service = new MockHistoryBoardService();

    test('getSummary returns complete KPIs and breakdowns', async () => {
        const summary = await service.getSummary({ range: '30d' });
        expect(summary.kpis.totalBilledTokens).toBeGreaterThan(0);
        expect(summary.kpis.sessionsCount).toBeGreaterThan(0);
        expect(summary.kpis.cacheSavedPercent).toBeGreaterThanOrEqual(0);
        expect(summary.kpis.cacheSavedPercent).toBeLessThanOrEqual(100);
        expect(summary.topModels.length).toBeGreaterThan(0);
        expect(summary.topSources.length).toBeGreaterThan(0);
        expect(summary.topTools.length).toBeGreaterThan(0);
        expect(summary.timeSeries.length).toBeGreaterThan(0);
    });

    test('getSummary filters by sources and models', async () => {
        const fullSummary = await service.getSummary({ range: 'all' });
        const filteredSummary = await service.getSummary({
            range: 'all',
            sources: ['claude'],
        });
        expect(filteredSummary.kpis.sessionsCount).toBeLessThanOrEqual(fullSummary.kpis.sessionsCount);
        expect(filteredSummary.topSources.find((s: { id: string }) => s.id === 'claude')?.tokens).toBeGreaterThan(0);
    });

    test('getSummary honors bucket granularity and chart dimension', async () => {
        const byModel = await service.getSummary({ range: '7d', bucket: '30m', dimension: 'model' });
        const byTool = await service.getSummary({ range: '7d', bucket: '30m', dimension: 'tool' });
        const modelKeys = new Set(byModel.timeSeries.flatMap((point) => Object.keys(point.series)));
        const toolKeys = new Set(byTool.timeSeries.flatMap((point) => Object.keys(point.series)));

        expect(modelKeys.has('claude-opus-4.6') || modelKeys.has('gpt-5.6-sol')).toBe(true);
        expect(toolKeys.has('Read') || toolKeys.has('Bash')).toBe(true);
        expect(toolKeys).not.toEqual(modelKeys);
    });

    test('tool and skill filters preserve an honest empty result', async () => {
        const byTool = await service.getSummary({ range: 'all', tools: ['missing-tool'] });
        const bySkill = await service.getSummary({ range: 'all', skills: ['missing-skill'] });
        const sessions = await service.getSessions({
            filter: { range: 'all', tools: ['missing-tool'] },
            page: 1,
            pageSize: 20,
        });
        const insights = await service.getInsights({ range: 'all', skills: ['missing-skill'] });

        expect(byTool.kpis.sessionsCount).toBe(0);
        expect(bySkill.kpis.sessionsCount).toBe(0);
        expect(sessions.total).toBe(0);
        expect(insights).toEqual({
            loops: [],
            cacheWaste: [],
            heavySessions: [],
            largestTokenSteps: [],
            slowSteps: [],
            modelComparison: [],
        });
    });

    test('getTimeline returns valid session metadata and grouped blocks', async () => {
        const sessions = await service.getSessions({ page: 1, pageSize: 5 });
        const targetId = sessions.items[0]?.id ?? 'sess-0001';

        const timeline = await service.getTimeline(targetId);
        expect(timeline.session.id).toBe(targetId);
        expect(timeline.session.tokens.billedTokens).toBeGreaterThan(0);
        expect(timeline.blocks.length).toBeGreaterThan(0);
        expect(timeline.blocks[0]?.events.length).toBeGreaterThan(0);
    });

    test('getSessions handles pagination and sorting', async () => {
        const page1 = await service.getSessions({ page: 1, pageSize: 5, sortBy: 'start', sortDir: 'desc' });
        const page2 = await service.getSessions({ page: 2, pageSize: 5, sortBy: 'start', sortDir: 'desc' });

        expect(page1.items.length).toBe(5);
        expect(page2.items.length).toBe(5);
        expect(page1.items[0]?.id).not.toBe(page2.items[0]?.id);

        const sortedByBilled = await service.getSessions({
            page: 1,
            pageSize: 10,
            sortBy: 'billedTokens',
            sortDir: 'desc',
        });
        for (let i = 0; i < sortedByBilled.items.length - 1; i++) {
            const curr = sortedByBilled.items[i]?.billedTokens ?? 0;
            const next = sortedByBilled.items[i + 1]?.billedTokens ?? 0;
            expect(curr).toBeGreaterThanOrEqual(next);
        }
    });

    test('getInsights returns loops, cache waste, and model comparisons', async () => {
        const insights = await service.getInsights();
        expect(insights.loops.length).toBeGreaterThan(0);
        expect(insights.loops[0]?.repeats).toBeGreaterThanOrEqual(3);
        expect(insights.cacheWaste.length).toBeGreaterThan(0);
        expect(insights.heavySessions.length).toBeGreaterThan(0);
        expect(insights.largestTokenSteps.length).toBeGreaterThan(0);
        expect(insights.slowSteps.length).toBeGreaterThan(0);
        expect(insights.modelComparison.length).toBeGreaterThan(0);
    });

    test('getSources returns overview and 9 agent heatmaps', async () => {
        const sources = await service.getSources();
        expect(sources.overview.totalFiles).toBeGreaterThan(0);
        expect(sources.agents.length).toBe(9);
        expect(sources.roots.length).toBe(9);
        expect(sources.agents[0]?.heatmapDays.length).toBe(90);
    });

    test('getSources keeps empty and single-source fixtures honest', async () => {
        const empty = await new MockHistoryBoardService([]).getSources();
        expect(empty.overview).toEqual({
            totalFiles: 0,
            corpusSizeBytes: 0,
            dateCoverage: { from: null, to: null },
            totalSessions: 0,
        });
        expect(empty.roots.every((root) => root.status === 'empty')).toBe(true);

        const single = await new MockHistoryBoardService([
            {
                id: 'single',
                source: 'claude',
                model: 'claude-opus-4.6',
                start: Date.parse('2026-08-21T12:00:00Z'),
                durationMs: 1_000,
                messages: 2,
                toolCalls: 1,
                errors: 0,
                tokens: {
                    billedTokens: 150,
                    cacheSavedTokens: 200,
                    cacheReadTokens: 200,
                    freshInputTokens: 100,
                    outputTokens: 50,
                },
                toolMix: { Read: 1 },
                skillMix: {},
                state: 'complete',
            },
        ]).getSources();
        expect(single.overview.totalSessions).toBe(1);
        expect(single.roots.filter((root) => root.status === 'active').map((root) => root.agentId)).toEqual(['claude']);
        expect(single.agents.find((agent) => agent.id === 'claude')?.sessionCount).toBe(1);
    });

    test('triggerImport returns receipt with runId', async () => {
        const receipt = await service.triggerImport('incremental');
        expect(receipt.runId).toBeDefined();
        expect(receipt.status).toBe('completed');
    });
});
