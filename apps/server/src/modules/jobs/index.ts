import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';

/**
 * Server module for queue/job observability.
 *
 * GET /api/jobs/stats returns queue counts by status from the configured
 * `JobQueue` producer. The module is Bun-context gated; Workers have no local
 * SQLite queue to inspect.
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
    },
};
