import type {
    DatabaseCell,
    DatabaseColumn,
    DatabaseErrorResponse,
    DatabaseRowResponse,
    DatabaseRowsResponse,
    DatabaseTableResponse,
    DatabaseTablesResponse,
} from '@gobing-ai/spur-contracts';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Badge, Button, Card, CardBody, Input, Loading, Modal, Select, Tooltip } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';

/**
 * Projects → Database (feature G631, task 1184).
 *
 * Read-only browser over the served project's SQLite database: a filterable
 * table rail, a collapsible schema strip, and a server-paged dense row grid
 * with a row-detail modal. Layout contract: docs/design/projects-database-tab.md
 * §3.4. All paging, sorting and filtering happens on the server (tables reach
 * ~4M rows) — this file never sorts or filters fetched rows.
 *
 * Every fetch crosses the `resolveApiUrl()` + `fetchWithTimeout()` seam and
 * every failure maps to a named state (R7/AC8); no panel is ever blank.
 */

/** Server-clamped page size. The route accepts up to 200; the viewer fixes 50. */
export const DATABASE_PAGE_SIZE = 50;

/**
 * Settle time before the contains filter is sent to the server (R5). Each read costs a
 * filtered `COUNT(*)` plus a window select, executed synchronously on `bun:sqlite` inside
 * the Bun server, so reading once per keystroke blocks the shared event loop on a
 * multi-million-row table. 250 ms matches the repo's other server-driven filter boxes
 * (`HistoryShell`, `SystemEventsTab`).
 */
const FILTER_DEBOUNCE_MS = 250;

/** URL query keys owned by this tab (frozen seam of task 1184). */
const URL_KEYS = {
    table: 'table',
    page: 'page',
    sort: 'sort',
    dir: 'dir',
    filterColumn: 'fcol',
    filter: 'f',
} as const;

/** Named outcomes a resource fetch can reach; the design's state vocabulary. */
export type DatabaseResourceState = 'loading' | 'ready' | 'empty' | 'unknown-table' | 'unavailable' | 'failed';

export interface DatabaseResource<T> {
    state: DatabaseResourceState;
    data: T | null;
}

/** Normalised server request for one page of rows (or one row detail). */
export interface RowQuery {
    page: number;
    pageSize: number;
    sort: string | null;
    dir: 'asc' | 'desc';
    filterColumn: string | null;
    filterValue: string;
}

// ─── URL normalisation (malformed values fall back to defaults, never throw) ──

