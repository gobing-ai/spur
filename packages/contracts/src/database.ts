import { z } from 'zod';

// ─── Projects Database tab wire shapes (feature G631) ───
// CONTRACT ONLY — the four routes are served by the raw Hono module
// `apps/server/src/modules/database`; these entries document their wire shapes for typed
// clients. They are not in the generated OpenAPI, which covers only the oRPC contract
// (apps/server/src/openapi.ts). Same pattern as the observability DTOs.
// Shapes are owned by docs/design/projects-database-tab.md §3.3; task 1184
// consumes them.

/**
 * Tagged, JSON-safe projection of one cell. `blob` carries only the byte length;
 * `text` longer than 4 KiB is cut with `truncated: true` in a paged read.
 */
export const databaseCellSchema = z.discriminatedUnion('t', [
    z.object({ t: z.literal('null') }),
    z.object({ t: z.literal('num'), v: z.number() }),
    z.object({ t: z.literal('text'), v: z.string(), truncated: z.boolean().optional() }),
    z.object({ t: z.literal('blob'), bytes: z.number() }),
]);

/** Tagged, JSON-safe projection of one cell. */
export type DatabaseCell = z.infer<typeof databaseCellSchema>;

/** One column of a table's live schema, in `cid` order. */
export const databaseColumnSchema = z.object({
    name: z.string(),
    type: z.string(),
    notNull: z.boolean(),
    pk: z.boolean(),
});

/** One column of a table's live schema. */
export type DatabaseColumn = z.infer<typeof databaseColumnSchema>;

/** Response of GET /api/project/database/tables. */
export const databaseTablesResponseSchema = z.object({
    tables: z.array(z.string()),
});

/** Response DTO of GET /api/project/database/tables. */
export type DatabaseTablesResponse = z.infer<typeof databaseTablesResponseSchema>;

/** Response of GET /api/project/database/tables/:name — schema plus exact row count. */
export const databaseTableResponseSchema = z.object({
    name: z.string(),
    columns: z.array(databaseColumnSchema),
    rowCount: z.number(),
});

/** Response DTO of GET /api/project/database/tables/:name. */
export type DatabaseTableResponse = z.infer<typeof databaseTableResponseSchema>;

/** Response of GET /api/project/database/tables/:name/rows — one server-paged window. */
export const databaseRowsResponseSchema = z.object({
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
    columns: z.array(z.string()),
    rows: z.array(z.array(databaseCellSchema)),
});

/** Response DTO of GET /api/project/database/tables/:name/rows. */
export type DatabaseRowsResponse = z.infer<typeof databaseRowsResponseSchema>;

/** Response of GET /api/project/database/tables/:name/row — one row, untruncated. */
export const databaseRowResponseSchema = z.object({
    columns: z.array(z.string()),
    row: z.array(databaseCellSchema),
});

/** Response DTO of GET /api/project/database/tables/:name/row. */
export type DatabaseRowResponse = z.infer<typeof databaseRowResponseSchema>;

/** Error body of the database routes: unknown-table/unknown-column 404, invalid-request 400, database-unavailable 503. */
export const databaseErrorResponseSchema = z.object({
    error: z.enum(['unknown-table', 'unknown-column', 'invalid-request', 'database-unavailable']),
});

/** Error DTO of the database routes. */
export type DatabaseErrorResponse = z.infer<typeof databaseErrorResponseSchema>;
