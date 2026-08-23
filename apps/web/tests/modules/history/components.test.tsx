import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type {
    HistoryInsightsResponse,
    HistoryKpiTrendPoint,
    HistorySessionsResponse,
    HistorySourcesResponse,
    HistorySummaryResponse,
    HistoryTimelineResponse,
} from '@gobing-ai/spur-contracts';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { HeatmapGrid } from '../../../src/modules/history/charts';
import HistoryFilters from '../../../src/modules/history/HistoryFilters';
import InsightsTab from '../../../src/modules/history/InsightsTab';
import SessionsTab from '../../../src/modules/history/SessionsTab';
import SourcesTab from '../../../src/modules/history/SourcesTab';
import SummaryTab from '../../../src/modules/history/SummaryTab';
import TimelineTab from '../../../src/modules/history/TimelineTab';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

beforeAll(registerHappyDom);
afterEach(cleanup);
afterAll(teardownHappyDom);

const summary: HistorySummaryResponse['data'] = {
    kpis: {
        totalBilledTokens: 150,
        cacheSavedTokens: 200,
        cacheSavedPercent: 57,
        sessionsCount: 1,
        toolCallsCount: 2,
        errorRate: 0,
    },
    timeSeries: [{ bucketStart: '2026-08-21', cacheHitRatio: 57, series: { Read: 150 } }],
    topModels: [{ id: 'gpt-5.6-sol', label: 'gpt-5.6-sol', color: '#3987e5', tokens: 150, share: 100 }],
    topSources: [{ id: 'codex', label: 'Codex', color: '#d95926', tokens: 150, share: 100 }],
    topTools: [{ id: 'Read', count: 2, errors: 0, errorRate: 0 }],
    skillsUsed: [{ id: 'sp-dev-verify', label: 'Sp Dev Verify', color: '#199e70', count: 1 }],
    cacheEfficiency: { hitRatio: 57, savedTokens: 200, totalRead: 300 },
    kpiTrend: [],
    previousKpis: null,
    skillTimeSeries: [],
};

const sources: HistorySourcesResponse['data'] = {
    overview: {
        totalFiles: 1,
        corpusSizeBytes: 4096,
        dateCoverage: { from: '2026-08-01T00:00:00Z', to: '2026-08-21T00:00:00Z' },
        totalSessions: 2,
        lastImportedAt: null,
    },
    agents: [
        {
            id: 'codex',
            name: 'Codex',
            color: '#d95926',
            importPath: '~/.codex/sessions/',
            filePattern: 'rollout-*.jsonl',
            filesCount: 1,
            sizeMb: null,
            sessionCount: 2,
            totalTokens: 150,
            cacheSavedTokens: 200,
            freshTokens: 100,
            toolCalls: 3,
            firstDate: '2026-08-01T00:00:00Z',
            lastDate: '2026-08-21T00:00:00Z',
            heatmapDays: [{ date: '2026-08-21', tokens: 150, sessions: 2 }],
            maxDailyTokens: 150,
        },
    ],
    roots: [
        {
            agentId: 'codex',
            agentName: 'Codex',
            path: '~/.codex/sessions/',
            matchPattern: 'rollout-*.jsonl',
            fileCount: 1,
            status: 'active',
        },
    ],
};

const timeline: HistoryTimelineResponse['data'] = {
    session: {
        id: 'session-1',
        source: 'agy',
        model: 'gemini-3-pro',
        start: '2026-08-21T10:00:00Z',
        durationMs: 6_000,
        tokens: {
            billedTokens: 60_000,
            cacheSavedTokens: 1_000,
            cacheReadTokens: 1_000,
            freshInputTokens: 55_000,
            outputTokens: 5_000,
        },
        messageCount: 1,
        toolCallCount: 1,
    },
    blocks: [
        {
            turnIndex: 0,
            timestamp: '2026-08-21T10:00:00Z',
            source: 'agy',
            model: 'gemini-3-pro',
            totalDurationMs: 6_000,
            totalTokens: 60_000,
            operationCount: 1,
            events: [
                {
                    seq: 0,
                    kind: 'user',
                    title: 'Fix the failing bun test',
                    durationMs: 0,
                    tokens: 0,
                    freshInputTokens: 0,
                    cacheReadTokens: 0,
                    outputTokens: 0,
                    exitCode: null,
                    payload: 'Fix the failing bun test\nand keep coverage green.',
                    agent: 'agy',
                    model: 'gemini-3-pro',
                },
                {
                    seq: 1,
                    kind: 'bash',
                    title: 'Bash',
                    durationMs: 6_000,
                    tokens: 60_000,
                    freshInputTokens: 55_000,
                    cacheReadTokens: 1_000,
                    outputTokens: 5_000,
                    exitCode: 0,
                    payload: 'bun test',
                    agent: 'agy',
                    model: 'gemini-3-pro',
                },
            ],
        },
        {
            turnIndex: 1,
            timestamp: '2026-08-21T10:05:00Z',
            source: 'agy',
            model: 'gemini-3-pro',
            totalDurationMs: 1_000,
            totalTokens: 10_000,
            operationCount: 1,
            events: [
                {
                    seq: 1,
                    kind: 'read',
                    title: 'Read',
                    durationMs: 1_000,
                    tokens: 10_000,
                    freshInputTokens: 8_000,
                    cacheReadTokens: 1_000,
                    outputTokens: 1_000,
                    exitCode: null,
                    payload: 'src/index.ts',
                    agent: 'agy',
                    model: 'gemini-3-pro',
                },
            ],
        },
    ],
};

