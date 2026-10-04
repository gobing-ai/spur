import {
    projectWorkflowProgress,
    RunStoreBadCursorError,
    RunStoreNotFoundError,
    type RunStoreService,
} from '@gobing-ai/spur-app';
import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';

/**
 * Server module for the workflow run-store read API (task 0373 / J3 R22–R25).
 *
 * Thin transport only: all query + redaction lives in {@link RunStoreService}
 * (application layer) and the domain DAOs. This module does not import
 * `@gobing-ai/ts-db` (ADR-021 / R5).
 *
 * | Method | Path | Notes |
 * | --- | --- | --- |
 * | GET | `/api/runs` | List + status/workflow/since filters + keyset paging; bad `since` → 400 `MALFORMED_SINCE` |
 * | GET | `/api/runs/by-wbs/:wbs` | WBS → linked runs (empty list, not error) |
 * | GET | `/api/runs/:runId/progress` | `projectWorkflowProgress` projection; unknown run → 404 `RUN_NOT_FOUND` |
 * | GET | `/api/runs/:runId` | Detail: phases, transitions, actions |
 */
export const runsModule: ServerModule = {
    name: 'runs',

    mount(app: Hono, ctx: ServerContext | undefined): void {
        if (!ctx) return;

        // GET /api/runs — newest-first list (R1).
        app.get('/api/runs', async (c) => {
            const status = c.req.query('status') || undefined;
            const limitParam = c.req.query('limit');
            const cursor = c.req.query('cursor') || undefined;
            let limit: number | undefined;
            if (limitParam !== undefined) {
                const parsed = Number.parseInt(limitParam, 10);
                if (!Number.isNaN(parsed)) limit = parsed;
            }

            const workflow = c.req.query('workflow') || undefined;
            const sinceRaw = c.req.query('since') || undefined;
            let since: string | undefined;
            if (sinceRaw !== undefined) {
                // 1069 R4: normalize to canonical ISO before the lexicographic
                // `started_at` comparison; reject unparseable values before the
                // service runs.
                if (Number.isNaN(Date.parse(sinceRaw))) {
                    return c.json({ error: `malformed since: ${sinceRaw}`, code: 'MALFORMED_SINCE' }, 400);
                }
                since = new Date(sinceRaw).toISOString();
            }

            try {
                const service = ctx.runStoreService();
                const result = await service.list({ status, limit, cursor, workflow, since });
                return c.json(result);
            } catch (err) {
                if (err instanceof RunStoreBadCursorError) {
                    return c.json({ error: err.message, code: err.code }, 400);
                }
                throw err;
            }
        });

        // GET /api/runs/by-wbs/:wbs — must register before :runId (R3).
        app.get('/api/runs/by-wbs/:wbs', async (c) => {
            const wbs = c.req.param('wbs');
            const limitParam = c.req.query('limit');
            let limit: number | undefined;
            if (limitParam !== undefined) {
                const parsed = Number.parseInt(limitParam, 10);
                if (!Number.isNaN(parsed)) limit = parsed;
            }
            const service = ctx.runStoreService();
            const result = await service.listByWbs(wbs, limit);
            return c.json(result);
        });

        // GET /api/runs/:runId/progress — the single progress projection shared
        // with `spur workflow progress` (1069 R1/R2). An `orphan-row` diagnostic
        // means the run id is unknown → 404, same shape as the detail route.
        app.get('/api/runs/:runId/progress', async (c) => {
            const runId = c.req.param('runId');
            const projection = await projectWorkflowProgress(runId, {
                db: await ctx.getDb(),
                projectRoot: ctx.cwd,
            });
            if (projection.diagnostics.some((d) => d.code === 'orphan-row')) {
                return c.json({ error: `run not found: ${runId}`, code: 'RUN_NOT_FOUND', runId }, 404);
            }
            return c.json(projection);
        });

        // GET /api/runs/:runId — full detail or clean 404 (R2/R4).
        app.get('/api/runs/:runId', async (c) => {
            const runId = c.req.param('runId');
            const service: RunStoreService = ctx.runStoreService();
            try {
                const detail = await service.getDetail(runId);
                return c.json(detail);
            } catch (err) {
                if (err instanceof RunStoreNotFoundError) {
                    return c.json({ error: err.message, code: err.code, runId: err.runId }, 404);
                }
                throw err;
            }
        });
    },
};
