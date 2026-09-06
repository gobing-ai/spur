import { describe, expect, test } from 'bun:test';
import {
    type ObservabilitySummaryResponse,
    observabilitySummaryResponseSchema,
    type QueueJobListResponse,
    queueJobListResponseSchema,
    type SchedulerSchedulesResponse,
    schedulerSchedulesResponseSchema,
} from '../src';

describe('observability contracts', () => {
    test('observabilitySummaryResponseSchema validates complete payload', () => {
        const fixture: ObservabilitySummaryResponse = {
            window: {
                since: '2026-09-06T12:00:00.000Z',
                until: '2026-09-06T16:00:00.000Z',
                range: '4h',
            },
            kpis: {
                totalEvents: 42,
                activeJobs: 1,
                completedJobs: 10,
                failedJobs: 2,
                successRatePct: 83,
                errorEventCount: 3,
                warningEventCount: 5,
            },
            eventVolumeBuckets: [
                {
                    timestamp: '2026-09-06T12:00:00.000Z',
                    total: 5,
                    byPrefix: { task: 3, queue: 2 },
                    bySeverity: { info: 4, warning: 1, error: 0, unknown: 0 },
                },
            ],
            topEventTypes: [
                {
                    name: 'task.created',
                    prefix: 'task',
                    count: 3,
                    latestAt: '2026-09-06T12:30:00.000Z',
                },
            ],
            recentErrors: [
                {
                    id: 'err-1',
                    source: 'event',
                    name: 'task.failed',
                    occurredAt: '2026-09-06T12:45:00.000Z',
                    message: 'Precheck failed',
                    refId: '0789',
                },
                {
                    id: 'err-2',
                    source: 'job',
                    name: 'smoke.tick',
                    occurredAt: '2026-09-06T12:50:00.000Z',
                    message: 'Worker timed out',
                },
            ],
        };

        const parsed = observabilitySummaryResponseSchema.parse(fixture);
        expect(parsed).toEqual(fixture);
    });

    test('queueJobListResponseSchema validates null timing and payload handling', () => {
        const fixture: QueueJobListResponse = {
            jobs: [
                {
                    id: 'job-1',
                    type: 'smoke.tick',
                    status: 'pending',
                    attempts: 0,
                    maxRetries: 3,
                    queuedAt: '2026-09-06T12:00:00.000Z',
                    startedAt: null,
                    endedAt: null,
                    durationMs: null,
                    lastError: null,
                    payload: null,
                },
                {
                    id: 'job-2',
                    type: 'system.events.prune',
                    status: 'completed',
                    attempts: 1,
                    maxRetries: 1,
                    queuedAt: '2026-09-06T12:00:00.000Z',
                    startedAt: '2026-09-06T12:00:01.000Z',
                    endedAt: '2026-09-06T12:00:05.000Z',
                    durationMs: 4000,
                    lastError: null,
                    payload: { source: 'scheduler' },
                },
            ],
            total: 2,
            hasMore: false,
            countsByStatus: {
                all: 2,
                pending: 1,
                processing: 0,
                completed: 1,
                failed: 0,
            },
        };

        const parsed = queueJobListResponseSchema.parse(fixture);
        expect(parsed.jobs[0]?.startedAt).toBeNull();
        expect(parsed.jobs[0]?.durationMs).toBeNull();
        expect(parsed.jobs[1]?.durationMs).toBe(4000);
    });

    test('schedulerSchedulesResponseSchema validates builtin and cron entries', () => {
        const fixture: SchedulerSchedulesResponse = {
            schedules: [
                {
                    name: 'system.events.prune',
                    cron: '300000',
                    cadence: 'every 5 minutes',
                    nextFireAt: '2026-09-06T12:05:00.000Z',
                    lastFiredAt: '2026-09-06T12:00:00.000Z',
                    lastStatus: 'completed',
                    source: 'builtin',
                },
                {
                    name: 'daily-report',
                    cron: '0 0 * * *',
                    cadence: '0 0 * * *',
                    nextFireAt: null,
                    lastFiredAt: null,
                    lastStatus: 'none',
                    source: 'config',
                },
            ],
        };

        const parsed = schedulerSchedulesResponseSchema.parse(fixture);
        expect(parsed.schedules[0]?.source).toBe('builtin');
        expect(parsed.schedules[1]?.nextFireAt).toBeNull();
        expect(parsed.schedules[1]?.lastStatus).toBe('none');
    });
});
