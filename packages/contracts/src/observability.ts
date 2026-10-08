import { z } from 'zod';

/**
 * KPI totals and rates aggregated across events and jobs schema.
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
/**
 * KPI totals and rates aggregated across events and jobs.
 */
export type ObservabilitySummaryKpis = z.infer<typeof observabilitySummaryKpisSchema>;

/**
 * Single time-bucketed event volume distribution schema.
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
/**
 * Single time-bucketed event volume distribution.
 */
export type ObservabilityVolumeBucket = z.infer<typeof observabilityVolumeBucketSchema>;

/**
 * Top occurring event type aggregated by name schema.
 */
export const observabilityTopEventTypeSchema = z.object({
    name: z.string(),
    prefix: z.string(),
    count: z.number(),
    latestAt: z.string(),
    /** Mean `durationMs` for this type in the window; `null` when none recorded a duration. */
    avgDurationMs: z.number().nullable(),
    /** Count of this type with `presentation.severity === 'error'`. */
    failureCount: z.number(),
});
/**
 * Top occurring event type aggregated by name.
 */
export type ObservabilityTopEventType = z.infer<typeof observabilityTopEventTypeSchema>;

/**
 * Unified error record sourced from either a failed system event or failed queue job schema.
 */
export const observabilityRecentErrorSchema = z.object({
    id: z.string(),
    source: z.enum(['event', 'job']),
    name: z.string(),
    occurredAt: z.string(),
    message: z.string(),
    refId: z.string().optional(),
});
/**
 * Unified error record sourced from either a failed system event or failed queue job.
 */
export type ObservabilityRecentError = z.infer<typeof observabilityRecentErrorSchema>;

/**
 * Aggregated response for the Observability Summary tab schema.
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
/**
 * Aggregated response for the Observability Summary tab.
 */
export type ObservabilitySummaryResponse = z.infer<typeof observabilitySummaryResponseSchema>;

/**
 * Valid lifecycle states for a queue job schema.
 */
export const queueJobStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed']);
/**
 * Valid lifecycle states for a queue job.
 */
export type QueueJobStatus = z.infer<typeof queueJobStatusSchema>;

/**
 * Single row representation of a persistent queue job schema.
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
/**
 * Single row representation of a persistent queue job.
 */
export type QueueJobRow = z.infer<typeof queueJobRowSchema>;

/**
 * Job count breakdown by lifecycle status across the queried window schema.
 */
export const queueJobStatusCountsSchema = z.object({
    all: z.number(),
    pending: z.number(),
    processing: z.number(),
    completed: z.number(),
    failed: z.number(),
});
/**
 * Job count breakdown by lifecycle status across the queried window.
 */
export type QueueJobStatusCounts = z.infer<typeof queueJobStatusCountsSchema>;

/**
 * Response for queue job listings with pagination and status counts schema.
 */
export const queueJobListResponseSchema = z.object({
    jobs: z.array(queueJobRowSchema),
    total: z.number(),
    hasMore: z.boolean(),
    countsByStatus: queueJobStatusCountsSchema,
});
/**
 * Response for queue job listings with pagination and status counts.
 */
export type QueueJobListResponse = z.infer<typeof queueJobListResponseSchema>;

/**
 * Latest execution status for a registered schedule entry schema.
 */
export const schedulerLastStatusSchema = z.enum(['completed', 'failed', 'processing', 'none']);
/**
 * Latest execution status for a registered schedule entry.
 */
export type SchedulerLastStatus = z.infer<typeof schedulerLastStatusSchema>;

/**
 * Single registered schedule entry with runtime cadence and status schema.
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
/**
 * Single registered schedule entry with runtime cadence and status.
 */
export type SchedulerScheduleRow = z.infer<typeof schedulerScheduleRowSchema>;

/**
 * Response for registered scheduler jobs schema.
 */
export const schedulerSchedulesResponseSchema = z.object({
    schedules: z.array(schedulerScheduleRowSchema),
});
/**
 * Response for registered scheduler jobs.
 */
export type SchedulerSchedulesResponse = z.infer<typeof schedulerSchedulesResponseSchema>;

/**
 * One caller-observed decision lifecycle phase (task 1100).
 */
export const decisionPhaseSchema = z.object({
    phase: z.enum(['resolve', 'evidence', 'maker', 'serve']),
    startedAt: z.number(),
    durationMs: z.number(),
});
/**
 * One caller-observed decision lifecycle phase.
 */
export type DecisionPhase = z.infer<typeof decisionPhaseSchema>;

/**
 * List row of the Board Decisions tab: the full decision-log row minus the
 * mode-gated payload (`inputJson`, `question`, `phases`).
 */
export const decisionLogRowSchema = z.object({
    id: z.string(),
    decisionId: z.string(),
    decisionType: z.string().nullable(),
    caller: z.enum(['cli', 'workflow', 'gate']),
    runId: z.string().nullable(),
    workflowName: z.string().nullable(),
    nodeId: z.string().nullable(),
    wbs: z.string().nullable(),
    makerName: z.string().nullable(),
    makerSource: z.string().nullable(),
    catalogLayer: z.string().nullable(),
    catalogSource: z.string().nullable(),
    minConfidence: z.number().nullable(),
    inputKeys: z.array(z.string()),
    evidenceDigest: z.string().nullable(),
    outcome: z.enum(['accepted', 'fallback', 'rejected']),
    value: z.string().nullable(),
    fallbackValue: z.string().nullable(),
    source: z.string().nullable(),
    reason: z.string().nullable(),
    confidence: z.number().nullable(),
    error: z.string().nullable(),
    startedAt: z.string(),
    endedAt: z.string(),
    durationMs: z.number(),
    schemaVersion: z.number(),
});
/**
 * List row of the Board Decisions tab.
 */
export type DecisionLogRow = z.infer<typeof decisionLogRowSchema>;

/**
 * Full decision-log row: adds the redacted input text, inline question and
 * phase timings (detail drawer only).
 */
export const decisionLogDetailSchema = decisionLogRowSchema.extend({
    question: z.string().nullable(),
    inputJson: z.string().nullable(),
    phases: z.array(decisionPhaseSchema),
});
/**
 * Full decision-log row with the mode-gated payload.
 */
export type DecisionLogDetail = z.infer<typeof decisionLogDetailSchema>;

/**
 * KPI strip over the filtered decision set.
 */
export const decisionLogSummarySchema = z.object({
    count: z.number(),
    acceptedRate: z.number(),
    fallbackRate: z.number(),
    p95DurationMs: z.number().nullable(),
});
/**
 * KPI strip over the filtered decision set.
 */
export type DecisionLogSummary = z.infer<typeof decisionLogSummarySchema>;

/**
 * Response for decision-log listings: newest-first page, KPI strip, filter
 * facets and the next-page cursor.
 */
export const decisionLogListResponseSchema = z.object({
    rows: z.array(decisionLogRowSchema),
    summary: decisionLogSummarySchema,
    facets: z.object({ decisionIds: z.array(z.string()), makers: z.array(z.string()) }),
    nextCursor: z.string().nullable(),
});
/**
 * Response for decision-log listings.
 */
export type DecisionLogListResponse = z.infer<typeof decisionLogListResponseSchema>;
