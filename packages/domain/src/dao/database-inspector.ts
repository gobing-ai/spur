import type { DbAdapter } from '@gobing-ai/ts-db';

/** Default page size for {@link DatabaseInspector.readRows} when a query omits one. */
export const DEFAULT_DATABASE_PAGE_SIZE = 50;

/** Maximum bytes of a text cell in a page read; longer text is cut with `truncated: true`. */
export const DATABASE_TEXT_CELL_MAX_BYTES = 4096;

/** One column of a live table, resolved from `PRAGMA table_info` in `cid` order. */
export interface DbColumn {
    name: string;
    type: string;
    notNull: boolean;
    pk: boolean;
}

/** A live table's schema plus its exact row count. */
export interface DbTableDescription {
    name: string;
    columns: DbColumn[];
    rowCount: number;
}

/**
 * JSON-safe projection of one cell. `blob` carries only the byte length — the
 * value itself is never serialized to the wire.
 */
export type DbCell =
    | { t: 'null' }
    | { t: 'num'; v: number }
    | { t: 'text'; v: string; truncated?: true }
    | { t: 'blob'; bytes: number };

/** One page query: optional 1-based page, sort column/direction and one contains filter. */
export interface DatabaseRowQuery {
    page?: number;
    pageSize?: number;
    sort?: string;
    dir?: 'asc' | 'desc';
    filterColumn?: string;
    filterValue?: string;
}

/** Rows for one page plus the column order and the filter-aware row total. */
export interface DbRowPage {
    total: number;
    columns: string[];
    rows: DbCell[][];
}

/** One full-value row (no text truncation), addressed by offset. */
export interface DbRowDetail {
    columns: string[];
    row: DbCell[];
}

/** Raised when a name is not a table of the live schema. */
export class UnknownTableError extends Error {
    readonly table: string;

    constructor(table: string) {
        super(`unknown table: ${table}`);
        this.name = 'UnknownTableError';
        this.table = table;
    }
}

/** Raised when a sort/filter name is not a column of the resolved live table. */
export class UnknownColumnError extends Error {
    readonly table: string;
    readonly column: string;

    constructor(table: string, column: string) {
        super(`unknown column "${column}" on table "${table}"`);
        this.name = 'UnknownColumnError';
        this.table = table;
        this.column = column;
    }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Double-quote a schema-sourced identifier, doubling any embedded quote. */
function quoteIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

/** Escape LIKE metacharacters so the bound pattern is an exact contains match. */
function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Cut to `maxBytes`, backing off to a UTF-8 character boundary so no code point splits. */
function truncateUtf8(value: string, maxBytes: number): { text: string; truncated: boolean } {
    const bytes = encoder.encode(value);
    if (bytes.byteLength <= maxBytes) return { text: value, truncated: false };
    let end = maxBytes;
    while (end > 0 && ((bytes[end] ?? 0) & 0b1100_0000) === 0b1000_0000) end--;
    return { text: decoder.decode(bytes.subarray(0, end)), truncated: true };
}

/** Project one raw driver value to the tagged, JSON-safe cell shape. */
function projectCell(value: unknown, truncateText: boolean): DbCell {
    if (value === null || value === undefined) return { t: 'null' };
    if (value instanceof Uint8Array) return { t: 'blob', bytes: value.byteLength };
    if (typeof value === 'number') {
        return Number.isFinite(value) ? { t: 'num', v: value } : { t: 'text', v: String(value) };
    }
    if (typeof value === 'bigint') return { t: 'num', v: Number(value) };
    const text = typeof value === 'string' ? value : String(value);
    if (!truncateText) return { t: 'text', v: text };
    const { text: cut, truncated } = truncateUtf8(text, DATABASE_TEXT_CELL_MAX_BYTES);
    return truncated ? { t: 'text', v: cut, truncated: true } : { t: 'text', v: cut };
}

/**
 * Read-only introspection DAO over a live SQLite schema (feature G631, task 1183).
 *
 * Every identifier is resolved against the live schema first — `listTables` for
 * tables, `PRAGMA table_info` for columns — and only then quoted from the schema's
 * own spelling, so an arbitrary caller string never reaches the SQL text. Filter
 * values are bound with `%`, `_` and `\` escaped. Only `SELECT` and
 * `PRAGMA table_info` statements are ever issued; the class never writes.
 */
export class DatabaseInspector {
    constructor(private readonly db: DbAdapter) {}

    /**
     * User tables of the live schema (SQLite internals excluded), sorted by name.
     * Stated as `sqlite_master` SQL rather than a scrape so a future view/index
     * type stays out until deliberately added.
     */
    async listTables(): Promise<string[]> {
        const rows = await this.db.queryAll<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name",
        );
        return rows.map((row) => row.name);
    }

