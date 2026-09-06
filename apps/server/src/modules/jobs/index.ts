import type { SchedulerLastStatus, SchedulerScheduleRow } from '@gobing-ai/spur-contracts';
import { queryQueueJobs, queryScheduleLastExecution } from '@gobing-ai/spur-domain';
import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';
import { getRegisteredSchedules } from './schedule-registry';

export * from './schedule-registry';

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
