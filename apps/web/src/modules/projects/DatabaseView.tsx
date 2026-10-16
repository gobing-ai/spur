import type {
    DatabaseCell,
    DatabaseColumn,
    DatabaseErrorResponse,
    DatabaseRowResponse,
    DatabaseRowsResponse,
    DatabaseTableResponse,
    DatabaseTablesResponse,
} from '@gobing-ai/spur-contracts';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Badge, Button, Card, CardBody, Checkbox, Input, Loading, Modal, Select, Tooltip } from '@/ui';
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

/** `1–50 of 4,028,297`, clamped to a zero-row table and to the last page: a stale `?page=` renders before the snap-back. */
export function rangeLabel(page: number, pageSize: number, total: number): string {
    if (total === 0) return `0 of 0`;
    const shown = Math.min(page, Math.ceil(total / pageSize));
    const start = (shown - 1) * pageSize + 1;
    const end = Math.min(shown * pageSize, total);
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
    // A paged read cuts text at 4 KiB and flags it (contracts `truncated`). The tooltip is the
    // only place a reader sees the value in the grid, so without this note the cut text reads as
    // the complete value; the row detail carries the untruncated one.
    const tip = cell.truncated === true ? `${cell.v} … [truncated — open the row for the full value]` : cell.v;
    return (
        <Tooltip tip={tip} className="w-full">
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

// ─── Column visibility & client storage persistence ──────────────────────────

/** Maximum columns shown by default on tables with many fields. */
export const DEFAULT_MAX_VISIBLE_COLUMNS = 7;

/** LocalStorage key prefix for per-table column preferences. */
export const DATABASE_COLUMNS_STORAGE_PREFIX = 'spur:database:columns:v1:';

export function getTableStorageKey(tableName: string): string {
    return `${DATABASE_COLUMNS_STORAGE_PREFIX}${tableName}`;
}

/**
 * Compute the default visible columns for a table.
 * If total columns <= maxDefault, all are shown.
 * Otherwise, ensures PK columns are included first, filled up to maxDefault in schema order.
 */
export function getDefaultVisibleColumns(
    columns: DatabaseColumn[],
    maxDefault = DEFAULT_MAX_VISIBLE_COLUMNS,
): string[] {
    if (columns.length <= maxDefault) {
        return columns.map((c) => c.name);
    }
    const pks = columns.filter((c) => c.pk).map((c) => c.name);
    const nonPks = columns.filter((c) => !c.pk).map((c) => c.name);
    const selected = new Set<string>(pks);
    for (const name of nonPks) {
        if (selected.size >= maxDefault) break;
        selected.add(name);
    }
    return columns.filter((c) => selected.has(c.name)).map((c) => c.name);
}

/**
 * Load user-selected columns for a table from localStorage.
 * Filters out any stale columns that are not in availableColumns.
 */
export function loadStoredColumns(tableName: string, availableColumns: string[], storage?: Storage): string[] | null {
    try {
        const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
        if (!store) return null;
        const raw = store.getItem(getTableStorageKey(tableName));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) return null;
        const availableSet = new Set(availableColumns);
        const valid = parsed.filter((c): c is string => typeof c === 'string' && availableSet.has(c));
        return valid.length > 0 ? valid : null;
    } catch {
        return null;
    }
}

/** Save user-selected columns for a table to localStorage. */
export function saveStoredColumns(tableName: string, columns: string[], storage?: Storage): void {
    try {
        const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
        if (!store) return;
        store.setItem(getTableStorageKey(tableName), JSON.stringify(columns));
    } catch {
        // Storage errors ignored silently
    }
}

/** Clear stored column preferences for a table. */
export function clearStoredColumns(tableName: string, storage?: Storage): void {
    try {
        const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
        if (!store) return;
        store.removeItem(getTableStorageKey(tableName));
    } catch {
        // Storage errors ignored silently
    }
}

// ─── Table Metadata Modal ─────────────────────────────────────────────────────

export interface TableMetadataModalProps {
    open: boolean;
    onClose: () => void;
    schema: DatabaseTableResponse | null;
}

export function TableMetadataModal({ open, onClose, schema }: TableMetadataModalProps) {
    if (!schema) return null;
    return (
        <Modal
            open={open}
            onClose={onClose}
            className="max-w-3xl w-full p-0 overflow-hidden bg-base-100 border border-base-content/15 shadow-2xl flex flex-col max-h-[85vh]"
            data-database-metadata-modal
            aria-label="Table metadata"
        >
            {/* Modal Header */}
            <div className="px-5 py-3.5 border-b border-base-content/10 bg-base-200/50 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex items-center justify-center w-6 h-6 rounded bg-primary/15 text-primary font-bold text-xs shrink-0">
                        ℹ
                    </span>
                    <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-base-content leading-tight">Table Metadata</h3>
                        <p className="text-xs text-base-content/60 truncate mt-0.5 font-mono">{schema.name}</p>
                    </div>
                </div>
                <Button
                    variant="ghost"
                    size="xs"
                    className="text-base-content/60 hover:text-base-content h-6 w-6 p-0 text-xs flex items-center justify-center cursor-pointer"
                    onClick={onClose}
                    aria-label="Close metadata"
                    title="Close metadata"
                >
                    ✕
                </Button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-base-200/40 border border-base-content/10">
                        <span className="text-[10px] uppercase font-semibold text-base-content/60 block">Table</span>
                        <span
                            className="font-mono text-xs font-semibold text-base-content truncate block"
                            title={schema.name}
                        >
                            {schema.name}
                        </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-base-200/40 border border-base-content/10">
                        <span className="text-[10px] uppercase font-semibold text-base-content/60 block">
                            Total Rows
                        </span>
                        <span className="font-mono text-xs text-base-content font-semibold">
                            {formatCount(schema.rowCount)}
                        </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-base-200/40 border border-base-content/10">
                        <span className="text-[10px] uppercase font-semibold text-base-content/60 block">Columns</span>
                        <span className="font-mono text-xs text-base-content font-semibold">
                            {schema.columns.length}
                        </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-base-200/40 border border-base-content/10">
                        <span className="text-[10px] uppercase font-semibold text-base-content/60 block">
                            Primary Key
                        </span>
                        <span className="font-mono text-xs text-base-content truncate block">
                            {schema.columns
                                .filter((c) => c.pk)
                                .map((c) => c.name)
                                .join(', ') || 'none'}
                        </span>
                    </div>
                </div>

                {/* Schema Table */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-base-content/70 uppercase tracking-wide">
                            Fields ({schema.columns.length})
                        </span>
                    </div>
                    <div className="rounded-lg border border-base-content/10 overflow-hidden bg-base-100">
                        <table className="table table-xs w-full" data-database-columns>
                            <thead className="bg-base-200/80 text-base-content/70">
                                <tr>
                                    <th className="w-12 text-center font-mono text-[11px]">#</th>
                                    <th className="font-mono text-[11px]">Field Name</th>
                                    <th className="font-mono text-[11px]">Data Type</th>
                                    <th className="text-[11px]">Constraint</th>
                                    <th className="text-[11px] text-center w-16">Key</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-base-content/10">
                                {schema.columns.map((column, idx) => (
                                    <tr key={column.name} className="hover:bg-base-200/40">
                                        <td className="text-center font-mono text-xs text-base-content/40">
                                            {idx + 1}
                                        </td>
                                        <td className="font-mono text-xs font-semibold text-base-content">
                                            {column.name}
                                        </td>
                                        <td className="font-mono text-xs text-base-content/70">
                                            {column.type === '' ? (
                                                <span className="text-base-content/40 italic">—</span>
                                            ) : (
                                                column.type
                                            )}
                                        </td>
                                        <td>
                                            {column.notNull ? (
                                                <Badge
                                                    variant="ghost"
                                                    size="xs"
                                                    className="opacity-75 font-mono text-[10px]"
                                                >
                                                    NOT NULL
                                                </Badge>
                                            ) : (
                                                <span className="text-xs text-base-content/40 font-mono">NULL</span>
                                            )}
                                        </td>
                                        <td className="text-center">
                                            {column.pk ? (
                                                <Badge variant="primary" size="xs">
                                                    PK
                                                </Badge>
                                            ) : (
                                                <span className="text-base-content/20 text-xs">—</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-base-content/10 bg-base-200/40 flex items-center justify-end shrink-0">
                <Button variant="ghost" size="xs" onClick={onClose} aria-label="Close metadata">
                    Close
                </Button>
            </div>
        </Modal>
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
    const [tableDropdownOpen, setTableDropdownOpen] = useState(false);
    const tableDropdownRef = useRef<HTMLDivElement>(null);
    const [showMetadataModal, setShowMetadataModal] = useState(false);
    const [columnsDropdownOpen, setColumnsDropdownOpen] = useState(false);
    const columnsDropdownRef = useRef<HTMLDivElement>(null);
    const [columnSearch, setColumnSearch] = useState('');
    const [visibleColumns, setVisibleColumns] = useState<string[]>([]);

    // The input stays bound to the URL value so typing is immediate; the read waits for the
    // value to settle. Debouncing the request rather than the URL write keeps `?f=` accurate
    // for reload and deep links (AC2) while still collapsing a burst of keystrokes into one read.
    const [filterValueSettled, setFilterValueSettled] = useState(filterValue);
    useEffect(() => {
        const timer = setTimeout(() => setFilterValueSettled(filterValue), FILTER_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [filterValue]);

    useEffect(() => {
        if (!tableDropdownOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (tableDropdownRef.current && !tableDropdownRef.current.contains(e.target as Node)) {
                setTableDropdownOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setTableDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [tableDropdownOpen]);

    useEffect(() => {
        if (!columnsDropdownOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (columnsDropdownRef.current && !columnsDropdownRef.current.contains(e.target as Node)) {
                setColumnsDropdownOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setColumnsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [columnsDropdownOpen]);

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
        setColumnsDropdownOpen(false);
        setColumnSearch('');
        setShowMetadataModal(false);
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

    // Sync user column choices with localStorage or fall back to defaults
    useEffect(() => {
        if (!selectedTable || !schema.data) {
            setVisibleColumns([]);
            return;
        }
        const allCols = schema.data.columns;
        const allColNames = allCols.map((c) => c.name);
        const stored = loadStoredColumns(selectedTable, allColNames);
        if (stored !== null && stored.length > 0) {
            setVisibleColumns(stored);
        } else {
            setVisibleColumns(getDefaultVisibleColumns(allCols, DEFAULT_MAX_VISIBLE_COLUMNS));
        }
    }, [selectedTable, schema.data]);

    const effectiveVisibleColumns = useMemo(() => {
        if (visibleColumns.length > 0) {
            const availableSet = new Set(columns);
            const filtered = visibleColumns.filter((c) => availableSet.has(c));
            if (filtered.length > 0) return filtered;
        }
        return columns;
    }, [visibleColumns, columns]);

    const visibleColumnIndices = useMemo(() => {
        return effectiveVisibleColumns.map((name) => columns.indexOf(name)).filter((i) => i !== -1);
    }, [effectiveVisibleColumns, columns]);

    const visibleSet = useMemo(() => new Set(effectiveVisibleColumns), [effectiveVisibleColumns]);

    const filteredColumnsForPicker = useMemo(() => {
        const list = schema.data?.columns ?? [];
        const needle = columnSearch.trim().toLowerCase();
        return needle === '' ? list : list.filter((c) => c.name.toLowerCase().includes(needle));
    }, [schema.data?.columns, columnSearch]);

    const handleToggleColumn = (colName: string) => {
        if (!selectedTable || !schema.data) return;
        const allCols = schema.data.columns.map((c) => c.name);
        const currentSet = new Set(effectiveVisibleColumns);
        if (currentSet.has(colName)) {
            if (currentSet.size <= 1) return;
            currentSet.delete(colName);
        } else {
            currentSet.add(colName);
        }
        const nextCols = allCols.filter((name) => currentSet.has(name));
        setVisibleColumns(nextCols);
        saveStoredColumns(selectedTable, nextCols);
    };

    const handleSelectAllColumns = () => {
        if (!selectedTable || !schema.data) return;
        const allCols = schema.data.columns.map((c) => c.name);
        setVisibleColumns(allCols);
        saveStoredColumns(selectedTable, allCols);
    };

    const handleResetColumns = () => {
        if (!selectedTable || !schema.data) return;
        const defaultCols = getDefaultVisibleColumns(schema.data.columns, DEFAULT_MAX_VISIBLE_COLUMNS);
        setVisibleColumns(defaultCols);
        clearStoredColumns(selectedTable);
    };

    return (
        <div className="flex flex-col h-full min-h-0" data-database-view>
            <Card variant="bordered" className="min-w-0 flex-1 overflow-hidden">
                <CardBody className="p-0 min-h-0 flex flex-col h-full">
                    {/* Top control bar: table selector dropdown + filter controls */}
                    <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-base-content/10 px-3 py-2 bg-base-100/60 shrink-0">
                        <div className="flex flex-wrap items-center gap-2.5">
                            {/* Table dropdown with input filter */}
                            <div ref={tableDropdownRef} className="relative">
                                <button
                                    type="button"
                                    aria-haspopup="listbox"
                                    aria-expanded={tableDropdownOpen}
                                    aria-label="Select table"
                                    data-database-table-select
                                    onClick={() => setTableDropdownOpen((v) => !v)}
                                    className="flex items-center gap-2 px-2.5 py-1 text-xs rounded border border-base-content/20 bg-base-100 hover:bg-base-200/80 transition-colors cursor-pointer text-left font-mono font-medium text-base-content"
                                >
                                    <svg
                                        className="h-3.5 w-3.5 text-base-content/60 shrink-0"
                                        viewBox="0 0 16 16"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.5"
                                        aria-hidden="true"
                                    >
                                        <ellipse cx="8" cy="4" rx="6" ry="2.5" />
                                        <path d="M2 4v4c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V4" />
                                        <path d="M2 8v4c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V8" />
                                    </svg>
                                    <span className="truncate max-w-[200px] sm:max-w-[320px]">
                                        {selectedTable ?? 'Select table…'}
                                    </span>
                                    <svg
                                        className={`h-3 w-3 shrink-0 text-base-content/50 transition-transform ${tableDropdownOpen ? 'rotate-180' : ''}`}
                                        viewBox="0 0 16 16"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        aria-hidden="true"
                                    >
                                        <path d="M4 6l4 4 4-4" />
                                    </svg>
                                </button>

                                {tableDropdownOpen && (
                                    <div
                                        role="dialog"
                                        aria-label="Select table"
                                        className="absolute left-0 top-full mt-1.5 z-50 w-72 sm:w-84 rounded-lg border border-base-content/15 bg-base-100 shadow-xl p-2 flex flex-col gap-2"
                                    >
                                        <div className="relative">
                                            <Input
                                                size="xs"
                                                placeholder="Filter tables…"
                                                aria-label="Filter tables"
                                                value={railFilter}
                                                onChange={(e) => setRailFilter(e.target.value)}
                                                onKeyDown={(e) => {
                                                    const first = visibleTables[0];
                                                    if (e.key === 'Enter' && first) {
                                                        e.preventDefault();
                                                        selectTable(first);
                                                        setTableDropdownOpen(false);
                                                        setRailFilter('');
                                                    }
                                                }}
                                                data-database-rail-filter
                                                autoFocus
                                            />
                                            {railFilter && (
                                                <button
                                                    type="button"
                                                    onClick={() => setRailFilter('')}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-base-content/40 hover:text-base-content cursor-pointer"
                                                    aria-label="Clear filter"
                                                >
                                                    ×
                                                </button>
                                            )}
                                        </div>

                                        <div
                                            className="max-h-64 overflow-y-auto min-h-0 flex flex-col gap-0.5"
                                            data-database-rail
                                            data-database-rail-state={tables.state}
                                            role="listbox"
                                            aria-label="Tables"
                                        >
                                            {tables.state === 'loading' && (
                                                <div className="flex justify-center p-3">
                                                    <Loading size="sm" />
                                                </div>
                                            )}
                                            {tables.state === 'unavailable' && (
                                                <p className="p-2 text-xs text-base-content/60 text-center">
                                                    Database unavailable.
                                                </p>
                                            )}
                                            {tables.state === 'failed' && (
                                                <p className="p-2 text-xs text-base-content/60 text-center">
                                                    Could not load tables.
                                                </p>
                                            )}
                                            {tables.state === 'empty' && (
                                                <p
                                                    className="p-2 text-xs text-base-content/60 text-center"
                                                    data-database-rail-empty
                                                >
                                                    This database has no tables.
                                                </p>
                                            )}
                                            {tables.state === 'ready' &&
                                                (visibleTables.length === 0 ? (
                                                    <p className="p-2 text-xs text-base-content/60 text-center">
                                                        No tables match this filter.
                                                    </p>
                                                ) : (
                                                    visibleTables.map((name) => {
                                                        const isSelected = name === selectedTable;
                                                        return (
                                                            <button
                                                                key={name}
                                                                type="button"
                                                                role="option"
                                                                aria-selected={isSelected}
                                                                data-database-table={name}
                                                                onClick={() => {
                                                                    selectTable(name);
                                                                    setTableDropdownOpen(false);
                                                                    setRailFilter('');
                                                                }}
                                                                className={`flex items-center justify-between px-2.5 py-1.5 text-xs font-mono rounded text-left transition-colors cursor-pointer ${
                                                                    isSelected
                                                                        ? 'bg-primary text-primary-content font-bold'
                                                                        : 'text-base-content/80 hover:bg-base-content/10 hover:text-base-content'
                                                                }`}
                                                            >
                                                                <span className="truncate">{name}</span>
                                                                {isSelected && <span className="text-xs ml-2">✓</span>}
                                                            </button>
                                                        );
                                                    })
                                                ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Filter row: one column + contains value (R5) */}
                            {selectedTable !== null && schemaReady && schema.data !== null && (
                                <>
                                    <div className="h-4 w-px bg-base-content/15 hidden sm:block" />
                                    <div className="flex items-center gap-2">
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
                                </>
                            )}
                        </div>

                        {/* Right action controls */}
                        {selectedTable !== null && schemaReady && schema.data !== null && (
                            <div className="flex items-center gap-2 ml-auto">
                                <span className="text-xs text-base-content/50 font-mono hidden md:inline">
                                    {formatCount(schema.data.rowCount)} rows · {schema.data.columns.length} columns
                                </span>
                                <div className="h-4 w-px bg-base-content/15 hidden md:block" />

                                <Button
                                    size="xs"
                                    variant="outline"
                                    onClick={() => setShowMetadataModal(true)}
                                    className="flex items-center gap-1.5 font-medium cursor-pointer"
                                    aria-label="Table metadata"
                                    title="View table metadata"
                                    data-database-metadata-btn
                                >
                                    <svg
                                        className="w-3.5 h-3.5 text-base-content/70 shrink-0"
                                        viewBox="0 0 16 16"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        aria-hidden="true"
                                    >
                                        <circle cx="8" cy="8" r="6" />
                                        <path d="M8 7v4M8 5h.01" />
                                    </svg>
                                    <span>Metadata</span>
                                </Button>

                                <div ref={columnsDropdownRef} className="relative">
                                    <Button
                                        size="xs"
                                        variant="outline"
                                        onClick={() => {
                                            setColumnsDropdownOpen((v) => !v);
                                            setColumnSearch('');
                                        }}
                                        className="flex items-center gap-1.5 font-medium cursor-pointer"
                                        aria-haspopup="dialog"
                                        aria-expanded={columnsDropdownOpen}
                                        aria-label="Customize visible columns"
                                        title="Customize visible columns"
                                        data-database-columns-btn
                                    >
                                        <svg
                                            className="w-3.5 h-3.5 text-base-content/70 shrink-0"
                                            viewBox="0 0 16 16"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            aria-hidden="true"
                                        >
                                            <rect x="2" y="2" width="12" height="12" rx="1.5" />
                                            <path d="M6.5 2v12M10.5 2v12" />
                                        </svg>
                                        <span>Columns</span>
                                        <span className="font-mono text-[10px] px-1 py-0.2 rounded bg-base-200 text-base-content/70">
                                            {effectiveVisibleColumns.length}/{schema.data.columns.length}
                                        </span>
                                    </Button>

                                    {columnsDropdownOpen && (
                                        <div
                                            role="dialog"
                                            aria-label="Customize columns"
                                            data-database-columns-dropdown
                                            className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-lg border border-base-content/15 bg-base-100 shadow-xl p-3 flex flex-col gap-2.5"
                                        >
                                            <div className="flex items-center justify-between pb-2 border-b border-base-content/10">
                                                <span className="text-xs font-bold uppercase tracking-wide text-base-content/70">
                                                    Visible Fields ({effectiveVisibleColumns.length}/
                                                    {schema.data.columns.length})
                                                </span>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={handleSelectAllColumns}
                                                        className="text-[11px] text-primary hover:underline cursor-pointer"
                                                    >
                                                        All
                                                    </button>
                                                    <span className="text-base-content/30 text-xs">·</span>
                                                    <button
                                                        type="button"
                                                        onClick={handleResetColumns}
                                                        className="text-[11px] text-base-content/60 hover:text-base-content hover:underline cursor-pointer"
                                                    >
                                                        Default
                                                    </button>
                                                </div>
                                            </div>

                                            {schema.data.columns.length > 8 && (
                                                <div className="relative">
                                                    <Input
                                                        size="xs"
                                                        placeholder="Search fields…"
                                                        aria-label="Search fields"
                                                        value={columnSearch}
                                                        onChange={(e) => setColumnSearch(e.target.value)}
                                                        autoFocus
                                                    />
                                                    {columnSearch && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setColumnSearch('')}
                                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-base-content/40 hover:text-base-content cursor-pointer"
                                                            aria-label="Clear search"
                                                        >
                                                            ×
                                                        </button>
                                                    )}
                                                </div>
                                            )}

                                            <div className="max-h-64 overflow-y-auto flex flex-col gap-1 pr-1">
                                                {filteredColumnsForPicker.map((col) => {
                                                    const checked = visibleSet.has(col.name);
                                                    const isOnlyOne = checked && visibleSet.size === 1;
                                                    const inputId = `database-col-${col.name}`;
                                                    return (
                                                        <label
                                                            key={col.name}
                                                            htmlFor={inputId}
                                                            className={`flex items-center justify-between px-2 py-1 rounded text-xs transition-colors ${
                                                                isOnlyOne
                                                                    ? 'opacity-60 cursor-not-allowed'
                                                                    : 'hover:bg-base-200 cursor-pointer text-base-content'
                                                            }`}
                                                        >
                                                            <span className="flex items-center gap-2 min-w-0">
                                                                <Checkbox
                                                                    id={inputId}
                                                                    size="xs"
                                                                    variant="primary"
                                                                    checked={checked}
                                                                    disabled={isOnlyOne}
                                                                    onChange={() => handleToggleColumn(col.name)}
                                                                    aria-label={col.name}
                                                                />
                                                                <span className="font-mono truncate">{col.name}</span>
                                                            </span>
                                                            <span className="flex items-center gap-1 shrink-0 ml-2">
                                                                {col.pk && (
                                                                    <Badge variant="primary" size="xs">
                                                                        PK
                                                                    </Badge>
                                                                )}
                                                                <span className="text-[10px] text-base-content/40 font-mono">
                                                                    {col.type || 'ANY'}
                                                                </span>
                                                            </span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {selectedTable === null && (
                        <StatePanel state="prompt">
                            <p data-database-prompt>Select a table to browse its rows.</p>
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
                                                    {effectiveVisibleColumns.map((column) => {
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
                                                            {visibleColumnIndices.map((colIndex) => (
                                                                <td
                                                                    key={columns[colIndex] ?? colIndex}
                                                                    className="align-middle max-w-[28rem]"
                                                                >
                                                                    {row[colIndex] ? (
                                                                        <GridCell cell={row[colIndex]} />
                                                                    ) : null}
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

            {/* Table metadata modal */}
            <TableMetadataModal
                open={showMetadataModal}
                onClose={() => setShowMetadataModal(false)}
                schema={schema.data}
            />
        </div>
    );
}
