import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import { enqueueSseFrame, sendSseKeepalive } from '../sse/stream-helpers';
import type { ServerModule } from '../types';

/** Supervised-process SSE heartbeat — delegates to the shared SSE helper (task 0241 R8). */
export function sendHeartbeat(
    closed: { current: boolean },
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
): void {
    sendSseKeepalive(closed, controller, encoder);
}

/** Supervised-process SSE data frame — delegates to the shared SSE helper (task 0241 R8). */
export function enqueueFrame(
    closed: { current: boolean },
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    frame: unknown,
): boolean {
    return enqueueSseFrame(closed, controller, encoder, frame);
}

/**
 * Supervised process + agent lifecycle module.
 *
 * Mounts the supervised-process and agent-lifecycle routes under their owning
 * nouns (0860 R1): `GET /api/processes` and its stream/stdin children, plus
 * `POST /api/agents/:id/start|stop`. Streams heartbeats via SSE and replays
 * buffered frames on reconnect. The former team-scoped health probe is removed.
 */
export const processesModule: ServerModule = {
    name: 'processes',

    mount(app: Hono, ctx: ServerContext | undefined): void {
        if (!ctx) return;

        // ── GET /api/processes — supervised list + ProcessRegistry snapshot ──
        // `processes` remains the supervisor-controlled list (start/stop/attach).
        // `executions` is the full ts-runtime ProcessRegistry watch list (spur#0264).
        app.get('/api/processes', (c) => {
            const supervisor = ctx.supervisor();
            // `teamId` stays on the wire with the predecessor's `null` shape (0860):
            // the grouping id is no longer written anywhere, but the Board's watch-list
            // parsers and rows still read the key — omitting it broke the poll entirely.
            // It is deliberately NOT written: the retired spec-tag group stays retired.
            const processes = supervisor.list().map((p) => ({
                agentId: p.agentId,
                pid: p.pid,
                status: p.status,
                startedAt: p.startedAt,
                exitCode: p.exitCode ?? null,
                teamId: null,
            }));
            const executions = ctx
                .processRegistry()
                .listExecutions()
                .map((e) => ({
                    id: e.id,
                    label: e.label ?? e.command,
                    command: e.command,
                    args: [...e.args],
                    pid: e.pid ?? null,
                    status: e.status,
                    startedAt: e.startedAt,
                    exitedAt: e.exitedAt ?? null,
                    exitCode: e.exitCode ?? null,
                    source: e.source,
                    teamId: e.teamId ?? null,
                    agentId: e.agentId ?? null,
                }));
            return c.json({
                processes,
                count: processes.length,
                executions,
                executionsCount: executions.length,
            });
        });

        // ── POST /api/agents/:id/start — spawn a supervised agent ──
        app.post('/api/agents/:id/start', async (c) => {
            const id = c.req.param('id');
            try {
                const entry = await ctx.supervisor().start(id);
                return c.json({ ok: true, pid: entry.pid, status: entry.status }, 201);
            } catch (err) {
                return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
            }
        });

        // ── POST /api/agents/:id/stop — stop a supervised agent ──
        app.post('/api/agents/:id/stop', async (c) => {
            const id = c.req.param('id');
            try {
                await ctx.supervisor().stop(id);
                return c.json({ ok: true });
            } catch (err) {
                return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
            }
        });

        // ── POST /api/processes/:id/stdin — forward line to child stdin ──
        app.post('/api/processes/:id/stdin', async (c) => {
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

        // ── GET /api/processes/:id/stream — SSE attach ──
        app.get('/api/processes/:id/stream', (c) => {
            const id = c.req.param('id');
            const supervisor = ctx.supervisor();
            const proc = supervisor.get(id);
            if (!proc) {
                return c.json({ error: `Agent "${id}" not found` }, 404);
            }

            const closed = { current: false };
            const signal = c.req.raw.signal;
            let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
            let pollInterval: ReturnType<typeof setInterval> | undefined;
            let closeController: () => void = () => {};

            const teardown = () => {
                if (closed.current) return;
                closed.current = true;
                if (heartbeatInterval) clearInterval(heartbeatInterval);
                if (pollInterval) clearInterval(pollInterval);
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
                    pollInterval = setInterval(() => {
                        if (closed.current) {
                            if (pollInterval) clearInterval(pollInterval);
                            return;
                        }
                        for (const frame of supervisor.getRingBuffer(id)) {
                            if (frame.seq <= lastSeq) continue;
                            if (!enqueueFrame(closed, controller, encoder, frame)) {
                                teardown();
                                return;
                            }
                            lastSeq = frame.seq;
                        }
                    }, 500);
                },

                cancel() {
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
