import type { Context, Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';

/**
 * Server module that mounts the messages API for the observabilities board.
 *
 * Endpoints:
 *   - GET  /api/messages/inbox?agent=<id>&limit=<n>  — one agent's inbox (newest-first)
 *   - GET  /api/messages?limit=<n>                    — global recent-message feed (newest-first)
 *   - POST /api/messages                              — send a message (body, to, optional from)
 *   - POST /api/messages/:id/reply                    — reply to a message (body)
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

        // POST /api/messages — send a message. Body: { to, body, from? }.
        // Fires the same TeamService path the CLI uses, so message.sent emits identically.
        app.post('/api/messages', async (c) => {
            const parsed = await parseJsonBody(c);
            if ('error' in parsed) return c.json({ error: parsed.error }, 400);
            const { to, body, from } = parsed;
            if (typeof to !== 'string' || to.length === 0) return c.json({ error: 'field "to" is required' }, 400);
            if (typeof body !== 'string' || body.length === 0)
                return c.json({ error: 'field "body" is required' }, 400);
            if (from !== undefined && (typeof from !== 'string' || from.length === 0)) {
                return c.json({ error: 'field "from" must be a non-empty string when present' }, 400);
            }
            const svc = ctx.teamService();
            try {
                const result = await svc.sendMessage(from ?? null, to, body);
                return c.json(result, 201);
            } catch (err) {
                return c.json({ error: errMsg(err) }, 400);
            }
        });

        // POST /api/messages/:id/reply — reply to an existing message. Body: { body }.
        // Threads via in_reply_to back to the original sender.
        app.post('/api/messages/:id/reply', async (c) => {
            const id = c.req.param('id');
            const parsed = await parseJsonBody(c);
            if ('error' in parsed) return c.json({ error: parsed.error }, 400);
            const { body } = parsed;
            if (typeof body !== 'string' || body.length === 0)
                return c.json({ error: 'field "body" is required' }, 400);
            const svc = ctx.teamService();
            try {
                const result = await svc.replyToMessage(id, body);
                return c.json(result, 201);
            } catch (err) {
                return c.json({ error: errMsg(err) }, 400);
            }
        });
    },
};

/** Read and validate a JSON object body; returns `{ error }` on malformed input. */
async function parseJsonBody(
    c: Context,
): Promise<{ to?: unknown; body?: unknown; from?: unknown } | { error: string }> {
    let json: unknown;
    try {
        json = await c.req.json();
    } catch {
        return { error: 'request body must be valid JSON' };
    }
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
        return { error: 'request body must be a JSON object' };
    }
    return json as { to?: unknown; body?: unknown; from?: unknown };
}

/** Extract a useful message from a thrown error (validation, missing row, etc.). */
function errMsg(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
}

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