    /** Columns in `cid` order plus the exact `COUNT(*)` of the named table. */
    async describe(table: string): Promise<DbTableDescription> {
        const name = await this.resolveTableName(table);
        const [columns, counted] = await Promise.all([
            this.readColumns(name),
            this.db.queryAll<{ n: number }>(`SELECT COUNT(*) AS n FROM ${quoteIdentifier(name)}`),
        ]);
        return { name, columns, rowCount: counted[0]?.n ?? 0 };
    }

    /**
     * One page of rows with optional single-column sort and one contains filter.
     * `total` counts the filter-matching rows, so a paged footer stays honest.
     */
    async readRows(table: string, q: DatabaseRowQuery = {}): Promise<DbRowPage> {
        const name = await this.resolveTableName(table);
        const columns = await this.readColumns(name);
        const filter = this.buildFilter(name, columns, q);
        const order = this.buildOrder(name, columns, q);
        const pageSize =
            q.pageSize !== undefined && q.pageSize > 0 ? Math.trunc(q.pageSize) : DEFAULT_DATABASE_PAGE_SIZE;
        const page = q.page !== undefined && q.page > 0 ? Math.trunc(q.page) : 1;
        const counted = await this.db.queryAll<{ n: number }>(
            `SELECT COUNT(*) AS n FROM ${quoteIdentifier(name)}${filter.sql}`,
            ...filter.params,
        );
        const raw = await this.db.queryAll<Record<string, unknown>>(
            `SELECT * FROM ${quoteIdentifier(name)}${filter.sql}${order} LIMIT ? OFFSET ?`,
            ...filter.params,
            pageSize,
            (page - 1) * pageSize,
        );
        return {
            total: counted[0]?.n ?? 0,
            columns: columns.map((column) => column.name),
            rows: raw.map((row) => columns.map((column) => projectCell(row[column.name], true))),
        };
    }

    /**
     * One row at `offset` with full (untruncated) values. Addressed by offset
     * because `WITHOUT ROWID` tables and views have no rowid to key on.
     */
    async readRow(table: string, q: DatabaseRowQuery & { offset: number }): Promise<DbRowDetail> {
        const name = await this.resolveTableName(table);
        const columns = await this.readColumns(name);
        const filter = this.buildFilter(name, columns, q);
        const order = this.buildOrder(name, columns, q);
        const raw = await this.db.queryAll<Record<string, unknown>>(
            `SELECT * FROM ${quoteIdentifier(name)}${filter.sql}${order} LIMIT 1 OFFSET ?`,
            ...filter.params,
            Math.max(0, Math.trunc(q.offset)),
        );
        const first = raw[0];
        return {
            columns: columns.map((column) => column.name),
            row: first === undefined ? [] : columns.map((column) => projectCell(first[column.name], false)),
        };
    }

    /** Resolve a caller name to the live table's own spelling, or throw. */
    private async resolveTableName(table: string): Promise<string> {
        const tables = await this.listTables();
        const match = tables.find((candidate) => candidate.toLowerCase() === table.toLowerCase());
        if (match === undefined) throw new UnknownTableError(table);
        return match;
    }

    /** Columns of an already-resolved table name, in `cid` order. */
    private async readColumns(table: string): Promise<DbColumn[]> {
        const rows = await this.db.queryAll<{ name: string; type: string | null; notnull: number; pk: number }>(
            `PRAGMA table_info(${quoteIdentifier(table)})`,
        );
        return rows.map((row) => ({
            name: row.name,
            type: row.type ?? '',
            notNull: row.notnull === 1,
            pk: row.pk === 1,
        }));
    }

    /** Resolve a caller column name to the schema's spelling, or throw. */
    private resolveColumnName(table: string, columns: DbColumn[], column: string): string {
        const match = columns.find((candidate) => candidate.name.toLowerCase() === column.toLowerCase());
        if (match === undefined) throw new UnknownColumnError(table, column);
        return match.name;
    }

    private buildFilter(table: string, columns: DbColumn[], q: DatabaseRowQuery): { sql: string; params: unknown[] } {
        const column = q.filterColumn?.trim();
        if (column === undefined || column === '') return { sql: '', params: [] };
        const name = this.resolveColumnName(table, columns, column);
        return {
            sql: ` WHERE ${quoteIdentifier(name)} LIKE ? ESCAPE '\\'`,
            params: [`%${escapeLike(q.filterValue ?? '')}%`],
        };
    }

    private buildOrder(table: string, columns: DbColumn[], q: DatabaseRowQuery): string {
        const column = q.sort?.trim();
        if (column === undefined || column === '') return '';
        const name = this.resolveColumnName(table, columns, column);
        return ` ORDER BY ${quoteIdentifier(name)} ${q.dir === 'desc' ? 'DESC' : 'ASC'}`;
    }
}
