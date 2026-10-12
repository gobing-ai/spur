import {
    DatabaseInspector,
    type DatabaseRowQuery,
    type DbAdapter,
    type DbCell,
    type DbRowDetail,
    type DbTableDescription,
    DEFAULT_DATABASE_PAGE_SIZE,
    UnknownColumnError,
    UnknownTableError,
} from '@gobing-ai/spur-domain';

/** Page-size cap for a browse request; larger `pageSize` values are clamped down to it. */
export const MAX_DATABASE_PAGE_SIZE = 200;

/** Named failure outcomes the server module maps to HTTP statuses. */
export type DatabaseFailure = 'unknown-table' | 'unknown-column' | 'invalid-request';

/** Result of a browser read: either the value or a named, HTTP-mappable failure. */
export type DatabaseResult<T> = { ok: true; value: T } | { ok: false; outcome: DatabaseFailure; message: string };

/** One server-paged window of rows plus the filter-aware total for its footer. */
export interface DatabaseRowsPage {
    page: number;
    pageSize: number;
    total: number;
    columns: string[];
    rows: DbCell[][];
}

/** Raw row-list query params as they arrive from the HTTP query string. */
export interface DatabaseRowParams {
    page?: string;
    pageSize?: string;
    sort?: string;
    dir?: string;
    filterColumn?: string;
    filter?: string;
}

/** Raw single-row query params: the page params plus the row's offset. */
export interface DatabaseRowDetailParams extends DatabaseRowParams {
    offset?: string;
}

function trimToUndefined(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** Whole numbers only; anything malformed falls back to `1` rather than failing the read. */
function normalizePage(value: string | undefined): number {
    if (value === undefined || value === '') return 1;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/** Default 50, clamped to `[1, MAX_DATABASE_PAGE_SIZE]`; malformed input takes the default. */
function normalizePageSize(value: string | undefined): number {
    if (value === undefined || value === '') return DEFAULT_DATABASE_PAGE_SIZE;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_DATABASE_PAGE_SIZE;
    return Math.min(parsed, MAX_DATABASE_PAGE_SIZE);
}

/**
 * Validate and clamp the raw row query. `dir` is the only malformed value that
 * rejects outright — page/pageSize normalise, and the sort/filter columns are
 * resolved against the live schema downstream (so an unknown name is
 * `unknown-column`, not `invalid-request`).
 */
function normalizeRowQuery(params: DatabaseRowParams): DatabaseResult<DatabaseRowQuery> {
    let dir: 'asc' | 'desc' | undefined;
    if (params.dir !== undefined && params.dir !== '') {
        const candidate = params.dir.toLowerCase();
        if (candidate !== 'asc' && candidate !== 'desc') {
            return {
                ok: false,
                outcome: 'invalid-request',
                message: `invalid dir: "${params.dir}" — expected asc | desc`,
            };
        }
        dir = candidate;
    }
    return {
        ok: true,
        value: {
            page: normalizePage(params.page),
            pageSize: normalizePageSize(params.pageSize),
            sort: trimToUndefined(params.sort),
            dir,
            filterColumn: trimToUndefined(params.filterColumn),
            filterValue: params.filter,
        },
    };
}

/** Domain errors become named outcomes; anything else is not a browser-level failure. */
function mapDomainFailure(err: unknown): DatabaseResult<never> {
    if (err instanceof UnknownTableError) return { ok: false, outcome: 'unknown-table', message: err.message };
    if (err instanceof UnknownColumnError) return { ok: false, outcome: 'unknown-column', message: err.message };
    throw err;
}

/**
 * Read-only browse service over the served project database (feature G631, task 1183).
 *
 * Holds the request-shape rules (page clamp, `dir` validation, error naming) so the
 * Hono module stays a thin transport and the domain inspector stays a pure DAO. It
 * caches nothing: `sqlite_master` and `PRAGMA table_info` are in-memory, so every
 * request sees the live schema.
 */
export class DatabaseBrowserService {
    private readonly inspector: DatabaseInspector;

    constructor(db: DbAdapter) {
        this.inspector = new DatabaseInspector(db);
    }

    /** Live user tables, sorted by name. */
    listTables(): Promise<string[]> {
        return this.inspector.listTables();
    }

    /** One table's columns and exact row count. */
    async describe(table: string): Promise<DatabaseResult<DbTableDescription>> {
        try {
            return { ok: true, value: await this.inspector.describe(table) };
        } catch (err) {
            return mapDomainFailure(err);
        }
    }

    /** One clamped page of rows with optional single-column sort and contains filter. */
    async readRows(table: string, params: DatabaseRowParams): Promise<DatabaseResult<DatabaseRowsPage>> {
        const normalized = normalizeRowQuery(params);
        if (!normalized.ok) return normalized;
        try {
            const page = await this.inspector.readRows(table, normalized.value);
            return {
                ok: true,
                value: {
                    page: normalized.value.page ?? 1,
                    pageSize: normalized.value.pageSize ?? DEFAULT_DATABASE_PAGE_SIZE,
                    total: page.total,
                    columns: page.columns,
                    rows: page.rows,
                },
            };
        } catch (err) {
            return mapDomainFailure(err);
        }
    }

    /** One row at `offset` with full (untruncated) values. */
    async readRow(table: string, params: DatabaseRowDetailParams): Promise<DatabaseResult<DbRowDetail>> {
        const normalized = normalizeRowQuery(params);
        if (!normalized.ok) return normalized;
        const raw = params.offset;
        const offset = raw === undefined || raw === '' ? Number.NaN : Number(raw);
        if (!Number.isInteger(offset) || offset < 0) {
            return {
                ok: false,
                outcome: 'invalid-request',
                message: `invalid offset: "${raw ?? ''}" — expected a non-negative integer`,
            };
        }
        try {
            return { ok: true, value: await this.inspector.readRow(table, { ...normalized.value, offset }) };
        } catch (err) {
            return mapDomainFailure(err);
        }
    }
}
