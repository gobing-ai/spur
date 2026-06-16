import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';

/** Server start timestamp for uptime calculation. */
const startedAt = Date.now();

/**
 * Health module — the reference ServerModule implementation.
 *
 * Proves the registry pattern (design §2.4): the liveness + readiness
 * endpoints register through the same `ServerModule` interface every
 * domain module uses. Routes are raw Hono handlers (not oRPC) because
 * health is infrastructure, not an API domain.
 */
export const healthModule: ServerModule = {
    name: 'health',

    mount(app: Hono, ctx: ServerContext | undefined): void {
        // ── Liveness ──
        app.get('/api/health', (c) => {
            const uptime = (Date.now() - startedAt) / 1000;
            const memory = process.memoryUsage();
            return c.json({
                status: 'ok',
                uptime_seconds: Math.round(uptime),
                memory_rss_mb: Math.round((memory.rss / 1_048_576) * 100) / 100,
                memory_heap_mb: Math.round((memory.heapUsed / 1_048_576) * 100) / 100,
            });
        });

        // ── Readiness ──
        app.get('/api/health/ready', async (c) => {
            if (!ctx) {
                return c.json({ status: 'error', db: 'unavailable' }, 503);
            }
            const ok = await ctx.checkDbHealth();
            if (ok) {
                return c.json({ status: 'ok', db: 'connected' });
            }
            return c.json({ status: 'error', db: 'unreachable' }, 503);
        });
    },
};
