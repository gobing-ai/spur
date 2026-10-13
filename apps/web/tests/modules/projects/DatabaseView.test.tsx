/**
 * Failure list written before the Database tab existed (task 1184 Plan step 1).
 * Each line names a way /board/projects/database could fail its AC; the tests
 * below close them one by one.
 *
 *  1. 404 `unknown-table` after a deep link / reload → blank main panel (AC8, R7).
 *  2. 400 `invalid-request` / 500 on a read → blank main panel (AC8, R7).
 *  3. 503 `database-unavailable` (Worker path) → blank panel (AC8, R7).
 *  4. Network failure / transport reject → blank panel (AC8, R7).
 *  5. Zero tables in the database → empty rail with no named state (AC8, R2).
 *  6. A selected table with zero rows → empty grid with no named state (AC8).
 *  7. Malformed URL params (`page=abc`, `dir=sideways`) → throw or wrong page (R2).
 *  8. Page beyond the last page / huge total → range text and pager lie (AC4).
 *  9. Very wide table (many columns) → rows still render; paging stays server-side (R4/AC7).
 * 10. Huge text cell → unbounded row height instead of one-line truncation (AC6).
 * 11. NULL / BLOB cell → indistinguishable from the text "null" (AC6).
 * 12. Sort/filter change that keeps the old page → empty-looking page 1 (AC5).
 * 13. Row click → detail modal without a full value / pretty JSON (AC6).
 * 14. Picking a table from the rail / reload → selection not restored (AC2).
 */

registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import type { DatabaseCell, DatabaseColumn } from '@gobing-ai/spur-contracts';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import DatabaseView from '../../../src/modules/projects/DatabaseView';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

