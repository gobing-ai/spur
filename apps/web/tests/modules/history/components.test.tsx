import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type {
    HistorySourcesResponse,
    HistorySummaryResponse,
    HistoryTimelineResponse,
} from '@gobing-ai/spur-contracts';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
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
};

const sources: HistorySourcesResponse['data'] = {
    overview: {
        totalFiles: 1,
        corpusSizeBytes: 4096,
        dateCoverage: { from: '2026-08-01T00:00:00Z', to: '2026-08-21T00:00:00Z' },
        totalSessions: 2,
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
    ],
};

describe('History Board components', () => {
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

    test('Timeline keeps agent/model on the turn header and exposes step telemetry on hover', () => {
        const view = render(<TimelineTab data={timeline} />);

        expect(view.getAllByText('agy').length).toBe(2);
        expect(view.getAllByText('gemini-3-pro').length).toBe(2);
        const metrics = view.container.querySelector('[title*="Fresh input: 55.0K"]');
        expect(metrics?.getAttribute('title')).toContain('Agent/model: agy · gemini-3-pro');
        expect(metrics?.textContent).toContain('6.0s');
    });
});
