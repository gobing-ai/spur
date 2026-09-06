import { z } from 'zod';

/**
 * KPI totals and rates aggregated across events and jobs.
 */
export const observabilitySummaryKpisSchema = z.object({
    totalEvents: z.number(),
    activeJobs: z.number(),
    completedJobs: z.number(),
    failedJobs: z.number(),
    successRatePct: z.number(),
    errorEventCount: z.number(),
    warningEventCount: z.number(),
});
export type ObservabilitySummaryKpis = z.infer<typeof observabilitySummaryKpisSchema>;

/**
 * Single time-bucketed event volume distribution.
 */
export const observabilityVolumeBucketSchema = z.object({
    timestamp: z.string(),
    total: z.number(),
    byPrefix: z.record(z.string(), z.number()),
    bySeverity: z.object({
        info: z.number(),
        warning: z.number(),
        error: z.number(),
        unknown: z.number(),
    }),
});
export type ObservabilityVolumeBucket = z.infer<typeof observabilityVolumeBucketSchema>;

/**
 * Top occurring event type aggregated by name.
 */
export const observabilityTopEventTypeSchema = z.object({
    name: z.string(),
    prefix: z.string(),
    count: z.number(),
    latestAt: z.string(),
});
export type ObservabilityTopEventType = z.infer<typeof observabilityTopEventTypeSchema>;

/**
 * Unified error record sourced from either a failed system event or failed queue job.
 */
export const observabilityRecentErrorSchema = z.object({
    id: z.string(),
    source: z.enum(['event', 'job']),
    name: z.string(),
    occurredAt: z.string(),
    message: z.string(),
    refId: z.string().optional(),
});
export type ObservabilityRecentError = z.infer<typeof observabilityRecentErrorSchema>;

/**
 * Aggregated response for the Observability Summary tab.
 */
export const observabilitySummaryResponseSchema = z.object({
    window: z.object({
        since: z.string(),
        until: z.string(),
        range: z.string(),
    }),
    kpis: observabilitySummaryKpisSchema,
    eventVolumeBuckets: z.array(observabilityVolumeBucketSchema),
    topEventTypes: z.array(observabilityTopEventTypeSchema),
    recentErrors: z.array(observabilityRecentErrorSchema),
});
export type ObservabilitySummaryResponse = z.infer<typeof observabilitySummaryResponseSchema>;

/**
 * Valid lifecycle states for a queue job.
 */
export const queueJobStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed']);
export type QueueJobStatus = z.infer<typeof queueJobStatusSchema>;

/**
 * Single row representation of a persistent queue job.
 */
export const queueJobRowSchema = z.object({
    id: z.string(),
    type: z.string(),
    status: queueJobStatusSchema,
    attempts: z.number(),
    maxRetries: z.number(),
    queuedAt: z.string(),
    startedAt: z.string().nullable(),
    endedAt: z.string().nullable(),
    durationMs: z.number().nullable(),
    lastError: z.string().nullable(),
    payload: z.record(z.string(), z.unknown()).nullable(),
});
export type QueueJobRow = z.infer<typeof queueJobRowSchema>;

/**
 * Job count breakdown by lifecycle status across the queried window.
 */
export const queueJobStatusCountsSchema = z.object({
    all: z.number(),
    pending: z.number(),
    processing: z.number(),
    completed: z.number(),
    failed: z.number(),
});
export type QueueJobStatusCounts = z.infer<typeof queueJobStatusCountsSchema>;

/**
 * Response for queue job listings with pagination and status counts.
 */
export const queueJobListResponseSchema = z.object({
    jobs: z.array(queueJobRowSchema),
    total: z.number(),
    hasMore: z.boolean(),
    countsByStatus: queueJobStatusCountsSchema,
});
export type QueueJobListResponse = z.infer<typeof queueJobListResponseSchema>;

/**
 * Latest execution status for a registered schedule entry.
 */
export const schedulerLastStatusSchema = z.enum(['completed', 'failed', 'processing', 'none']);
export type SchedulerLastStatus = z.infer<typeof schedulerLastStatusSchema>;

/**
 * Single registered schedule entry with runtime cadence and status.
 */
export const schedulerScheduleRowSchema = z.object({
    name: z.string(),
    cron: z.string(),
    cadence: z.string(),
    nextFireAt: z.string().nullable(),
    lastFiredAt: z.string().nullable(),
    lastStatus: schedulerLastStatusSchema,
    source: z.enum(['builtin', 'config']),
});
export type SchedulerScheduleRow = z.infer<typeof schedulerScheduleRowSchema>;

/**
 * Response for registered scheduler jobs.
 */
export const schedulerSchedulesResponseSchema = z.object({
    schedules: z.array(schedulerScheduleRowSchema),
});
export type SchedulerSchedulesResponse = z.infer<typeof schedulerSchedulesResponseSchema>;
