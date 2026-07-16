import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import { enqueueSseFrame, sendSseKeepalive } from '../sse/stream-helpers';
import type { ServerModule } from '../types';

/** Team SSE heartbeat — delegates to the shared SSE helper (task 0241 R8). */
export function sendHeartbeat(
    closed: { current: boolean },
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
): void {
    sendSseKeepalive(closed, controller, encoder);
}

/** Team SSE data frame — delegates to the shared SSE helper (task 0241 R8). */
export function enqueueFrame(
    closed: { current: boolean },
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    frame: unknown,
): boolean {
    return enqueueSseFrame(closed, controller, encoder, frame);
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

        // ── GET /api/team/processes — supervised list + ProcessRegistry snapshot ──
        // `processes` remains the supervisor-controlled list (start/stop/attach).
        // `executions` is the full ts-runtime ProcessRegistry watch list (spur#0264).
        app.get('/api/team/processes', (c) => {
            const supervisor = ctx.supervisor();
            const processes = supervisor.list().map((p) => ({
                agentId: p.agentId,
                pid: p.pid,
                status: p.status,
                startedAt: p.startedAt,
                exitCode: p.exitCode ?? null,
                teamId: p.teamId ?? null,
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

        // ── GET /api/team/teams — teams grouped with member status (0256 R2) ──
        app.get('/api/team/teams', async (c) => {
            if (!ctx.teamService) return c.json({ error: 'team API requires Bun server context' }, 503);
            const svc = ctx.teamService();
            const supervisor = ctx.supervisor();
            const teams = await svc.listTeams();
            const processes = supervisor.list();
            const enriched = teams.map((team) => ({
                teamId: team.teamId,
                name: team.name,
                members: team.specs.map((spec) => {
                    const proc = processes.find((p) => p.agentId === spec.id);
                    return {
                        id: spec.id,
                        type: spec.type,
                        status: proc?.status ?? 'unknown',
                        // Surfaced so the Roster can show a hint when no member is
                        // autostart (the Up button starts only autostart members).
                        autoStart: spec.autoStart === true,
                        ...(proc?.pid !== undefined ? { pid: proc.pid } : {}),
                    };
                }),
            }));
            return c.json({ teams: enriched, count: enriched.length });
        });

        // ── POST /api/team/:team/up — materialize + best-effort start (0256 R3/R5) ──
        app.post('/api/team/:team/up', async (c) => {
            if (!ctx.teamService) return c.json({ error: 'team API requires Bun server context' }, 503);
            const teamId = c.req.param('team');
            const check = c.req.query('check') === 'true';
            const svc = ctx.teamService();
            const materialized = await svc.materializeTeam(teamId, { check });
            if (check) {
                return c.json({ materialized, started: [] });
            }
            // Best-effort start of AUTOSTART members only (0256 R3/R5 + 0252 up-scope;
            // consistent with the CLI `team up`). A materialized member with autoStart=false
            // is created but NOT started here — start-all would ignore the per-member opt-out.
            const supervisor = ctx.supervisor();
            const autostartIds = new Set(
                (await svc.listAgentSpecs()).filter((spec) => spec.autoStart === true).map((spec) => spec.id),
            );
            const started: Array<{ id: string; ok: boolean; pid?: number }> = [];
            for (const id of materialized.upserted) {
                if (!autostartIds.has(id)) continue;
                try {
                    const entry = await supervisor.start(id);
                    started.push({ id, ok: true, ...(entry.pid !== null ? { pid: entry.pid } : {}) });
                } catch {
                    started.push({ id, ok: false });
                }
            }
            return c.json({ materialized, started });
        });

        // ── POST /api/team/:team/down — stop + optional purge (0256 R3) ──
        app.post('/api/team/:team/down', async (c) => {
            if (!ctx.teamService) return c.json({ error: 'team API requires Bun server context' }, 503);
            const teamId = c.req.param('team');
            const purge = c.req.query('purge') === 'true';
            const svc = ctx.teamService();
            // Stop running members
            const supervisor = ctx.supervisor();
            const teams = await svc.listTeams();
            const team = teams.find((t) => t.teamId === teamId);
            const stopped: string[] = [];
            if (team) {
                for (const spec of team.specs) {
                    const proc = supervisor.get(spec.id);
                    if (proc?.status === 'running') {
                        await supervisor.stop(spec.id);
                        stopped.push(spec.id);
                    }
                }
            }
            const result = await svc.teardownTeam(teamId, { purge });
            return c.json({ stopped, purged: result.purged });
        });

        // ── GET /api/team/health — liveness probe (0256 R4) ──
        app.get('/api/team/health', (c) => {
            return c.json({ ok: true });
        });
    },
};
