import { describe, expect, test } from 'bun:test';
import {
    RunStoreBadCursorError,
    type RunStoreDetail,
    type RunStoreListResult,
    RunStoreNotFoundError,
    type RunStoreService,
    type RunStoreWbsLink,
} from '@gobing-ai/spur-app';
import { Hono } from 'hono';
import type { ServerContext } from '../../../src/context';
import { runsModule } from '../../../src/modules/runs';

function ctxWithService(service: Partial<RunStoreService>): ServerContext {
    return {
        runStoreService: () => service as RunStoreService,
    } as unknown as ServerContext;
}

describe('runs module', () => {
    test('GET /api/runs returns list envelope', async () => {
        const listResult: RunStoreListResult = {
            runs: [
                {
                    id: 'run_1',
                    workflowName: 'task-pipeline',
                    status: 'done',
                    mode: 'state-machine',
                    agent: 'omp',
                    startedAt: '2026-07-01T10:00:00.000Z',
                    completedAt: '2026-07-01T10:05:00.000Z',
                },
            ],
            count: 1,
            nextCursor: null,
            hasMore: false,
        };
        const app = new Hono();
        runsModule.mount(
            app,
            ctxWithService({
                list: async (q = {}) => {
                    expect(q.status).toBe('done');
                    expect(q.limit).toBe(10);
                    return listResult;
                },
            }),
        );

        const res = await app.fetch(new Request('http://localhost/api/runs?status=done&limit=10'));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(listResult);
    });

    test('GET /api/runs returns 400 for malformed cursor', async () => {
        const app = new Hono();
        runsModule.mount(
            app,
            ctxWithService({
                list: async () => {
                    throw new RunStoreBadCursorError('malformed cursor: not valid base64url');
                },
            }),
        );
        const res = await app.fetch(new Request('http://localhost/api/runs?cursor=bad'));
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string; code: string };
        expect(body.code).toBe('MALFORMED_CURSOR');
        expect(body.error).toContain('malformed cursor');
    });

    test('GET /api/runs/:runId returns detail', async () => {
        const detail: RunStoreDetail = {
            run: {
                id: 'run_1',
                workflowName: 'task-pipeline',
                status: 'done',
                mode: 'state-machine',
                agent: 'pi',
                startedAt: '2026-07-01T10:00:00.000Z',
                completedAt: '2026-07-01T10:05:00.000Z',
            },
            phases: [{ phase: 'implement', status: 'done', startedAt: null, completedAt: null }],
            transitions: [{ from: 'todo', to: 'wip', trigger: 'start' }],
            actions: [
                {
                    id: 'act1',
                    node: 'implement',
                    kind: 'agent.run',
                    status: 'done',
                    durationMs: 100,
                    ok: true,
                    resultSummary: { ok: true },
                    startedAt: null,
                    completedAt: null,
                },
            ],
        };
        const app = new Hono();
        runsModule.mount(
            app,
            ctxWithService({
                getDetail: async (id) => {
                    expect(id).toBe('run_1');
                    return detail;
                },
            }),
        );
        const res = await app.fetch(new Request('http://localhost/api/runs/run_1'));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(detail);
    });

    test('GET /api/runs/:runId returns clean 404 for unknown id (R4)', async () => {
        const app = new Hono();
        runsModule.mount(
            app,
            ctxWithService({
                getDetail: async (id) => {
                    throw new RunStoreNotFoundError(id);
                },
            }),
        );
        const res = await app.fetch(new Request('http://localhost/api/runs/run_missing'));
        expect(res.status).toBe(404);
        const body = (await res.json()) as { error: string; code: string; runId: string };
        expect(body).toEqual({
            error: 'run not found: run_missing',
            code: 'RUN_NOT_FOUND',
            runId: 'run_missing',
        });
    });

    test('GET /api/runs/by-wbs/:wbs returns empty list for no links (R3)', async () => {
        const app = new Hono();
        runsModule.mount(
            app,
            ctxWithService({
                listByWbs: async (wbs) => ({ wbs, links: [] as RunStoreWbsLink[], count: 0 }),
            }),
        );
        const res = await app.fetch(new Request('http://localhost/api/runs/by-wbs/9999'));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ wbs: '9999', links: [], count: 0 });
    });

    test('GET /api/runs/by-wbs/:wbs forwards a valid limit query', async () => {
        const app = new Hono();
        runsModule.mount(
            app,
            ctxWithService({
                listByWbs: async (wbs, limit) => {
                    expect(wbs).toBe('0373');
                    expect(limit).toBe(25);
                    return { wbs, links: [] as RunStoreWbsLink[], count: 0 };
                },
            }),
        );
        const res = await app.fetch(new Request('http://localhost/api/runs/by-wbs/0373?limit=25'));
        expect(res.status).toBe(200);
    });

    test('GET /api/runs ignores non-numeric limit and still lists', async () => {
        const listResult: RunStoreListResult = {
            runs: [],
            count: 0,
            nextCursor: null,
            hasMore: false,
        };
        const app = new Hono();
        runsModule.mount(
            app,
            ctxWithService({
                list: async (q = {}) => {
                    // NaN parse → limit left undefined; service applies its own default.
                    expect(q.limit).toBeUndefined();
                    return listResult;
                },
            }),
        );
        const res = await app.fetch(new Request('http://localhost/api/runs?limit=not-a-number'));
        expect(res.status).toBe(200);
    });

    test('GET /api/runs surfaces unexpected service errors (not a silent 200)', async () => {
        const app = new Hono();
        // Mirror production: error middleware turns uncaught throws into 500.
        app.onError((err, c) => c.json({ error: err.message }, 500));
        runsModule.mount(
            app,
            ctxWithService({
                list: async () => {
                    throw new Error('db unavailable');
                },
            }),
        );
        const res = await app.fetch(new Request('http://localhost/api/runs'));
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'db unavailable' });
    });

    test('mount is a no-op without ServerContext', () => {
        const app = new Hono();
        expect(() => runsModule.mount(app, undefined)).not.toThrow();
    });
});
