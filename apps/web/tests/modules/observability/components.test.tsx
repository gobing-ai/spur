import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';

import InboxTab from '../../../src/modules/observability/InboxTab';
import ObservabilityShell from '../../../src/modules/observability/ObservabilityShell';
import ProcessListTab from '../../../src/modules/observability/ProcessListTab';
import SystemEventsTab from '../../../src/modules/observability/SystemEventsTab';
import { teardownHappyDom } from '../../happy-dom';

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

let originalFetch: typeof fetch;
let originalEventSource: typeof EventSource | undefined;

beforeAll(() => {
    try {
        GlobalRegistrator.register();
    } catch {} // already registered in suite
    originalFetch = globalThis.fetch;
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
    globalThis.fetch = originalFetch;
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
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('/events/history')) {
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
    }) as typeof fetch;
    return calls;
}

describe('observability components', () => {
    test('shell renders tab data and switches from system events to inbox messages', async () => {
        const calls = installObservabilityFetchMock();
        const { getByRole, queryAllByText, getByText, container } = render(<ObservabilityShell />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));
        expect(calls.some((url) => url.includes('/events/history?limit=100'))).toBe(true);

        fireEvent.click(getByRole('tab', { name: 'Inbox Messages' }));

        await waitFor(() => expect(getByText('Please review the observability board.')).toBeDefined());
        expect(getByText('Review complete.')).toBeDefined();
        expect(container.querySelector('[data-inbox-tab]')?.textContent).toContain('reply to msg-1');
        expect(calls.some((url) => url.includes('/messages/inbox?agent=operator&limit=50'))).toBe(true);

        fireEvent.click(getByRole('tab', { name: 'Jobs' }));

        await waitFor(() => expect(queryAllByText('queue.job.completed').length).toBeGreaterThan(0));
        expect(getByText('Pending')).toBeDefined();
        expect(getByText('2')).toBeDefined();
        expect(calls.some((url) => url.includes('/jobs/stats'))).toBe(true);
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

    test('system events tab renders a table with sticky header and the 5 columns (task 0223 R1/R3)', async () => {
        installObservabilityFetchMock();
        const { container, queryAllByText } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        const table = container.querySelector('[data-system-events-tab] table');
        expect(table).not.toBeNull();
        const thead = table?.querySelector('thead');
        expect(thead?.className).toContain('sticky');
        const headers = table?.querySelectorAll('thead th');
        const headerLabels = Array.from(headers ?? []).map((th) => th.textContent?.trim());
        expect(headerLabels).toEqual(['Time', 'Event', 'Actor', 'Prefix', 'Tier']);
    });

    test('event names are colored by a stable prefix-to-color map (task 0223 R4/R5/R6)', async () => {
        installObservabilityFetchMock();
        const { queryAllByText } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        // R4: `task` prefix maps to a fixed color, not a hash. The text-color
        // class is deterministic across renders.
        const taskName = queryAllByText('task.created').find((n) => n.tagName === 'SPAN');
        expect(taskName?.className).toContain('text-emerald-400');
        const queueName = queryAllByText('queue.job.completed').find((n) => n.tagName === 'SPAN');
        expect(queueName?.className).toContain('text-orange-400');

        // R5: the prefix label is always rendered alongside the color in the
        // dedicated Prefix column.
        expect(queryAllByText('task').length).toBeGreaterThan(0);
        expect(queryAllByText('queue').length).toBeGreaterThan(0);
    });

    test('event-name cell carries a tooltip with a typed summary, never raw JSON (task 0223 R8)', async () => {
        installObservabilityFetchMock();
        const { queryAllByText, container } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        // The tooltip element exists for the queue row (which has renderer
        // 'queue' + payload {jobId, type}) and surfaces `Job Kind` / `Job ID`.
        // We assert via the tooltip role since happy-dom does not propagate
        // group-hover CSS, but the tooltip is in the DOM.
        const tooltip = container.querySelector('[role="tooltip"]');
        expect(tooltip).not.toBeNull();
        // R8: tooltip contains the typed detail labels (e.g. "Job Kind:"),
        // NOT raw JSON. We assert no `<pre>` block with JSON.stringify output
        // appears inside any tooltip.
        const tooltips = container.querySelectorAll('[role="tooltip"]');
        for (const t of tooltips) {
            expect(t.querySelector('pre')).toBeNull();
        }
        // At least one tooltip has a `<dl>` (renderer summary rows).
        const tooltipWithDl = container.querySelector('[role="tooltip"] dl');
        expect(tooltipWithDl).not.toBeNull();
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
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = String(input);
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
        }) as typeof fetch;
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
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = String(input);
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
        }) as typeof fetch;
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
        const taskSpans = queryAllByText('task.created').filter((n) => n.tagName === 'SPAN');
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

    test('tooltip renders typed summary on event-name cell (task 0225 R3)', async () => {
        installObservabilityFetchMock();
        const { container, queryAllByText } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        // The tooltip has role="tooltip", is hidden by default, and reveals
        // on group-hover only (rows are no longer focusable).
        const tooltip = container.querySelector('[role="tooltip"]');
        expect(tooltip).not.toBeNull();
        expect(tooltip?.className).toContain('hidden');
        expect(tooltip?.className).toContain('group-hover:block');
        // Tooltip never exposes raw JSON (no <pre> element).
        expect(tooltip?.querySelector('pre')).toBeNull();
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
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = String(input);
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
        }) as typeof fetch;

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
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = String(input);
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
        }) as typeof fetch;

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

    test('process list renders rows and refetches on process SSE events', async () => {
        let rows: {
            agentId: string;
            pid: number | null;
            status: string;
            startedAt: string;
            exitCode: number | null;
        }[] = [
            {
                agentId: 'planner',
                pid: 123,
                status: 'running',
                startedAt: new Date(Date.now() - 90_000).toISOString(),
                exitCode: null,
            },
        ];
        const processCalls: string[] = [];
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/team/processes')) {
                processCalls.push(url);
                return jsonResponse({ processes: rows, count: rows.length });
            }
            return new Response('not found', { status: 404 });
        }) as typeof fetch;

        const { getByText, container } = render(<ProcessListTab />);
        await waitFor(() => expect(getByText('planner')).toBeDefined());
        expect(getByText('pid=123')).toBeDefined();
        expect(container.querySelector('[data-process-list-tab]')?.textContent).toContain('running');

        rows = [
            ...rows,
            {
                agentId: 'reviewer',
                pid: null,
                status: 'exited',
                startedAt: new Date(Date.now() + 1_000).toISOString(),
                exitCode: 0,
            },
        ];
        const before = processCalls.length;
        await act(async () => {
            FakeEventSource.instances[0]?.onmessage?.(
                new MessageEvent('message', {
                    data: JSON.stringify({ eventName: 'process.exited' }),
                }),
            );
        });

        await waitFor(() => expect(getByText('reviewer')).toBeDefined());
        expect(processCalls.length).toBeGreaterThan(before);
        expect(getByText('pid=?')).toBeDefined();
    });

    test('process list renders empty and error states', async () => {
        globalThis.fetch = (async () => jsonResponse({ processes: [], count: 0 })) as unknown as typeof fetch;
        const empty = render(<ProcessListTab />);
        await waitFor(() => expect(empty.getByText(/No supervised processes/)).toBeDefined());
        empty.unmount();

        globalThis.fetch = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
        const failed = render(<ProcessListTab />);
        await waitFor(() => expect(failed.getByRole('alert').textContent).toContain('process list fetch failed: 503'));
    });
});
