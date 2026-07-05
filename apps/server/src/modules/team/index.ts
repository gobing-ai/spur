import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';

/**
 * Team process supervision module — task 0195/0208 (G2 wave B).
 *
 * Bun-gated: on Cloudflare Workers (ctx undefined) the module is a no-op.
 * Endpoints:
 *   - GET  /api/team/processes            — list supervised processes
 *   - GET  /api/team/processes/:id/stream  — SSE attach (ring-buffer replay + live tail)
 *   - POST /api/team/processes/:id/stdin   — forward a line to child stdin
 */
export const teamModule: ServerModule = {
    name: 'team',

    mount(app: Hono, ctx: ServerContext | undefined): void {
        if (!ctx) return;

        // ── GET /api/team/processes — list supervised processes ──
        app.get('/api/team/processes', (c) => {
            const supervisor = ctx.supervisor();
            const processes = supervisor.list().map((p) => ({
                agentId: p.agentId,
                pid: p.pid,
                status: p.status,
                startedAt: p.startedAt,
                exitCode: p.exitCode ?? null,
            }));
            return c.json({ processes, count: processes.length });
        });

        // ── POST /api/team/agents/:id/start — spawn a supervised agent ──
        app.post('/api/team/agents/:id/start', async (c) => {
            const id = c.req.param('id');
            try {
                const entry = await ctx.supervisor().start(id);
                return c.json({ ok: true, pid: entry.pid, status: entry.status }, 201);
            } catch (err) {
                return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
            }
        });

        // ── POST /api/team/agents/:id/stop — stop a supervised agent ──
        app.post('/api/team/agents/:id/stop', async (c) => {
            const id = c.req.param('id');
            try {
                await ctx.supervisor().stop(id);
                return c.json({ ok: true });
            } catch (err) {
                return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
            }
        });

        // ── POST /api/team/processes/:id/stdin — forward line to child stdin ──
        app.post('/api/team/processes/:id/stdin', async (c) => {
            const id = c.req.param('id');
            let json: unknown;
            try {
                json = await c.req.json();
            } catch {
                return c.json({ error: 'request body must be valid JSON' }, 400);
            }
            const body = json as { line?: string };
            if (typeof body.line !== 'string' || body.line.length === 0) {
                return c.json({ error: 'field "line" is required' }, 400);
            }
            try {
                ctx.supervisor().writeStdin(id, body.line);
                return c.json({ ok: true });
            } catch (err) {
                return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
            }
        });

        // ── GET /api/team/processes/:id/stream — SSE attach ──
        app.get('/api/team/processes/:id/stream', (c) => {
            const id = c.req.param('id');
            const supervisor = ctx.supervisor();
            const proc = supervisor.get(id);
            if (!proc) {
                return c.json({ error: `Agent "${id}" not found` }, 404);
            }

            const closed = { current: false };
            const signal = c.req.raw.signal;
            let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
            let closeController: () => void = () => {};

            const teardown = () => {
                if (closed.current) return;
                closed.current = true;
                if (heartbeatInterval) clearInterval(heartbeatInterval);
                signal.removeEventListener('abort', teardown);
                closeController();
            };

            const stream = new ReadableStream({
                start(controller) {
                    const encoder = new TextEncoder();
                    closeController = () => {
                        try {
                            controller.close();
                        } catch {
                            /* already closed */
                        }
                    };

                    if (signal.aborted) {
                        teardown();
                        return;
                    }
                    signal.addEventListener('abort', teardown);

                    // Heartbeat every 15 s
                    heartbeatInterval = setInterval(() => {
                        if (closed.current) return;
                        try {
                            controller.enqueue(encoder.encode(': keepalive\n\n'));
                        } catch {
                            /* closed */
                        }
                    }, 15_000);

                    // ── 1. Replay ring buffer frames (oldest-first) ──
                    const buffer = supervisor.getRingBuffer(id);
                    for (const frame of buffer) {
                        if (closed.current) return;
                        try {
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
                        } catch {
                            return;
                        }
                    }

                    // ── 2. Send a sync marker so the client knows replay is done ──
                    if (!closed.current) {
                        try {
                            controller.enqueue(
                                encoder.encode(
                                    `data: ${JSON.stringify({ stream: 'meta', ts: new Date().toISOString(), line: '--replay-done--' })}\n\n`,
                                ),
                            );
                        } catch {
                            return;
                        }
                    }

                    // ── 3. Live tail: poll the ring buffer for new frames ──
                    let cursor = buffer.length;
                    const pollInterval = setInterval(() => {
                        if (closed.current) {
                            clearInterval(pollInterval);
                            return;
                        }
                        const current = supervisor.getRingBuffer(id);
                        while (cursor < current.length) {
                            const frame = current[cursor];
                            if (frame && !closed.current) {
                                try {
                                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
                                } catch {
                                    clearInterval(pollInterval);
                                    return;
                                }
                            }
                            cursor++;
                        }
                    }, 500);

                    // Stop polling when stream closes
                    const origClose = closeController;
                    closeController = () => {
                        clearInterval(pollInterval);
                        origClose();
                    };
                },

                cancel() {
                    closeController = () => {};
                    teardown();
                },
            });

            return c.newResponse(stream, 200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
            });
        });
    },
};
