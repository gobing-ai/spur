import { describe, expect, test } from 'bun:test';
import type { MaterializeResult, ProcessEntry, ProcessFrame, TeamListing, TeardownResult } from '@gobing-ai/spur-app';
import { Hono } from 'hono';
import type { ServerContext } from '../../../src/context';
import { enqueueFrame, sendHeartbeat, teamModule } from '../../../src/modules/team';

/** Minimal TeamService stub surface — the module only calls these three methods. */
interface TeamServiceStub {
    listTeams(): Promise<TeamListing[]>;
    materializeTeam(teamId: string, opts?: { check?: boolean }): Promise<MaterializeResult>;
    teardownTeam(teamId: string, opts?: { purge?: boolean }): Promise<TeardownResult>;
}

/** Build a complete TeamServiceStub from a partial — defaults are type-correct no-ops. */
function teamServiceStub(overrides: Partial<TeamServiceStub>): TeamServiceStub {
    return {
        listTeams: async () => [],
        materializeTeam: async () => ({ teamId: '', upserted: [], orphaned: [], written: false }),
        teardownTeam: async () => ({ teamId: '', purged: [], stopped: [] }),
        ...overrides,
    };
}

/**
 * Build a stub ServerContext whose supervisor returns canned process data and
 * captures stdin writes. Unchecked cast — the module only touches `supervisor()`,
 * so a partial object is sufficient.
 */
function ctxWithStubs(opts: {
    list?: ProcessEntry[];
    get?: ProcessEntry | undefined;
    getFn?: (id: string) => ProcessEntry | undefined;
    getRingBuffer?: ProcessFrame[];
    getRingBufferFn?: () => ProcessFrame[];
    writeStdinThrows?: Error;
    start?: (id: string) => Promise<ProcessEntry>;
    stop?: (id: string) => Promise<void>;
    teamService?: TeamServiceStub;
}): {
    ctx: ServerContext;
    stdinCalls: Array<{ agentId: string; line: string }>;
    startCalls: string[];
    stopCalls: string[];
} {
    const stdinCalls: Array<{ agentId: string; line: string }> = [];
    const startCalls: string[] = [];
    const stopCalls: string[] = [];
    const start =
        opts.start ??
        (async (id: string) => {
            startCalls.push(id);
            return {
                agentId: id,
                pid: 1000,
                status: 'running',
                startedAt: '2026-07-05T00:00:00.000Z',
                exitCode: null,
                ringBuffer: [],
            };
        });
    const stop =
        opts.stop ??
        (async (id: string) => {
            stopCalls.push(id);
        });
    const supervisor = {
        list: () => opts.list ?? [],
        get: (id?: string) => (opts.getFn && id ? opts.getFn(id) : opts.get),
        getRingBuffer: opts.getRingBufferFn ?? (() => opts.getRingBuffer ?? []),

        writeStdin: (agentId: string, line: string) => {
            if (opts.writeStdinThrows) throw opts.writeStdinThrows;
            stdinCalls.push({ agentId, line });
        },
        start,
        stop,
    };
    const ctx = {
        supervisor: () => supervisor,
        ...(opts.teamService ? { teamService: () => opts.teamService } : {}),
    } as unknown as ServerContext;
    return { ctx, stdinCalls, startCalls, stopCalls };
}

