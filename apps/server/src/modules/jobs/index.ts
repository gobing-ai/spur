import type { SchedulerLastStatus, SchedulerScheduleRow } from '@gobing-ai/spur-contracts';
import {
    queryQueueJobs,
    queryScheduleLastExecution,
    type SystemEventDao,
    type SystemEventRow,
} from '@gobing-ai/spur-domain';
import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';
import { getRegisteredSchedules } from './schedule-registry';

export * from './schedule-registry';

/** Terminal queue events whose persisted envelope carries the true attempt duration. */
const TERMINAL_JOB_EVENT_NAMES = ['queue.job.completed', 'queue.job.failed'] as const;

/**
 * Task 0806 R4: `markCompleted`/`markFailed` clear `processing_at`, so a
 * terminal row alone cannot answer "when did it actually run and for how long".
 * The terminal `queue.job.*` events DO carry the handler `durationMs`, and the
 * `queue.job.started` event (R5) carries `entityId` — both are persisted in
 * `system_events`. Enrich terminal page rows from those rows; anything not
 * observed stays null — a legacy row is never assigned its enqueue time as its
 * start. Bounded: one query for the whole page, payload parse failures skipped.
 */
export async function enrichTerminalJobsFromEvents(
    dao: SystemEventDao,
    jobs: Array<{ id: string; status: string; startedAt: string | null; durationMs: number | null }>,
): Promise<void> {
    const pending = jobs.filter(
        (job) => (job.status === 'completed' || job.status === 'failed') && job.durationMs === null,
    );
    if (pending.length === 0) return;

    const oldestQueuedAt = jobs.reduce<string | undefined>((acc, job) => {
        const queuedAt = (job as { queuedAt?: string | null }).queuedAt ?? undefined;
        return acc === undefined || queuedAt === undefined || queuedAt < acc ? (queuedAt ?? acc) : acc;
    }, undefined);

    let rows: SystemEventRow[];
    try {
        rows = await dao.query({
            names: [...TERMINAL_JOB_EVENT_NAMES, 'queue.job.started'],
            since: oldestQueuedAt,
            limit: 500,
        });
    } catch {
        return; // Enrichment is best-effort; the raw projection stands on failure.
    }

    const durationByJob = new Map<string, number>();
    const startByJob = new Map<string, string>();
    for (const row of rows) {
        // Started anchors carry jobId via entity_id; their payload may be empty.
        if (row.event_name === 'queue.job.started') {
            if (typeof row.entity_id === 'string' && row.entity_id.length > 0 && !startByJob.has(row.entity_id)) {
                startByJob.set(row.entity_id, row.occurred_at);
            }
            continue;
        }
        let data: Record<string, unknown> | undefined;
        try {
            const parsed: unknown = JSON.parse(row.payload_json ?? '');
            if (parsed !== null && typeof parsed === 'object') {
                data = (parsed as { data?: unknown }).data as Record<string, unknown> | undefined;
            }
        } catch {
            continue;
        }
        if (data === undefined) continue;
        const candidateJobId = typeof data.jobId === 'string' ? data.jobId : row.entity_id;
        if (typeof candidateJobId !== 'string' || candidateJobId.length === 0) continue;
        if (typeof data.durationMs === 'number' && Number.isFinite(data.durationMs)) {
            durationByJob.set(candidateJobId, data.durationMs);
        }
    }

    for (const job of pending) {
        const durationMs = durationByJob.get(job.id);
        if (durationMs !== undefined) job.durationMs = durationMs;
        if (job.startedAt === null) {
            const startedAt = startByJob.get(job.id);
            if (startedAt !== undefined) job.startedAt = startedAt;
        }
    }
}

/**
 * Server module for queue/job observability.
 *
 * GET /api/jobs/stats returns queue counts by status from the configured
 * `JobQueue` producer. The module is Bun-context gated; Workers have no local
 * SQLite queue to inspect.
 *
 * GET /api/jobs queries the persistent queue_jobs table with filtering and pagination.
 *
 * GET /api/jobs/schedules returns registered scheduler entries with timing and latest status.
 */
