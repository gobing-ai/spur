import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import InboxTab from '../../../src/modules/observability/InboxTab';
import JobsTab from '../../../src/modules/observability/JobsTab';
import ObservabilityShell from '../../../src/modules/observability/ObservabilityShell';
import ProcessListTab from '../../../src/modules/observability/ProcessListTab';
import SystemEventsTab, { historyUrl, serializeFilter } from '../../../src/modules/observability/SystemEventsTab';
import TasksTab from '../../../src/modules/observability/TasksTab';
import ToolUsingTab from '../../../src/modules/observability/ToolUsingTab';
import { OBSERVABILITY_TABS } from '../../../src/modules/observability/tabs';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

class FakeEventSource {
    static instances: FakeEventSource[] = [];

    onopen: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    closed = false;

    constructor(readonly url: string) {
        FakeEventSource.instances.push(this);
    }

    close(): void {
        this.closed = true;
    }
}

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

let originalEventSource: typeof EventSource | undefined;

beforeAll(() => {
    registerHappyDom();
    originalEventSource = globalThis.EventSource;
});

beforeEach(() => {
    FakeEventSource.instances = [];
    Object.defineProperty(globalThis, 'EventSource', {
        configurable: true,
        value: FakeEventSource,
    });
});

afterEach(() => {
    cleanup();
    resetFetchForTesting();
    Object.defineProperty(globalThis, 'EventSource', {
        configurable: true,
        value: originalEventSource,
    });
});

afterAll(async () => {
    await teardownHappyDom();
});