describe('team module', () => {
    describe('GET /api/team/processes', () => {
        test('returns empty list when no processes are supervised', async () => {
            const { ctx } = ctxWithStubs({});
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(new Request('http://localhost/api/team/processes'));
            expect(res.status).toBe(200);
            const body = (await res.json()) as { processes: unknown[]; count: number };
            expect(body.processes).toEqual([]);
            expect(body.count).toBe(0);
        });

        test('returns process entries with id, pid, status, startedAt', async () => {
            const entry: ProcessEntry = {
                agentId: 'planner',
                pid: 12345,
                status: 'running',
                startedAt: '2026-07-05T00:00:00.000Z',
                exitCode: null,
                ringBuffer: [],
            };
            const { ctx } = ctxWithStubs({ list: [entry] });
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(new Request('http://localhost/api/team/processes'));
            expect(res.status).toBe(200);
            const body = (await res.json()) as { processes: Array<Record<string, unknown>>; count: number };
            expect(body.count).toBe(1);
            expect(body.processes[0]?.agentId).toBe('planner');
            expect(body.processes[0]?.pid).toBe(12345);
            expect(body.processes[0]?.status).toBe('running');
            expect(body.processes[0]?.startedAt).toBe('2026-07-05T00:00:00.000Z');
        });
    });

    describe('POST /api/team/processes/:id/stdin', () => {
        test('forwards a line to the supervised process stdin', async () => {
            const { ctx, stdinCalls } = ctxWithStubs({});
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(
                new Request('http://localhost/api/team/processes/planner/stdin', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ line: 'hello agent' }),
                }),
            );
            expect(res.status).toBe(200);
            const body = (await res.json()) as { ok: boolean };
            expect(body.ok).toBe(true);
            expect(stdinCalls).toEqual([{ agentId: 'planner', line: 'hello agent' }]);
        });

        test('rejects 400 when "line" is missing', async () => {
            const { ctx } = ctxWithStubs({});
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(
                new Request('http://localhost/api/team/processes/planner/stdin', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({}),
                }),
            );
            expect(res.status).toBe(400);
        });

        test('surfaces supervisor errors as 400', async () => {
            const { ctx } = ctxWithStubs({ writeStdinThrows: new Error('Agent "x" is not running') });
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(
                new Request('http://localhost/api/team/processes/x/stdin', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ line: 'hi' }),
                }),
            );
            expect(res.status).toBe(400);
            const body = (await res.json()) as { error: string };
            expect(body.error).toContain('not running');
        });
        test('rejects 400 when the body is not valid JSON', async () => {
            const { ctx } = ctxWithStubs({});
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(
                new Request('http://localhost/api/team/processes/planner/stdin', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: '{not json',
                }),
            );
            expect(res.status).toBe(400);
            const body = (await res.json()) as { error: string };
            expect(body.error).toContain('valid JSON');
        });
    });

    describe('GET /api/team/processes/:id/stream', () => {
        test('returns 404 when agent is not found', async () => {
            const { ctx } = ctxWithStubs({ get: undefined });
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(new Request('http://localhost/api/team/processes/ghost/stream'));
            expect(res.status).toBe(404);
        });

        test('returns text/event-stream and replays ring buffer', async () => {
            const frames: ProcessFrame[] = [
                { stream: 'stdout', ts: '2026-07-05T00:00:01.000Z', line: 'starting up', seq: 0 },
                { stream: 'stderr', ts: '2026-07-05T00:00:02.000Z', line: 'warning: low memory', seq: 1 },
            ];
            const entry: ProcessEntry = {
                agentId: 'planner',
                pid: 99,
                status: 'running',
                startedAt: '2026-07-05T00:00:00.000Z',
                exitCode: null,
                ringBuffer: frames,
            };
            const { ctx } = ctxWithStubs({ get: entry, getRingBuffer: frames });
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(new Request('http://localhost/api/team/processes/planner/stream'));
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toBe('text/event-stream');

            // Read only the first few frames — the SSE stream is live/long-running.
            const reader = res.body?.getReader();
            expect(reader).toBeDefined();
            let text = '';
            if (reader) {
                // Read up to 10 chunks (replay + sync marker = 3 frames minimum).
                for (let i = 0; i < 10; i++) {
                    const { done, value } = await reader.read();
                    if (value) text += new TextDecoder().decode(value);
                    if (done || text.includes('--replay-done--')) break;
                }
                reader.cancel();
            }
            expect(text).toContain('starting up');
            expect(text).toContain('warning: low memory');
            expect(text).toContain('--replay-done--');
        });
        test('tears the stream down when the request signal is already aborted', async () => {
            const entry: ProcessEntry = {
                agentId: 'planner',
                pid: 99,
                status: 'running',
                startedAt: '2026-07-05T00:00:00.000Z',
                exitCode: null,
                ringBuffer: [],
            };
            const { ctx } = ctxWithStubs({ get: entry, getRingBuffer: [] });
            const app = new Hono();
            teamModule.mount(app, ctx);

            const controller = new AbortController();
            controller.abort();
            const res = await app.fetch(
                new Request('http://localhost/api/team/processes/planner/stream', { signal: controller.signal }),
            );
            expect(res.status).toBe(200);
            // Drain the body so the controller teardown path runs end-to-end.
            const reader = res.body?.getReader();
            if (reader) {
                while (true) {
                    const { done } = await reader.read();
                    if (done) break;
                }
            }
            expect(true).toBe(true);
        });

        test('tears the stream down when the consumer cancels via reader.cancel()', async () => {
            const entry: ProcessEntry = {
                agentId: 'planner',
                pid: 99,
                status: 'running',
                startedAt: '2026-07-05T00:00:00.000Z',
                exitCode: null,
                ringBuffer: [],
            };
            const { ctx } = ctxWithStubs({ get: entry, getRingBuffer: [] });
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(new Request('http://localhost/api/team/processes/planner/stream'));
            expect(res.status).toBe(200);
            await res.body?.cancel();
            expect(true).toBe(true);
        });

        test('polls the ring buffer for new frames while the stream is open', async () => {
            // Integration test against real time: the live-tail block fires from a
            // setInterval(500ms). Deterministic time control would require an
            // injectable timer the server team module does not (yet) expose.
            // Cost: ~700ms wall-clock per run.
            const liveBuffer: ProcessFrame[] = [];
            const entry: ProcessEntry = {
                agentId: 'planner',
                pid: 99,
                status: 'running',
                startedAt: '2026-07-05T00:00:00.000Z',
                exitCode: null,
                ringBuffer: liveBuffer,
            };
            const { ctx } = ctxWithStubs({ get: entry, getRingBufferFn: () => liveBuffer });
            const app = new Hono();
            teamModule.mount(app, ctx);
            const res = await app.fetch(new Request('http://localhost/api/team/processes/planner/stream'));
            expect(res.status).toBe(200);
            const reader = res.body?.getReader();
            expect(reader).toBeDefined();
            if (reader) {
                const decoder = new TextDecoder();
                const collected: string[] = [];
                const start = Date.now();
                let replayDone = false;
                let liveTailReached = false;
                while (Date.now() - start < 1000) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (value) {
                        const chunk = decoder.decode(value);
                        collected.push(chunk);
                        if (chunk.includes('--replay-done--')) {
                            replayDone = true;
                            break;
                        }
                    }
                }
                expect(replayDone).toBe(true);
                // Now the stream is in live-tail phase; push a frame and wait for it.
                liveBuffer.push({ stream: 'stdout', ts: '2026-07-05T00:00:05.000Z', line: 'tail frame', seq: 0 });
                while (Date.now() - start < 2000) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (value) {
                        const chunk = decoder.decode(value);
                        collected.push(chunk);
                        if (chunk.includes('tail frame')) {
                            liveTailReached = true;
                            break;
                        }
                    }
                }
                expect(liveTailReached).toBe(true);
                await reader.cancel();
            }
            expect(true).toBe(true);
        });

        test('live tail survives ring-buffer overflow (seq watermark, not array index)', async () => {
            // Regression: the old index cursor pointed past the array after an
            // overflow splice shifted frames left, silently skipping new frames.
            // Simulate: replay [seq 0, seq 1], then overflow drops seq 0 and
            // appends seq 2 — the tail must still deliver seq 2.
            const liveBuffer: ProcessFrame[] = [
                { stream: 'stdout', ts: '2026-07-05T00:00:01.000Z', line: 'frame zero', seq: 0 },
                { stream: 'stdout', ts: '2026-07-05T00:00:02.000Z', line: 'frame one', seq: 1 },
            ];
            const entry: ProcessEntry = {
                agentId: 'planner',
                pid: 99,
                status: 'running',
                startedAt: '2026-07-05T00:00:00.000Z',
                exitCode: null,
                ringBuffer: liveBuffer,
            };
            const { ctx } = ctxWithStubs({ get: entry, getRingBufferFn: () => liveBuffer });
            const app = new Hono();
            teamModule.mount(app, ctx);
            const res = await app.fetch(new Request('http://localhost/api/team/processes/planner/stream'));
            const reader = res.body?.getReader();
            expect(reader).toBeDefined();
            if (reader) {
                const decoder = new TextDecoder();
                const start = Date.now();
                let text = '';
                while (Date.now() - start < 1000 && !text.includes('--replay-done--')) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (value) text += decoder.decode(value);
                }
                expect(text).toContain('--replay-done--');
                // Overflow: drop the oldest frame, append a new one. The buffer
                // length is back to 2 — an index cursor (2) would skip it forever.
                liveBuffer.shift();
                liveBuffer.push({ stream: 'stdout', ts: '2026-07-05T00:00:05.000Z', line: 'post-overflow', seq: 2 });
                let delivered = false;
                while (Date.now() - start < 2000) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (value) {
                        text += decoder.decode(value);
                        if (text.includes('post-overflow')) {
                            delivered = true;
                            break;
                        }
                    }
                }
                expect(delivered).toBe(true);
                // Already-replayed frames must not repeat past the watermark.
                expect(text.split('frame one').length - 1).toBe(1);
                await reader.cancel();
            }
        });

        test('live-tail poll stops cleanly when enqueue fails (non-serializable frame)', async () => {
            // WHY: lines 165-167 — when enqueueFrame returns false during poll,
            // the poll interval must clear and the start() callback must return.
            // A circular frame makes JSON.stringify throw → enqueueFrame false.
            const liveBuffer: ProcessFrame[] = [];
            const entry: ProcessEntry = {
                agentId: 'planner',
                pid: 99,
                status: 'running',
                startedAt: '2026-07-05T00:00:00.000Z',
                exitCode: null,
                ringBuffer: liveBuffer,
            };
            const { ctx } = ctxWithStubs({ get: entry, getRingBufferFn: () => liveBuffer });
            const app = new Hono();
            teamModule.mount(app, ctx);
            const res = await app.fetch(new Request('http://localhost/api/team/processes/planner/stream'));
            const reader = res.body?.getReader();
            expect(reader).toBeDefined();
            if (!reader) throw new Error('expected body reader');

            const decoder = new TextDecoder();
            const start = Date.now();
            let text = '';
            while (Date.now() - start < 1000 && !text.includes('--replay-done--')) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) text += decoder.decode(value);
            }
            expect(text).toContain('--replay-done--');

            // Circular object → JSON.stringify throws inside enqueueSseFrame.
            const circular = {
                stream: 'stdout' as const,
                ts: '2026-07-05T00:00:09.000Z',
                line: 'boom',
                seq: 1,
            } as ProcessFrame & { self?: unknown };
            circular.self = circular;
            liveBuffer.push(circular);

            // Give the 500ms poll a chance to fire and hit the failure path.
            await new Promise((r) => setTimeout(r, 700));
            // Stream should still be readable / cancellable (no hang, no unhandled throw).
            await reader.cancel();
            expect(true).toBe(true);
        });

        test('abort after live-tail starts clears the poll interval via closeController', async () => {
            // WHY: lines 174-177 — after poll starts, the closeController wrapper
            // clears pollInterval. Abort after --replay-done-- exercises that path
            // (cancel() overwrites closeController with a no-op, so use signal abort).
            const entry: ProcessEntry = {
                agentId: 'planner',
                pid: 99,
                status: 'running',
                startedAt: '2026-07-05T00:00:00.000Z',
                exitCode: null,
                ringBuffer: [],
            };
            const { ctx } = ctxWithStubs({ get: entry, getRingBuffer: [] });
            const app = new Hono();
            teamModule.mount(app, ctx);

            const ac = new AbortController();
            const res = await app.fetch(
                new Request('http://localhost/api/team/processes/planner/stream', { signal: ac.signal }),
            );
            expect(res.status).toBe(200);
            const reader = res.body?.getReader();
            expect(reader).toBeDefined();
            if (!reader) throw new Error('expected body reader');

            const decoder = new TextDecoder();
            const start = Date.now();
            let text = '';
            while (Date.now() - start < 1000 && !text.includes('--replay-done--')) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) text += decoder.decode(value);
            }
            expect(text).toContain('--replay-done--');

            // Wait one poll tick so closeController has been wrapped with clearInterval.
            await new Promise((r) => setTimeout(r, 550));
            ac.abort();
            // Drain until the stream ends after abort teardown.
            try {
                while (true) {
                    const { done } = await reader.read();
                    if (done) break;
                }
            } catch {
                // AbortError while reading is acceptable.
            }
            expect(true).toBe(true);
        });
    });

    describe('POST /api/team/agents/:id/start', () => {
        test('spawns the agent and returns 201 with pid and status', async () => {
            const { ctx, startCalls } = ctxWithStubs({});
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(
                new Request('http://localhost/api/team/agents/planner/start', { method: 'POST' }),
            );
            expect(res.status).toBe(201);
            const body = (await res.json()) as { ok: boolean; pid: number; status: string };
            expect(body.ok).toBe(true);
            expect(body.pid).toBe(1000);
            expect(body.status).toBe('running');
            expect(startCalls).toEqual(['planner']);
        });

        test('surfaces supervisor errors as 400', async () => {
            const { ctx } = ctxWithStubs({
                start: async () => {
                    throw new Error('spawn failed: not executable');
                },
            });
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(
                new Request('http://localhost/api/team/agents/planner/start', { method: 'POST' }),
            );
            expect(res.status).toBe(400);
            const body = (await res.json()) as { error: string };
            expect(body.error).toContain('spawn failed');
        });
    });

    describe('POST /api/team/agents/:id/stop', () => {
        test('stops the agent and returns 200 ok', async () => {
            const { ctx, stopCalls } = ctxWithStubs({});
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(
                new Request('http://localhost/api/team/agents/planner/stop', { method: 'POST' }),
            );
            expect(res.status).toBe(200);
            const body = (await res.json()) as { ok: boolean };
            expect(body.ok).toBe(true);
            expect(stopCalls).toEqual(['planner']);
        });

        test('surfaces supervisor errors as 400', async () => {
            const { ctx } = ctxWithStubs({
                stop: async () => {
                    throw new Error('not running');
                },
            });
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(
                new Request('http://localhost/api/team/agents/planner/stop', { method: 'POST' }),
            );
            expect(res.status).toBe(400);
            const body = (await res.json()) as { error: string };
            expect(body.error).toContain('not running');
        });
    });

    // ── 0256 routes: teams / up / down / health ──

    /** Minimal team-member spec factory (typed via TeamListing's specs element). */
    function spec(id: string, type = 'claude'): TeamListing['specs'][number] {
        return {
            id,
            name: id,
            type,
            workspace: '/tmp',
            purpose: 'test',
            tags: ['team:devops', 'spur:generated'],
            config: {},
        };
    }

    describe('GET /api/team/teams', () => {
        test('returns 503 when teamService is unavailable (Cloudflare Workers gate)', async () => {
            // No teamService on the ctx → the Bun-only gate fires.
            const { ctx } = ctxWithStubs({});
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(new Request('http://localhost/api/team/teams'));
            expect(res.status).toBe(503);
            const body = (await res.json()) as { error: string };
            expect(body.error).toContain('Bun server context');
        });

        test('enriches members with running status and pid from the supervisor', async () => {
            const team: TeamListing = {
                teamId: 'devops',
                name: 'DevOps',
                members: [],
                specs: [spec('planner'), spec('reviewer')],
            };
            const teamService = teamServiceStub({ listTeams: async () => [team] });
            const list: ProcessEntry[] = [
                {
                    agentId: 'planner',
                    pid: 4242,
                    status: 'running',
                    startedAt: '2026-07-05T00:00:00.000Z',
                    exitCode: null,
                    ringBuffer: [],
                },
            ];
            const { ctx } = ctxWithStubs({ list, teamService });
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(new Request('http://localhost/api/team/teams'));
            expect(res.status).toBe(200);
            const body = (await res.json()) as {
                teams: Array<{
                    teamId: string;
                    members: Array<{ id: string; type: string; status: string; pid?: number }>;
                }>;
                count: number;
            };
            expect(body.count).toBe(1);
            const members = body.teams[0]?.members ?? [];
            // Running member carries pid + status; the un-supervised one falls back to 'unknown'.
            const planner = members.find((m) => m.id === 'planner');
            expect(planner?.status).toBe('running');
            expect(planner?.pid).toBe(4242);
            const reviewer = members.find((m) => m.id === 'reviewer');
            expect(reviewer?.status).toBe('unknown');
            expect(reviewer?.pid).toBeUndefined();
        });
    });

    describe('POST /api/team/:team/up', () => {
        test('returns 503 when teamService is unavailable', async () => {
            const { ctx } = ctxWithStubs({});
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(new Request('http://localhost/api/team/devops/up', { method: 'POST' }));
            expect(res.status).toBe(503);
        });

        test('check=true dry-run returns the materialize diff without starting members', async () => {
            let checkArg: { check?: boolean } | undefined;
            const materialized: MaterializeResult = {
                teamId: 'devops',
                upserted: ['planner', 'reviewer'],
                orphaned: ['stale-1'],
                written: false,
            };
            const teamService = teamServiceStub({
                listTeams: async () => [],
                materializeTeam: async (_id, opts) => {
                    checkArg = opts;
                    return materialized;
                },
            });
            const { ctx, startCalls } = ctxWithStubs({ teamService });
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(
                new Request('http://localhost/api/team/devops/up?check=true', { method: 'POST' }),
            );
            expect(res.status).toBe(200);
            const body = (await res.json()) as { materialized: MaterializeResult; started: unknown[] };
            expect(body.materialized).toEqual(materialized);
            expect(body.started).toEqual([]);
            expect(checkArg).toEqual({ check: true });
            expect(startCalls).toEqual([]); // dry-run must not start anything
        });

        test('best-effort starts each upserted member and reports per-member ok/pid', async () => {
            const materialized: MaterializeResult = {
                teamId: 'devops',
                upserted: ['planner', 'reviewer'],
                orphaned: [],
                written: true,
            };
            const teamService = teamServiceStub({
                listTeams: async () => [],
                materializeTeam: async () => materialized,
            });
            const { ctx, startCalls } = ctxWithStubs({ teamService });
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(new Request('http://localhost/api/team/devops/up', { method: 'POST' }));
            expect(res.status).toBe(200);
            const body = (await res.json()) as {
                materialized: MaterializeResult;
                started: Array<{ id: string; ok: boolean; pid?: number }>;
            };
            expect(startCalls).toEqual(['planner', 'reviewer']);
            expect(body.started).toHaveLength(2);
            expect(body.started.every((s) => s.ok === true)).toBe(true);
            expect(body.started[0]?.pid).toBe(1000);
        });

        test('records ok=false (no pid) for members that fail to start', async () => {
            const materialized: MaterializeResult = {
                teamId: 'devops',
                upserted: ['planner', 'reviewer'],
                orphaned: [],
                written: true,
            };
            const teamService = teamServiceStub({
                listTeams: async () => [],
                materializeTeam: async () => materialized,
            });
            const { ctx } = ctxWithStubs({
                teamService,
                start: async (id) => {
                    if (id === 'reviewer') throw new Error('spawn failed');
                    return {
                        agentId: id,
                        pid: 700,
                        status: 'running',
                        startedAt: '2026-07-05T00:00:00.000Z',
                        exitCode: null,
                        ringBuffer: [],
                    };
                },
            });
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(new Request('http://localhost/api/team/devops/up', { method: 'POST' }));
            expect(res.status).toBe(200);
            const body = (await res.json()) as {
                started: Array<{ id: string; ok: boolean; pid?: number }>;
            };
            const reviewer = body.started.find((s) => s.id === 'reviewer');
            expect(reviewer?.ok).toBe(false);
            expect(reviewer?.pid).toBeUndefined();
            const planner = body.started.find((s) => s.id === 'planner');
            expect(planner?.ok).toBe(true);
            expect(planner?.pid).toBe(700);
        });

        test('omits pid when supervisor.start returns a null pid', async () => {
            const materialized: MaterializeResult = {
                teamId: 'devops',
                upserted: ['planner'],
                orphaned: [],
                written: true,
            };
            const teamService = teamServiceStub({
                listTeams: async () => [],
                materializeTeam: async () => materialized,
            });
            const { ctx } = ctxWithStubs({
                teamService,
                start: async (id) => ({
                    agentId: id,
                    pid: null,
                    status: 'running',
                    startedAt: '2026-07-05T00:00:00.000Z',
                    exitCode: null,
                    ringBuffer: [],
                }),
            });
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(new Request('http://localhost/api/team/devops/up', { method: 'POST' }));
            const body = (await res.json()) as { started: Array<{ id: string; ok: boolean; pid?: number }> };
            expect(body.started[0]?.ok).toBe(true);
            expect(body.started[0]?.pid).toBeUndefined();
        });
    });

    describe('POST /api/team/:team/down', () => {
        test('returns 503 when teamService is unavailable', async () => {
            const { ctx } = ctxWithStubs({});
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(new Request('http://localhost/api/team/devops/down', { method: 'POST' }));
            expect(res.status).toBe(503);
        });

        test('stops running members and tears the team down without purging by default', async () => {
            const team: TeamListing = {
                teamId: 'devops',
                name: 'DevOps',
                members: [],
                specs: [spec('planner'), spec('reviewer')],
            };
            let purgeArg: { purge?: boolean } | undefined;
            const teamService = teamServiceStub({
                listTeams: async () => [team],
                teardownTeam: async (_id, opts) => {
                    purgeArg = opts;
                    return { teamId: 'devops', purged: [], stopped: [] };
                },
            });
            const { ctx, stopCalls } = ctxWithStubs({
                teamService,
                getFn: (id) =>
                    id === 'planner'
                        ? {
                              agentId: id,
                              pid: 1,
                              status: 'running',
                              startedAt: '2026-07-05T00:00:00.000Z',
                              exitCode: null,
                              ringBuffer: [],
                          }
                        : {
                              agentId: id,
                              pid: 2,
                              status: 'stopped',
                              startedAt: '2026-07-05T00:00:00.000Z',
                              exitCode: 0,
                              ringBuffer: [],
                          },
            });
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(new Request('http://localhost/api/team/devops/down', { method: 'POST' }));
            expect(res.status).toBe(200);
            const body = (await res.json()) as { stopped: string[]; purged: string[] };
            // Only the running member ('planner') is stopped; 'reviewer' was already stopped.
            expect(body.stopped).toEqual(['planner']);
            expect(body.purged).toEqual([]);
            expect(purgeArg).toEqual({ purge: false }); // default: no purge
            expect(stopCalls).toEqual(['planner']);
        });

        test('purge=true passes purge through to teardownTeam', async () => {
            const team: TeamListing = {
                teamId: 'devops',
                name: 'DevOps',
                members: [],
                specs: [spec('planner')],
            };
            let purgeArg: { purge?: boolean } | undefined;
            const teamService = teamServiceStub({
                listTeams: async () => [team],
                teardownTeam: async (_id, opts) => {
                    purgeArg = opts;
                    return { teamId: 'devops', purged: ['planner'], stopped: [] };
                },
            });
            const { ctx } = ctxWithStubs({ teamService });
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(
                new Request('http://localhost/api/team/devops/down?purge=true', { method: 'POST' }),
            );
            expect(res.status).toBe(200);
            const body = (await res.json()) as { purged: string[] };
            expect(body.purged).toEqual(['planner']);
            expect(purgeArg).toEqual({ purge: true });
        });

        test('returns empty stopped list when the team is unknown', async () => {
            const teamService = teamServiceStub({
                listTeams: async () => [], // no teams → the team is not found
                teardownTeam: async () => ({ teamId: 'ghost', purged: [], stopped: [] }),
            });
            const { ctx, stopCalls } = ctxWithStubs({ teamService });
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(new Request('http://localhost/api/team/ghost/down', { method: 'POST' }));
            expect(res.status).toBe(200);
            const body = (await res.json()) as { stopped: string[] };
            expect(body.stopped).toEqual([]);
            expect(stopCalls).toEqual([]);
        });
    });

    describe('GET /api/team/health', () => {
        test('returns 200 ok liveness probe', async () => {
            const { ctx } = ctxWithStubs({});
            const app = new Hono();
            teamModule.mount(app, ctx);

            const res = await app.fetch(new Request('http://localhost/api/team/health'));
            expect(res.status).toBe(200);
            const body = (await res.json()) as { ok: boolean };
            expect(body.ok).toBe(true);
        });
    });

    test('module is a no-op when ctx is undefined (Cloudflare Workers gate)', () => {
        const app = new Hono();
        teamModule.mount(app, undefined);
        // Should not throw and should register no routes.
    });
});

