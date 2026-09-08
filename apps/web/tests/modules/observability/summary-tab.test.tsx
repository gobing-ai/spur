import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type { ObservabilitySummaryResponse } from '@gobing-ai/spur-contracts';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import SummaryTab, { DeltaBadge } from '../../../src/modules/observability/SummaryTab';
import type { ObservabilityNavIntent } from '../../../src/modules/observability/tabs';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

function jsonResponse(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

const mockSummary: ObservabilitySummaryResponse = {
    window: {
        since: '2026-09-06T08:00:00.000Z',
        until: '2026-09-06T12:00:00.000Z',
        range: '4h',
    },
    kpis: {
        totalEvents: 150,
        activeJobs: 4,
        completedJobs: 18,
        failedJobs: 2,
        successRatePct: 90,
        errorEventCount: 5,
        warningEventCount: 10,
    },
    eventVolumeBuckets: [
        {
            timestamp: '2026-09-06T08:00:00.000Z',
            total: 50,
            byPrefix: { task: 30, queue: 20 },
            bySeverity: { info: 40, warning: 5, error: 3, unknown: 2 },
        },
        {
            timestamp: '2026-09-06T09:00:00.000Z',
            total: 100,
            byPrefix: { task: 60, scheduler: 40 },
            bySeverity: { info: 85, warning: 5, error: 2, unknown: 8 },
        },
    ],
    topEventTypes: [
        { name: 'task.created', prefix: 'task', count: 90, latestAt: '2026-09-06T11:50:00.000Z' },
        { name: 'scheduler.run', prefix: 'scheduler', count: 40, latestAt: '2026-09-06T11:45:00.000Z' },
        { name: 'queue.job.retry', prefix: 'queue', count: 20, latestAt: '2026-09-06T11:30:00.000Z' },
    ],
    recentErrors: [
        {
            id: 'job-err-1',
            source: 'job',
            name: 'task.execute',
            occurredAt: '2026-09-06T11:55:00.000Z',
            message: 'Exit code 1',
        },
        {
            id: 'evt-err-2',
            source: 'event',
            name: 'system.startup.failed',
            occurredAt: '2026-09-06T11:50:00.000Z',
            message: 'Port 8080 in use',
            refId: 'run-99',
        },
    ],
};

const mockPrevSummary: ObservabilitySummaryResponse = {
    ...mockSummary,
    kpis: {
        totalEvents: 100,
        activeJobs: 2,
        completedJobs: 15,
        failedJobs: 5,
        successRatePct: 75,
        errorEventCount: 10,
        warningEventCount: 15,
    },
};

const emptySummary: ObservabilitySummaryResponse = {
    window: {
        since: '2026-09-06T08:00:00.000Z',
        until: '2026-09-06T12:00:00.000Z',
        range: '4h',
    },
    kpis: {
        totalEvents: 0,
        activeJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        successRatePct: 0,
        errorEventCount: 0,
        warningEventCount: 0,
    },
    eventVolumeBuckets: [],
    topEventTypes: [],
    recentErrors: [],
};

describe('SummaryTab (task 0791)', () => {
    beforeAll(() => {
        registerHappyDom();
    });

    afterAll(async () => {
        await teardownHappyDom();
    });

    afterEach(() => {
        cleanup();
        resetFetchForTesting();
    });

    test('renders loading skeleton then transitions to loaded content with 4 KPI cards (R1, R2, R7)', async () => {
        const resolvers: (() => void)[] = [];
        setFetchForTesting(((req: RequestInfo | URL) => {
            const url = typeof req === 'string' ? req : req instanceof Request ? req.url : req.toString();
            return new Promise<Response>((res) => {
                resolvers.push(() => {
                    res(jsonResponse(url.includes('period=previous') ? mockPrevSummary : mockSummary));
                });
            });
        }) as unknown as typeof fetch);

        const { getByTestId, queryByTestId } = render(<SummaryTab timeRange="4h" />);
        expect(getByTestId('observability-summary-skeleton')).toBeDefined();

        for (const resolve of resolvers) {
            resolve();
        }

        await waitFor(() => {
            expect(queryByTestId('observability-summary-skeleton')).toBeNull();
        });

        expect(getByTestId('observability-summary-tab')).toBeDefined();
        expect(getByTestId('kpi-card-total-events').textContent).toContain('150');
        expect(getByTestId('kpi-card-active-jobs').textContent).toContain('4');
        expect(getByTestId('kpi-card-success-rate').textContent).toContain('90%');
        expect(getByTestId('kpi-card-errors-warnings').textContent).toContain('5 / 10');
    });

    test('delta badge correctly indicates up, down, inverted, and new baselines (R2)', () => {
        const upView = render(<DeltaBadge current={150} previous={100} />);
        expect(upView.container.textContent).toContain('↑ +50.0%');

        const downView = render(<DeltaBadge current={80} previous={100} />);
        expect(downView.container.textContent).toContain('↓ 20.0%');

        const invertUpView = render(<DeltaBadge current={15} previous={10} invert />);
        expect(invertUpView.container.querySelector('.text-error')).not.toBeNull();

        const noPrevView = render(<DeltaBadge current={50} previous={undefined} />);
        expect(noPrevView.container.textContent).toBe('No prior baseline');

        const zeroPrevView = render(<DeltaBadge current={50} previous={0} />);
        expect(zeroPrevView.container.textContent).toBe('new');
    });

    test('stacked columns chart and severity distribution bar render with unknown segment (R3, R4)', async () => {
        setFetchForTesting((async (req: RequestInfo | URL) => {
            const url = typeof req === 'string' ? req : req instanceof Request ? req.url : req.toString();
            if (url.includes('since=')) {
                return jsonResponse(mockSummary);
            }
            return jsonResponse(mockSummary);
        }) as unknown as typeof fetch);

        const { getByTestId } = render(<SummaryTab timeRange="4h" />);

        await waitFor(() => {
            expect(getByTestId('stacked-event-volume-chart')).toBeDefined();
        });

        // Severity bar has info, warning, error, unknown segments
        expect(getByTestId('severity-bar-info')).toBeDefined();
        expect(getByTestId('severity-bar-warning')).toBeDefined();
        expect(getByTestId('severity-bar-error')).toBeDefined();
        expect(getByTestId('severity-bar-unknown')).toBeDefined();
    });

    test('hotspots render and failure rows trigger onNavigate to jobs or system-events (R5, R6)', async () => {
        setFetchForTesting((async () => jsonResponse(mockSummary)) as unknown as typeof fetch);

        const navigated: ObservabilityNavIntent[] = [];
        const handleNavigate = (intent: ObservabilityNavIntent) => {
            navigated.push(intent);
        };

        const { getByTestId, getByText } = render(<SummaryTab timeRange="4h" onNavigate={handleNavigate} />);

        await waitFor(() => {
            expect(getByTestId('top-event-types-table')).toBeDefined();
        });

        // Top event types table
        expect(getByText('task.created')).toBeDefined();
        expect(getByText('scheduler.run')).toBeDefined();

        // Recent failures feed
        const jobFailure = getByTestId('failure-row-job-job-err-1');
        fireEvent.click(jobFailure);
        expect(navigated).toHaveLength(1);
        expect(navigated[0]).toEqual({ tab: 'jobs', jobId: 'job-err-1' });

        const eventFailure = getByTestId('failure-row-event-evt-err-2');
        fireEvent.click(eventFailure);
        expect(navigated).toHaveLength(2);
        expect(navigated[1]).toEqual({ tab: 'system-events', eventName: 'system.startup.failed', runId: 'run-99' });
    });

    test('displays error panel on network or server failure (R7)', async () => {
        setFetchForTesting((async () => {
            return new Response('Database timeout', { status: 500, statusText: 'Internal Server Error' });
        }) as unknown as typeof fetch);

        const { getByTestId } = render(<SummaryTab timeRange="4h" />);

        await waitFor(() => {
            expect(getByTestId('observability-summary-error')).toBeDefined();
        });

        expect(getByTestId('observability-summary-error').textContent).toContain('HTTP 500');
    });

    test('empty window renders zeros and calm fallback instead of throwing (AC R2)', async () => {
        setFetchForTesting((async () => jsonResponse(emptySummary)) as unknown as typeof fetch);

        const { getByTestId, getByText } = render(<SummaryTab timeRange="4h" />);

        await waitFor(() => {
            expect(getByTestId('kpi-card-total-events').textContent).toContain('0');
        });

        expect(getByTestId('kpi-card-success-rate').textContent).toContain('0%');
        expect(getByTestId('empty-chart-fallback')).toBeDefined();
        expect(getByText('No recent failures in this time range.')).toBeDefined();
    });

    test('previous window failure degrades gracefully without breaking the tab (D2)', async () => {
        setFetchForTesting((async (req: RequestInfo | URL) => {
            const url = typeof req === 'string' ? req : req instanceof Request ? req.url : req.toString();
            if (url.includes('period=previous')) {
                return new Response('Internal error', { status: 500 });
            }
            return jsonResponse(mockSummary);
        }) as unknown as typeof fetch);

        const { getByTestId, queryByTestId } = render(<SummaryTab timeRange="4h" />);

        await waitFor(() => {
            expect(getByTestId('kpi-card-total-events')).toBeDefined();
        });

        expect(queryByTestId('observability-summary-error')).toBeNull();
        expect(getByTestId('kpi-card-total-events').textContent).toContain('150');
    });

    test('malformed summary payload (e.g. a catch-all returning []) renders without throwing', async () => {
        // Regression: `data?.eventVolumeBuckets.map(...)` only guarded `data`, so a
        // payload that exists but lacks the nested arrays crashed the tab (and, under
        // an ErrorBoundary, spammed the console). Normalize-to-array makes it render zeros.
        setFetchForTesting((async () => jsonResponse([])) as unknown as typeof fetch);

        const { getByTestId, queryByTestId } = render(<SummaryTab timeRange="4h" />);

        await waitFor(() => {
            expect(getByTestId('kpi-card-total-events')).toBeDefined();
        });

        expect(queryByTestId('observability-summary-error')).toBeNull();
        expect(getByTestId('kpi-card-total-events').textContent).toContain('0');
    });
});
