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
});
