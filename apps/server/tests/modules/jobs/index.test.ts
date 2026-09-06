import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleSchedulerCustomJob, SCHEDULER_CUSTOM_JOB } from '@gobing-ai/spur-app';
import { EventBus } from '@gobing-ai/ts-infra';
import { createNodeFileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { Hono } from 'hono';
import { createServerContext, type ServerContext, type ServerJobQueue } from '../../../src/context';
import { jobsModule } from '../../../src/modules/jobs';

function ctxWithStats(stats: Awaited<ReturnType<ServerJobQueue['stats']>>): ServerContext {
    const queue = {
        stats: async () => stats,
    } as unknown as ServerJobQueue;
    return {
        jobQueue: async () => queue,
    } as unknown as ServerContext;
}

describe('jobs module', () => {
    test('GET /api/jobs/stats returns queue counts', async () => {
        const app = new Hono();
        jobsModule.mount(app, ctxWithStats({ pending: 2, processing: 1, completed: 3, failed: 4 }));

        const res = await app.fetch(new Request('http://localhost/api/jobs/stats'));
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({
            stats: { pending: 2, processing: 1, completed: 3, failed: 4 },
        });
    });

    test('is a no-op when ctx is undefined', async () => {
        const app = new Hono();
        expect(() => jobsModule.mount(app, undefined)).not.toThrow();
        const res = await app.fetch(new Request('http://localhost/api/jobs/stats'));
        expect(res.status).toBe(404);
    });
});

describe('jobs stats count scheduler.custom rows without an API change (task 0734)', () => {
    test('a completed job and a retry-exhausted job land in the existing counts', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-0734-stats-'));
        const ctx = createServerContext((await import('../../middleware/helpers')).mockRuntime(), {
            cwd,
            fs: createNodeFileSystem(cwd),
            dbUrl: ':memory:',
            jobQueueEnabled: true,
            eventsBus: new EventBus<Record<string, (event: unknown) => void>>(),
        });
        const db = await ctx.getDb();

        try {
            const queue = await ctx.jobQueue();
            await queue.enqueue(SCHEDULER_CUSTOM_JOB, { name: 'ok-job', command: 'exit 0' });
            await queue.enqueue(SCHEDULER_CUSTOM_JOB, { name: 'bad-job', command: 'exit 7' });

            const consumer = await ctx.queueConsumer();
            const executor = new NodeProcessExecutor();
            consumer.register(SCHEDULER_CUSTOM_JOB, (job) => handleSchedulerCustomJob({ cwd, executor }, job));

            // Drive bad-job through the real three-attempt policy. Each retry parks the
            // row behind an exponential next_retry_at, so the test travels time forward
            // rather than sleeping; the retry/failure decision itself stays untouched.
            for (let attempt = 0; attempt < 3; attempt++) {
                await consumer.processOnce();
                await db.run('UPDATE queue_jobs SET next_retry_at = 0 WHERE status = ?', ['pending']);
            }

            const app = new Hono();
            jobsModule.mount(app, ctx);
            const res = await app.fetch(new Request('http://localhost/api/jobs/stats'));
            expect(res.status).toBe(200);

            const { stats } = (await res.json()) as { stats: Record<string, number> };
            expect(stats.completed).toBe(1);
            expect(stats.failed).toBe(1);
            expect(stats.pending).toBe(0);
        } finally {
            db.close();
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('GET /api/jobs supports status filtering, pagination, and rejects invalid status with 400', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-0789-jobs-api-'));
        const ctx = createServerContext((await import('../../middleware/helpers')).mockRuntime(), {
            cwd,
            fs: createNodeFileSystem(cwd),
            dbUrl: ':memory:',
            jobQueueEnabled: true,
            eventsBus: new EventBus<Record<string, (event: unknown) => void>>(),
        });
        const db = await ctx.getDb();

        try {
            const now = Date.now();
            await db.run(
                `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at)
                 VALUES ('j-1', 'job.one', '{}', 'completed', 1, 3, ?, ?)`,
                now - 2000,
                now - 1000,
            );
            await db.run(
                `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at, last_error)
                 VALUES ('j-2', 'job.two', '{}', 'failed', 3, 3, ?, ?, 'Error message')`,
                now - 1000,
                now - 500,
            );

            const app = new Hono();
            jobsModule.mount(app, ctx);

            // 1. Filter by status=failed
            const resFailed = await app.fetch(new Request('http://localhost/api/jobs?status=failed'));
            expect(resFailed.status).toBe(200);
            const dataFailed = (await resFailed.json()) as {
                jobs: Array<{ id: string }>;
                total: number;
                countsByStatus: { all: number; failed: number };
            };
            expect(dataFailed.jobs).toHaveLength(1);
            expect(dataFailed.jobs[0]?.id).toBe('j-2');
            expect(dataFailed.total).toBe(1);
            expect(dataFailed.countsByStatus.all).toBe(2);

            // 2. Pagination with limit=1 and offset=1
            const resPaged = await app.fetch(new Request('http://localhost/api/jobs?limit=1&offset=1'));
            expect(resPaged.status).toBe(200);
            const dataPaged = (await resPaged.json()) as {
                jobs: Array<{ id: string }>;
                hasMore: boolean;
            };
            expect(dataPaged.jobs).toHaveLength(1);
            expect(dataPaged.jobs[0]?.id).toBe('j-1');
            expect(dataPaged.hasMore).toBe(false);

            // 3. Unknown status returns 400
            const resBogus = await app.fetch(new Request('http://localhost/api/jobs?status=bogus'));
            expect(resBogus.status).toBe(400);
            const err = (await resBogus.json()) as { error: string; code: string };
            expect(err.code).toBe('VALIDATION_FAILED');
        } finally {
            db.close();
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('GET /api/jobs/schedules returns registered jobs with timing and latest status', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-0789-schedules-api-'));
        const ctx = createServerContext((await import('../../middleware/helpers')).mockRuntime(), {
            cwd,
            fs: createNodeFileSystem(cwd),
            dbUrl: ':memory:',
            jobQueueEnabled: true,
            eventsBus: new EventBus<Record<string, (event: unknown) => void>>(),
        });
        const db = await ctx.getDb();

        const { setRegisteredSchedules, resetRegisteredSchedulesForTesting } = await import(
            '../../../src/modules/jobs/schedule-registry'
        );

        try {
            resetRegisteredSchedulesForTesting();
            const app = new Hono();
            jobsModule.mount(app, ctx);

            // 1. Zero registrations
            const resEmpty = await app.fetch(new Request('http://localhost/api/jobs/schedules'));
            expect(resEmpty.status).toBe(200);
            const dataEmpty = (await resEmpty.json()) as { schedules: unknown[] };
            expect(dataEmpty.schedules).toEqual([]);

            // 2. Register built-in and config jobs covering minutes, seconds, ms, and pending status
            const now = Date.now();
            setRegisteredSchedules([
                {
                    name: 'system.events.prune',
                    schedule: '300000',
                    source: 'builtin',
                    registeredAt: now - 60_000,
                },
                {
                    name: 'fast-ticker',
                    schedule: '5000',
                    source: 'builtin',
                    registeredAt: now - 1000,
                },
                {
                    name: 'raw-ms-ticker',
                    schedule: '500',
                    source: 'builtin',
                    registeredAt: now - 100,
                },
                {
                    name: 'pending-job',
                    schedule: '60000',
                    source: 'builtin',
                    registeredAt: now - 10_000,
                },
                {
                    name: 'daily-job',
                    schedule: '0 0 * * *',
                    source: 'config',
                    registeredAt: now - 60_000,
                },
            ]);

            // Seed a completed row for system.events.prune
            await db.run(
                `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at)
                 VALUES ('job-prune-1', 'system.events.prune', '{}', 'completed', 1, 3, ?, ?)`,
                now - 50_000,
                now - 45_000,
            );

            // Seed a pending row for pending-job
            await db.run(
                `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at)
                 VALUES ('job-pending-1', 'pending-job', '{}', 'pending', 1, 3, ?, ?)`,
                now - 5000,
                now - 5000,
            );

            const res = await app.fetch(new Request('http://localhost/api/jobs/schedules'));
            expect(res.status).toBe(200);
            const data = (await res.json()) as {
                schedules: Array<{
                    name: string;
                    cron: string;
                    cadence: string;
                    nextFireAt: string | null;
                    lastFiredAt: string | null;
                    lastStatus: string;
                    source: string;
                }>;
            };

            expect(data.schedules).toHaveLength(5);

            // Built-in interval entry (minutes)
            const prune = data.schedules.find((s) => s.name === 'system.events.prune');
            expect(prune?.cadence).toBe('every 5 minutes');
            expect(prune?.nextFireAt).not.toBeNull();
            expect(prune?.lastStatus).toBe('completed');
            expect(prune?.lastFiredAt).toBe(new Date(now - 45_000).toISOString());
            expect(prune?.source).toBe('builtin');

            // Built-in interval entry (seconds)
            const ticker = data.schedules.find((s) => s.name === 'fast-ticker');
            expect(ticker?.cadence).toBe('every 5 seconds');

            // Built-in interval entry (ms)
            const msTicker = data.schedules.find((s) => s.name === 'raw-ms-ticker');
            expect(msTicker?.cadence).toBe('every 500 ms');

            // Built-in pending entry maps to 'processing'
            const pendingJob = data.schedules.find((s) => s.name === 'pending-job');
            expect(pendingJob?.lastStatus).toBe('processing');

            // Config cron entry per D4: nextFireAt is null
            const daily = data.schedules.find((s) => s.name === 'daily-job');
            expect(daily?.cadence).toBe('0 0 * * *');
            expect(daily?.nextFireAt).toBeNull();
            expect(daily?.lastStatus).toBe('none');
            expect(daily?.lastFiredAt).toBeNull();
            expect(daily?.source).toBe('config');
        } finally {
            resetRegisteredSchedulesForTesting();
            db.close();
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('handles internal errors with 500 status', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-0789-err-'));
        const ctx = createServerContext((await import('../../middleware/helpers')).mockRuntime(), {
            cwd,
            fs: createNodeFileSystem(cwd),
            dbUrl: ':memory:',
            jobQueueEnabled: true,
            eventsBus: new EventBus<Record<string, (event: unknown) => void>>(),
        });
        const app = new Hono();
        (ctx as unknown as { getDb: () => Promise<unknown> }).getDb = async () => {
            throw new Error('boom');
        };
        jobsModule.mount(app, ctx);

        const resJobs = await app.fetch(new Request('http://localhost/api/jobs'));
        expect(resJobs.status).toBe(500);

        const resSched = await app.fetch(new Request('http://localhost/api/jobs/schedules'));
        expect(resSched.status).toBe(500);

        rmSync(cwd, { recursive: true, force: true });
    });
});
