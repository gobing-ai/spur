import { describe, expect, test } from 'bun:test';
import type { ProcessEntry, ProcessFrame } from '@gobing-ai/spur-app';
import { Hono } from 'hono';
import type { ServerContext } from '../../../src/context';
import { teamModule } from '../../../src/modules/team';

/**
 * Build a stub ServerContext whose supervisor returns canned process data and
 * captures stdin writes. Unchecked cast — the module only touches `supervisor()`,
 * so a partial object is sufficient.
 */
function ctxWithStubs(opts: {
    list?: ProcessEntry[];
    get?: ProcessEntry | undefined;
    getRingBuffer?: ProcessFrame[];
    getRingBufferFn?: () => ProcessFrame[];
    writeStdinThrows?: Error;
    start?: (id: string) => Promise<ProcessEntry>;
    stop?: (id: string) => Promise<void>;
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
        get: () => opts.get,
        getRingBuffer: opts.getRingBufferFn ?? (() => opts.getRingBuffer ?? []),

        writeStdin: (agentId: string, line: string) => {
            if (opts.writeStdinThrows) throw opts.writeStdinThrows;
            stdinCalls.push({ agentId, line });
        },
        start,
        stop,
    };
    const ctx = { supervisor: () => supervisor } as unknown as ServerContext;
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
                { stream: 'stdout', ts: '2026-07-05T00:00:01.000Z', line: 'starting up' },
                { stream: 'stderr', ts: '2026-07-05T00:00:02.000Z', line: 'warning: low memory' },
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
                liveBuffer.push({ stream: 'stdout', ts: '2026-07-05T00:00:05.000Z', line: 'tail frame' });
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

    test('module is a no-op when ctx is undefined (Cloudflare Workers gate)', () => {
        const app = new Hono();
        teamModule.mount(app, undefined);
        // Should not throw and should register no routes.
    });
});
