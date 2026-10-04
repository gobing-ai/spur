import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import {
    projectWorkflowProgress,
    RunStoreBadCursorError,
    type RunStoreDetail,
    type RunStoreListResult,
    RunStoreNotFoundError,
    type RunStoreService,
    type RunStoreWbsLink,
    type WorkflowProgressProjection,
} from '@gobing-ai/spur-app';
import { type WorkflowProgressProjectionDto, workflowProgressProjectionSchema } from '@gobing-ai/spur-contracts';
import { applyCliMigrations } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { Hono } from 'hono';
import type { ServerContext } from '../../../src/context';
import { runsModule } from '../../../src/modules/runs';

const PROJECT_ROOT = resolve(__dirname, '../../../../..');

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

    test('GET /api/runs forwards workflow + normalized since filters (1069 R4)', async () => {
        const listResult: RunStoreListResult = { runs: [], count: 0, nextCursor: null, hasMore: false };
        const app = new Hono();
        runsModule.mount(
            app,
            ctxWithService({
                list: async (q = {}) => {
                    expect(q.workflow).toBe('task-pipeline');
                    expect(q.since).toBe('2026-09-01T00:00:00.000Z');
                    return listResult;
                },
            }),
        );
        const res = await app.fetch(
            new Request('http://localhost/api/runs?workflow=task-pipeline&since=2026-09-01T00:00:00Z'),
        );
        expect(res.status).toBe(200);
    });

    test('GET /api/runs?since=garbage returns 400 MALFORMED_SINCE without calling the service (1069 R4)', async () => {
        const app = new Hono();
        runsModule.mount(
            app,
            ctxWithService({
                list: async () => {
                    expect.unreachable('service must not be called for a malformed since');
                },
            }),
        );
        const res = await app.fetch(new Request('http://localhost/api/runs?since=garbage'));
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string; code: string };
        expect(body.code).toBe('MALFORMED_SINCE');
        expect(body.error).toContain('garbage');
    });
});

describe('runs module progress route (1069 / E72 R5)', () => {
    async function setupProgressDb() {
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);
        // Seed mirrors packages/app/tests/workflow/progress-projection.test.ts:63-77.
        const now = Date.now();
        await db.run(
            "INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES ('r1', 'test-pipeline', 'done', '2026-08-19T00:00:00Z', ?, ?, ?)",
            JSON.stringify({ definitionDigest: 'sha256:testdigest' }),
            now,
            now,
        );
        await db.run(
            "INSERT INTO action_runs (id, run_id, node, kind, status, ok, duration_ms, started_at, completed_at, created_at) VALUES ('a1', 'r1', 'precheck', 'shell', 'success', 1, 100, '2026-08-19T00:00:01Z', '2026-08-19T00:00:02Z', ?)",
            now + 10,
        );
        return db;
    }

    function ctxWithDb(db: Awaited<ReturnType<typeof createDbAdapter>>): ServerContext {
        return { getDb: async () => db, cwd: PROJECT_ROOT } as unknown as ServerContext;
    }

    test('GET /api/runs/:runId/progress returns 200 with the shared projection (R1)', async () => {
        const db = await setupProgressDb();
        const app = new Hono();
        runsModule.mount(app, ctxWithDb(db));

        const res = await app.fetch(new Request('http://localhost/api/runs/r1/progress'));
        expect(res.status).toBe(200);
        const body = (await res.json()) as WorkflowProgressProjectionDto;

        // Wire shape parses against the shared contract schema.
        const parsed = workflowProgressProjectionSchema.parse(body);

        // One projection implementation: the route body equals the direct app-layer
        // call, apart from the per-call projectedAt timestamp.
        const direct = await projectWorkflowProgress('r1', { db, projectRoot: PROJECT_ROOT });
        const { projectedAt: _bodyAt, ...bodyRest } = parsed;
        const { projectedAt: _directAt, ...directRest } = direct;
        expect(bodyRest).toEqual(directRest);

        db.close();
    });

    test('GET /api/runs/:runId/progress returns 404 RUN_NOT_FOUND for an unknown id (R2)', async () => {
        const db = await setupProgressDb();
        const app = new Hono();
        runsModule.mount(app, ctxWithDb(db));

        const res = await app.fetch(new Request('http://localhost/api/runs/nope/progress'));
        expect(res.status).toBe(404);
        const body = (await res.json()) as { error: string; code: string; runId: string };
        expect(body).toEqual({
            error: 'run not found: nope',
            code: 'RUN_NOT_FOUND',
            runId: 'nope',
        });
        db.close();
    });

    test('WorkflowProgressProjection and WorkflowProgressProjectionDto stay assignable in both directions (R5)', () => {
        // Type-drift guard: `bun run typecheck` fails if either side gains or
        // changes a field, in either direction.
        const toDto = (p: WorkflowProgressProjection): WorkflowProgressProjectionDto => p;
        const fromDto = (d: WorkflowProgressProjectionDto): WorkflowProgressProjection => d;
        expect(typeof toDto).toBe('function');
        expect(typeof fromDto).toBe('function');
    });
});