export const jobsModule: ServerModule = {
    name: 'jobs',

    mount(app: Hono, ctx: ServerContext | undefined): void {
        if (!ctx) return;

        app.get('/api/jobs/stats', async (c) => {
            const queue = await ctx.jobQueue();
            const stats = await queue.stats();
            return c.json({ stats });
        });

        app.get('/api/jobs', async (c) => {
            try {
                const statusParam = c.req.query('status');
                const sinceParam = c.req.query('since');
                const limitParam = c.req.query('limit');
                const offsetParam = c.req.query('offset');

                const validStatuses = ['pending', 'processing', 'completed', 'failed'] as const;
                type Status = (typeof validStatuses)[number];
                let status: Status | undefined;
                if (statusParam !== undefined && statusParam !== '') {
                    if (!validStatuses.includes(statusParam as Status)) {
                        return c.json(
                            {
                                error: `unknown status: "${statusParam}", expected one of: ${validStatuses.join(', ')}`,
                                code: 'VALIDATION_FAILED',
                            },
                            400,
                        );
                    }
                    status = statusParam as Status;
                }

                let limit = 100;
                if (limitParam !== undefined && limitParam !== '') {
                    const parsedLimit = Number(limitParam);
                    if (!Number.isNaN(parsedLimit)) {
                        limit = Math.min(500, Math.max(1, parsedLimit));
                    }
                }

                let offset = 0;
                if (offsetParam !== undefined && offsetParam !== '') {
                    const parsedOffset = Number(offsetParam);
                    if (!Number.isNaN(parsedOffset)) {
                        offset = Math.max(0, parsedOffset);
                    }
                }

                const db = await ctx.getDb();
                const result = await queryQueueJobs(db, {
                    status,
                    since: sinceParam,
                    limit,
                    offset,
                });
                // Task 0806 R4: recover the true attempt duration/start for terminal
                // rows whose `processing_at` was cleared on completion.
                try {
                    await enrichTerminalJobsFromEvents(await ctx.systemEventDao(), result.jobs);
                } catch {
                    // Best-effort enrichment only.
                }

                return c.json(result);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return c.json({ error: message }, 500);
            }
        });

        app.get('/api/jobs/schedules', async (c) => {
            try {
                const registrations = getRegisteredSchedules();
                const db = await ctx.getDb();
                const now = Date.now();

                const schedules = await Promise.all(
                    registrations.map(async (reg) => {
                        const matchingRow = await queryScheduleLastExecution(db, reg.source, reg.name);

                        const lastFiredAt = matchingRow ? new Date(matchingRow.updated_at).toISOString() : null;
                        let lastStatus: SchedulerLastStatus = 'none';
                        if (matchingRow) {
                            lastStatus = matchingRow.status === 'pending' ? 'processing' : matchingRow.status;
                        }

                        const intervalMs = Number(reg.schedule);
                        const isInterval = !Number.isNaN(intervalMs) && intervalMs > 0 && /^\d+$/.test(reg.schedule);

                        let nextFireAt: string | null = null;
                        let cadence: string = reg.schedule;

                        if (isInterval) {
                            const elapsed = Math.max(0, now - reg.registeredAt);
                            const steps = Math.ceil(elapsed / intervalMs);
                            const nextTime = reg.registeredAt + (steps === 0 ? 1 : steps) * intervalMs;
                            const resolvedNextTime = nextTime <= now ? nextTime + intervalMs : nextTime;
                            nextFireAt = new Date(resolvedNextTime).toISOString();

                            if (intervalMs >= 60_000 && intervalMs % 60_000 === 0) {
                                cadence = `every ${intervalMs / 60_000} minutes`;
                            } else if (intervalMs >= 1000 && intervalMs % 1000 === 0) {
                                cadence = `every ${intervalMs / 1000} seconds`;
                            } else {
                                cadence = `every ${intervalMs} ms`;
                            }
                        } else {
                            nextFireAt = null;
                            cadence = reg.schedule;
                        }

                        const row: SchedulerScheduleRow = {
                            name: reg.name,
                            cron: reg.schedule,
                            cadence,
                            nextFireAt,
                            lastFiredAt,
                            lastStatus,
                            source: reg.source,
                        };
                        return row;
                    }),
                );

                return c.json({ schedules });
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return c.json({ error: message }, 500);
            }
        });
    },
};