function installObservabilityFetchMock(): string[] {
    const calls: string[] = [];
    setFetchForTesting((async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        calls.push(url);
        if (url.includes('/events/history')) {
            // Branch on server-side prefix filter so JobsTab's two parallel
            // prefix fetches each get their own page (R9), while SystemEventsTab's
            // unfiltered call still gets the full set.
            if (url.includes('prefix=queue')) {
                return jsonResponse({
                    events: [
                        {
                            id: 'event-job-1',
                            eventName: 'queue.job.completed',
                            occurredAt: '2026-07-04T20:04:00.000Z',
                            actor: null,
                            payload: { jobId: 'job-1', type: 'smoke' },
                        },
                    ],
                    count: 1,
                    catalog: [{ name: 'queue.job.completed', prefix: 'queue', source: 'queue', renderer: 'queue' }],
                });
            }
            if (url.includes('prefix=scheduler')) {
                return jsonResponse({
                    events: [
                        {
                            id: 'event-sched-1',
                            eventName: 'scheduler.job.executed',
                            occurredAt: '2026-07-04T20:03:00.000Z',
                            actor: null,
                            payload: { name: 'cleanup', durationMs: 250 },
                        },
                    ],
                    count: 1,
                    catalog: [
                        {
                            name: 'scheduler.job.executed',
                            prefix: 'scheduler',
                            source: 'scheduler',
                            renderer: 'scheduler',
                        },
                    ],
                });
            }
            // Unfiltered (SystemEventsTab): full set across all prefixes.
            return jsonResponse({
                events: [
                    {
                        id: 'event-job-1',
                        eventName: 'queue.job.completed',
                        occurredAt: '2026-07-04T20:04:00.000Z',
                        actor: null,
                        payload: { jobId: 'job-1', type: 'smoke' },
                    },
                    {
                        id: 'event-1',
                        eventName: 'task.created',
                        occurredAt: '2026-07-04T20:00:00.000Z',
                        actor: 'operator',
                        payload: { wbs: '0199' },
                    },
                ],
                count: 2,
                catalog: [
                    { name: 'task.created', prefix: 'task', source: 'planning', renderer: 'planning' },
                    { name: 'queue.job.completed', prefix: 'queue', source: 'queue', renderer: 'queue' },
                ],
            });
        }
        if (url.includes('/jobs/stats')) {
            return jsonResponse({
                stats: { pending: 2, processing: 1, completed: 3, failed: 0 },
            });
        }
        if (url.includes('/messages/inbox')) {
            return jsonResponse({
                messages: [
                    {
                        id: 'msg-1',
                        fromId: 'operator',
                        toId: 'worker',
                        body: 'Please review the observability board.',
                        status: 'sent',
                        createdAt: '2026-07-04T20:01:00.000Z',
                        inReplyTo: null,
                    },
                    {
                        id: 'msg-2',
                        fromId: 'worker',
                        toId: 'operator',
                        body: 'Review complete.',
                        status: 'sent',
                        createdAt: '2026-07-04T20:02:00.000Z',
                        inReplyTo: 'msg-1',
                    },
                ],
                count: 2,
            });
        }
        return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch);
    return calls;
}

describe('observability components', () => {
    test('shell renders tab data and switches from system events to jobs', async () => {
        // 0254 migrated `inbox` and `process-list` out of Observability into
        // the Teams module. The shell now switches among the telemetry-only
        // tabs (system-events → jobs); the inbox tab-switching behavior is
        // covered by the Teams module MessagesTab tests.
        const calls = installObservabilityFetchMock();
        const { getByRole, queryAllByText, getByText } = render(<ObservabilityShell />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));
        expect(calls.some((url) => url.includes('/events/history?limit=100'))).toBe(true);

        fireEvent.click(getByRole('tab', { name: 'Jobs' }));

        await waitFor(() => expect(queryAllByText('job-1').length).toBeGreaterThan(0));
        expect(getByText('Pending')).toBeDefined();
        expect(getByText('2')).toBeDefined();
        expect(calls.some((url) => url.includes('/jobs/stats'))).toBe(true);
        // 0376: Jobs tab now fetches via server-side prefix filter (R9).
        expect(calls.some((url) => url.includes('prefix=queue'))).toBe(true);
        expect(calls.some((url) => url.includes('prefix=scheduler'))).toBe(true);
    });

    test('system events tab fetches history and prepends live SSE events', async () => {
        installObservabilityFetchMock();
        const { queryAllByText } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));
        expect(FakeEventSource.instances).toHaveLength(1);
        expect(FakeEventSource.instances[0]?.url).toContain('/events/planning');

        await act(async () => {
            FakeEventSource.instances[0]?.onmessage?.(
                new MessageEvent('message', {
                    data: JSON.stringify({
                        eventName: 'task.updated',
                        occurredAt: '2026-07-04T20:03:00.000Z',
                        actor: 'operator',
                        payload: { status: 'done' },
                    }),
                }),
            );
        });

        await waitFor(() => expect(queryAllByText('task.updated').length).toBeGreaterThan(0));
    });

    test('system events tab renders the liveness strip (task 0222 R1/R3)', async () => {
        installObservabilityFetchMock();
        const { queryAllByText, getByText } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        // R1: connection indicator starts in the "connecting" state and
        // surfaces both a colored dot and a text label (R6 — color is never
        // the only signal).
        expect(getByText('connecting')).toBeDefined();
        // R3: N of M shown reflects filtered count over total loaded count.
        expect(getByText('2 of 2 shown')).toBeDefined();
    });

    test('system events tab transitions liveness strip to live on SSE open (task 0222 R1)', async () => {
        installObservabilityFetchMock();
        const { queryAllByText, getByText } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        await act(async () => {
            FakeEventSource.instances[0]?.onopen?.(new Event('open'));
        });

        await waitFor(() => expect(getByText('live')).toBeDefined());
    });

    test('system events tab counts incoming SSE events in the rolling 60s rate (task 0222 R2)', async () => {
        installObservabilityFetchMock();
        const { queryAllByText, getByText } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        // Two new live envelopes bump the rate from 0 to 2 within the window.
        for (const evt of [
            { eventName: 'task.updated', occurredAt: '2026-07-04T20:03:00.000Z' },
            { eventName: 'queue.job.queued', occurredAt: '2026-07-04T20:03:30.000Z' },
        ]) {
            await act(async () => {
                FakeEventSource.instances[0]?.onmessage?.(
                    new MessageEvent('message', { data: JSON.stringify({ ...evt, actor: null, payload: {} }) }),
                );
            });
        }

        await waitFor(() => expect(getByText('2 events / 60s')).toBeDefined());
        // R3: filtered count grows as live events arrive (no filter active).
        expect(getByText('4 of 4 shown')).toBeDefined();
    });

    test('system events tab renders a table with sticky header and the 7 columns (task 0223 R1/R3 + 0375 R2)', async () => {
        installObservabilityFetchMock();
        const { container, queryAllByText } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        const table = container.querySelector('[data-system-events-tab] table');
        expect(table).not.toBeNull();
        const thead = table?.querySelector('thead');
        expect(thead?.className).toContain('sticky');
        const headers = table?.querySelectorAll('thead th');
        const headerLabels = Array.from(headers ?? []).map((th) => th.textContent?.trim());
        expect(headerLabels).toEqual(['Time', 'Event', 'Actor', 'Prefix', 'Tier', 'Run', 'Outcome']);
    });

    test('event names are colored by a stable prefix-to-color map (task 0223 R4/R5/R6)', async () => {
        installObservabilityFetchMock();
        const { queryAllByText } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        // R4: `task` prefix maps to a fixed color, not a hash. The text-color
        // class is deterministic across renders.
        const isNameEl = (n: Element) => {
            const tag = n.tagName.toLowerCase();
            return tag === 'button' || tag === 'span';
        };
        const taskName = queryAllByText('task.created').find(isNameEl);
        expect(String(taskName?.className ?? '')).toContain('text-emerald-400');
        const queueName = queryAllByText('queue.job.completed').find(isNameEl);
        expect(String(queueName?.className ?? '')).toContain('text-orange-400');

        // R5: the prefix label is always rendered alongside the color in the
        // dedicated Prefix column.
        expect(queryAllByText('task').length).toBeGreaterThan(0);
        expect(queryAllByText('queue').length).toBeGreaterThan(0);
    });

    test('event-name cell has an expand button that toggles a detail panel (task 0375 R4)', async () => {
        installObservabilityFetchMock();
        const { queryAllByText, container } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        // R4: the hover-only tooltip is replaced by a row-anchored expandable
        // region. Each row has a toggle button with aria-expanded.
        const toggleButtons = container.querySelectorAll('button[aria-expanded]');
        expect(toggleButtons.length).toBeGreaterThan(0);

        // Detail panel is not present until a toggle is clicked.
        let detailPanels = container.querySelectorAll('section[aria-label^="Detail for"]');
        expect(detailPanels.length).toBe(0);

        // Click the first toggle to expand the detail panel.
        await act(async () => {
            const btn = toggleButtons[0];
            if (btn) fireEvent.click(btn);
        });

        // The detail panel is now in the DOM.
        detailPanels = container.querySelectorAll('section[aria-label^="Detail for"]');
        expect(detailPanels.length).toBe(1);

        // R4: detail panel contains the typed summary as a <dl>, NOT raw JSON.
        // The panel renders correlation columns + renderer summary + raw payload.
        const dl = detailPanels[0]?.querySelector('dl');
        expect(dl).not.toBeNull();
        // Raw payload IS shown (as a <pre>), but it is server-redacted, not
        // client-re-redacted (R6 - client never re-redacts).
        const pre = detailPanels[0]?.querySelector('pre');
        expect(pre).not.toBeNull();
    });

    test('system events tab derives prefix filters from catalog metadata', async () => {
        installObservabilityFetchMock();
        const { queryAllByText, getByRole } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));
        expect(queryAllByText('queue.job.completed').length).toBeGreaterThan(0);

        // R2: prefix pills are multi-select switches; clicking the `queue`
        // pill narrows the visible set to queue-prefixed events.
        const queueChip = getByRole('switch', { name: /^Prefix queue/ });
        fireEvent.click(queueChip);

        expect(queryAllByText('queue.job.completed').length).toBeGreaterThan(0);
        expect(queryAllByText('task.created').length).toBe(0);
    });

    test('system events tab filters by visibility tier (task 0221 R5/R7)', async () => {
        // Catalog with one default + one diagnostic event so the tier filter
        // can hide the diagnostic row.
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/events/history')) {
                return jsonResponse({
                    events: [
                        {
                            id: 'evt-default',
                            eventName: 'task.created',
                            occurredAt: '2026-07-04T20:00:00.000Z',
                            actor: 'operator',
                            payload: {},
                        },
                        {
                            id: 'evt-diagnostic',
                            eventName: 'bus.handler.error',
                            occurredAt: '2026-07-04T20:00:01.000Z',
                            actor: null,
                            payload: { event: 'rule.eval.error' },
                        },
                    ],
                    count: 2,
                    catalog: [
                        {
                            name: 'task.created',
                            prefix: 'task',
                            source: 'planning',
                            tier: 'default',
                            renderer: 'planning',
                        },
                        {
                            name: 'bus.handler.error',
                            prefix: 'bus',
                            source: 'bus',
                            tier: 'diagnostic',
                            renderer: 'bus',
                        },
                    ],
                });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);
        const { queryAllByText, getByRole } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));
        expect(queryAllByText('bus.handler.error').length).toBeGreaterThan(0);

        // R3: tier segmented toggle — click the Diagnostic radio.
        const diagnosticRadio = getByRole('radio', { name: 'Diagnostic' });
        fireEvent.click(diagnosticRadio);
        expect(queryAllByText('task.created').length).toBe(0);
    });

    test('filter bar exposes a multi-select prefix pill row (task 0224 R1/R2)', async () => {
        installObservabilityFetchMock();
        const { queryAllByText, getByRole } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        // R1: each known prefix is a `role="switch"` pill. The chip is muted
        // until selected, then adopts the prefix → color class from the table
        // (assertion below fires after activation so the color class is in
        // the className).
        const taskChip = getByRole('switch', { name: /^Prefix task/ });
        const queueChip = getByRole('switch', { name: /^Prefix queue/ });
        expect(taskChip.className).not.toContain('text-emerald-400');

        // R2: select task, then also select queue — multi-select. Both
        // become `aria-checked="true"` and both prefixes remain visible.
        fireEvent.click(taskChip);
        fireEvent.click(queueChip);
        expect(taskChip.getAttribute('aria-checked')).toBe('true');
        expect(queueChip.getAttribute('aria-checked')).toBe('true');
        // After activation the chip carries the prefix-to-color class.
        expect(taskChip.className).toContain('text-emerald-400');
        expect(queueChip.className).toContain('text-orange-400');
        expect(queryAllByText('task.created').length).toBeGreaterThan(0);
        expect(queryAllByText('queue.job.completed').length).toBeGreaterThan(0);

        // Toggle task off (deselect), only queue remains in scope.
        fireEvent.click(taskChip);
        expect(taskChip.getAttribute('aria-checked')).toBe('false');
        expect(queryAllByText('queue.job.completed').length).toBeGreaterThan(0);
    });

    test('filter bar exposes a segmented tier toggle (task 0224 R3)', async () => {
        installObservabilityFetchMock();
        const { container, queryAllByText } = render(<SystemEventsTab />);

        // The filter bar only renders after the events array is loaded.
        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        // R3: the Tier filter is a `<fieldset>` (a native radiogroup) with
        // three `<input type="radio">` options.
        const tierFieldset = container.querySelector('fieldset[aria-label="Tier"]') as HTMLElement;
        expect(tierFieldset).not.toBeNull();
        const tierRadios = tierFieldset.querySelectorAll('input[type="radio"]');
        expect(tierRadios.length).toBe(3);
        const findRadio = (value: string) =>
            Array.from(tierRadios).find((r) => (r as HTMLInputElement).value === value) as HTMLInputElement;
        const allRadio = findRadio('all');
        const defaultRadio = findRadio('default');
        expect(allRadio.checked).toBe(true);
        fireEvent.click(defaultRadio);
        expect(defaultRadio.checked).toBe(true);
        expect(allRadio.checked).toBe(false);
    });
    test('search input has an inline scope selector (task 0224 R4)', async () => {
        installObservabilityFetchMock();
        const { queryAllByText, getByRole } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        // R4 default scope is 'all'.
        const scopeSelect = getByRole('combobox', { name: 'Search scope' });
        expect(scopeSelect).toBeDefined();
        expect((scopeSelect as HTMLSelectElement).value).toBe('all');
    });

    test('time-window segmented toggle restricts visible events to the trailing window (task 0224 R5)', async () => {
        // Two events: one old (>5m ago), one recent. After picking 30s only
        // the recent one should remain.
        const now = Date.now();
        const recentIso = new Date(now - 5_000).toISOString();
        const oldIso = new Date(now - 10 * 60_000).toISOString();
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/events/history')) {
                return jsonResponse({
                    events: [
                        {
                            id: 'evt-recent',
                            eventName: 'task.created',
                            occurredAt: recentIso,
                            actor: 'op',
                            payload: {},
                        },
                        {
                            id: 'evt-old',
                            eventName: 'queue.job.completed',
                            occurredAt: oldIso,
                            actor: null,
                            payload: {},
                        },
                    ],
                    count: 2,
                    catalog: [
                        { name: 'task.created', prefix: 'task', source: 'planning', renderer: 'planning' },
                        { name: 'queue.job.completed', prefix: 'queue', source: 'queue', renderer: 'queue' },
                    ],
                });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);
        const { queryAllByText, container } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));
        expect(queryAllByText('queue.job.completed').length).toBeGreaterThan(0);

        // R5: the Window filter is a `<fieldset>` with three radio inputs.
        // Scope the radio query to it because the Tier fieldset also has
        // an "All" option.
        const windowFieldset = container.querySelector('fieldset[aria-label="Window"]') as HTMLElement;
        const windowRadios = Array.from(windowFieldset.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
        const setWindow = (value: string) => {
            const radio = windowRadios.find((r) => r.value === value);
            if (radio) fireEvent.click(radio);
        };
        setWindow('30s');
        expect(queryAllByText('task.created').length).toBeGreaterThan(0);
        expect(queryAllByText('queue.job.completed').length).toBe(0);

        setWindow('all');
        expect(queryAllByText('queue.job.completed').length).toBeGreaterThan(0);
    });

    test('clear-filters button appears when filters are active and resets them (task 0224 R6)', async () => {
        installObservabilityFetchMock();
        const { queryAllByText, queryByRole, getByRole } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        // No clear button at default state.
        expect(queryByRole('button', { name: 'Clear all filters' })).toBeNull();

        // Activate a prefix filter — clear button should appear.
        fireEvent.click(getByRole('switch', { name: /^Prefix task/ }));
        const clearBtn = getByRole('button', { name: 'Clear all filters' });
        expect(clearBtn).toBeDefined();

        fireEvent.click(clearBtn);
        // After clear, all events return and the clear button disappears.
        await waitFor(() => expect(queryByRole('button', { name: 'Clear all filters' })).toBeNull());
        expect(queryAllByText('task.created').length).toBeGreaterThan(0);
        expect(queryAllByText('queue.job.completed').length).toBeGreaterThan(0);
    });

    test('filter bar renders an inline result count (task 0224 R7)', async () => {
        installObservabilityFetchMock();
        const { queryAllByText, getByText } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        // R7: inline count format is "N of M".
        expect(getByText('2 of 2')).toBeDefined();
    });

    test('table collapses to 2 columns under 640px and stacks Actor under Event (task 0225 R1)', async () => {
        // @ts-expect-error install matchMedia mock that reports compact viewport
        globalThis.matchMedia = ((query: string) => ({
            matches: query === '(max-width: 639px)',
            media: query,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
        })) as typeof window.matchMedia;

        try {
            installObservabilityFetchMock();
            const { container, queryAllByText, getByText } = render(<SystemEventsTab />);

            await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

            // R1: under 640px only Time + Event columns render; Actor/Prefix/Tier are hidden.
            const headers = container.querySelectorAll('[data-system-events-tab] thead th');
            expect(Array.from(headers).map((th) => th.textContent?.trim())).toEqual(['Time', 'Event']);
            expect(getByText('by operator')).toBeDefined();

            // Actor is stacked inside the Event cell as "by <actor>".
        } finally {
            // @ts-expect-error restore matchMedia
            globalThis.matchMedia = undefined;
        }
    });

    test('color is never the only signal: prefix has text + color, tier has text (task 0225 R2)', async () => {
        installObservabilityFetchMock();
        const { queryAllByText } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        // Find the row containing `task.created` then inspect its Prefix/Tier cells.
        const taskSpans = queryAllByText('task.created').filter((n) => {
            const tag = n.tagName.toLowerCase();
            return tag === 'button' || tag === 'span';
        });
        expect(taskSpans.length).toBeGreaterThan(0);
        const taskRow = taskSpans[0]?.closest('tr') as HTMLTableRowElement;
        expect(taskRow).not.toBeNull();

        const prefixSpan = taskRow.querySelector('td:nth-child(4) span');
        expect(prefixSpan).not.toBeNull();
        expect(prefixSpan?.textContent).toBe('task');
        expect(prefixSpan?.className).toContain('text-emerald-400');

        const tierCell = taskRow.querySelector('td:nth-child(5)');
        expect(tierCell?.textContent?.trim()).toMatch(/default|diagnostic/);
    });

    test('detail panel renders typed summary and is keyboard-toggleable (task 0225 R3 + 0375 R4)', async () => {
        installObservabilityFetchMock();
        const { container, queryAllByText } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        // R4: the hover-only tooltip is replaced by a row-anchored expandable
        // region. The toggle button is keyboard-focusable and toggles via
        // Enter/Space (native button behavior). The detail panel is absent
        // until toggled.
        const toggleButtons = container.querySelectorAll('button[aria-expanded]');
        expect(toggleButtons.length).toBeGreaterThan(0);
        expect(toggleButtons[0]?.getAttribute('aria-expanded')).toBe('false');

        // Expand via click - detail panel appears with a typed <dl> summary.
        await act(async () => {
            const btn = toggleButtons[0];
            if (btn) fireEvent.click(btn);
        });
        expect(toggleButtons[0]?.getAttribute('aria-expanded')).toBe('true');
        const detailPanel = container.querySelector('section[aria-label^="Detail for"]');
        expect(detailPanel).not.toBeNull();
        expect(detailPanel?.querySelector('dl')).not.toBeNull();

        // Collapse via click - detail panel disappears.
        await act(async () => {
            const btn = toggleButtons[0];
            if (btn) fireEvent.click(btn);
        });
        expect(toggleButtons[0]?.getAttribute('aria-expanded')).toBe('false');
        expect(container.querySelector('section[aria-label^="Detail for"]')).toBeNull();
    });

    test('system event name and actor scopes serialize into the server query (0375 R1/R3)', () => {
        const base = {
            selectedPrefixes: new Set<string>(),
            tierFilter: 'all' as const,
            timeWindow: 'all' as const,
            runId: '',
        };
        const nameUrl = historyUrl(serializeFilter({ ...base, searchQuery: 'task.created', searchScope: 'name' }));
        const actorUrl = historyUrl(serializeFilter({ ...base, searchQuery: 'operator', searchScope: 'actor' }));

        expect(nameUrl).toContain('names=task.created');
        expect(actorUrl).toContain('actor=operator');
    });

    test('system event row exposes run/action/outcome and explicit unavailable usage (0375 R2/R3)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/events/history')) {
                return jsonResponse({
                    events: [
                        {
                            id: 'evt-correlated',
                            eventName: 'workflow.action.done',
                            occurredAt: '2026-07-29T12:00:00.000Z',
                            actor: 'runner',
                            runId: 'run-42',
                            payload: {
                                actionId: 'action-7',
                                durationMs: 125,
                                outcome: 'success',
                                usage: null,
                            },
                        },
                    ],
                    count: 1,
                    catalog: [
                        {
                            name: 'workflow.action.done',
                            prefix: 'workflow',
                            source: 'workflow',
                            renderer: 'workflow-action',
                        },
                    ],
                    nextCursor: null,
                    hasMore: false,
                });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const view = render(<SystemEventsTab />);
        await waitFor(() => expect(view.getByText('workflow.action.done')).toBeDefined());
        const row = view.getByText('workflow.action.done').closest('tr') as HTMLTableRowElement;
        expect(row.textContent).toContain('run-42');
        expect(row.textContent).toContain('action-7');
        expect(row.textContent).toContain('success');
        expect(row.textContent).toContain('125ms');

        fireEvent.click(row.querySelector('button[aria-expanded]') as HTMLButtonElement);
        const detail = view.container.querySelector('section[aria-label="Detail for workflow.action.done"]');
        expect(detail?.textContent).toContain('usage: unavailable');
        expect(detail?.textContent).not.toContain('usage: 0');
    });

    test('event name hover tooltip renders the original payload JSON', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/events/history')) {
                return jsonResponse({
                    events: [
                        {
                            id: 'evt-tip',
                            eventName: 'queue.job.completed',
                            occurredAt: '2026-07-29T17:02:26.000Z',
                            actor: null,
                            runId: null,
                            payload: {
                                jobId: 'job-tip-1',
                                type: 'system-events-prune',
                            },
                        },
                    ],
                    count: 1,
                    catalog: [
                        {
                            name: 'queue.job.completed',
                            prefix: 'queue',
                            source: 'queue',
                            renderer: 'metadata-only',
                        },
                    ],
                    nextCursor: null,
                    hasMore: false,
                });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const view = render(<SystemEventsTab />);
        await waitFor(() => expect(view.getByTestId('system-event-name')).toBeDefined());
        // Hover the event name to open the ephemeral tooltip.
        fireEvent.mouseEnter(view.getByTestId('system-event-name'));
        const tip = await waitFor(() => view.getByTestId('system-event-payload-tooltip'));
        expect(tip.getAttribute('role')).toBe('tooltip');
        expect(tip.getAttribute('data-pinned')).toBe('false');
        expect(tip.textContent).toContain('job-tip-1');
        expect(tip.textContent).toContain('system-events-prune');
        // Pretty-printed JSON shape
        expect(tip.textContent).toContain('jobId');
    });

    test('payload tooltip pins on outside click and unlocks on Esc', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/events/history')) {
                return jsonResponse({
                    events: [
                        {
                            id: 'evt-pin',
                            eventName: 'queue.job.enqueued',
                            occurredAt: '2026-07-29T17:02:26.000Z',
                            actor: null,
                            runId: null,
                            payload: { jobId: 'job-pin-1', type: 'smoke' },
                        },
                    ],
                    count: 1,
                    catalog: [
                        {
                            name: 'queue.job.enqueued',
                            prefix: 'queue',
                            source: 'queue',
                            renderer: 'metadata-only',
                        },
                    ],
                    nextCursor: null,
                    hasMore: false,
                });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const view = render(<SystemEventsTab />);
        await waitFor(() => expect(view.getByTestId('system-event-name')).toBeDefined());

        // Primary pin trigger: click the event name (no need to leave the hover target).
        // Pinned tips portal to document.body.
        fireEvent.click(view.getByTestId('system-event-name'));
        await waitFor(() => {
            const tip = document.querySelector('[data-testid="system-event-payload-tooltip"]');
            expect(tip?.getAttribute('data-pinned')).toBe('true');
        });
        const pinnedTip = document.querySelector('[data-testid="system-event-payload-tooltip"]') as HTMLElement;
        expect(pinnedTip.className).toContain('pointer-events-auto');
        expect(pinnedTip.textContent).toContain('job-pin-1');
        expect(pinnedTip.textContent).toContain('select to copy');

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await waitFor(() => expect(document.querySelector('[data-testid="system-event-payload-tooltip"]')).toBeNull());
    });

    test('payload tooltip Pin control locks the tip while hovering', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/events/history')) {
                return jsonResponse({
                    events: [
                        {
                            id: 'evt-pin-btn',
                            eventName: 'queue.job.completed',
                            occurredAt: '2026-07-29T17:02:26.000Z',
                            actor: null,
                            runId: null,
                            payload: { jobId: 'job-pin-btn', type: 'smoke' },
                        },
                    ],
                    count: 1,
                    catalog: [
                        {
                            name: 'queue.job.completed',
                            prefix: 'queue',
                            source: 'queue',
                            renderer: 'metadata-only',
                        },
                    ],
                    nextCursor: null,
                    hasMore: false,
                });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const view = render(<SystemEventsTab />);
        await waitFor(() => expect(view.getByTestId('system-event-name')).toBeDefined());
        fireEvent.mouseEnter(view.getByTestId('system-event-name'));
        const pinBtn = await waitFor(() => view.getByTestId('system-event-payload-tooltip-pin'));
        fireEvent.click(pinBtn);
        await waitFor(() => {
            const tip = document.querySelector('[data-testid="system-event-payload-tooltip"]');
            expect(tip?.getAttribute('data-pinned')).toBe('true');
        });
        expect(document.querySelector('[data-testid="system-event-payload-tooltip"]')?.textContent).toContain(
            'job-pin-btn',
        );
    });

    test('queue.job rows surface jobId/type and derived outcome instead of stacked unavailable (layout fix)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/events/history')) {
                return jsonResponse({
                    events: [
                        {
                            id: 'evt-queue',
                            eventName: 'queue.job.completed',
                            occurredAt: '2026-07-29T17:02:26.000Z',
                            actor: null,
                            runId: null,
                            payload: {
                                jobId: 'ea874dc4-cb7f-4bd1-bb47-fbe3c175b737',
                                type: 'system-events-prune',
                            },
                        },
                    ],
                    count: 1,
                    catalog: [
                        {
                            name: 'queue.job.completed',
                            prefix: 'queue',
                            source: 'queue',
                            renderer: 'metadata-only',
                            tier: 'diagnostic',
                        },
                    ],
                    nextCursor: null,
                    hasMore: false,
                });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const view = render(<SystemEventsTab />);
        await waitFor(() => expect(view.getByText('queue.job.completed')).toBeDefined());
        const row = view.getByText('queue.job.completed').closest('tr') as HTMLTableRowElement;
        expect(row.textContent).toContain('ea874dc4-cb7f-4bd1-bb47-fbe3c175b737');
        expect(row.textContent).toContain('system-events-prune');
        expect(row.textContent).toContain('completed');
        // Must not double-stack the unavailable labels that broke the Run column layout.
        expect(row.textContent).not.toContain('run: unavailable');
        expect(row.textContent).not.toContain('action: unavailable');
    });

    test('filter bar controls are keyboard-focusable native elements (task 0225 R4)', async () => {
        installObservabilityFetchMock();
        const { container, queryAllByText } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        // Prefix pills are <button> (native keyboard focus).
        const prefixButtons = container.querySelectorAll('fieldset[aria-label="Filter by prefix"] button');
        expect(prefixButtons.length).toBeGreaterThan(0);
        // Segmented toggles use <input type="radio"> (native keyboard focus).
        const radios = container.querySelectorAll('fieldset[aria-label="Tier"] input[type="radio"]');
        expect(radios.length).toBe(3);
        // Scope selector is a native <select>.
        expect(container.querySelector('select')).not.toBeNull();
    });

    test('inbox tab renders sender recipient timestamp metadata and reply grouping', async () => {
        installObservabilityFetchMock();
        const { getByText, container } = render(<InboxTab />);

        await waitFor(() => expect(getByText('Please review the observability board.')).toBeDefined());
        expect(getByText('Review complete.')).toBeDefined();

        const text = container.querySelector('[data-inbox-tab]')?.textContent ?? '';
        expect(text).toContain('operator');
        expect(text).toContain('worker');
        expect(text).toContain('2026-07-04T20:01:00.000Z');
        expect(text).toContain('reply to msg-1');
    });

    test('inbox tab refetches and shows unread badge on message.sent SSE event (live tail)', async () => {
        // Dynamic inbox mock: starts with one message; flips to two after a flag is set
        // so the refetch triggered by the message.sent event surfaces the new row.
        let secondMessageVisible = false;
        const inboxCalls: string[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/messages/inbox')) {
                inboxCalls.push(url);
                const messages = [
                    {
                        id: 'msg-1',
                        fromId: 'operator',
                        toId: 'worker',
                        body: 'initial',
                        status: 'sent',
                        createdAt: '2026-07-04T20:01:00.000Z',
                        inReplyTo: null,
                    },
                    ...(secondMessageVisible
                        ? [
                              {
                                  id: 'msg-2',
                                  fromId: 'worker',
                                  toId: 'operator',
                                  body: 'live-arrived',
                                  status: 'sent',
                                  createdAt: '2026-07-04T20:05:00.000Z',
                                  inReplyTo: 'msg-1',
                              },
                          ]
                        : []),
                ];
                return jsonResponse({ messages, count: messages.length });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const { getByText, container } = render(<InboxTab />);

        // Initial load: one message.
        await waitFor(() => expect(getByText('initial')).toBeDefined());
        expect(container.querySelector('[data-inbox-unread]')).toBeNull();
        const callsBefore = inboxCalls.length;

        // A new message lands server-side; fire the SSE event the board emits for it.
        secondMessageVisible = true;
        await act(async () => {
            FakeEventSource.instances[0]?.onmessage?.(
                new MessageEvent('message', {
                    data: JSON.stringify({
                        eventName: 'message.sent',
                        occurredAt: '2026-07-04T20:05:00.000Z',
                        actor: 'operator',
                        payload: {
                            msgId: 'msg-2',
                            fromId: 'worker',
                            toId: 'operator',
                            threadId: null,
                            createdAt: '2026-07-04T20:05:00.000Z',
                        },
                    }),
                }),
            );
        });

        // The event triggered a refetch and the new row appears without a page refresh.
        await waitFor(() => expect(getByText('live-arrived')).toBeDefined());
        expect(inboxCalls.length).toBeGreaterThan(callsBefore);
        // Unread badge surfaced (cleared on focus — not triggered here).
        await waitFor(() => expect(container.querySelector('[data-inbox-unread]')?.textContent).toContain('1 new'));
    });

    test('inbox tab ignores non-message SSE events (no spurious refetch)', async () => {
        const inboxCalls: string[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/messages/inbox')) {
                inboxCalls.push(url);
                return jsonResponse({
                    messages: [
                        {
                            id: 'msg-1',
                            fromId: 'operator',
                            toId: 'worker',
                            body: 'only',
                            status: 'sent',
                            createdAt: '2026-07-04T20:01:00.000Z',
                            inReplyTo: null,
                        },
                    ],
                    count: 1,
                });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const { container } = render(<InboxTab />);
        await waitFor(() => expect(container.querySelector('[data-inbox-tab]')).not.toBeNull());
        const callsBefore = inboxCalls.length;

        await act(async () => {
            FakeEventSource.instances[0]?.onmessage?.(
                new MessageEvent('message', {
                    data: JSON.stringify({
                        eventName: 'task.updated',
                        occurredAt: '2026-07-04T20:06:00.000Z',
                        actor: 'operator',
                        payload: { status: 'done' },
                    }),
                }),
            );
        });

        // Non-message event did not trigger an inbox refetch.
        expect(inboxCalls.length).toBe(callsBefore);
        expect(container.querySelector('[data-inbox-unread]')).toBeNull();
    });

    test('process list renders inventory rows from observability endpoint', async () => {
        const processes = [
            {
                pid: 100,
                ppid: 1,
                depth: 0,
                source: 'serve' as const,
                label: 'spur serve',
                command: 'bun apps/cli serve --port 8787',
                status: 'running',
                rssBytes: 50 * 1024 * 1024,
                elapsedSeconds: 120,
                startedAt: new Date(Date.now() - 120_000).toISOString(),
            },
            {
                pid: 123,
                ppid: 100,
                depth: 1,
                source: 'supervisor' as const,
                label: 'planner',
                agentId: 'planner',
                command: 'bun agent run --agent planner',
                status: 'running',
                rssBytes: 20 * 1024 * 1024,
                elapsedSeconds: 90,
                startedAt: new Date(Date.now() - 90_000).toISOString(),
            },
        ];
        const processCalls: string[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/observability/processes')) {
                processCalls.push(url);
                return jsonResponse({
                    processes,
                    rootPid: 100,
                    capturedAt: new Date().toISOString(),
                });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const { getByText, container } = render(<ProcessListTab />);
        await waitFor(() => expect(getByText('planner')).toBeDefined());
        expect(getByText('spur serve')).toBeDefined();
        expect(container.querySelector('[data-process-list-tab]')?.textContent).toContain('root pid=100');
        expect(container.querySelector('[data-process-list-tab]')?.textContent).toContain('running');
        expect(processCalls.length).toBeGreaterThanOrEqual(1);
    });

    test('process list shows serve root even without supervised agents', async () => {
        setFetchForTesting((async () =>
            jsonResponse({
                processes: [
                    {
                        pid: 42,
                        ppid: 1,
                        depth: 0,
                        source: 'serve',
                        label: 'spur serve',
                        command: 'bun apps/cli serve',
                        status: 'running',
                        rssBytes: 1024,
                        elapsedSeconds: 10,
                        startedAt: null,
                    },
                ],
                rootPid: 42,
                capturedAt: new Date().toISOString(),
            })) as unknown as typeof fetch);
        const view = render(<ProcessListTab />);
        await waitFor(() => expect(view.getByText('spur serve')).toBeDefined());
        expect(view.container.querySelector('[data-process-list-tab]')?.textContent).toContain('root pid=42');
        expect(view.queryByText(/No supervised processes/)).toBeNull();
        view.unmount();
    });

    test('process list renders error state on fetch failure', async () => {
        setFetchForTesting((async () => new Response('nope', { status: 503 })) as unknown as typeof fetch);
        const failed = render(<ProcessListTab />);
        await waitFor(() =>
            expect(failed.getByRole('alert').textContent).toContain('process inventory fetch failed: 503'),
        );
    });

    test('tool using tab renders events newest-first with Live toggle', async () => {
        const events = [
            {
                seq: 0,
                ts: '2026-07-12T12:02:00.000Z',
                session: 'session-a',
                type: 'write',
                file: '/Users/robin/proj/src/a.ts',
                tokens: 5000,
                action: 'edit',
                agent: 'claude',
            },
            {
                seq: 1,
                ts: '2026-07-12T12:01:00.000Z',
                session: 'session-a',
                type: 'read',
                file: '/Users/robin/proj/src/a.ts',
                tokens: 10,
            },
            {
                seq: 2,
                ts: '2026-07-12T12:00:00.000Z',
                session: 'session-a',
                type: 'session_start',
            },
        ];
        const calls: string[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/observability/tool-use')) {
                calls.push(url);
                return jsonResponse({
                    events,
                    count: events.length,
                    limit: 200,
                    truncated: true,
                    path: '/proj/.spur/context/token-ledger.jsonl',
                    capturedAt: new Date().toISOString(),
                    sparseToolActivity: false,
                    nextBefore: '2026-07-12T12:00:00.000Z',
                });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const view = render(<ToolUsingTab />);
        await waitFor(() => expect(view.getByText('write')).toBeDefined());
        expect(view.container.querySelector('[data-tool-using-tab]')?.textContent).toContain('a.ts');
        expect(view.container.querySelector('[data-live-toggle]')).toBeDefined();
        expect(view.getByText('session_start')).toBeDefined();
        expect(view.getByText('read')).toBeDefined();
        // Column order: Type then Target (file basename or summary — task 0248)
        const header = view.container.querySelector('thead')?.textContent ?? '';
        expect(header.indexOf('Type')).toBeLessThan(header.indexOf('Target'));
        expect(header.indexOf('Target')).toBeLessThan(header.indexOf('Action'));
        // Thousands separator for tokens
        expect(view.container.textContent).toMatch(/5[,.]?000/);
        expect(view.getByText('claude')).toBeDefined();
        expect(view.container.querySelectorAll('[data-event-seq]').length).toBe(3);
        expect(calls.length).toBeGreaterThanOrEqual(1);
        // Load more control when nextBefore set
        expect(view.container.querySelector('[data-load-more]')).toBeDefined();

        // Live off closes SSE (FakeEventSource) — toggle off and ensure no crash.
        const toggle = view.container.querySelector('[data-live-toggle]') as HTMLInputElement;
        await act(async () => {
            fireEvent.click(toggle);
        });
        expect(toggle.checked).toBe(false);
        view.unmount();
    });

    test('tool using tab shows sparse banner when only session markers', async () => {
        setFetchForTesting((async () =>
            jsonResponse({
                events: [
                    { seq: 0, ts: '2026-07-12T12:00:00.000Z', session: 's', type: 'session_end' },
                    { seq: 1, ts: '2026-07-12T11:00:00.000Z', session: 's', type: 'session_start' },
                ],
                count: 2,
                limit: 200,
                truncated: false,
                path: '/proj/.spur/context/token-ledger.jsonl',
                capturedAt: new Date().toISOString(),
                sparseToolActivity: true,
                nextBefore: null,
            })) as unknown as typeof fetch);
        const view = render(<ToolUsingTab />);
        await waitFor(() => expect(view.container.querySelector('[data-sparse-banner]')).toBeDefined());
        expect(view.container.querySelector('[data-sparse-banner]')?.textContent).toMatch(
            /Limited recent tool activity/,
        );
        view.unmount();
    });

    test('tool using tab Live SSE prepends tool-use frames', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/observability/tool-use') && !url.includes('stream')) {
                return jsonResponse({
                    events: [
                        {
                            seq: 0,
                            ts: '2026-07-12T12:00:00.000Z',
                            session: 's',
                            type: 'read',
                            file: '/x.ts',
                            tokens: 1,
                        },
                    ],
                    count: 1,
                    limit: 200,
                    truncated: false,
                    path: '/p/token-ledger.jsonl',
                    capturedAt: new Date().toISOString(),
                    sparseToolActivity: false,
                    nextBefore: null,
                });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        FakeEventSource.instances = [];
        const view = render(<ToolUsingTab />);
        await waitFor(() => expect(view.getByText('read')).toBeDefined());
        await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThanOrEqual(1));
        const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
        expect(es).toBeDefined();
        await act(async () => {
            es?.onopen?.(new Event('open'));
            es?.onmessage?.(
                new MessageEvent('message', {
                    data: JSON.stringify({
                        type: 'tool-use',
                        event: {
                            ts: '2026-07-12T12:01:00.000Z',
                            session: 's',
                            type: 'write',
                            file: '/y.ts',
                            action: 'create',
                            tokens: 2,
                        },
                    }),
                }),
            );
        });
        await waitFor(() => expect(view.getByText('write')).toBeDefined());
        view.unmount();
        expect(es?.closed).toBe(true);
    });

    test('tool using tab load more fetches before cursor', async () => {
        const calls: string[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            calls.push(url);
            if (url.includes('before=')) {
                return jsonResponse({
                    events: [
                        {
                            seq: 0,
                            ts: '2026-07-12T11:00:00.000Z',
                            session: 's',
                            type: 'read',
                            file: '/older.ts',
                            tokens: 1,
                        },
                    ],
                    count: 1,
                    limit: 200,
                    truncated: false,
                    path: '/p/token-ledger.jsonl',
                    capturedAt: new Date().toISOString(),
                    sparseToolActivity: false,
                    nextBefore: null,
                });
            }
            return jsonResponse({
                events: [
                    {
                        seq: 0,
                        ts: '2026-07-12T12:00:00.000Z',
                        session: 's',
                        type: 'read',
                        file: '/newer.ts',
                        tokens: 1,
                    },
                ],
                count: 1,
                limit: 200,
                truncated: true,
                path: '/p/token-ledger.jsonl',
                capturedAt: new Date().toISOString(),
                sparseToolActivity: false,
                nextBefore: '2026-07-12T12:00:00.000Z',
            });
        }) as unknown as typeof fetch);

        const view = render(<ToolUsingTab />);
        await waitFor(() => expect(view.getByText('newer.ts')).toBeDefined());
        const btn = view.container.querySelector('[data-load-more]') as HTMLButtonElement;
        expect(btn).toBeDefined();
        await act(async () => {
            fireEvent.click(btn);
        });
        await waitFor(() => expect(view.getByText('older.ts')).toBeDefined());
        expect(
            calls.some(
                (u) =>
                    u.includes('before=2026-07-12T12%3A00%3A00.000Z') || u.includes('before=2026-07-12T12:00:00.000Z'),
            ),
        ).toBe(true);
        view.unmount();
    });

    test('tool using tab shows calm empty state', async () => {
        setFetchForTesting((async () =>
            jsonResponse({
                events: [],
                count: 0,
                limit: 200,
                truncated: false,
                path: '/proj/.spur/context/token-ledger.jsonl',
                capturedAt: new Date().toISOString(),
            })) as unknown as typeof fetch);
        const view = render(<ToolUsingTab />);
        await waitFor(() => expect(view.getByText(/No tool-use events yet/)).toBeDefined());
        expect(view.queryByRole('alert')).toBeNull();
        view.unmount();
    });

    test('tool using tab renders hard error when no snapshot yet', async () => {
        setFetchForTesting((async () => new Response('nope', { status: 503 })) as unknown as typeof fetch);
        const failed = render(<ToolUsingTab />);
        await waitFor(() => expect(failed.getByRole('alert').textContent).toContain('tool-use fetch failed: 503'));
    });

    test('jobs tab fetches queue and scheduler events via server-side prefix filter (R9)', async () => {
        const calls = installObservabilityFetchMock();
        render(<JobsTab />);

        await waitFor(() => expect(calls.some((url) => url.includes('prefix=queue'))).toBe(true));
        expect(calls.some((url) => url.includes('prefix=scheduler'))).toBe(true);
        // No unfiltered history call - jobs tab never slices a client-side page.
        expect(calls.some((url) => url.includes('/events/history?limit=50') && !url.includes('prefix='))).toBe(false);
    });

    test('jobs tab renders structured job fields not raw JSON blob (R2/R10)', async () => {
        // Custom mock with failed/retrying events that carry attempt + error.
        const calls: string[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            calls.push(url);
            if (url.includes('prefix=queue')) {
                return jsonResponse({
                    events: [
                        {
                            id: 'q1',
                            eventName: 'queue.job.failed',
                            occurredAt: '2026-07-04T20:10:00.000Z',
                            actor: null,
                            payload: { jobId: 'job-42', type: 'indexer', error: 'ECONNREFUSED', attempt: 3 },
                        },
                        {
                            id: 'q2',
                            eventName: 'queue.job.retrying',
                            occurredAt: '2026-07-04T20:09:00.000Z',
                            actor: null,
                            payload: { jobId: 'job-42', type: 'indexer', attempt: 2, nextRetryAt: 1783267800000 },
                        },
                    ],
                    count: 2,
                    catalog: [],
                });
            }
            if (url.includes('prefix=scheduler')) {
                return jsonResponse({
                    events: [
                        {
                            id: 's1',
                            eventName: 'scheduler.job.executed',
                            occurredAt: '2026-07-04T20:08:00.000Z',
                            actor: null,
                            payload: { name: 'cleanup', durationMs: 1250 },
                        },
                    ],
                    count: 1,
                    catalog: [],
                });
            }
            if (url.includes('/jobs/stats')) {
                return jsonResponse({ stats: { pending: 0, processing: 1, completed: 5, failed: 1 } });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const { getByText, queryByText } = render(<JobsTab />);

        // Job identity surfaces as a scannable field.
        await waitFor(() => expect(getByText('job-42')).toBeDefined());
        // State badge - "failed" state renders.
        expect(getByText('failed')).toBeDefined();
        // Attempt count surfaces as a first-class field.
        expect(getByText('3')).toBeDefined();
        // Failure reason surfaces as text, not buried in JSON.
        expect(getByText('ECONNREFUSED')).toBeDefined();
        // Scheduler duration surfaces.
        expect(getByText('1.3s')).toBeDefined();
        // Queue story duration is derived from the oldest to newest correlated event.
        expect(getByText('60.0s')).toBeDefined();
        // Raw JSON blob should NOT be visible by default (collapsed in <details>).
        expect(queryByText('"jobId"')).toBeNull();
    });

    test('jobs tab renders explicit empty state when no job events match (R5/R12)', async () => {
        const calls: string[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            calls.push(url);
            if (url.includes('/events/history')) {
                return jsonResponse({ events: [], count: 0, catalog: [] });
            }
            if (url.includes('/jobs/stats')) {
                return jsonResponse({ stats: { pending: 0, processing: 0, completed: 0, failed: 0 } });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const { getByText } = render(<JobsTab />);

        await waitFor(() => expect(getByText(/No job events yet/)).toBeDefined());
        // Stats cards still render even with empty event list.
        expect(getByText('Pending')).toBeDefined();
    });

    test('jobs tab renders queue counters from /api/jobs/stats (R4/R11)', async () => {
        const calls: string[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            calls.push(url);
            if (url.includes('/events/history')) {
                return jsonResponse({ events: [], count: 0, catalog: [] });
            }
            if (url.includes('/jobs/stats')) {
                return jsonResponse({ stats: { pending: 7, processing: 3, completed: 42, failed: 2 } });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const { getByText } = render(<JobsTab />);

        await waitFor(() => expect(getByText('Pending')).toBeDefined());
        expect(getByText('7')).toBeDefined();
        expect(getByText('3')).toBeDefined();
        expect(getByText('42')).toBeDefined();
        expect(getByText('2')).toBeDefined();
    });

    // -----------------------------------------------------------------------
    // TasksTab (task 0377) - pipeline run list backed by run store
    // -----------------------------------------------------------------------

    function installTasksFetchMock(opts?: {
        runs?: unknown[];
        runDetail?: Record<string, unknown>;
        tasks?: unknown[];
        wbsLinks?: Record<string, unknown[]>;
        corpusTaskEvents?: unknown[];
        corpusFeatureEvents?: unknown[];
        runDetailStatus?: number;
    }): string[] {
        const calls: string[] = [];
        const runs = opts?.runs ?? [
            {
                id: 'run-1',
                workflowName: 'task-pipeline',
                status: 'completed',
                mode: 'auto',
                agent: 'omp',
                startedAt: '2026-07-04T20:00:00.000Z',
                completedAt: '2026-07-04T20:05:00.000Z',
            },
            {
                id: 'run-2',
                workflowName: null,
                status: 'running',
                mode: null,
                agent: null,
                startedAt: '2026-07-04T20:10:00.000Z',
                completedAt: null,
            },
        ];
        const tasks = opts?.tasks ?? [{ wbs: '0377' }];
        const wbsLinks = opts?.wbsLinks ?? {
            '0377': [{ runId: 'run-1', kind: 'task', linkedAt: '2026-07-04T20:00:01.000Z', run: runs[0] }],
        };
        const runDetail = opts?.runDetail ?? {
            run: runs[0],
            phases: [
                {
                    phase: 'precheck',
                    status: 'completed',
                    startedAt: '2026-07-04T20:00:00.000Z',
                    completedAt: '2026-07-04T20:00:30.000Z',
                },
                {
                    phase: 'implement',
                    status: 'completed',
                    startedAt: '2026-07-04T20:00:30.000Z',
                    completedAt: '2026-07-04T20:03:00.000Z',
                },
                {
                    phase: 'review',
                    status: 'failed',
                    startedAt: '2026-07-04T20:03:00.000Z',
                    completedAt: '2026-07-04T20:04:00.000Z',
                },
                { phase: 'verify', status: 'pending', startedAt: null, completedAt: null },
            ],
            transitions: [
                { from: 'precheck', to: 'implement', trigger: 'auto' },
                { from: 'implement', to: 'review', trigger: 'auto' },
            ],
            actions: [
                {
                    id: 'a1',
                    node: 'precheck',
                    kind: 'gate',
                    status: 'completed',
                    durationMs: 300,
                    ok: true,
                    resultSummary: 'all clear',
                    startedAt: '2026-07-04T20:00:00.000Z',
                    completedAt: '2026-07-04T20:00:30.000Z',
                },
                {
                    id: 'a2',
                    node: 'review',
                    kind: 'review',
                    status: 'failed',
                    durationMs: 5000,
                    ok: false,
                    resultSummary: { error: 'lint errors found' },
                    startedAt: '2026-07-04T20:03:00.000Z',
                    completedAt: '2026-07-04T20:04:00.000Z',
                },
            ],
        };
        const corpusTaskEvents = opts?.corpusTaskEvents ?? [
            {
                id: 'ce-1',
                eventName: 'task.updated',
                occurredAt: '2026-07-04T20:02:00.000Z',
                actor: 'operator',
                payload: { wbs: '0377', status: 'wip' },
            },
        ];
        const corpusFeatureEvents = opts?.corpusFeatureEvents ?? [
            {
                id: 'ce-2',
                eventName: 'feature.created',
                occurredAt: '2026-07-04T20:01:00.000Z',
                actor: 'operator',
                payload: { id: 'J4' },
            },
        ];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            calls.push(url);
            // R1: run list
            if (url.includes('/runs?limit=') && !url.includes('/by-wbs/')) {
                return jsonResponse({ runs, count: runs.length, nextCursor: null, hasMore: false });
            }
            // R2/R3: run detail
            if (url.match(/\/runs\/[^/]+$/) && !url.includes('by-wbs')) {
                if (opts?.runDetailStatus && opts.runDetailStatus !== 200) {
                    return new Response(JSON.stringify({ error: 'detail fetch failed' }), {
                        status: opts.runDetailStatus,
                        headers: { 'content-type': 'application/json' },
                    });
                }
                return jsonResponse(runDetail);
            }
            // WBS index: task list
            if (url.includes('/tasks?limit=')) {
                return jsonResponse({ items: tasks });
            }
            // WBS index: by-wbs links
            if (url.includes('/runs/by-wbs/')) {
                const wbs = url.split('/runs/by-wbs/')[1]?.split('?')[0];
                const links = wbsLinks[wbs ?? ''] ?? [];
                return jsonResponse({ wbs, links, count: links.length });
            }
            // R4: corpus lane - task events
            if (url.includes('prefix=task')) {
                return jsonResponse({ events: corpusTaskEvents, count: corpusTaskEvents.length, catalog: [] });
            }
            // R4: corpus lane - feature events
            if (url.includes('prefix=feature')) {
                return jsonResponse({ events: corpusFeatureEvents, count: corpusFeatureEvents.length, catalog: [] });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);
        return calls;
    }

    test('tasks tab lists pipeline runs with WBS link, workflow name, status, start time (R1)', async () => {
        installTasksFetchMock();
        const { getByText, queryAllByText } = render(<TasksTab />);

        await waitFor(() => expect(queryAllByText('task-pipeline').length).toBeGreaterThan(0));
        // R1: linked WBS badge (appears in run row + possibly corpus lane)
        expect(queryAllByText('0377').length).toBeGreaterThan(0);
        // R1: workflow name
        expect(getByText('task-pipeline')).toBeDefined();
        // R1: status badge
        expect(getByText('completed')).toBeDefined();
        // R1: unlinked run shows "unlinked" badge
        expect(getByText('unlinked')).toBeDefined();
    });

    test('tasks tab expands a run into ordered phase progress with active/completed/failed (R2)', async () => {
        installTasksFetchMock();
        const { getByText, queryAllByText, container } = render(<TasksTab />);

        await waitFor(() => expect(queryAllByText('task-pipeline').length).toBeGreaterThan(0));

        // Click the run row to expand
        const runRow = container.querySelector('[data-tasks-tab] button[aria-expanded="false"]');
        expect(runRow).not.toBeNull();
        fireEvent.click(runRow as Element);

        // R2: phases render in order with status distinction
        await waitFor(() => expect(getByText('Phases')).toBeDefined());
        expect(queryAllByText('precheck').length).toBeGreaterThan(0);
        expect(queryAllByText('implement').length).toBeGreaterThan(0);
        expect(queryAllByText('review').length).toBeGreaterThan(0);
        expect(queryAllByText('verify').length).toBeGreaterThan(0);
        // R2: failed phase is distinguishable (error badge)
        expect(queryAllByText('failed').length).toBeGreaterThan(0);
    });

    test('tasks tab shows per-action log with node, kind, status, duration, failure reason (R3)', async () => {
        installTasksFetchMock();
        const { getByText, queryAllByText, container } = render(<TasksTab />);

        await waitFor(() => expect(queryAllByText('task-pipeline').length).toBeGreaterThan(0));

        const runRow = container.querySelector('[data-tasks-tab] button[aria-expanded="false"]');
        fireEvent.click(runRow as Element);

        // R3: action log renders
        await waitFor(() => expect(getByText('Action Log')).toBeDefined());
        // R3: node name (also appears as phase name, so queryAll)
        expect(queryAllByText('precheck').length).toBeGreaterThan(0);
        // R3: kind badge
        expect(getByText('gate')).toBeDefined();
        expect(queryAllByText('review').length).toBeGreaterThan(0);
        // R3: duration formatted (300ms)
        expect(getByText('300ms')).toBeDefined();
        // R3: failure reason from resultSummary.error
        expect(getByText('lint errors found')).toBeDefined();
    });

    test('tasks tab renders secondary corpus lane with task.*/feature.* events (R4)', async () => {
        installTasksFetchMock();
        const { getByText, queryAllByText } = render(<TasksTab />);

        await waitFor(() => expect(queryAllByText('task-pipeline').length).toBeGreaterThan(0));

        // R4: corpus lane is visually distinct (dashed border, "corpus-only" badge)
        await waitFor(() => expect(getByText('Corpus Activity')).toBeDefined());
        expect(getByText('corpus-only')).toBeDefined();
        // R4: task.* event
        expect(getByText('task.updated')).toBeDefined();
        // R4: feature.* event
        expect(getByText('feature.created')).toBeDefined();
    });

    test('tasks tab degrades per-row when run detail fetch fails (R5)', async () => {
        installTasksFetchMock({ runDetailStatus: 500 });
        const { getByText, queryAllByText, container } = render(<TasksTab />);

        await waitFor(() => expect(queryAllByText('task-pipeline').length).toBeGreaterThan(0));

        const runRow = container.querySelector('[data-tasks-tab] button[aria-expanded="false"]');
        fireEvent.click(runRow as Element);

        // R5: inline error shows, list stays usable
        await waitFor(() => expect(getByText(/Failed to load run detail/)).toBeDefined());
        // List is still visible
        expect(getByText('task-pipeline')).toBeDefined();
    });

    test('tasks tab narrows untrusted run list input - malformed entries dropped (R7)', async () => {
        installTasksFetchMock({
            runs: [
                {
                    id: 'run-good',
                    workflowName: 'valid',
                    status: 'completed',
                    mode: 'auto',
                    agent: 'omp',
                    startedAt: '2026-07-04T20:00:00.000Z',
                    completedAt: null,
                },
                { id: 12345, workflowName: 'bad-id-type' }, // missing required fields + wrong types
                { id: 'run-no-status', workflowName: 'missing-status' }, // missing status
                null, // null entry
                'string-not-object', // wrong type
            ],
        });
        const { queryAllByText, getByText } = render(<TasksTab />);

        await waitFor(() => expect(queryAllByText('valid').length).toBeGreaterThan(0));
        // R7: only the valid run renders
        expect(getByText('valid')).toBeDefined();
        expect(queryAllByText('bad-id-type')).toHaveLength(0);
        expect(queryAllByText('missing-status')).toHaveLength(0);
    });

    test('tasks tab narrows untrusted run detail - malformed phases/actions dropped (R7)', async () => {
        installTasksFetchMock({
            runDetail: {
                run: {
                    id: 'run-1',
                    workflowName: 'task-pipeline',
                    status: 'completed',
                    mode: 'auto',
                    agent: 'omp',
                    startedAt: '2026-07-04T20:00:00.000Z',
                    completedAt: null,
                },
                phases: [
                    {
                        phase: 'precheck',
                        status: 'completed',
                        startedAt: '2026-07-04T20:00:00.000Z',
                        completedAt: null,
                    },
                    { phase: 123, status: 'bad-phase-type' }, // wrong type
                    null, // null phase
                    'string', // wrong type
                ],
                transitions: [],
                actions: [
                    {
                        id: 'a1',
                        node: 'precheck',
                        kind: 'gate',
                        status: 'completed',
                        durationMs: 300,
                        ok: true,
                        resultSummary: null,
                        startedAt: null,
                        completedAt: null,
                    },
                    { id: 999, node: 'bad-action' }, // missing fields
                    null,
                ],
            },
        });
        const { getByText, queryAllByText, container } = render(<TasksTab />);

        await waitFor(() => expect(queryAllByText('task-pipeline').length).toBeGreaterThan(0));

        const runRow = container.querySelector('[data-tasks-tab] button[aria-expanded="false"]');
        fireEvent.click(runRow as Element);

        await waitFor(() => expect(getByText('Phases')).toBeDefined());
        // R7: only valid phase renders
        expect(queryAllByText('precheck').length).toBeGreaterThan(0);
        // R7: only valid action renders
        await waitFor(() => expect(getByText('Action Log')).toBeDefined());
        expect(getByText('gate')).toBeDefined();
    });

    test('tasks tab renders empty state when no runs exist (R1)', async () => {
        installTasksFetchMock({ runs: [], corpusTaskEvents: [], corpusFeatureEvents: [] });
        const { getByText } = render(<TasksTab />);

        await waitFor(() => expect(getByText(/No pipeline runs yet/)).toBeDefined());
    });

    test('tasks tab is registered in OBSERVABILITY_TABS (R6)', () => {
        const tasksTab = OBSERVABILITY_TABS.find((t) => t.id === 'tasks');
        expect(tasksTab).toBeDefined();
        expect(tasksTab?.label).toBe('Tasks');
    });
});