const insights: HistoryInsightsResponse['data'] = {
    loops: [],
    cacheWaste: [],
    heavySessions: [],
    largestTokenSteps: [],
    slowSteps: [],
    modelComparison: [
        { model: 'fast-model', speedMsMean: 1000, cacheRatio: 1.5, reliability: -0.2, outputRatio: 1.2 },
        { model: 'slow-model', speedMsMean: 4000, cacheRatio: 0.5, reliability: 0.9, outputRatio: 0.2 },
    ],
};

const kpiTrend: HistoryKpiTrendPoint[] = [
    {
        day: '2026-08-20',
        totalBilledTokens: 100,
        cacheSavedTokens: 50,
        sessionsCount: 1,
        toolCallsCount: 2,
        cacheHitRatio: 50,
    },
    {
        day: '2026-08-21',
        totalBilledTokens: 120,
        cacheSavedTokens: 60,
        sessionsCount: 1,
        toolCallsCount: 3,
        cacheHitRatio: 55,
    },
    {
        day: '2026-08-22',
        totalBilledTokens: 140,
        cacheSavedTokens: 70,
        sessionsCount: 2,
        toolCallsCount: 4,
        cacheHitRatio: 61,
    },
];

const sessions: HistorySessionsResponse['data'] = {
    items: [
        {
            id: 'abcdefghijklmnopqrst',
            source: 'codex',
            model: 'gpt-5.6-sol',
            start: '2026-08-21T10:00:00Z',
            durationMs: 60000,
            messages: 2,
            toolCalls: 3,
            billedTokens: 150,
            cacheReadTokens: 200,
            freshInputTokens: 100,
            outputTokens: 50,
            topTool: 'Read',
            state: 'ok',
        },
        {
            id: 'short-id',
            source: 'agy',
            model: 'gemini-3-pro',
            start: '2026-08-21T11:00:00Z',
            durationMs: 30000,
            messages: 1,
            toolCalls: 1,
            billedTokens: 80,
            cacheReadTokens: 10,
            freshInputTokens: 70,
            outputTokens: 20,
            topTool: 'Bash',
            state: 'ok',
        },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
};

describe('History Board components', () => {
    test('Filter search keeps keyboard focus while typing', () => {
        const view = render(
            <HistoryFilters
                filter={{ range: '30d' }}
                onChange={() => undefined}
                sourceOptions={[
                    { id: 'codex', label: 'Codex' },
                    { id: 'claude', label: 'Claude Code' },
                ]}
            />,
        );

        fireEvent.click(view.getByRole('button', { name: 'Agents: All' }));
        const search = view.getByRole('searchbox', { name: 'Search Agents' });
        search.focus();
        fireEvent.keyDown(search, { key: 'c' });
        expect(document.activeElement).toBe(search);
    });

    test('Summary dimension controls request a server-backed restack', () => {
        let selected = '';
        const view = render(
            <SummaryTab data={summary} dimension="model" onDimensionChange={(value) => (selected = value)} />,
        );

        fireEvent.click(view.getByRole('button', { name: 'By Tool' }));
        expect(selected).toBe('tool');
    });

    test('Sources renders vector agent icons, telemetry tooltip, and queued import state', async () => {
        const view = render(
            <SourcesTab
                data={sources}
                onTriggerImport={async () => ({
                    runId: 'history-refresh-1',
                    status: 'queued',
                    message: 'Incremental import queued.',
                })}
            />,
        );

        const icon = view.container.querySelector('[aria-describedby="source-tooltip-codex"]');
        expect(icon?.querySelector('svg')).not.toBeNull();
        expect(view.getByRole('tooltip').textContent).toContain('Imported Files');
        expect(view.getByRole('tooltip').textContent).toContain('Date Range');

        fireEvent.click(view.getByRole('button', { name: /Import & Analyze/ }));
        await waitFor(() => expect(view.getByText('Incremental import queued.')).toBeDefined());
    });

    test('Timeline keeps turn-header chips, renders prompt bubbles, and exposes step telemetry via tooltip', () => {
        const view = render(<TimelineTab data={timeline} />);

        // Session meta chip + two turn headers.
        expect(view.getAllByText('agy').length).toBe(3);
        expect(view.getAllByText('gemini-3-pro').length).toBe(3);

        // User prompt renders as a right-aligned bubble.
        const bubble = view.getByTestId('timeline-user-event-0-0');
        expect(bubble.textContent).toContain('Fix the failing bun test');
        expect(bubble.textContent).toContain('Input 0');

        // Duplicate seq across turns does not collide (string keys turnIndex:seq).
        expect(view.getByTestId('timeline-step-metrics-0-1')).toBeDefined();
        expect(view.getByTestId('timeline-step-metrics-1-1')).toBeDefined();

        // Step telemetry tooltip carries the old native-title payload.
        const metrics = view.getByTestId('timeline-step-metrics-0-1');
        expect(metrics.textContent).toContain('6.0s');
        expect(metrics.getAttribute('aria-describedby')).toBe('timeline-step-tooltip-0-1');
        const tooltip = view.getByTestId('timeline-step-tooltip-0-1');
        expect(tooltip.getAttribute('role')).toBe('tooltip');
        expect(tooltip.textContent).toContain('Fresh Input:');
        expect(tooltip.textContent).toContain('55.0K');
        expect(tooltip.textContent).toContain('agy · gemini-3-pro');

        // Keyboard focus opens the tooltip (sr-only until open).
        expect(tooltip.className).toContain('sr-only');
        fireEvent.focus(metrics);
        expect(view.getByTestId('timeline-step-tooltip-0-1').className).not.toContain('sr-only');

        // Expand all reveals payloads; switching session resets expansion.
        expect(view.getAllByRole('button', { name: 'Expand all' })).toHaveLength(1);
        fireEvent.click(view.getByRole('button', { name: 'Expand all' }));
        expect(view.getByText('bun test')).toBeDefined();
        expect(view.getByText('src/index.ts')).toBeDefined();
        view.rerender(<TimelineTab data={{ ...timeline, session: { ...timeline.session, id: 'session-2' } }} />);
        expect(view.queryByText('bun test')).toBeNull();
    });

    test('Summary KPI cards show no-baseline deltas and the chart/table toggle swaps bucket views', () => {
        const view = render(<SummaryTab data={summary} />);

        // previousKpis null + empty kpiTrend → every card degrades to the baseline hint.
        expect(view.getAllByText('No prior baseline').length).toBeGreaterThanOrEqual(4);

        // Default is chart mode; table appears only after the toggle.
        expect(view.queryByTestId('summary-bucket-table')).toBeNull();
        fireEvent.click(view.getByRole('button', { name: 'Table' }));
        expect(view.getByTestId('summary-bucket-table')).toBeDefined();
        expect(view.getByText('Bucket')).toBeDefined();
        fireEvent.click(view.getByRole('button', { name: 'Chart' }));
        expect(view.queryByTestId('summary-bucket-table')).toBeNull();
    });

    test('Summary renders measured KPI notes, prior-window deltas, skill tokens, and distinct sub-day buckets', () => {
        const richSummary: HistorySummaryResponse['data'] = {
            ...summary,
            previousKpis: {
                totalBilledTokens: 75,
                cacheSavedTokens: 100,
                cacheSavedPercent: 50,
                sessionsCount: 1,
                toolCallsCount: 1,
                errorRate: 0,
            },
            kpiTrend,
            timeSeries: [
                { bucketStart: '2026-08-21T10:00:00Z', cacheHitRatio: 50, series: { Read: 100 } },
                { bucketStart: '2026-08-21T10:05:00Z', cacheHitRatio: 60, series: { Read: 50 } },
            ],
            skillTimeSeries: [
                { bucketStart: '2026-08-21T10:00:00Z', cacheHitRatio: 50, series: { 'sp-dev-verify': 150 } },
            ],
        };
        const view = render(
            <SummaryTab data={richSummary} loopSummary={{ count: 1, redundantCalls: 3, wastedTokens: 9000 }} />,
        );

        expect(view.getByText('Fresh 100 · Output 50')).toBeDefined();
        expect(view.getAllByText(/vs previous period/).length).toBeGreaterThanOrEqual(4);
        expect(view.getByText('150 tokens')).toBeDefined();
        expect(view.getByText('3 redundant')).toBeDefined();
        expect(view.getByText('9.0K wasted')).toBeDefined();

        fireEvent.click(view.getByRole('button', { name: 'Table' }));
        expect(view.getByText('2026-08-21 10:00')).toBeDefined();
        expect(view.getByText('2026-08-21 10:05')).toBeDefined();
    });

    test('Summary bucket fieldset exposes a legend and relays interval selection', () => {
        let chosen = '';
        const view = render(<SummaryTab data={summary} onBucketChange={(b) => (chosen = b)} />);

        expect(view.getByText('Bucket interval')).toBeDefined();
        fireEvent.click(view.getByRole('button', { name: '5m' }));
        expect(chosen).toBe('5m');
    });

    test('Sources overview renders the never-imported chip when no import has run', () => {
        const view = render(<SourcesTab data={sources} />);
        expect(view.getByText(/never imported/)).toBeDefined();
    });

    test('Insights radar inverts speed so the faster model plots nearer full-scale, and cache-hit trend needs data', () => {
        const view = render(<InsightsTab data={insights} cacheHitTrend={kpiTrend} />);

        expect(view.getByTestId('cache-hit-trend-chart')).toBeDefined();

        // Series render in modelComparison order; first circle of each series sits on the
        // Speed axis (axis 0, top of radar). Higher speed score → smaller cy (closer to rim).
        const dots = view.container.querySelectorAll('svg[aria-label="Radar chart"] circle[r="3.5"]');
        expect(dots.length).toBe(8);
        const fastCy = Number(dots[0]?.getAttribute('cy'));
        const slowCy = Number(dots[4]?.getAttribute('cy'));
        expect(Number.isFinite(fastCy)).toBe(true);
        expect(fastCy).toBeLessThan(slowCy);
        for (const dot of dots) {
            expect(Number(dot.getAttribute('cx'))).toBeGreaterThanOrEqual(0);
            expect(Number(dot.getAttribute('cx'))).toBeLessThanOrEqual(520);
            expect(Number(dot.getAttribute('cy'))).toBeGreaterThanOrEqual(0);
            expect(Number(dot.getAttribute('cy'))).toBeLessThanOrEqual(280);
        }

        view.rerender(<InsightsTab data={insights} />);
        expect(view.queryByTestId('cache-hit-trend-chart')).toBeNull();

        // Model Comparison table renders Mean Speed (ms) header without ms in body cells
        expect(view.getByText(/Mean Speed \(ms\)/)).toBeDefined();
        expect(view.getByText('1,000')).toBeDefined(); // Formatted speed without 'ms'
        expect(view.getByText('4,000')).toBeDefined();

        // Sorting by speed toggles order
        fireEvent.click(view.getByText(/Mean Speed \(ms\)/));
        const cells = view.container.querySelectorAll('tbody tr td:nth-child(2)');
        expect(cells[0]?.textContent).toBe('4,000'); // desc default for numeric
    });

    test('Heatmap calendar carries weekday chrome and a screen-reader token digest', () => {
        const view = render(
            <HeatmapGrid days={[{ date: '2026-08-21', tokens: 1200, sessions: 3 }]} maxDailyTokens={1200} />,
        );

        expect(view.getByTestId('heatmap-calendar')).toBeDefined();
        expect(view.getByText('Mon')).toBeDefined();
        expect(view.getByText('Wed')).toBeDefined();
        expect(view.getByText('Fri')).toBeDefined();
        expect(view.getByText('Less')).toBeDefined();
        expect(view.getByText('More')).toBeDefined();
        expect(view.getByText('2026-08-21: 1.2K tokens, 3 sessions')).toBeDefined();

        const start = Date.UTC(2026, 4, 24);
        const days = Array.from({ length: 90 }, (_, index) => ({
            date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
            tokens: index,
            sessions: 1,
        }));
        view.rerender(<HeatmapGrid days={days} maxDailyTokens={89} />);
        expect(view.getAllByTestId('heatmap-week')).toHaveLength(13);
    });

    test('Sessions table truncates long IDs behind a full-ID title and surfaces loading/error states', () => {
        const view = render(<SessionsTab data={sessions} />);

        const longId = view.container.querySelector('td span[title="abcdefghijklmnopqrst"]');
        expect(longId?.textContent).toBe('abcdefghijklmnop…');
        expect(view.container.querySelector('span[title="short-id"]')?.textContent).toBe('short-id');

        const busy = render(<SessionsTab loading />);
        expect(busy.container.querySelector('.animate-spin')).not.toBeNull();
        const failed = render(<SessionsTab error="network down" />);
        expect(failed.getByText('Failed to load sessions: network down')).toBeDefined();
    });

    test('Timeline prev/next are disabled at roster bounds', () => {
        const view = render(
            <TimelineTab
                data={timeline}
                availableSessions={[
                    { id: 'session-1', source: 'agy', model: 'gemini-3-pro', start: '2026-08-21T10:00:00Z' },
                ]}
            />,
        );

        expect(view.getByRole('button', { name: 'Previous session' }).getAttribute('disabled')).not.toBeNull();
        expect(view.getByRole('button', { name: 'Next session' }).getAttribute('disabled')).not.toBeNull();
    });
});
