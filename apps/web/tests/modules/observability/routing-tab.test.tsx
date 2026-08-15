import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import RoutingTab, {
    formatTokenCount,
    parseRoutingSummaryResponse,
    type RoutingSummaryView,
    sourceLabel,
} from '../../../src/modules/observability/RoutingTab';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

function pair(overrides: Partial<RoutingSummaryView['pairs'][number]> = {}): RoutingSummaryView['pairs'][number] {
    return { role: 'scribe', executor: 'cheap-exec', source: 'role', runs: 4, escalations: 1, ...overrides };
}

function totals(overrides: Record<string, number> = {}): NonNullable<RoutingSummaryView['roles'][number]['exact']> {
    return {
        inputTokens: 1250,
        outputTokens: 300,
        cacheReadTokens: 200,
        cacheCreationTokens: 50,
        records: 4,
        recordsWithUsage: 4,
        ...overrides,
    };
}

function role(overrides: Partial<RoutingSummaryView['roles'][number]> = {}): RoutingSummaryView['roles'][number] {
    return {
        role: 'scribe',
        totalRuns: 4,
        matchedRuns: 4,
        exact: totals(),
        estimated: null,
        unmeasured: false,
        ...overrides,
    };
}

/** Full envelope shaped exactly like GET /api/observability/routing-summary. */
function envelope(view: Partial<RoutingSummaryView>): unknown {
    return {
        routing: {
            window: { since: '2026-08-08T00:00:00.000Z', until: '2026-08-15T00:00:00.000Z' },
            pairs: view.pairs ?? [],
        },
        tokens: {
            window: { since: '2026-08-08T00:00:00.000Z', until: '2026-08-15T00:00:00.000Z' },
            roles: view.roles ?? [],
        },
    };
}

let requestedUrls: string[] = [];

beforeAll(() => {
    registerHappyDom();
});

beforeEach(() => {
    requestedUrls = [];
});

afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

afterAll(async () => {
    await teardownHappyDom();
});

/** Install a fetch stub returning `view`; records every requested URL. */
function stubRouting(view: Partial<RoutingSummaryView>): void {
    setFetchForTesting((async (input: RequestInfo | URL) => {
        requestedUrls.push(input instanceof Request ? input.url : String(input));
        return jsonResponse(envelope(view));
    }) as unknown as typeof fetch);
}

