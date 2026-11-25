import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import type { QueueJobListResponse, QueueJobRow, SchedulerScheduleRow } from '@gobing-ai/spur-contracts';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import JobsTab, {
    computeExcludedSchedules,
    defaultSelectedSchedules,
} from '../../../src/modules/observability/JobsTab';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

registerHappyDom();
afterEach(() => {
    cleanup();
    resetFetchForTesting();
});
afterAll(teardownHappyDom);

const SCHEDULES: SchedulerScheduleRow[] = [
    {
        name: 'system-events-prune',
        cron: '300000',
        cadence: 'every 5 minutes',
        nextFireAt: '2026-11-25T10:50:00.000Z',
        lastFiredAt: '2026-11-25T10:45:00.000Z',
        lastStatus: 'completed',
        source: 'builtin',
    },
    {
        name: 'smoke',
        cron: '600000',
        cadence: 'every 10 minutes',
        nextFireAt: '2026-11-25T10:52:00.000Z',
        lastFiredAt: '2026-11-25T10:42:00.000Z',
        lastStatus: 'completed',
        source: 'builtin',
    },
    {
        name: 'observation-refresh',
        cron: '2 17 * * *',
        cadence: '2 17 * * *',
        nextFireAt: null,
        lastFiredAt: null,
        lastStatus: 'none',
        source: 'builtin',
    },
    {
        name: 'history-refresh',
        cron: '*/20 7-23 * * *',
        cadence: '*/20 7-23 * * *',
        nextFireAt: null,
        lastFiredAt: '2026-11-25T10:30:00.000Z',
        lastStatus: 'completed',
        source: 'config',
    },
    {
        name: 'database-daily-maintenance',
        cron: '32 4 * * *',
        cadence: '32 4 * * *',
        nextFireAt: null,
        lastFiredAt: '2026-11-25T04:32:00.000Z',
        lastStatus: 'completed',
        source: 'config',
    },
];

const ALL_JOBS: QueueJobRow[] = [
    {
        id: 'job-prune-1',
        type: 'system-events-prune',
        status: 'completed',
        attempts: 1,
        maxRetries: 1,
        queuedAt: '2026-11-25T10:45:00.000Z',
        startedAt: null,
        endedAt: '2026-11-25T10:45:01.000Z',
        durationMs: 100,
        lastError: null,
        payload: { source: 'scheduler' },
    },
    {
        id: 'job-smoke-1',
        type: 'smoke',
        status: 'completed',
        attempts: 1,
        maxRetries: 1,
        queuedAt: '2026-11-25T10:42:00.000Z',
        startedAt: null,
        endedAt: '2026-11-25T10:42:01.000Z',
        durationMs: 10,
        lastError: null,
        payload: { source: 'scheduler' },
    },
    {
        id: 'job-history-1',
        type: 'scheduler.custom',
        status: 'completed',
        attempts: 1,
        maxRetries: 1,
        queuedAt: '2026-11-25T10:30:00.000Z',
        startedAt: '2026-11-25T10:30:00.000Z',
        endedAt: '2026-11-25T10:30:01.000Z',
        durationMs: 100,
        lastError: null,
        payload: { name: 'history-refresh', command: 'spur history import' },
    },
    {
        id: 'job-adhoc-1',
        type: 'task-action',
        status: 'completed',
        attempts: 1,
        maxRetries: 1,
        queuedAt: '2026-11-25T10:25:00.000Z',
        startedAt: '2026-11-25T10:25:00.000Z',
        endedAt: '2026-11-25T10:25:02.000Z',
        durationMs: 2000,
        lastError: null,
        payload: { wbs: '1234' },
    },
];

function buildJobsResponse(jobsSource: QueueJobRow[], url: URL, overrideHasMore?: boolean): QueueJobListResponse {
    const excludeTypes = new Set(url.searchParams.getAll('excludeType'));
    const excludeCustomNames = new Set(url.searchParams.getAll('excludeCustomName'));
    const filtered = jobsSource.filter((job) => {
        if (excludeTypes.has(job.type)) return false;
        if (
            job.type === 'scheduler.custom' &&
            job.payload &&
            typeof job.payload.name === 'string' &&
            excludeCustomNames.has(job.payload.name)
        ) {
            return false;
        }
        return true;
    });
    const status = url.searchParams.get('status');
    const byStatus = status ? filtered.filter((j) => j.status === status) : filtered;
    const countsByStatus = {
        all: filtered.length,
        pending: filtered.filter((j) => j.status === 'pending').length,
        processing: filtered.filter((j) => j.status === 'processing').length,
        completed: filtered.filter((j) => j.status === 'completed').length,
        failed: filtered.filter((j) => j.status === 'failed').length,
    };
    return {
        jobs: byStatus,
        total: byStatus.length,
        hasMore: overrideHasMore ?? false,
        countsByStatus,
    };
}