function normalizePage(raw: string | null): number {
    if (raw === null) return 1;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

function normalizeDir(raw: string | null): 'asc' | 'desc' {
    return raw === 'desc' ? 'desc' : 'asc';
}

function normalizeText(raw: string | null): string | null {
    if (raw === null) return null;
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
}

// ─── Transport ────────────────────────────────────────────────────────────────

function tablesUrl(): string {
    return `${resolveApiUrl()}/project/database/tables`;
}

function schemaUrl(name: string): string {
    return `${resolveApiUrl()}/project/database/tables/${encodeURIComponent(name)}`;
}

function rowsUrl(name: string, query: RowQuery): string {
    const url = new URL(`${schemaUrl(name)}/rows`);
    url.searchParams.set('page', String(query.page));
    url.searchParams.set('pageSize', String(query.pageSize));
    if (query.sort) {
        url.searchParams.set('sort', query.sort);
        url.searchParams.set('dir', query.dir);
    }
    if (query.filterColumn && query.filterValue) {
        url.searchParams.set('filterColumn', query.filterColumn);
        url.searchParams.set('filter', query.filterValue);
    }
    return url.toString();
}

function rowUrl(name: string, offset: number, query: RowQuery): string {
    const url = new URL(`${schemaUrl(name)}/row`);
    url.searchParams.set('offset', String(offset));
    if (query.sort) {
        url.searchParams.set('sort', query.sort);
        url.searchParams.set('dir', query.dir);
    }
    if (query.filterColumn && query.filterValue) {
        url.searchParams.set('filterColumn', query.filterColumn);
        url.searchParams.set('filter', query.filterValue);
    }
    return url.toString();
}

type FetchOutcome<T> =
    | { ok: true; data: T }
    | { ok: false; state: Exclude<DatabaseResourceState, 'loading' | 'ready' | 'empty'> };

async function readError(response: Response): Promise<DatabaseErrorResponse | null> {
    try {
        return (await response.json()) as DatabaseErrorResponse;
    } catch {
        return null;
    }
}

/** One JSON read that maps every HTTP / transport outcome to a named state. */
async function fetchResource<T>(url: string, signal: AbortSignal): Promise<FetchOutcome<T>> {
    let response: Response;
    try {
        response = await fetchWithTimeout(new Request(url, { signal }));
    } catch {
        return { ok: false, state: 'failed' };
    }
    if (response.status === 404) {
        const body = await readError(response);
        return { ok: false, state: body?.error === 'unknown-table' ? 'unknown-table' : 'failed' };
    }
    if (response.status === 503) return { ok: false, state: 'unavailable' };
    if (!response.ok) return { ok: false, state: 'failed' };
    try {
        return { ok: true, data: (await response.json()) as T };
    } catch {
        return { ok: false, state: 'failed' };
    }
}

// ─── Resource hooks (design key signatures) ──────────────────────────────────

function useResource<T>(url: string | null, reloadKey: number): DatabaseResource<T> {
    const [resource, setResource] = useState<DatabaseResource<T>>({ state: 'loading', data: null });
    useEffect(() => {
        // `reloadKey` is not read for its value — bumping it is the Retry signal that
        // re-runs this effect (the exhaustive-deps rule needs the read to see intent).
        void reloadKey;
        if (url === null) {
            setResource({ state: 'loading', data: null });
            return;
        }
        const controller = new AbortController();
        let active = true;
        setResource({ state: 'loading', data: null });
        void (async () => {
            const outcome = await fetchResource<T>(url, controller.signal);
            if (!active) return;
            setResource(outcome.ok ? { state: 'ready', data: outcome.data } : { state: outcome.state, data: null });
        })();
        return () => {
            active = false;
            controller.abort();
        };
    }, [url, reloadKey]);
    return resource;
}

/** The database's table names; `empty` when the database has no tables. */
export function useDatabaseTables(reloadKey = 0): DatabaseResource<DatabaseTablesResponse> {
    const raw = useResource<DatabaseTablesResponse>(tablesUrl(), reloadKey);
    return useMemo(() => (raw.data && raw.data.tables.length === 0 ? { state: 'empty', data: raw.data } : raw), [raw]);
}

/** Live schema + exact row count for one table; `unknown-table` when it is gone. */
export function useTableSchema(name: string | null, reloadKey = 0): DatabaseResource<DatabaseTableResponse> {
    const url = name === null ? null : schemaUrl(name);
    return useResource<DatabaseTableResponse>(url, reloadKey);
}

/** One server page of rows; `empty` when the (filtered) total is zero. */
export function useTableRows(
    name: string | null,
    query: RowQuery | null,
    reloadKey = 0,
): DatabaseResource<DatabaseRowsResponse> {
    const url = name !== null && query !== null ? rowsUrl(name, query) : null;
    const raw = useResource<DatabaseRowsResponse>(url, reloadKey);
    return useMemo(() => (raw.data && raw.data.total === 0 ? { state: 'empty', data: raw.data } : raw), [raw]);
}

/** One untruncated row for the detail modal. */
export function useTableRow(
    name: string | null,
    offset: number | null,
    query: RowQuery | null,
    reloadKey = 0,
): DatabaseResource<DatabaseRowResponse> {
    const url = name !== null && offset !== null && query !== null ? rowUrl(name, offset, query) : null;
    return useResource<DatabaseRowResponse>(url, reloadKey);
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

/** `4028297` → `4,028,297`. */
export function formatCount(value: number): string {
    return value.toLocaleString('en-US');
}

/** `1–50 of 4,028,297`, clamped to a zero-row table. */
export function rangeLabel(page: number, pageSize: number, total: number): string {
    if (total === 0) return `0 of 0`;
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    return `${formatCount(start)}–${formatCount(end)} of ${formatCount(total)}`;
}

/** Pretty-printed JSON when the text parses, else null (R6/AC6). */
export function prettyJson(text: string): string | null {
    const trimmed = text.trim();
    if (trimmed === '') return null;
    try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
        return null;
    }
}

function totalPages(total: number, pageSize: number): number {
    return Math.max(1, Math.ceil(total / pageSize));
}

// ─── Cell rendering ───────────────────────────────────────────────────────────

function NullBadge() {
    return (
        <Badge variant="ghost" size="xs" className="opacity-60" data-database-null>
            NULL
        </Badge>
    );
}

function BlobBadge({ bytes }: { bytes: number }) {
    return (
        <Badge variant="ghost" size="xs" className="opacity-60 font-mono" data-database-blob>
            {`BLOB · ${formatCount(bytes)} B`}
        </Badge>
    );
}

/** One-line grid cell: truncated text with a tooltip; NULL/BLOB as muted badges. */
function GridCell({ cell }: { cell: DatabaseCell }) {
    if (cell.t === 'null') return <NullBadge />;
    if (cell.t === 'blob') return <BlobBadge bytes={cell.bytes} />;
    if (cell.t === 'num') return <span className="font-mono text-xs">{String(cell.v)}</span>;
    return (
        <Tooltip tip={cell.v} className="w-full">
            <span className="block max-w-[28rem] truncate font-mono text-xs" data-database-text>
                {cell.v}
            </span>
        </Tooltip>
    );
}

/** Full value for the detail modal: pretty JSON, full text, or a muted badge. */
function FullCell({ cell }: { cell: DatabaseCell }) {
    if (cell.t === 'null') return <NullBadge />;
    if (cell.t === 'blob') return <BlobBadge bytes={cell.bytes} />;
    if (cell.t === 'num') return <span className="font-mono text-xs">{String(cell.v)}</span>;
    const pretty = prettyJson(cell.v);
    if (pretty !== null) {
        return (
            <pre className="font-mono text-[11px] whitespace-pre-wrap break-all" data-database-json>
                {pretty}
            </pre>
        );
    }
    return (
        <span className="font-mono text-xs whitespace-pre-wrap break-all" data-database-text>
            {cell.v}
        </span>
    );
}

// ─── Schema strip ─────────────────────────────────────────────────────────────

function SchemaStrip({ schema }: { schema: DatabaseTableResponse }) {
    const [open, setOpen] = useState(true);
    return (
        <section className="border-b border-base-content/10 pb-2" data-database-schema-strip>
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center gap-2 text-left text-xs font-semibold text-base-content/70 hover:text-base-content cursor-pointer"
                data-database-schema-toggle
            >
                <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                <span>
                    Schema · {schema.columns.length} columns · {formatCount(schema.rowCount)} rows
                </span>
            </button>
            {open && (
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1" data-database-columns>
                    {schema.columns.map((column: DatabaseColumn) => (
                        <li key={column.name} className="flex items-center gap-1 text-[11px]">
                            <span className="font-mono font-semibold">{column.name}</span>
                            <span className="text-base-content/50">{column.type === '' ? '—' : column.type}</span>
                            {column.notNull && (
                                <Badge variant="ghost" size="xs" className="opacity-60">
                                    NOT NULL
                                </Badge>
                            )}
                            {column.pk && (
                                <Badge variant="primary" size="xs">
                                    PK
                                </Badge>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

// ─── Named states ─────────────────────────────────────────────────────────────

function StatePanel({ state, children }: { state: string; children: ReactNode }) {
    return (
        <div
            className="flex h-full items-center justify-center p-8 text-center text-sm text-base-content/60"
            data-database-state={state}
        >
            {children}
        </div>
    );
}

function stateMessage(state: DatabaseResourceState, table: string | null): ReactNode {
    switch (state) {
        case 'loading':
            return <Loading size="md" />;
        case 'empty':
            return `Table ${table ?? ''} has no rows.`;
        case 'unknown-table':
            return `Table ${table ?? ''} no longer exists. Pick another table from the list.`;
        case 'unavailable':
            return 'Database unavailable — the serve daemon is not attached to a project database.';
        case 'failed':
            return 'Request failed — could not read the database.';
        default:
            return null;
    }
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function DatabaseView() {
    const [searchParams, setSearchParams] = useSearchParams();

    const selectedTable = normalizeText(searchParams.get(URL_KEYS.table));
    const page = normalizePage(searchParams.get(URL_KEYS.page));
    const sort = normalizeText(searchParams.get(URL_KEYS.sort));
    const dir = normalizeDir(searchParams.get(URL_KEYS.dir));
    const filterColumn = normalizeText(searchParams.get(URL_KEYS.filterColumn));
    const filterValue = searchParams.get(URL_KEYS.filter) ?? '';
    const filterActive = filterColumn !== null && filterValue !== '';

    const [reloadKey, setReloadKey] = useState(0);
    const [railFilter, setRailFilter] = useState('');
    const [pageInput, setPageInput] = useState('');
    const [detailOffset, setDetailOffset] = useState<number | null>(null);

    // The input stays bound to the URL value so typing is immediate; the read waits for the
    // value to settle. Debouncing the request rather than the URL write keeps `?f=` accurate
    // for reload and deep links (AC2) while still collapsing a burst of keystrokes into one read.
    const [filterValueSettled, setFilterValueSettled] = useState(filterValue);
    useEffect(() => {
        const timer = setTimeout(() => setFilterValueSettled(filterValue), FILTER_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [filterValue]);

    const query = useMemo<RowQuery | null>(() => {
        if (selectedTable === null) return null;
        const filterSettled = filterColumn !== null && filterValueSettled !== '';
        return {
            page,
            pageSize: DATABASE_PAGE_SIZE,
            sort,
            dir,
            filterColumn: filterSettled ? filterColumn : null,
            filterValue: filterSettled ? filterValueSettled : '',
        };
    }, [selectedTable, page, sort, dir, filterColumn, filterValueSettled]);

    const tables = useDatabaseTables(reloadKey);
    const schema = useTableSchema(selectedTable, reloadKey);
    const rows = useTableRows(selectedTable, query, reloadKey);
    const detail = useTableRow(selectedTable, detailOffset, query, reloadKey);

    // A change of table/page/sort/filter invalidates the open row detail — handled
    // in updateParams so this file needs no effect that only mentions setters.

    // A page past the last one (hand-typed URL, filter shrank the result) snaps
    // back to the real last page so the range text and pager never lie (AC4).
    useEffect(() => {
        if (rows.data === null) return;
        const last = totalPages(rows.data.total, DATABASE_PAGE_SIZE);
        if (page <= last) return;
        setSearchParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                if (last <= 1) next.delete(URL_KEYS.page);
                else next.set(URL_KEYS.page, String(last));
                return next;
            },
            { replace: true },
        );
    }, [rows.data, page, setSearchParams]);

    const updateParams = (mutate: (next: URLSearchParams) => void) => {
        // Any query change (table/page/sort/filter) invalidates the open row detail.
        setDetailOffset(null);
        setSearchParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                mutate(next);
                return next;
            },
            { replace: true },
        );
    };

    const selectTable = (name: string) => {
        updateParams((next) => {
            next.set(URL_KEYS.table, name);
            next.delete(URL_KEYS.page);
            next.delete(URL_KEYS.sort);
            next.delete(URL_KEYS.dir);
            next.delete(URL_KEYS.filterColumn);
            next.delete(URL_KEYS.filter);
        });
    };

    const toggleSort = (column: string) => {
        updateParams((next) => {
            if (next.get(URL_KEYS.sort) === column) {
                next.set(URL_KEYS.dir, next.get(URL_KEYS.dir) === 'desc' ? 'asc' : 'desc');
            } else {
                next.set(URL_KEYS.sort, column);
                next.set(URL_KEYS.dir, 'asc');
            }
            next.delete(URL_KEYS.page); // sort change resets to page 1 (R4)
        });
    };

    const changeFilterColumn = (column: string) => {
        updateParams((next) => {
            if (column === '') {
                next.delete(URL_KEYS.filterColumn);
                next.delete(URL_KEYS.filter);
            } else {
                next.set(URL_KEYS.filterColumn, column);
            }
            next.delete(URL_KEYS.page);
        });
    };

    const changeFilterValue = (value: string) => {
        updateParams((next) => {
            if (value === '') next.delete(URL_KEYS.filter);
            else next.set(URL_KEYS.filter, value);
            next.delete(URL_KEYS.page);
        });
    };

    const goToPage = (target: number) => {
        const total = rows.data?.total ?? 0;
        const last = totalPages(total, DATABASE_PAGE_SIZE);
        const clamped = Math.min(Math.max(1, target), last);
        updateParams((next) => {
            if (clamped <= 1) next.delete(URL_KEYS.page);
            else next.set(URL_KEYS.page, String(clamped));
        });
    };

    const visibleTables = useMemo(() => {
        const names = tables.data?.tables ?? [];
        const needle = railFilter.trim().toLowerCase();
        return needle === '' ? names : names.filter((name) => name.toLowerCase().includes(needle));
    }, [tables.data, railFilter]);

    // A hard failure on either read blocks the panel; a rows-only refetch (page /
    // sort / filter) must NOT unmount the schema strip and filter controls, so
    // only schema `loading` swaps the whole panel for a spinner.
    const blockedState: DatabaseResourceState | null = (() => {
        const states = [schema.state, rows.state];
        if (states.includes('unavailable')) return 'unavailable';
        if (states.includes('unknown-table')) return 'unknown-table';
        if (states.includes('failed')) return 'failed';
        return null;
    })();
    const schemaReady = schema.state === 'ready' && schema.data !== null;
    const rowsReady = rows.state === 'ready' && rows.data !== null;

    const total = rows.data?.total ?? 0;
    const lastPage = totalPages(total, DATABASE_PAGE_SIZE);
    const columns = rows.data?.columns ?? schema.data?.columns.map((c) => c.name) ?? [];

    return (
        <div className="flex h-full min-h-0 gap-3" data-database-view>
            {/* Left rail: filter-as-you-type table list */}
            <Card variant="bordered" className="w-56 shrink-0 overflow-hidden">
                <CardBody className="p-2 gap-2 min-h-0">
                    <Input
                        size="xs"
                        placeholder="Filter tables"
                        aria-label="Filter tables"
                        value={railFilter}
                        onChange={(e) => setRailFilter(e.target.value)}
                        data-database-rail-filter
                    />
                    <div
                        className="min-h-0 flex-1 overflow-y-auto"
                        data-database-rail
                        data-database-rail-state={tables.state}
                    >
                        {tables.state === 'loading' && (
                            <div className="flex justify-center p-3">
                                <Loading size="sm" />
                            </div>
                        )}
                        {tables.state === 'unavailable' && (
                            <p className="p-2 text-xs text-base-content/60">Database unavailable.</p>
                        )}
                        {tables.state === 'failed' && (
                            <p className="p-2 text-xs text-base-content/60">Could not load tables.</p>
                        )}
                        {tables.state === 'empty' && (
                            <p className="p-2 text-xs text-base-content/60" data-database-rail-empty>
                                This database has no tables.
                            </p>
                        )}
                        {tables.state === 'ready' &&
                            (visibleTables.length === 0 ? (
                                <p className="p-2 text-xs text-base-content/60">No tables match this filter.</p>
                            ) : (
                                <ul className="flex flex-col gap-0.5">
                                    {visibleTables.map((name) => (
                                        <li key={name}>
                                            <button
                                                type="button"
                                                data-database-table={name}
                                                aria-current={name === selectedTable ? 'true' : undefined}
                                                onClick={() => selectTable(name)}
                                                className={
                                                    name === selectedTable
                                                        ? 'font-mono text-xs font-semibold text-primary'
                                                        : 'font-mono text-xs'
                                                }
                                            >
                                                {name}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            ))}
                    </div>
                </CardBody>
            </Card>

            {/* Main: schema strip + grid + footer */}
            <Card variant="bordered" className="min-w-0 flex-1 overflow-hidden">
                <CardBody className="p-0 min-h-0 flex flex-col">
                    {selectedTable === null && (
                        <StatePanel state="prompt">
                            <p data-database-prompt>Select a table from the left to browse its rows.</p>
                        </StatePanel>
                    )}

                    {selectedTable !== null && blockedState !== null && (
                        <StatePanel state={blockedState}>
                            <div className="flex flex-col items-center gap-2">
                                {stateMessage(blockedState, selectedTable)}
                                {blockedState === 'failed' && (
                                    <Button size="xs" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                                        Retry
                                    </Button>
                                )}
                            </div>
                        </StatePanel>
                    )}

                    {selectedTable !== null && blockedState === null && !schemaReady && (
                        <StatePanel state="loading">
                            <Loading size="md" />
                        </StatePanel>
                    )}

                    {selectedTable !== null && blockedState === null && schemaReady && schema.data !== null && (
                        <>
                            <SchemaStrip schema={schema.data} />

                            {/* Filter row: one column + contains value (R5) */}
                            <div className="flex items-center gap-2 border-b border-base-content/10 px-2 py-2">
                                <Select
                                    size="xs"
                                    aria-label="Filter column"
                                    value={filterColumn ?? ''}
                                    onChange={(e) => changeFilterColumn(e.target.value)}
                                    data-database-filter-column
                                >
                                    <option value="">Filter column…</option>
                                    {schema.data.columns.map((column) => (
                                        <option key={column.name} value={column.name}>
                                            {column.name}
                                        </option>
                                    ))}
                                </Select>
                                <Input
                                    size="xs"
                                    placeholder="contains…"
                                    aria-label="Filter value"
                                    value={filterValue}
                                    onChange={(e) => changeFilterValue(e.target.value)}
                                    data-database-filter-value
                                />
                            </div>

                            {rows.state === 'loading' && (
                                <div className="flex flex-1 items-center justify-center p-8">
                                    <Loading size="md" />
                                </div>
                            )}

                            {rows.state === 'empty' && (
                                <StatePanel state="empty">
                                    <span>
                                        Table {selectedTable} has no rows{filterActive ? ' matching this filter' : ''}.
                                    </span>
                                </StatePanel>
                            )}

                            {rowsReady && rows.data !== null && (
                                <>
                                    <div className="min-h-0 flex-1 overflow-auto">
                                        <table className="table table-sm" data-testid="database-table">
                                            <thead className="sticky top-0 z-10 bg-base-200">
                                                <tr className="text-xs text-base-content/60">
                                                    {columns.map((column) => {
                                                        const sorted = sort === column;
                                                        const ariaSort = sorted
                                                            ? dir === 'desc'
                                                                ? 'descending'
                                                                : 'ascending'
                                                            : 'none';
                                                        return (
                                                            <th
                                                                key={column}
                                                                scope="col"
                                                                aria-sort={ariaSort}
                                                                className="whitespace-nowrap"
                                                            >
                                                                <button
                                                                    type="button"
                                                                    onClick={() => toggleSort(column)}
                                                                    data-database-sort={column}
                                                                    className="flex items-center gap-1 font-mono text-xs font-semibold uppercase tracking-wide cursor-pointer"
                                                                >
                                                                    <span>{column}</span>
                                                                    {sorted && (
                                                                        <span aria-hidden="true">
                                                                            {dir === 'desc' ? '▼' : '▲'}
                                                                        </span>
                                                                    )}
                                                                </button>
                                                            </th>
                                                        );
                                                    })}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rows.data.rows.map((row, rowIndex) => {
                                                    const offset = (page - 1) * DATABASE_PAGE_SIZE + rowIndex;
                                                    return (
                                                        <tr
                                                            key={offset}
                                                            tabIndex={0}
                                                            aria-haspopup="dialog"
                                                            data-database-row
                                                            className="hover:bg-base-200/70 cursor-pointer focus:outline-none focus:bg-base-200/70"
                                                            onClick={() => setDetailOffset(offset)}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter' || e.key === ' ') {
                                                                    e.preventDefault();
                                                                    setDetailOffset(offset);
                                                                }
                                                            }}
                                                        >
                                                            {row.map((cell, cellIndex) => (
                                                                <td
                                                                    key={columns[cellIndex] ?? cellIndex}
                                                                    className="align-middle max-w-[28rem]"
                                                                >
                                                                    <GridCell cell={cell} />
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    <footer className="flex items-center justify-between gap-4 border-t border-base-content/10 px-2 py-2 text-xs text-base-content/70">
                                        <span data-database-range>{rangeLabel(page, DATABASE_PAGE_SIZE, total)}</span>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                size="xs"
                                                variant="outline"
                                                disabled={page <= 1}
                                                onClick={() => goToPage(page - 1)}
                                                data-database-prev
                                            >
                                                Prev
                                            </Button>
                                            <span data-database-page>
                                                Page {page} of {formatCount(lastPage)}
                                            </span>
                                            <Button
                                                size="xs"
                                                variant="outline"
                                                disabled={page >= lastPage}
                                                onClick={() => goToPage(page + 1)}
                                                data-database-next
                                            >
                                                Next
                                            </Button>
                                            <Input
                                                size="xs"
                                                type="number"
                                                min={1}
                                                className="w-16"
                                                aria-label="Go to page"
                                                placeholder={String(page)}
                                                value={pageInput}
                                                onChange={(e) => setPageInput(e.target.value)}
                                            />
                                            <Button
                                                size="xs"
                                                variant="outline"
                                                onClick={() => {
                                                    const target = Number.parseInt(pageInput, 10);
                                                    if (Number.isFinite(target)) goToPage(target);
                                                    setPageInput('');
                                                }}
                                                data-database-go
                                            >
                                                Go
                                            </Button>
                                        </div>
                                    </footer>
                                </>
                            )}
                        </>
                    )}
                </CardBody>
            </Card>

            {/* Row detail: every column's full value, pretty JSON when parseable (AC6) */}
            <Modal
                open={detailOffset !== null}
                onClose={() => setDetailOffset(null)}
                className="max-w-3xl"
                data-database-detail
                aria-label="Row detail"
            >
                <h3 className="text-sm font-bold">Row detail</h3>
                {detail.state === 'loading' && (
                    <div className="flex justify-center p-6">
                        <Loading size="md" />
                    </div>
                )}
                {detail.state !== 'loading' && detail.state !== 'ready' && (
                    <p className="p-4 text-sm text-base-content/60" data-database-detail-state={detail.state}>
                        {stateMessage(detail.state, selectedTable)}
                    </p>
                )}
                {detail.state === 'ready' && detail.data !== null && (
                    <div className="mt-2 max-h-[60vh] overflow-auto">
                        <dl className="divide-y divide-base-content/10">
                            {detail.data.columns.map((column, index) => (
                                <div key={column} className="grid grid-cols-[10rem_1fr] gap-3 py-2">
                                    <dt className="font-mono text-xs font-semibold">{column}</dt>
                                    <dd className="min-w-0">
                                        <FullCell cell={detail.data?.row[index] ?? { t: 'null' }} />
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                )}
                <div className="flex justify-end gap-2 pt-4">
                    <Button size="sm" onClick={() => setDetailOffset(null)}>
                        Close
                    </Button>
                </div>
            </Modal>
        </div>
    );
}