describe('RoutingTab (task 0552)', () => {
    test('R1: renders per-pair run and escalation counts, pinned separated from resolved', async () => {
        stubRouting({
            pairs: [
                pair({ role: 'scribe', executor: 'cheap-exec', source: 'role', runs: 4, escalations: 1 }),
                pair({ role: 'scribe', executor: 'cheap-exec', source: 'explicit', runs: 2, escalations: 0 }),
                pair({ role: 'planner', executor: 'capable-3', source: 'default', runs: 3, escalations: 2 }),
                pair({ role: null, executor: 'capable-3', source: null, runs: 1, escalations: 0 }),
            ],
        });

        const view = render(<RoutingTab />);
        await view.findByText('Role → executor');

        // Counts render exactly as the query returns them.
        const table = document.querySelector('[data-routing-table]');
        expect(table?.textContent).toContain('cheap-exec');
        expect(table?.textContent).toContain('capable-3');

        // Selection sources stay distinct: pinned, resolved, default, and bare pin.
        expect(view.getByText('pinned')).toBeTruthy();
        expect(view.getByText('resolved')).toBeTruthy();
        expect(view.getByText('default')).toBeTruthy();

        // Counts render exactly as the query returns them — per-row, per-cell.
        const rows = Array.from(table?.querySelectorAll('tbody tr') ?? []);
        expect(rows).toHaveLength(4);
        const cells = rows.map((row) => Array.from(row.querySelectorAll('td')).map((td) => td.textContent?.trim()));
        expect(cells).toEqual([
            ['scribe', 'cheap-exec', 'resolved', '4', '1'],
            ['scribe', 'cheap-exec', 'pinned', '2', '0'],
            ['planner', 'capable-3', 'default', '3', '2'],
            ['—', 'capable-3', '—', '1', '0'],
        ]);

        // The covered window is reported, never implied.
        expect(document.querySelector('[data-covered-window]')?.textContent).toContain('2026-08-08');
    });

    test('R2: token totals render with no currency figure anywhere', async () => {
        stubRouting({ roles: [role()] });

        const view = render(<RoutingTab />);
        await view.findByText('Token consumption by role');

        expect(view.getByText('input')).toBeTruthy();
        expect(view.getByText('cache read')).toBeTruthy();
        expect(view.getByText('cache write')).toBeTruthy();
        expect(view.getByText('output')).toBeTruthy();
        expect(view.getByText('1,250')).toBeTruthy();
        expect(view.getByText('200')).toBeTruthy();
        expect(view.getByText('50')).toBeTruthy();
        expect(view.getByText('300')).toBeTruthy();

        const surface = document.querySelector('[data-routing-tab]')?.textContent ?? '';
        expect(surface).not.toMatch(/\$|usd|price|cost/i);
    });

    test('R3: unmeasured renders as unmeasured, distinct from an observed zero', async () => {
        stubRouting({
            roles: [
                // No matched history rows → unmeasured, not zero-as-fact.
                role({
                    role: 'ghost',
                    totalRuns: 1,
                    matchedRuns: 0,
                    exact: null,
                    estimated: null,
                    unmeasured: true,
                }),
                // Genuinely consumed nothing → measured zero.
                role({
                    role: 'empty-role',
                    totalRuns: 1,
                    matchedRuns: 1,
                    exact: totals({
                        inputTokens: 0,
                        outputTokens: 0,
                        cacheReadTokens: 0,
                        cacheCreationTokens: 0,
                    }),
                    estimated: null,
                    unmeasured: false,
                }),
            ],
        });

        const view = render(<RoutingTab />);
        await view.findByText('Token consumption by role');

        const unmeasuredCard = document.querySelector('[data-role-attribution="ghost"]');
        expect(unmeasuredCard?.textContent).toContain('unmeasured');
        // Unmeasured carries no token figures at all — never a zero presented as measured.
        expect(unmeasuredCard?.textContent).not.toMatch(/input|cache read|cache write|output/);

        const zeroCard = document.querySelector('[data-role-attribution="empty-role"]');
        expect(zeroCard?.textContent).toContain('input');
        expect(zeroCard?.textContent).toContain('0');
        expect(zeroCard?.textContent).not.toContain('unmeasured');
    });

    test('R4: exact and estimated buckets render separately, never summed', async () => {
        stubRouting({
            roles: [
                role({
                    exact: totals({ inputTokens: 1000 }),
                    estimated: totals({
                        inputTokens: 300,
                        outputTokens: 90,
                        cacheReadTokens: 10,
                        cacheCreationTokens: 5,
                    }),
                }),
            ],
        });

        const view = render(<RoutingTab />);
        await view.findByText('Token consumption by role');

        expect(document.querySelector('[data-token-bucket="exact"]')?.textContent).toContain('1,000');
        expect(document.querySelector('[data-token-bucket="estimated"]')?.textContent).toContain('300');
        // The two exactness classes are never folded into one figure.
        expect(document.querySelector('[data-routing-tab]')?.textContent).not.toContain('1,300');
    });

    test('R5: an empty dataset states that nothing has been recorded, not zero activity', async () => {
        stubRouting({ pairs: [], roles: [] });

        const view = render(<RoutingTab />);
        await view.findByText(/No routing attribution has been recorded/i);

        expect(document.querySelector('[data-routing-empty]')).toBeTruthy();
        expect(document.querySelector('[data-routing-table]')).toBeNull();
        // No zeroes that could be mistaken for measurements.
        expect(document.querySelector('[data-routing-tab]')?.textContent).not.toMatch(/0 runs|0 escalations/);
    });

    test('fetches the routing-summary endpoint through the API client', async () => {
        stubRouting({ pairs: [], roles: [] });

        const view = render(<RoutingTab />);
        await view.findByText(/No routing attribution has been recorded/i);
        expect(requestedUrls.some((u) => u.endsWith('/api/observability/routing-summary'))).toBe(true);
    });
});

describe('parseRoutingSummaryResponse', () => {
    test('parses a well-formed envelope', () => {
        const view = parseRoutingSummaryResponse(envelope({ pairs: [pair()], roles: [role()] }));
        expect(view).not.toBeNull();
        expect(view?.pairs).toHaveLength(1);
        expect(view?.roles).toHaveLength(1);
        expect(view?.window.since).toBe('2026-08-08T00:00:00.000Z');
    });

    test('returns null for missing window or non-array collections', () => {
        expect(parseRoutingSummaryResponse(null)).toBeNull();
        expect(parseRoutingSummaryResponse('x')).toBeNull();
        expect(parseRoutingSummaryResponse({ routing: {}, tokens: {} })).toBeNull();
        expect(
            parseRoutingSummaryResponse({
                routing: { window: { since: 'a' }, pairs: [] },
                tokens: { window: { since: 'a', until: 'b' }, roles: [] },
            }),
        ).toBeNull();
        expect(
            parseRoutingSummaryResponse({
                routing: { window: { since: 'a', until: 'b' }, pairs: {} },
                tokens: { window: { since: 'a', until: 'b' }, roles: [] },
            }),
        ).toBeNull();
    });

    test('drops malformed rows instead of blanking the surface', () => {
        const view = parseRoutingSummaryResponse(
            envelope({
                pairs: [pair(), { bad: true } as unknown as RoutingSummaryView['pairs'][number]],
                roles: [role(), { nope: 1 } as unknown as RoutingSummaryView['roles'][number]],
            }),
        );
        expect(view?.pairs).toHaveLength(1);
        expect(view?.roles).toHaveLength(1);
    });
});

describe('sourceLabel / formatTokenCount', () => {
    test('maps selection sources to honest labels', () => {
        expect(sourceLabel('explicit')).toBe('pinned');
        expect(sourceLabel('role')).toBe('resolved');
        expect(sourceLabel('default')).toBe('default');
        expect(sourceLabel('phase')).toBe('phase');
        expect(sourceLabel(null)).toBe('—');
    });

    test('formats token counts without any currency symbol', () => {
        expect(formatTokenCount(1250)).toBe('1,250');
        expect(formatTokenCount(0)).toBe('0');
        expect(formatTokenCount(1_000_000)).toBe('1,000,000');
    });
});
