import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type { QueueJobListResponse, SchedulerSchedulesResponse } from '@gobing-ai/spur-contracts';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import JobsTab from '../../../src/modules/observability/JobsTab';
import type { ObservabilityNavIntent } from '../../../src/modules/observability/tabs';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

function jsonResponse(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

const mockJobsResponse: QueueJobListResponse = {
    jobs: [
        {
            id: 'job-1',
            type: 'indexer',
            status: 'completed',
            attempts: 1,
            maxRetries: 3,
            queuedAt: '2026-09-06T10:00:00.000Z',
            startedAt: '2026-09-06T10:01:00.000Z',
            endedAt: '2026-09-06T10:05:00.000Z',
            durationMs: 240000,
            lastError: null,
            payload: { jobId: 'job-1', query: 'repo' },
        },
        {
            id: 'job-2',
            type: 'digest',
            status: 'failed',
            attempts: 3,
            maxRetries: 3,
            queuedAt: '2026-09-06T10:10:00.000Z',
            startedAt: '2026-09-06T10:11:00.000Z',
            endedAt: '2026-09-06T10:12:00.000Z',
            durationMs: 60000,
            lastError: 'Connection refused to upstream mailer service on port 587',
            payload: { jobId: 'job-2', email: 'test@example.com' },
        },
        {
            id: 'job-3',
            type: 'worker',
            status: 'pending',
            attempts: 0,
            maxRetries: 3,
            queuedAt: '2026-09-06T11:00:00.000Z',
            startedAt: null,
            endedAt: null,
            durationMs: null,
            lastError: null,
            payload: null,
        },
    ],
    total: 3,
    hasMore: false,
    countsByStatus: {
        all: 3,
        pending: 1,
        processing: 0,
        completed: 1,
        failed: 1,
    },
};

const mockSchedulesResponse: SchedulerSchedulesResponse = {
    schedules: [
        {
            name: 'session-cleanup',
            cron: '300000',
            cadence: 'every 5 minutes',
            nextFireAt: '2026-09-06T11:05:00.000Z',
            lastFiredAt: '2026-09-06T11:00:00.000Z',
            lastStatus: 'completed',
            source: 'builtin',
        },
        {
            name: 'nightly-reindex',
            cron: '0 0 * * *',
            cadence: 'daily at midnight',
            nextFireAt: null,
            lastFiredAt: null,
            lastStatus: 'none',
            source: 'config',
        },
    ],
};

describe('JobsTab (task 0792)', () => {
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

    test('renders status filter chips with counts, failure banner, and retention badge (R2, R3, R9)', async () => {
        const fetchCalls: string[] = [];
        setFetchForTesting((async (req: RequestInfo | URL) => {
            const url = typeof req === 'string' ? req : req instanceof Request ? req.url : req.toString();
            fetchCalls.push(url);
            if (url.includes('/jobs/schedules')) {
                return jsonResponse(mockSchedulesResponse);
            }
            if (url.includes('/jobs')) {
                return jsonResponse(mockJobsResponse);
            }
            return jsonResponse({});
        }) as unknown as typeof fetch);

        const { getByTestId, getByText } = render(<JobsTab timeRange="4h" />);

        await waitFor(() => {
            expect(getByTestId('queue-jobs-table')).toBeDefined();
        });

        // Status filter chips with counts
        expect(getByTestId('status-chip-all').textContent).toContain('All');
        expect(getByTestId('status-chip-all').textContent).toContain('3');
        expect(getByTestId('status-chip-failed').textContent).toContain('Failed');
        expect(getByTestId('status-chip-failed').textContent).toContain('1');
        expect(getByTestId('status-chip-running').textContent).toContain('Running');
        expect(getByTestId('status-chip-running').textContent).toContain('0');
        expect(getByTestId('status-chip-completed').textContent).toContain('Completed');
        expect(getByTestId('status-chip-completed').textContent).toContain('1');

        // Failure warning banner because failed > 0 (R3)
        const banner = getByTestId('jobs-failure-banner');
        expect(banner.textContent).toContain('1 job failed in this window');
        const filterBtn = getByTestId('filter-to-failed-btn');
        expect(filterBtn).toBeDefined();

        // Clicking Filter to Failed triggers request with status=failed
        fireEvent.click(filterBtn);
        await waitFor(() => {
            expect(fetchCalls.some((u) => u.includes('status=failed'))).toBe(true);
        });

        // Retention badge rendered (R9)
        expect(getByText(/terminal jobs pruned after 30d/)).toBeDefined();
    });

    test('table renders first-class columns and handles null timing with em dash (R4)', async () => {
        setFetchForTesting((async (req: RequestInfo | URL) => {
            const url = typeof req === 'string' ? req : req instanceof Request ? req.url : req.toString();
            if (url.includes('/jobs/schedules')) return jsonResponse(mockSchedulesResponse);
            return jsonResponse(mockJobsResponse);
        }) as unknown as typeof fetch);

        const { getByTestId } = render(<JobsTab timeRange="4h" />);

        await waitFor(() => {
            expect(getByTestId('job-row-job-1')).toBeDefined();
        });

        // Completed row
        const row1 = getByTestId('job-row-job-1');
        expect(row1.textContent).toContain('completed');
        expect(row1.textContent).toContain('indexer');
        expect(row1.textContent).toContain('240.0s'); // 240000ms formatted

        // Pending row with null startedAt and null durationMs -> renders em dash '—'
        const row3 = getByTestId('job-row-job-3');
        expect(row3.textContent).toContain('pending');
        expect(row3.textContent).toContain('worker');
        expect(row3.textContent).toContain('—');
        expect(row3.textContent).not.toContain('0ms');
        expect(row3.textContent).not.toContain('Invalid Date');
    });

    test('inline error expansion toggles details without opening drawer (R5)', async () => {
        setFetchForTesting((async (req: RequestInfo | URL) => {
            const url = typeof req === 'string' ? req : req instanceof Request ? req.url : req.toString();
            if (url.includes('/jobs/schedules')) return jsonResponse(mockSchedulesResponse);
            return jsonResponse(mockJobsResponse);
        }) as unknown as typeof fetch);

        const { getByTestId, queryByTestId } = render(<JobsTab timeRange="4h" />);

        await waitFor(() => {
            expect(getByTestId('job-row-job-2')).toBeDefined();
        });

        const errorEl = getByTestId('job-error-job-2');
        const expandBtn = getByTestId('expand-error-btn-job-2');
        expect(expandBtn.textContent).toBe('Details');
        expect(errorEl.className).toContain('truncate');

        // Drawer should not be open yet
        expect(queryByTestId('job-detail-drawer')).toBeNull();

        // Click expand button
        fireEvent.click(expandBtn);
        expect(expandBtn.textContent).toBe('Hide');
        expect(errorEl.className).toContain('whitespace-pre-wrap');

        // Drawer must still NOT be open
        expect(queryByTestId('job-detail-drawer')).toBeNull();
    });

    test('active schedules card displays schedules and degrades on error (R6)', async () => {
        // First test: valid schedules
        setFetchForTesting((async (req: RequestInfo | URL) => {
            const url = typeof req === 'string' ? req : req instanceof Request ? req.url : req.toString();
            if (url.includes('/jobs/schedules')) return jsonResponse(mockSchedulesResponse);
            return jsonResponse(mockJobsResponse);
        }) as unknown as typeof fetch);

        const view1 = render(<JobsTab timeRange="4h" />);
        await waitFor(() => {
            expect(view1.getByTestId('schedule-item-session-cleanup')).toBeDefined();
        });

        // session-cleanup interval item
        const sched1 = view1.getByTestId('schedule-item-session-cleanup');
        expect(sched1.textContent).toContain('session-cleanup');
        expect(sched1.textContent).toContain('builtin');
        expect(sched1.textContent).toContain('every 5 minutes');

        // nightly-reindex cron item with null nextFireAt -> 'next run: cron (unknown)' and 'never run'
        const sched2 = view1.getByTestId('schedule-item-nightly-reindex');
        expect(sched2.textContent).toContain('nightly-reindex');
        expect(sched2.textContent).toContain('next run: cron (unknown)');
        expect(sched2.textContent).toContain('never run');

        cleanup();

        // Second test: schedules fetch fails 500, jobs table still renders
        setFetchForTesting((async (req: RequestInfo | URL) => {
            const url = typeof req === 'string' ? req : req instanceof Request ? req.url : req.toString();
            if (url.includes('/jobs/schedules')) return new Response('Schedules unavailable', { status: 500 });
            return jsonResponse(mockJobsResponse);
        }) as unknown as typeof fetch);

        const view2 = render(<JobsTab timeRange="4h" />);
        await waitFor(() => {
            expect(view2.getByTestId('schedules-error')).toBeDefined();
        });
        expect(view2.getByTestId('queue-jobs-table')).toBeDefined();
    });

    test('detail drawer opens on row click, renders metadata and empty lifecycle note (R7, R8)', async () => {
        setFetchForTesting((async (req: RequestInfo | URL) => {
            const url = typeof req === 'string' ? req : req instanceof Request ? req.url : req.toString();
            if (url.includes('/jobs/schedules')) return jsonResponse(mockSchedulesResponse);
            if (url.includes('/events/history')) return jsonResponse({ events: [] });
            return jsonResponse(mockJobsResponse);
        }) as unknown as typeof fetch);

        const navigated: ObservabilityNavIntent[] = [];
        const handleNavigate = (intent: ObservabilityNavIntent) => {
            navigated.push(intent);
        };

        const { getByTestId, queryByTestId } = render(<JobsTab timeRange="4h" onNavigate={handleNavigate} />);

        await waitFor(() => {
            expect(getByTestId('job-row-job-1')).toBeDefined();
        });

        // Click row to open drawer
        fireEvent.click(getByTestId('job-row-job-1'));

        await waitFor(() => {
            expect(getByTestId('job-detail-drawer')).toBeDefined();
        });

        // Empty lifecycle timeline explanation (D4)
        await waitFor(() => {
            expect(getByTestId('empty-lifecycle-timeline')).toBeDefined();
        });
        expect(getByTestId('empty-lifecycle-timeline').textContent).toContain(
            'Queue lifecycle events are diagnostic-tier',
        );

        // System Events navigation link (R8)
        const navBtn = getByTestId('navigate-system-events-btn');
        expect(navBtn).toBeDefined();
        fireEvent.click(navBtn);
        expect(navigated).toHaveLength(1);
        expect(navigated[0]).toEqual({ tab: 'system-events', runId: 'job-1' });

        // Close drawer
        const closeBtn = getByTestId('close-job-drawer');
        fireEvent.click(closeBtn);
        expect(queryByTestId('job-detail-drawer')).toBeNull();
    });
});
