import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { ServerContext, ServerJobQueue } from '../../../src/context';
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
