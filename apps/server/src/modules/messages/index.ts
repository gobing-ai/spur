import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';

/**
 * Server module that mounts the read-only messages API for the observabilities board.
 *
 * Two endpoints:
 *   - GET /api/messages/inbox?agent=<id>&limit=<n>  — one agent's inbox (newest-first)
 *   - GET /api/messages?limit=<n>                    — global recent-message feed (newest-first)
 *
 * Gated by ServerContext: on Bun the routes are active; on Cloudflare Workers
 * (ctx undefined) the module is a no-op (the inbox table is Bun-only — D1 has no
 * shared SQLite with the operator's `.spur` DB).
 */
export const messagesModule: ServerModule = {
    name: 'messages',

    mount(app: Hono, ctx: ServerContext | undefined): void {
        if (!ctx) return;

        // GET /api/messages/inbox — one agent's inbox queue.
        // Query: ?agent=<id> (required) &limit=<int, default 50, max 500> &offset=<int>
        app.get('/api/messages/inbox', async (c) => {
            const agent = c.req.query('agent');
            if (!agent) {
                return c.json({ error: 'missing required query parameter: agent' }, 400);
            }
            const limit = parseLimit(c.req.query('limit'), 50);
            const offsetParam = c.req.query('offset');
            const offset = offsetParam === undefined ? undefined : parseLimit(offsetParam, 0);
            const svc = ctx.teamService();
            const result = await svc.getInbox(agent, limit, offset);
            return c.json(result);
        });

        // GET /api/messages — global recent-message feed across all agents (newest-first).
        // Query: ?limit=<int, default 50, max 500>
        app.get('/api/messages', async (c) => {
            const limit = parseLimit(c.req.query('limit'), 50);
            const svc = ctx.teamService();
            const result = await svc.listRecent(limit);
            return c.json(result);
        });
    },
};

/**
 * Parse a limit/offset query param. Returns `fallback` for missing/non-numeric
 * values; clamps to [0, 500] (limit-style usage). For offset semantics the caller
 * passes `0` as the fallback.
 */
function parseLimit(raw: string | undefined, fallback: number): number {
    if (raw === undefined) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < 0) return fallback;
    return Math.min(parsed, 500);
}