function createMockFetch(options: {
    schedules?: SchedulerScheduleRow[];
    schedulesStatus?: number;
    jobs?: QueueJobRow[];
    hasMoreForFirstPage?: boolean;
}) {
    const requests: string[] = [];
    const schedules = options.schedules ?? SCHEDULES;
    const jobs = options.jobs ?? ALL_JOBS;

    const mockFetch: typeof fetch = Object.assign(
        async (input: string | URL | Request) => {
            const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            requests.push(rawUrl);
            const url = new URL(rawUrl, 'http://localhost');

            if (url.pathname.endsWith('/jobs/schedules')) {
                if (options.schedulesStatus && options.schedulesStatus >= 400) {
                    return new Response('boom', { status: options.schedulesStatus });
                }
                return new Response(JSON.stringify({ schedules }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }

            if (url.pathname.endsWith('/jobs')) {
                const offset = Number(url.searchParams.get('offset') ?? '0');
                const template = ALL_JOBS[3];
                const pageJobs =
                    offset > 0 && template
                        ? [
                              {
                                  ...template,
                                  id: `job-page-${offset}`,
                              },
                          ]
                        : jobs;
                const body = buildJobsResponse(pageJobs, url, options.hasMoreForFirstPage && offset === 0);
                return new Response(JSON.stringify(body), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }

            return new Response('not found', { status: 404 });
        },
        { preconnect: () => {} },
    );

    return { mockFetch, requests };
}

describe('JobsTab schedule filter helpers', () => {
    test('defaultSelectedSchedules unchecks builtin and checks config schedules', () => {
        const selected = defaultSelectedSchedules(SCHEDULES);
        expect(selected.has('system-events-prune')).toBe(false);
        expect(selected.has('smoke')).toBe(false);
        expect(selected.has('observation-refresh')).toBe(false);
        expect(selected.has('history-refresh')).toBe(true);
        expect(selected.has('database-daily-maintenance')).toBe(true);
    });

    test('computeExcludedSchedules maps unchecked builtin to excludeTypes and config to excludeCustomNames', () => {
        const selected = new Set(['smoke', 'database-daily-maintenance']);
        const excluded = computeExcludedSchedules(SCHEDULES, selected);
        expect(excluded.excludeTypes).toEqual(['observation-refresh', 'system-events-prune']);
        expect(excluded.excludeCustomNames).toEqual(['history-refresh']);
        expect(computeExcludedSchedules(null, selected)).toEqual({
            excludeTypes: [],
            excludeCustomNames: [],
        });
    });
});

describe('JobsTab Active Schedules filter integration', () => {
    test('unchecks builtin schedules by default, checks config schedules, and excludes builtin jobs on initial fetch', async () => {
        const { mockFetch, requests } = createMockFetch({});
        setFetchForTesting(mockFetch);

        const view = render(<JobsTab timeRange="4h" />);

        await waitFor(() => {
            expect(view.queryByTestId('job-row-job-history-1')).not.toBeNull();
        });

        // No unfiltered /jobs request should have fired before schedules settled
        const jobRequests = requests.filter((u) => new URL(u, 'http://localhost').pathname.endsWith('/jobs'));
        expect(jobRequests).toHaveLength(1);
        const firstUrl = new URL(jobRequests[0] ?? '', 'http://localhost');
        expect(firstUrl.searchParams.getAll('excludeType').sort()).toEqual([
            'observation-refresh',
            'smoke',
            'system-events-prune',
        ]);
        expect(firstUrl.searchParams.getAll('excludeCustomName')).toEqual([]);

        // Builtin checkboxes are unchecked; config checkboxes are checked
        for (const name of ['system-events-prune', 'smoke', 'observation-refresh']) {
            const card = view.getByTestId(`schedule-item-${name}`);
            expect(card.getAttribute('data-checked')).toBe('false');
            const checkbox = view.getByTestId(`schedule-filter-${name}`) as HTMLInputElement;
            expect(checkbox.checked).toBe(false);
        }
        for (const name of ['history-refresh', 'database-daily-maintenance']) {
            const card = view.getByTestId(`schedule-item-${name}`);
            expect(card.getAttribute('data-checked')).toBe('true');
            const checkbox = view.getByTestId(`schedule-filter-${name}`) as HTMLInputElement;
            expect(checkbox.checked).toBe(true);
        }

        // Builtin jobs are omitted from Queue Jobs while config + ad-hoc jobs appear
        expect(view.queryByTestId('job-row-job-prune-1')).toBeNull();
        expect(view.queryByTestId('job-row-job-smoke-1')).toBeNull();
        expect(view.queryByTestId('job-row-job-history-1')).not.toBeNull();
        expect(view.queryByTestId('job-row-job-adhoc-1')).not.toBeNull();
    });

    test('checking a builtin schedule and unchecking a config schedule reflects in Queue Jobs', async () => {
        const { mockFetch, requests } = createMockFetch({});
        setFetchForTesting(mockFetch);

        const view = render(<JobsTab timeRange="4h" />);
        await waitFor(() => {
            expect(view.queryByTestId('job-row-job-history-1')).not.toBeNull();
        });

        // Check `smoke`
        fireEvent.click(view.getByTestId('schedule-filter-smoke'));
        await waitFor(() => {
            expect(view.queryByTestId('job-row-job-smoke-1')).not.toBeNull();
        });
        expect((view.getByTestId('schedule-filter-smoke') as HTMLInputElement).checked).toBe(true);
        expect(view.getByTestId('schedule-item-smoke').getAttribute('data-checked')).toBe('true');

        // Uncheck `history-refresh`
        fireEvent.click(view.getByTestId('schedule-filter-history-refresh'));
        await waitFor(() => {
            expect(view.queryByTestId('job-row-job-history-1') === null).toBe(true);
        });
        expect((view.getByTestId('schedule-filter-history-refresh') as HTMLInputElement).checked).toBe(false);

        const jobRequests = requests.filter((u) => new URL(u, 'http://localhost').pathname.endsWith('/jobs'));
        const latestUrl = new URL(jobRequests[jobRequests.length - 1] ?? '', 'http://localhost');
        expect(latestUrl.searchParams.getAll('excludeType').sort()).toEqual([
            'observation-refresh',
            'system-events-prune',
        ]);
        expect(latestUrl.searchParams.getAll('excludeCustomName')).toEqual(['history-refresh']);
    });

    test('toggling a schedule resets pagination offset to 0', async () => {
        const { mockFetch, requests } = createMockFetch({ hasMoreForFirstPage: true });
        setFetchForTesting(mockFetch);

        const view = render(<JobsTab timeRange="4h" />);
        await waitFor(() => {
            expect(view.queryByTestId('jobs-load-more-btn')).not.toBeNull();
        });

        fireEvent.click(view.getByTestId('jobs-load-more-btn'));
        await waitFor(() => {
            const jobRequests = requests.filter((u) => new URL(u, 'http://localhost').pathname.endsWith('/jobs'));
            const lastReq = jobRequests[jobRequests.length - 1] ?? '';
            expect(new URL(lastReq, 'http://localhost').searchParams.get('offset')).toBe('100');
        });

        fireEvent.click(view.getByTestId('schedule-filter-smoke'));
        await waitFor(() => {
            const jobRequests = requests.filter((u) => new URL(u, 'http://localhost').pathname.endsWith('/jobs'));
            const latest = new URL(jobRequests[jobRequests.length - 1] ?? '', 'http://localhost');
            expect(latest.searchParams.getAll('excludeType')).not.toContain('smoke');
            expect(latest.searchParams.get('offset')).toBe('0');
        });
    });

    test('Select all and Defaults buttons update schedule selection and Queue Jobs', async () => {
        const { mockFetch } = createMockFetch({});
        setFetchForTesting(mockFetch);

        const view = render(<JobsTab timeRange="4h" />);
        await waitFor(() => {
            expect(view.queryByTestId('schedules-select-all')).not.toBeNull();
        });

        fireEvent.click(view.getByTestId('schedules-select-all'));
        await waitFor(() => {
            expect(view.queryByTestId('job-row-job-prune-1')).not.toBeNull();
            expect(view.queryByTestId('job-row-job-smoke-1')).not.toBeNull();
        });

        fireEvent.click(view.getByTestId('schedules-reset-defaults'));
        await waitFor(() => {
            expect(view.queryByTestId('job-row-job-prune-1') === null).toBe(true);
            expect(view.queryByTestId('job-row-job-smoke-1') === null).toBe(true);
        });
    });

    test('shows filter-aware empty message when schedule filters exclude all jobs', async () => {
        const onlyBuiltinJobs = ALL_JOBS.filter((j) => j.type === 'system-events-prune' || j.type === 'smoke');
        const { mockFetch } = createMockFetch({ jobs: onlyBuiltinJobs });
        setFetchForTesting(mockFetch);

        const view = render(<JobsTab timeRange="4h" />);
        await waitFor(() => {
            expect(view.queryByTestId('jobs-empty-state')).not.toBeNull();
        });
        expect(view.getByTestId('jobs-empty-state').textContent).toContain('schedule filters');
    });

    test('degrades gracefully and loads unfiltered jobs when /api/jobs/schedules fails', async () => {
        const { mockFetch } = createMockFetch({ schedulesStatus: 500 });
        setFetchForTesting(mockFetch);

        const view = render(<JobsTab timeRange="4h" />);
        await waitFor(() => {
            expect(view.queryByTestId('schedules-error')).not.toBeNull();
            expect(view.queryByTestId('job-row-job-prune-1')).not.toBeNull();
        });
    });
});
