import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';

/** SSE heartbeat — enqueues a keepalive comment unless the stream is already closed. */
export function sendHeartbeat(
    closed: { current: boolean },
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
): void {
    if (closed.current) return;
    try {
        controller.enqueue(encoder.encode(': keepalive\n\n'));
    } catch {
        // Controller already closed.
    }
}

/** Enqueue a framed SSE `data:` payload; returns false when the controller is closed. */
export function enqueueFrame(
    closed: { current: boolean },
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    frame: unknown,
): boolean {
    if (closed.current) return false;
    try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        return true;
    } catch {
        return false;
    }
}

/**
 * Team process supervision module.
 *
 * Mounts the `/v1/team` routes: start/stop agents, assign tasks, stream heartbeats
 * via SSE, forward messages to the agent inbox, and replay buffered frames on
 * reconnect.
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

                    // Heartbeat every 15 s — body extracted to module-level `sendHeartbeat`.
                    heartbeatInterval = setInterval(sendHeartbeat, 15_000, closed, controller, encoder);

                    // ── 1. Replay ring buffer frames (oldest-first) ──
                    // Track the last delivered seq, not an array index: overflow
                    // splices old frames from the front, so indices shift under a
                    // live cursor and frames would be silently skipped.
                    let lastSeq = -1;
                    const buffer = supervisor.getRingBuffer(id);
                    for (const frame of buffer) {
                        if (!enqueueFrame(closed, controller, encoder, frame)) return;
                        lastSeq = frame.seq;
                    }

                    // ── 2. Send a sync marker so the client knows replay is done ──
                    if (
                        !enqueueFrame(closed, controller, encoder, {
                            stream: 'meta',
                            ts: new Date().toISOString(),
                            line: '--replay-done--',
                        })
                    )
                        return;

                    // ── 3. Live tail: poll the ring buffer for frames past the watermark ──
                    const pollInterval = setInterval(() => {
                        if (closed.current) {
                            clearInterval(pollInterval);
                            return;
                        }
                        for (const frame of supervisor.getRingBuffer(id)) {
                            if (frame.seq <= lastSeq) continue;
                            if (!enqueueFrame(closed, controller, encoder, frame)) {
                                clearInterval(pollInterval);
                                return;
                            }
                            lastSeq = frame.seq;
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
