import { DatabaseBrowserService, type DatabaseResult } from '@gobing-ai/spur-app';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import type { Context, Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';

/**
 * Projects Database tab HTTP surface (feature G631, task 1183).
 *
 * - GET /api/project/database/tables — live user tables, sorted by name
 * - GET /api/project/database/tables/:name — schema + exact row count
 * - GET /api/project/database/tables/:name/rows — one server-paged window
 * - GET /api/project/database/tables/:name/row — one row, untruncated
 *
 * Read-only: the whole surface goes through {@link DatabaseBrowserService} over the
 * lazily opened migrated adapter, and every identifier is schema-resolved inside the
 * domain inspector. Named failures map to 404/400; a `getDb()` throw is the Worker's
 * 503; anything else is a 500 — never the observability module's 500-on-anything.
 */

type QueryContext = Context;

/** Run `visit` with a service over the live adapter, mapping serve-side failures. */
async function withService(
    c: QueryContext,
    ctx: ServerContext,
    visit: (service: DatabaseBrowserService) => Promise<Response>,
): Promise<Response> {
    let db: DbAdapter;
    try {
        db = await ctx.getDb();
    } catch {
        return c.json({ error: 'database-unavailable' }, 503);
    }
    try {
        return await visit(new DatabaseBrowserService(db));
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: message }, 500);
    }
}

/** Map a named service failure to its status; non-failures were already non-2xx. */
function resultResponse<T>(c: QueryContext, result: DatabaseResult<T>): Response {
    if (result.ok) return c.json(result.value);
    return c.json({ error: result.outcome }, result.outcome === 'invalid-request' ? 400 : 404);
}

function rowParams(c: QueryContext) {
    return {
        page: c.req.query('page'),
        pageSize: c.req.query('pageSize'),
        sort: c.req.query('sort'),
        dir: c.req.query('dir'),
        filterColumn: c.req.query('filterColumn'),
        filter: c.req.query('filter'),
    };
}

function handleTables(ctx: ServerContext) {
    return (c: QueryContext) => withService(c, ctx, async (service) => c.json({ tables: await service.listTables() }));
}

function handleDescribe(ctx: ServerContext) {
    return (c: QueryContext) =>
        withService(c, ctx, async (service) => resultResponse(c, await service.describe(c.req.param('name') ?? '')));
}

function handleRows(ctx: ServerContext) {
    return (c: QueryContext) =>
        withService(c, ctx, async (service) =>
            resultResponse(c, await service.readRows(c.req.param('name') ?? '', rowParams(c))),
        );
}

function handleRow(ctx: ServerContext) {
    return (c: QueryContext) =>
        withService(c, ctx, async (service) =>
            resultResponse(
                c,
                await service.readRow(c.req.param('name') ?? '', { ...rowParams(c), offset: c.req.query('offset') }),
            ),
        );
}

/** Server module serving the read-only Projects Database tab routes (feature G631, task 1183). */
export const databaseModule: ServerModule = {
    name: 'database',

    mount(app: Hono, ctx: ServerContext | undefined): void {
        if (!ctx) return;
        app.get('/api/project/database/tables', handleTables(ctx));
        app.get('/api/project/database/tables/:name', handleDescribe(ctx));
        app.get('/api/project/database/tables/:name/rows', handleRows(ctx));
        app.get('/api/project/database/tables/:name/row', handleRow(ctx));
    },
};