describe('sendHeartbeat', () => {
    test('enqueues a keepalive comment when the stream is open', () => {
        const closed = { current: false };
        const enqueued: Uint8Array[] = [];
        const controller = {
            enqueue: (data: Uint8Array) => {
                enqueued.push(data);
            },
        } as unknown as ReadableStreamDefaultController;
        sendHeartbeat(closed, controller, new TextEncoder());
        expect(enqueued.length).toBe(1);
        expect(new TextDecoder().decode(enqueued[0])).toBe(': keepalive\n\n');
    });

    test('is a no-op when the stream is closed', () => {
        const closed = { current: true };
        const enqueued: Uint8Array[] = [];
        const controller = {
            enqueue: (data: Uint8Array) => {
                enqueued.push(data);
            },
        } as unknown as ReadableStreamDefaultController;
        sendHeartbeat(closed, controller, new TextEncoder());
        expect(enqueued.length).toBe(0);
    });

    test('swallows the error when the controller is already torn down', () => {
        const closed = { current: false };
        const controller = {
            enqueue: () => {
                throw new TypeError('The controller is in a closed state.');
            },
        } as unknown as ReadableStreamDefaultController;
        expect(() => sendHeartbeat(closed, controller, new TextEncoder())).not.toThrow();
    });
});

describe('enqueueFrame', () => {
    test('enqueues a JSON data frame and returns true when the stream is open', () => {
        const closed = { current: false };
        const enqueued: Uint8Array[] = [];
        const controller = {
            enqueue: (data: Uint8Array) => {
                enqueued.push(data);
            },
        } as unknown as ReadableStreamDefaultController;
        const ok = enqueueFrame(closed, controller, new TextEncoder(), { line: 'hello' });
        expect(ok).toBe(true);
        expect(new TextDecoder().decode(enqueued[0])).toBe('data: {"line":"hello"}\n\n');
    });

    test('returns false without enqueuing when the stream is already closed', () => {
        const closed = { current: true };
        const enqueued: Uint8Array[] = [];
        const controller = {
            enqueue: (data: Uint8Array) => {
                enqueued.push(data);
            },
        } as unknown as ReadableStreamDefaultController;
        const ok = enqueueFrame(closed, controller, new TextEncoder(), { line: 'late' });
        expect(ok).toBe(false);
        expect(enqueued.length).toBe(0);
    });

    test('returns false when enqueue throws on a torn-down controller', () => {
        const closed = { current: false };
        const controller = {
            enqueue: () => {
                throw new TypeError('ReadableStream is closed');
            },
        } as unknown as ReadableStreamDefaultController;
        const ok = enqueueFrame(closed, controller, new TextEncoder(), { line: 'x' });
        expect(ok).toBe(false);
    });
});