afterAll(async () => {
    resetFetchForTesting();
    await teardownHappyDom();
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COLUMN_DEFS: DatabaseColumn[] = [
    { name: 'id', type: 'INTEGER', notNull: true, pk: true },
    { name: 'body', type: 'TEXT', notNull: false, pk: false },
];

const COLUMN_NAMES = ['id', 'body'];

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function rowsPayload(params: URLSearchParams, rows: DatabaseCell[][], total: number): unknown {
    return {
        page: Number(params.get('page') ?? '1'),
        pageSize: Number(params.get('pageSize') ?? '50'),
        total,
        columns: COLUMN_NAMES,
        rows,
    };
}

interface RouterOptions {
    tables: string[];
    requests?: string[];
    tablesResponse?: () => Response;
    schema?: (name: string) => Response;
    rows?: (name: string, params: URLSearchParams) => Response;
    row?: (name: string, params: URLSearchParams) => Response;
}

/** Routes the four database reads by pathname; unmatched paths 404 as `unknown-table`. */
function databaseRouter(options: RouterOptions): typeof fetch {
    return (async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        options.requests?.push(url);
        const parsed = new URL(url);
        const path = parsed.pathname;
        if (path === '/api/project/database/tables') {
            return options.tablesResponse ? options.tablesResponse() : jsonResponse({ tables: options.tables });
        }
        const rowMatch = /^\/api\/project\/database\/tables\/([^/]+)\/row$/.exec(path);
        if (rowMatch) {
            const name = decodeURIComponent(rowMatch[1] ?? '');
            return options.row ? options.row(name, parsed.searchParams) : jsonResponse({ error: 'unknown-table' }, 404);
        }
        const rowsMatch = /^\/api\/project\/database\/tables\/([^/]+)\/rows$/.exec(path);
        if (rowsMatch) {
            const name = decodeURIComponent(rowsMatch[1] ?? '');
            return options.rows
                ? options.rows(name, parsed.searchParams)
                : jsonResponse({ error: 'unknown-table' }, 404);
        }
        const schemaMatch = /^\/api\/project\/database\/tables\/([^/]+)$/.exec(path);
        if (schemaMatch) {
            const name = decodeURIComponent(schemaMatch[1] ?? '');
            return options.schema ? options.schema(name) : jsonResponse({ error: 'unknown-table' }, 404);
        }
        return jsonResponse({ error: 'invalid-request' }, 400);
    }) as typeof fetch;
}

function renderView(initial: string) {
    return render(
        <MemoryRouter initialEntries={[initial]}>
            <DatabaseView />
        </MemoryRouter>,
    );
}

function rowsRequests(requests: string[]): URLSearchParams[] {
    return requests.filter((url) => url.includes('/rows')).map((url) => new URL(url).searchParams);
}

function lastRowsParams(requests: string[]): URLSearchParams | undefined {
    const all = rowsRequests(requests);
    return all[all.length - 1];
}

/**
 * Drive a controlled input/select through its real React onChange prop.
 *
 * happy-dom + React 19 do not deliver `fireEvent.change` to a controlled input's
 * onChange (capricorn86/happy-dom#856), so — matching the sibling `MemberTerminal` and
 * `components` convention — the test reads the handler off the real node. The lookup walks
 * `getOwnPropertyNames` because bun's `mock.module` is process-global: an earlier file's
 * `@/ui` mock is what this suite resolves here, and its Input carries the props differently.
 */
function setControlValue(el: Element, value: string): void {
    const key = Object.getOwnPropertyNames(el).find((k) => k.startsWith('__reactProps$'));
    const props = key ? (el as unknown as Record<string, { onChange?: (e: unknown) => void }>)[key] : undefined;
    const onChange = props?.onChange;
    if (!onChange) throw new Error('onChange not found on control');
    act(() => onChange({ target: { value } }));
}

// ── AC1–AC3: tab / picker / schema + exact row count ──────────────────────────

describe('DatabaseView deep link, schema and row count (AC1–AC3)', () => {
    test('a ?table= deep link selects the table, shows its schema and exact row count', async () => {
        const requests: string[] = [];
        setFetchForTesting(
            databaseRouter({
                tables: ['history_message', 'tasks'],
                requests,
                schema: (name) => jsonResponse({ name, columns: COLUMN_DEFS, rowCount: 3_212_345 }),
                rows: (_name, params) =>
                    jsonResponse(
                        rowsPayload(
                            params,
                            [
                                [
                                    { t: 'num', v: 1 },
                                    { t: 'text', v: 'hello world' },
                                ],
                            ],
                            3_212_345,
                        ),
                    ),
            }),
        );
        const view = renderView('/board/projects/database?table=history_message');

        await waitFor(() => expect(view.container.querySelector('[data-testid="database-table"]')).not.toBeNull());

        // Rail reflects the deep link and stays pickable.
        const railButton = view.container.querySelector('[data-database-table="history_message"]');
        expect(railButton?.getAttribute('aria-current')).toBe('true');

        // Schema strip: columns with type/nullability/pk + the exact row count.
        const strip = view.container.querySelector('[data-database-schema-strip]');
        expect(strip?.textContent).toContain('2 columns');
        expect(strip?.textContent).toContain('3,212,345 rows');
        expect(strip?.textContent).toContain('PK');
        expect(strip?.textContent).toContain('INTEGER');

        // Server-paged grid + range label.
        expect(view.container.textContent).toContain('hello world');
        expect(view.container.querySelector('[data-database-range]')?.textContent).toBe('1–50 of 3,212,345');

        // The page request carried page 1 and the bounded page size.
        const params = lastRowsParams(requests);
        expect(params?.get('page')).toBe('1');
        expect(params?.get('pageSize')).toBe('50');
    });

    test('picking a table from the rail selects it, and the choice survives a reload (AC2)', async () => {
        const requests: string[] = [];
        setFetchForTesting(
            databaseRouter({
                tables: ['history_message', 'tasks'],
                requests,
                schema: (name) => jsonResponse({ name, columns: COLUMN_DEFS, rowCount: 2 }),
                rows: (_name, params) => jsonResponse(rowsPayload(params, [[{ t: 'num', v: 7 }]], 2)),
            }),
        );
        const view = renderView('/board/projects/database');

        // No table selected yet: the panel names the prompt instead of staying blank.
        await waitFor(() => expect(view.container.querySelector('[data-database-prompt]')).not.toBeNull());

        act(() => (view.container.querySelector('[data-database-table="tasks"]') as HTMLButtonElement).click());
        await waitFor(() =>
            expect(view.container.querySelector('[data-database-table="tasks"]')?.getAttribute('aria-current')).toBe(
                'true',
            ),
        );
        expect(requests.some((url) => url.includes('/tables/tasks/rows'))).toBe(true);
        view.unmount();

        // Reload = render again from the URL the click produced.
        const reloadRequests: string[] = [];
        setFetchForTesting(
            databaseRouter({
                tables: ['history_message', 'tasks'],
                requests: reloadRequests,
                schema: (name) => jsonResponse({ name, columns: COLUMN_DEFS, rowCount: 2 }),
                rows: (_name, params) => jsonResponse(rowsPayload(params, [[{ t: 'num', v: 7 }]], 2)),
            }),
        );
        const reloaded = renderView('/board/projects/database?table=tasks');
        await waitFor(() => expect(reloaded.container.querySelector('[data-testid="database-table"]')).not.toBeNull());
        expect(reloaded.container.querySelector('[data-database-table="tasks"]')?.getAttribute('aria-current')).toBe(
            'true',
        );
        expect(reloadRequests.some((url) => url.includes('/tables/tasks/rows'))).toBe(true);
    });
});

// ── AC4: server pagination, bounded page size, pager controls ─────────────────

describe('DatabaseView pagination (AC4)', () => {
    test('fetches one bounded server page, pages with prev/next, and snaps an out-of-range page back', async () => {
        const requests: string[] = [];
        const table = Array.from({ length: 50 }, (_, i): DatabaseCell[] => [{ t: 'num', v: i + 1 }]);
        setFetchForTesting(
            databaseRouter({
                tables: ['history_message'],
                requests,
                schema: (name) => jsonResponse({ name, columns: COLUMN_DEFS, rowCount: 120 }),
                rows: (_name, params) => jsonResponse(rowsPayload(params, table, 120)),
            }),
        );
        const view = renderView('/board/projects/database?table=history_message');

        await waitFor(() =>
            expect(view.container.querySelector('[data-database-range]')?.textContent).toBe('1–50 of 120'),
        );
        expect(view.container.querySelector('[data-database-page]')?.textContent).toBe('Page 1 of 3');
        expect((view.container.querySelector('[data-database-prev]') as HTMLButtonElement).disabled).toBe(true);
        expect((view.container.querySelector('[data-database-next]') as HTMLButtonElement).disabled).toBe(false);
        // Bounded: every page request fixes pageSize at 50 (server max is 200).
        expect(rowsRequests(requests).every((p) => p.get('pageSize') === '50')).toBe(true);

        act(() => (view.container.querySelector('[data-database-next]') as HTMLButtonElement).click());
        await waitFor(() =>
            expect(view.container.querySelector('[data-database-range]')?.textContent).toBe('51–100 of 120'),
        );
        expect(lastRowsParams(requests)?.get('page')).toBe('2');

        // Go-to-page jumps to the last page and disables Next there.
        setControlValue(view.getByLabelText('Go to page'), '3');
        act(() => (view.container.querySelector('[data-database-go]') as HTMLButtonElement).click());
        await waitFor(() =>
            expect(view.container.querySelector('[data-database-range]')?.textContent).toBe('101–120 of 120'),
        );
        expect((view.container.querySelector('[data-database-next]') as HTMLButtonElement).disabled).toBe(true);
    });

    test('a page past the last one snaps to the real last page rather than lying', async () => {
        const requests: string[] = [];
        setFetchForTesting(
            databaseRouter({
                tables: ['history_message'],
                requests,
                schema: (name) => jsonResponse({ name, columns: COLUMN_DEFS, rowCount: 120 }),
                rows: (_name, params) => jsonResponse(rowsPayload(params, [], 120)),
            }),
        );
        const view = renderView('/board/projects/database?table=history_message&page=99');

        await waitFor(() =>
            expect(view.container.querySelector('[data-database-range]')?.textContent).toBe('101–120 of 120'),
        );
    });
});

// ── AC5: one sort column + one contains filter, both resetting to page 1 ──────

describe('DatabaseView sort and filter (AC5)', () => {
    test('header clicks toggle ascending/descending and reset to page 1', async () => {
        const requests: string[] = [];
        setFetchForTesting(
            databaseRouter({
                tables: ['history_message'],
                requests,
                schema: (name) => jsonResponse({ name, columns: COLUMN_DEFS, rowCount: 120 }),
                rows: (_name, params) => jsonResponse(rowsPayload(params, [], 120)),
            }),
        );
        const view = renderView('/board/projects/database?table=history_message&page=2&sort=id&dir=asc');

        await waitFor(() => expect(view.container.querySelector('[data-database-sort="body"]')).not.toBeNull());

        // Same column: asc → desc.
        act(() => (view.container.querySelector('[data-database-sort="id"]') as HTMLButtonElement).click());
        await waitFor(() => expect(lastRowsParams(requests)?.get('dir')).toBe('desc'));
        expect(lastRowsParams(requests)?.get('sort')).toBe('id');
        expect(lastRowsParams(requests)?.get('page')).toBe('1');

        // New column: switches to it, asc, page 1.
        act(() => (view.container.querySelector('[data-database-sort="body"]') as HTMLButtonElement).click());
        await waitFor(() => expect(lastRowsParams(requests)?.get('sort')).toBe('body'));
        expect(lastRowsParams(requests)?.get('dir')).toBe('asc');
        expect(lastRowsParams(requests)?.get('page')).toBe('1');
    });

    test('a column select plus a contains input filter one column and reset to page 1', async () => {
        const requests: string[] = [];
        setFetchForTesting(
            databaseRouter({
                tables: ['history_message'],
                requests,
                schema: (name) => jsonResponse({ name, columns: COLUMN_DEFS, rowCount: 120 }),
                rows: (_name, params) => jsonResponse(rowsPayload(params, [], 120)),
            }),
        );
        const view = renderView('/board/projects/database?table=history_message&page=3');

        await waitFor(() => expect(view.container.querySelector('[data-database-filter-column]')).not.toBeNull());
        fireEvent.change(view.container.querySelector('[data-database-filter-column]') as Element, {
            target: { value: 'body' },
        });
        setControlValue(view.container.querySelector('[data-database-filter-value]') as Element, 'needle');

        await waitFor(() => expect(lastRowsParams(requests)?.get('filterColumn')).toBe('body'));
        expect(lastRowsParams(requests)?.get('filter')).toBe('needle');
        expect(lastRowsParams(requests)?.get('page')).toBe('1');
    });

    test('the filter and sort round-trip through the URL', async () => {
        const requests: string[] = [];
        setFetchForTesting(
            databaseRouter({
                tables: ['history_message'],
                requests,
                schema: (name) => jsonResponse({ name, columns: COLUMN_DEFS, rowCount: 120 }),
                rows: (_name, params) => jsonResponse(rowsPayload(params, [], 120)),
            }),
        );
        const view = renderView('/board/projects/database?table=history_message&sort=body&dir=desc&fcol=body&f=needle');

        await waitFor(() => expect(view.container.querySelector('[data-testid="database-table"]')).not.toBeNull());
        expect((view.container.querySelector('[data-database-filter-column]') as HTMLSelectElement).value).toBe('body');
        expect((view.container.querySelector('[data-database-filter-value]') as HTMLInputElement).value).toBe('needle');
        const params = lastRowsParams(requests);
        expect(params?.get('sort')).toBe('body');
        expect(params?.get('dir')).toBe('desc');
        expect(params?.get('filterColumn')).toBe('body');
        expect(params?.get('filter')).toBe('needle');
        const header = view.container.querySelector('[aria-sort="descending"]');
        expect(header?.textContent).toContain('body');
    });

    test('malformed URL params fall back to the defaults without throwing', async () => {
        const requests: string[] = [];
        setFetchForTesting(
            databaseRouter({
                tables: ['history_message'],
                requests,
                schema: (name) => jsonResponse({ name, columns: COLUMN_DEFS, rowCount: 5 }),
                rows: (_name, params) => jsonResponse(rowsPayload(params, [], 5)),
            }),
        );
        const view = renderView('/board/projects/database?table=history_message&page=abc&dir=sideways&sort=&fcol=&f=');

        await waitFor(() => expect(view.container.querySelector('[data-testid="database-table"]')).not.toBeNull());
        const params = lastRowsParams(requests);
        expect(params?.get('page')).toBe('1');
        expect(params?.get('sort')).toBeNull();
        expect(params?.get('filterColumn')).toBeNull();
    });
});

// ── AC6: readable long / null / binary cells + the row-detail modal ───────────

describe('DatabaseView cell readability and row detail (AC6)', () => {
    test('NULL, BLOB and long text render as distinct readable cells', async () => {
        const longText = 'x'.repeat(5000);
        setFetchForTesting(
            databaseRouter({
                tables: ['t'],
                schema: (name) => jsonResponse({ name, columns: COLUMN_DEFS, rowCount: 2 }),
                rows: (_name, params) =>
                    jsonResponse(
                        rowsPayload(
                            params,
                            [
                                [{ t: 'null' }, { t: 'blob', bytes: 2048 }],
                                [
                                    { t: 'text', v: longText },
                                    { t: 'num', v: 42 },
                                ],
                            ],
                            2,
                        ),
                    ),
            }),
        );
        const view = renderView('/board/projects/database?table=t');

        await waitFor(() => expect(view.container.querySelector('[data-database-null]')).not.toBeNull());
        expect(view.container.querySelector('[data-database-null]')?.textContent).toBe('NULL');
        expect(view.container.querySelector('[data-database-blob]')?.textContent).toBe('BLOB · 2,048 B');

        // The long text truncates to one line (class) but the tooltip keeps the full value.
        const textCell = view.container.querySelector('[data-database-text]') as HTMLElement;
        expect(textCell.textContent).toBe(longText);
        expect(textCell.className).toContain('truncate');
        expect(textCell.closest('[data-tip]')?.getAttribute('data-tip')).toBe(longText);
    });

    test('clicking a row opens a modal with the full value and pretty-printed JSON', async () => {
        const requests: string[] = [];
        setFetchForTesting(
            databaseRouter({
                tables: ['t'],
                requests,
                schema: (name) => jsonResponse({ name, columns: COLUMN_DEFS, rowCount: 1 }),
                rows: (_name, params) =>
                    jsonResponse(
                        rowsPayload(
                            params,
                            [
                                [
                                    { t: 'num', v: 1 },
                                    { t: 'text', v: '{"a":1}' },
                                ],
                            ],
                            1,
                        ),
                    ),
                row: () =>
                    jsonResponse({
                        columns: COLUMN_NAMES,
                        row: [
                            { t: 'num', v: 1 },
                            { t: 'text', v: '{"a":1}' },
                        ],
                    }),
            }),
        );
        const view = renderView('/board/projects/database?table=t');

        await waitFor(() => expect(view.container.querySelector('[data-database-row]')).not.toBeNull());
        act(() => (view.container.querySelector('[data-database-row]') as HTMLTableRowElement).click());

        await waitFor(() => expect(view.container.querySelector('[data-database-json]')).not.toBeNull());
        expect(view.container.querySelector('[data-database-json]')?.textContent).toContain('"a": 1');
        // The detail read is fetched for the exact row offset.
        const detailRequest = requests.find((url) => url.includes('/row?'));
        expect(new URL(detailRequest ?? 'http://x/').searchParams.get('offset')).toBe('0');
    });
});

// ── AC8: every named state, never a blank panel ───────────────────────────────

describe('DatabaseView named states (AC8)', () => {
    test('loading is named', async () => {
        let release: (response: Response) => void = () => {};
        setFetchForTesting((() => new Promise<Response>((resolve) => (release = resolve))) as unknown as typeof fetch);
        const view = renderView('/board/projects/database');
        expect(view.container.querySelector('[data-database-rail-state="loading"]')).not.toBeNull();
        await act(async () => {
            release(jsonResponse({ tables: [] }));
            await Promise.resolve();
        });
    });

    test('an empty database is named and the rail stays usable', async () => {
        setFetchForTesting(databaseRouter({ tables: [] }));
        const view = renderView('/board/projects/database');
        await waitFor(() => expect(view.container.querySelector('[data-database-rail-empty]')).not.toBeNull());
    });

    test('an empty table is named', async () => {
        setFetchForTesting(
            databaseRouter({
                tables: ['t'],
                schema: (name) => jsonResponse({ name, columns: COLUMN_DEFS, rowCount: 0 }),
                rows: (_name, params) => jsonResponse(rowsPayload(params, [], 0)),
            }),
        );
        const view = renderView('/board/projects/database?table=t');
        await waitFor(() =>
            expect(view.container.querySelector('[data-database-state="empty"]')?.textContent).toContain('has no rows'),
        );
    });

    test('an unknown table is named and the picker still works', async () => {
        const requests: string[] = [];
        setFetchForTesting(
            databaseRouter({
                tables: ['alpha', 'beta'],
                requests,
                schema: (name) =>
                    name === 'alpha'
                        ? jsonResponse({ name, columns: COLUMN_DEFS, rowCount: 1 })
                        : jsonResponse({ error: 'unknown-table' }, 404),
                rows: (name, params) =>
                    name === 'alpha'
                        ? jsonResponse(rowsPayload(params, [[{ t: 'num', v: 1 }]], 1))
                        : jsonResponse({ error: 'unknown-table' }, 404),
            }),
        );
        const view = renderView('/board/projects/database?table=ghost');

        await waitFor(() =>
            expect(view.container.querySelector('[data-database-state="unknown-table"]')).not.toBeNull(),
        );
        // Picker is still usable while the main panel reports the unknown table.
        expect(view.container.querySelector('[data-database-table="alpha"]')).not.toBeNull();
        expect(view.container.querySelector('[data-database-table="beta"]')).not.toBeNull();

        act(() => (view.container.querySelector('[data-database-table="alpha"]') as HTMLButtonElement).click());
        await waitFor(() => expect(view.container.querySelector('[data-testid="database-table"]')).not.toBeNull());
        expect(requests.some((url) => url.includes('/tables/alpha/rows'))).toBe(true);
    });

    test('a 503 database-unavailable is named', async () => {
        setFetchForTesting(
            databaseRouter({
                tables: [],
                tablesResponse: () => jsonResponse({ error: 'database-unavailable' }, 503),
                schema: () => jsonResponse({ error: 'database-unavailable' }, 503),
                rows: () => jsonResponse({ error: 'database-unavailable' }, 503),
            }),
        );
        const view = renderView('/board/projects/database?table=t');
        await waitFor(() => expect(view.container.querySelector('[data-database-state="unavailable"]')).not.toBeNull());
    });

    test('an HTTP failure is named with a retry', async () => {
        setFetchForTesting(
            databaseRouter({
                tables: ['t'],
                schema: () => jsonResponse({ error: 'invalid-request' }, 400),
                rows: () => jsonResponse({ error: 'invalid-request' }, 400),
            }),
        );
        const view = renderView('/board/projects/database?table=t');
        await waitFor(() => expect(view.container.querySelector('[data-database-state="failed"]')).not.toBeNull());
        expect(view.getByText('Retry')).toBeTruthy();
    });

    test('a transport failure is named', async () => {
        setFetchForTesting(
            databaseRouter({
                tables: ['t'],
                schema: () => {
                    throw new Error('socket closed');
                },
                rows: () => {
                    throw new Error('socket closed');
                },
            }),
        );
        const view = renderView('/board/projects/database?table=t');
        await waitFor(() => expect(view.container.querySelector('[data-database-state="failed"]')).not.toBeNull());
    });
});

// ── 1188: the filter input must not read the server once per keystroke ────────
// Each read costs a filtered COUNT(*) plus a window select, executed synchronously
// on bun:sqlite inside the Bun server, so a keystroke-per-read against a 3.2M-row
// table blocks the shared event loop. The two comparable server-driven filter boxes
// in this repo (HistoryShell, SystemEventsTab) debounce 250 ms.
describe('DatabaseView filter debounce (1188)', () => {
    function filterRouter(requests: string[]) {
        return databaseRouter({
            tables: ['history_message'],
            requests,
            schema: (name) => jsonResponse({ name, columns: COLUMN_DEFS, rowCount: 120 }),
            rows: (_name, params) => jsonResponse(rowsPayload(params, [], 120)),
        });
    }

    /** Filter values that actually reached the server, in order. */
    function filterValuesSent(requests: string[]): string[] {
        return rowsRequests(requests)
            .map((params) => params.get('filter'))
            .filter((value): value is string => value !== null);
    }

    test('typing a term issues one rows read, carrying the final value', async () => {
        const requests: string[] = [];
        setFetchForTesting(filterRouter(requests));
        const view = renderView('/board/projects/database?table=history_message&fcol=body&f=nee');
        await waitFor(() => expect(lastRowsParams(requests)?.get('filter')).toBe('nee'));

        const before = filterValuesSent(requests).length;
        const input = view.container.querySelector('[data-database-filter-value]') as Element;
        for (const value of ['needle', 'needleb', 'needlebo']) setControlValue(input, value);

        await waitFor(() => expect(lastRowsParams(requests)?.get('filter')).toBe('needlebo'));
        expect(filterValuesSent(requests).length - before).toBe(1);
    });

    test('only the settled value reaches the server, never an intermediate one', async () => {
        const requests: string[] = [];
        setFetchForTesting(filterRouter(requests));
        const view = renderView('/board/projects/database?table=history_message&fcol=body&f=start');
        await waitFor(() => expect(lastRowsParams(requests)?.get('filter')).toBe('start'));

        const input = view.container.querySelector('[data-database-filter-value]') as Element;
        setControlValue(input, 'ab');
        setControlValue(input, 'abcd');

        await waitFor(() => expect(lastRowsParams(requests)?.get('filter')).toBe('abcd'));
        expect(filterValuesSent(requests)).toEqual(['start', 'abcd']);
    });
});
