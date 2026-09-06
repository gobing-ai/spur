import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import ColumnCustomizer, {
    ALL_COLUMNS,
    DEFAULT_VISIBLE_COLUMNS,
    type EventColumnKey,
    loadVisibleColumns,
    saveVisibleColumns,
    validateColumnKeys,
} from '../../../src/modules/observability/ColumnCustomizer';
import JobsTab from '../../../src/modules/observability/JobsTab';
import {
    RETENTION_COPY,
    RetentionBadge,
    timeRangeSince,
} from '../../../src/modules/observability/ObservabilityFilters';
import ObservabilityShell from '../../../src/modules/observability/ObservabilityShell';
import ProcessListTab from '../../../src/modules/observability/ProcessListTab';
import SystemEventsTab, {
    CopyValueButton,
    historyUrl,
    SeverityLabel,
    type SystemEventRow,
    serializeFilter,
    sortEventRows,
    tooltipTitle,
} from '../../../src/modules/observability/SystemEventsTab';
import TasksTab from '../../../src/modules/observability/TasksTab';
import ToolUsingTab from '../../../src/modules/observability/ToolUsingTab';
import { OBSERVABILITY_TABS, type ObservabilityLiveness } from '../../../src/modules/observability/tabs';
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

function eventEnvelope({
    data = {},
    severity = 'info',
    summary = 'Event completed',
    description = 'The operation completed.',
    fields = [],
    correlation = {},
    outcome = 'completed',
    action,
    correlators,
    actionLabel,
    agent,
}: {
    data?: Record<string, unknown>;
    severity?: 'info' | 'warning' | 'error';
    summary?: string;
    description?: string;
    fields?: { label: string; value: string }[];
    correlation?: Record<string, unknown>;
    outcome?: string;
    action?: { label: string; kind: 'command' | 'filter' | 'path'; value: string };
    correlators?: string;
    actionLabel?: string;
    agent?: string;
} = {}): Record<string, unknown> {
    return {
        schemaVersion: 2,
        data,
        context: {
            project: { name: 'spur-new', root: '/workspace/spur-new' },
            producer: { package: 'spur', subsystem: 'test' },
            correlation,
        },
        presentation: {
            severity,
            summary,
            description,
            fields,
            outcome,
            ...(action ? { action } : {}),
            ...(correlators !== undefined ? { correlators } : {}),
            ...(actionLabel !== undefined ? { actionLabel } : {}),
            ...(agent !== undefined ? { agent } : {}),
        },
    };
}

let originalEventSource: typeof EventSource | undefined;

beforeAll(() => {
    registerHappyDom();
    originalEventSource = globalThis.EventSource;
});

beforeEach(() => {
    FakeEventSource.instances = [];
    window.localStorage.clear();
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
                            payload: eventEnvelope({
                                data: { jobId: 'job-1', type: 'smoke' },
                                fields: [{ label: 'Job', value: 'job-1' }],
                                correlation: { jobId: 'job-1' },
                            }),
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
                            payload: eventEnvelope({ data: { name: 'cleanup', durationMs: 250 } }),
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
                        payload: eventEnvelope({
                            data: { jobId: 'job-1', type: 'smoke' },
                            fields: [{ label: 'Job', value: 'job-1' }],
                            correlation: { jobId: 'job-1' },
                        }),
                    },
                    {
                        id: 'event-1',
                        eventName: 'task.created',
                        occurredAt: '2026-07-04T20:00:00.000Z',
                        actor: 'operator',
                        payload: eventEnvelope({
                            data: { entity: { kind: 'task', id: '0199' } },
                            summary: 'Task created · 0199',
                            fields: [{ label: 'Task', value: '0199' }],
                        }),
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
    test('shell renders header, liveness chip, and switches from system events to jobs (J92 R1-R3, R6)', async () => {
        const calls = installObservabilityFetchMock();
        const { container, getByRole, queryAllByText, getByText, getByTestId } = render(<ObservabilityShell />);

        // R2: Header title, subtitle, icon, and liveness chip
        const shell = container.querySelector('[data-observability-shell]');
        expect(shell?.className).toContain('max-w-[1600px]');
        expect(shell?.className).toContain('mx-auto');
        expect(getByText('📡')).toBeDefined();
        expect(getByText('Observability')).toBeDefined();
        expect(getByText('System event streams, queue execution telemetry, and routing attribution')).toBeDefined();
        const chip = getByTestId('observability-liveness-chip');
        expect(chip).toBeDefined();

        const summaryTab = getByRole('tab', { name: 'Summary' });
        expect(summaryTab.getAttribute('aria-selected')).toBe('true');
        expect(summaryTab.getAttribute('aria-controls')).toBe('observability-tab-panel-summary');
        expect(getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('observability-tab-summary');
        expect(getByTestId('observability-summary-tab')).toBeDefined();

        // Switch to System Events tab
        const systemEventsTab = getByRole('tab', { name: 'System Events' });
        fireEvent.click(systemEventsTab);
        expect(systemEventsTab.getAttribute('aria-selected')).toBe('true');
        expect(systemEventsTab.getAttribute('aria-controls')).toBe('observability-tab-panel-system-events');
        expect(getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('observability-tab-system-events');

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));
        expect(calls.some((url) => url.includes('/events/history?limit=100'))).toBe(true);
        await waitFor(() =>
            expect(chip.querySelector('time')?.getAttribute('datetime')).toBe('2026-07-04T20:04:00.000Z'),
        );

        // One EventSource connection owned by SystemEventsTab, none by Shell
        expect(FakeEventSource.instances).toHaveLength(1);
        await act(async () => FakeEventSource.instances[0]?.onopen?.(new Event('open')));
        await waitFor(() => expect(chip.textContent).toContain('live tail · 0 evt/60s'));
        await act(async () => FakeEventSource.instances[0]?.onerror?.(new Event('error')));
        await waitFor(() => expect(chip.textContent).toContain('stream error'));
        expect(FakeEventSource.instances).toHaveLength(1);

        // Switch to Jobs tab
        fireEvent.click(getByRole('tab', { name: 'Jobs' }));

        // R6: Non-system-events tab displays honest idle state on the shell chip
        expect(getByTestId('observability-liveness-chip').textContent).toContain('live tail idle');
        expect(getByTestId('observability-liveness-chip').querySelector('time')).toBeNull();
        expect(getByRole('tab', { name: 'Jobs' }).getAttribute('aria-selected')).toBe('true');
        expect(getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('observability-tab-jobs');

        await waitFor(() => expect(queryAllByText('job-1').length).toBeGreaterThan(0));
        expect(getByText('Pending')).toBeDefined();
        expect(getByText('2')).toBeDefined();
        expect(calls.some((url) => url.includes('/jobs/stats'))).toBe(true);
        expect(calls.some((url) => url.includes('prefix=queue'))).toBe(true);
        expect(calls.some((url) => url.includes('prefix=scheduler'))).toBe(true);

        // Switch back to System Events
        fireEvent.click(getByRole('tab', { name: 'System Events' }));
        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));
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

    test('system events tab reports liveness and renders result count (J92 R3/R6)', async () => {
        installObservabilityFetchMock();
        const livenessEvents: ObservabilityLiveness[] = [];
        const { queryAllByText, getByText } = render(
            <SystemEventsTab onLivenessChange={(l) => livenessEvents.push(l)} />,
        );

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        // R6: Liveness callback invoked with initial connecting state
        expect(livenessEvents.length).toBeGreaterThan(0);
        expect(livenessEvents[0]?.status).toBe('connecting');
        // Result count reflects loaded count
        expect(getByText('2 of 2 shown')).toBeDefined();
    });

    test('system events tab pauses and resumes exactly one live connection (J92 R4/R6)', async () => {
        installObservabilityFetchMock();
        const livenessEvents: ObservabilityLiveness[] = [];
        const { queryAllByText, getByRole } = render(
            <SystemEventsTab onLivenessChange={(l) => livenessEvents.push(l)} />,
        );

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        await act(async () => {
            FakeEventSource.instances[0]?.onopen?.(new Event('open'));
        });

        await waitFor(() => expect(livenessEvents.some((l) => l.status === 'live')).toBe(true));

        // Pause live stream
        const liveBtn = getByRole('button', { name: /Pause live event stream/ });
        fireEvent.click(liveBtn);

        await waitFor(() => expect(livenessEvents.some((l) => l.status === 'paused')).toBe(true));
        expect(FakeEventSource.instances[0]?.closed).toBe(true);
        expect(queryAllByText('task.created').length).toBeGreaterThan(0);

        fireEvent.click(getByRole('button', { name: /Resume live event stream/ }));
        await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
        await act(async () => FakeEventSource.instances[1]?.onopen?.(new Event('open')));
        await waitFor(() => expect(livenessEvents.at(-1)?.status).toBe('live'));
        expect(FakeEventSource.instances[1]?.closed).toBe(false);
    });

    test('system events tab counts incoming SSE events in the rolling 60s rate (task 0222 R2; J92 R4)', async () => {
        installObservabilityFetchMock();
        const livenessEvents: ObservabilityLiveness[] = [];
        const { queryAllByText, getByText } = render(
            <SystemEventsTab onLivenessChange={(l) => livenessEvents.push(l)} />,
        );

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

        await waitFor(() => expect(livenessEvents.some((l) => l.rate === 2)).toBe(true));
        // Filtered count grows as live events arrive (no filter active).
        expect(getByText('4 of 4 shown')).toBeDefined();
    });

    test('system events tab renders the default visible desktop columns and customizer (J92 R1/R3)', async () => {
        installObservabilityFetchMock();
        const { container, queryAllByText } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        const table = container.querySelector('[data-system-events-tab] table');
        expect(table).not.toBeNull();
        const thead = table?.querySelector('thead');
        expect(thead?.className).toContain('sticky');
        const headers = table?.querySelectorAll('thead th');
        const headerLabels = Array.from(headers ?? []).map((th) => th.textContent?.trim());
        expect(headerLabels).toEqual(['Time ▼', 'Severity', 'Event', 'Summary', 'Correlation', 'Outcome', 'Agent']);
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

    test('time-range presets restrict visible events to the trailing window (task 0224 R5; J92 R1/R3)', async () => {
        // Two events: one old (>5m ago), one recent. After picking 30s only
        // the recent one should remain.
        const now = Date.now();
        const recentIso = new Date(now - 5_000).toISOString();
        const oldIso = new Date(now - 10 * 60_000).toISOString();
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/events/history')) {
                const urlObj = new URL(url, 'http://localhost');
                const sinceParam = urlObj.searchParams.get('since');
                const allEvts = [
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
                ];
                const events = sinceParam
                    ? allEvts.filter((e) => new Date(e.occurredAt).getTime() >= new Date(sinceParam).getTime())
                    : allEvts;
                return jsonResponse({
                    events,
                    count: events.length,
                    catalog: [
                        { name: 'task.created', prefix: 'task', source: 'planning', renderer: 'planning' },
                        { name: 'queue.job.completed', prefix: 'queue', source: 'queue', renderer: 'queue' },
                    ],
                });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);
        const { queryAllByText, getByRole } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));
        expect(queryAllByText('queue.job.completed').length).toBeGreaterThan(0);

        // Click the 30s preset button
        const btn30s = getByRole('button', { name: '30s' });
        fireEvent.click(btn30s);
        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));
        expect(queryAllByText('queue.job.completed').length).toBe(0);

        // Click All to restore
        const btnAll = getByRole('button', { name: 'All' });
        fireEvent.click(btnAll);
        await waitFor(() => expect(queryAllByText('queue.job.completed').length).toBeGreaterThan(0));
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
        expect(getByText(/2 of 2/)).toBeDefined();
    });

    test('table collapses to two columns under 640px and stacks actionable semantics under Event', async () => {
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

            // Under 640px only Time + Event columns render.
            const headers = container.querySelectorAll('[data-system-events-tab] thead th');
            expect(Array.from(headers).map((th) => th.textContent?.trim())).toEqual(['Time', 'Event']);
            expect(container.querySelector('[data-system-events-tab] table')?.className).toContain('min-w-0');
            const row = getByText('task.created').closest('tr') as HTMLTableRowElement;
            expect(row.textContent).toContain('info');
            expect(row.textContent).toContain('Task created · 0199');
            expect(row.textContent).toContain('spur / test');
            expect(row.textContent).not.toContain('spur-new ·');
            expect(row.textContent).toContain('outcome: completed');
            expect(row.textContent).toContain('action: -');
            expect(row.textContent).not.toContain('unavailable');
        } finally {
            // @ts-expect-error restore matchMedia
            globalThis.matchMedia = undefined;
        }
    });

    test('severity and event family are never communicated by color alone', async () => {
        installObservabilityFetchMock();
        const { queryAllByText } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        // The full event name communicates its family, and severity pairs icon + text.
        const taskSpans = queryAllByText('task.created').filter((n) => {
            const tag = n.tagName.toLowerCase();
            return tag === 'button' || tag === 'span';
        });
        expect(taskSpans.length).toBeGreaterThan(0);
        const taskRow = taskSpans[0]?.closest('tr') as HTMLTableRowElement;
        expect(taskRow).not.toBeNull();

        expect(taskSpans[0]?.className).toContain('text-emerald-400');
        const severityCell = taskRow.querySelector('td:nth-child(2)');
        expect(severityCell?.textContent).toContain('info');
        expect(severityCell?.querySelector('[aria-hidden="true"]')).not.toBeNull();
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

    test('system event row exposes canonical severity, summary, context, correlation, outcome, and action', async () => {
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
                            payload: eventEnvelope({
                                data: { actionId: 'action-7', durationMs: 125, outcome: 'success', kind: 'agent.run' },
                                severity: 'info',
                                summary: 'Workflow action completed',
                                correlation: { runId: 'run-42', actionId: 'action-7' },
                                outcome: 'success',
                                correlators: 'idea-pipeline · verify',
                                actionLabel: 'agent.run',
                                action: {
                                    label: 'Trace workflow run',
                                    kind: 'command',
                                    value: 'spur workflow trace run-42',
                                },
                            }),
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
        expect(row.textContent).toContain('info');
        expect(row.textContent).toContain('Workflow action completed');
        expect(row.textContent).not.toContain('spur-new');
        expect(row.textContent).toContain('idea-pipeline · verify');
        expect(row.textContent).not.toContain('run run-42');
        expect(row.textContent).not.toContain('spur workflow trace run-42');
        expect(row.textContent).toContain('success');
        expect(row.textContent).not.toContain('Trace workflow run');

        fireEvent.click(row.querySelector('button[aria-expanded]') as HTMLButtonElement);
        const detail = view.container.querySelector('section[aria-label="Detail for workflow.action.done"]');
        expect(detail?.textContent).toContain('project: spur-new');
        expect(detail?.textContent).toContain('producer: spur / test');
        expect(detail?.textContent).toContain('run-42');
    });

    test('event name hover tooltip renders semantic context and remediation', async () => {
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
                            payload: eventEnvelope({
                                data: { jobId: 'job-tip-1', type: 'system-events-prune' },
                                summary: 'Queue job completed',
                                description: 'A queued maintenance job completed.',
                                fields: [
                                    { label: 'Job', value: 'job-tip-1' },
                                    { label: 'Type', value: 'system-events-prune' },
                                ],
                                correlation: { jobId: 'job-tip-1' },
                                action: { label: 'Filter queue events', kind: 'filter', value: 'prefix=queue' },
                            }),
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
        expect(view.getByTestId('system-event-name').getAttribute('aria-describedby')).toBe(tip.id);
        expect(tip.textContent).toContain('A queued maintenance job completed.');
        expect(tip.textContent).toContain('job-tip-1');
        expect(tip.textContent).toContain('system-events-prune');
        expect(tip.textContent).toContain('Producer');
        expect(tip.textContent).toContain('spur / test');
        expect(tip.textContent).not.toContain('Project');
        expect(tip.textContent).toContain('prefix=queue');

        fireEvent.mouseLeave(view.getByTestId('system-event-name'));
        await act(async () => new Promise((resolve) => setTimeout(resolve, 250)));
        expect(view.queryByTestId('system-event-payload-tooltip')).toBeNull();
        fireEvent.focus(view.getByTestId('system-event-name'));
        await waitFor(() => expect(view.getByTestId('system-event-payload-tooltip')).toBeDefined());
    });

    test('payload tooltip pins on click and unlocks on Esc', async () => {
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
                            payload: eventEnvelope({
                                data: { jobId: 'job-pin-1', type: 'smoke' },
                                fields: [{ label: 'Job', value: 'job-pin-1' }],
                                correlation: { jobId: 'job-pin-1' },
                            }),
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
        expect(pinnedTip.textContent).toContain('Select to copy · Esc or outside click to close');

        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
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
                            payload: eventEnvelope({
                                data: { jobId: 'job-pin-btn', type: 'smoke' },
                                fields: [{ label: 'Job', value: 'job-pin-btn' }],
                                correlation: { jobId: 'job-pin-btn' },
                            }),
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

    test('queue.job rows surface canonical correlation, outcome, and action', async () => {
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
                            payload: eventEnvelope({
                                data: {
                                    jobId: 'ea874dc4-cb7f-4bd1-bb47-fbe3c175b737',
                                    type: 'system-events-prune',
                                },
                                summary: 'Queue maintenance completed',
                                correlation: { jobId: 'ea874dc4-cb7f-4bd1-bb47-fbe3c175b737' },
                                correlators: 'system-events-prune',
                                actionLabel: 'Filter queue events',
                                action: { label: 'Filter queue events', kind: 'filter', value: 'prefix=queue' },
                            }),
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
        expect(row.textContent).not.toContain('ea874dc4-cb7f-4bd1-bb47-fbe3c175b737');
        expect(row.textContent).toContain('system-events-prune');
        expect(row.textContent).toContain('Queue maintenance completed');
        expect(row.textContent).toContain('completed');
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

        const { container, getByText, queryByText } = render(<JobsTab />);

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
        const feedItems = container.querySelectorAll('[data-jobs-tab] ul > li');
        expect(feedItems).toHaveLength(2);
        expect(feedItems[0]?.textContent).toContain('job-42');
        expect(feedItems[1]?.textContent).toContain('cleanup');
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

        await waitFor(() => expect(getByText(/No job events/)).toBeDefined());
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

    test('jobs tab queries include since parameter when timeRange is specified (J92 R3, R4)', async () => {
        const calls: string[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            calls.push(url);
            if (url.includes('/events/history')) {
                return jsonResponse({ events: [], count: 0, catalog: [] });
            }
            if (url.includes('/jobs/stats')) {
                return jsonResponse({ stats: { pending: 1, processing: 0, completed: 0, failed: 0 } });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const { getByText, rerender } = render(<JobsTab timeRange="1h" />);

        await waitFor(() => expect(calls.some((u) => u.includes('prefix=queue') && u.includes('since='))).toBe(true));
        expect(calls.some((u) => u.includes('prefix=scheduler') && u.includes('since='))).toBe(true);
        const queueUrl = new URL(calls.find((u) => u.includes('prefix=queue')) ?? 'http://invalid');
        const schedulerUrl = new URL(calls.find((u) => u.includes('prefix=scheduler')) ?? 'http://invalid');
        expect(queueUrl.searchParams.get('limit')).toBe('50');
        expect(schedulerUrl.searchParams.get('limit')).toBe('50');
        expect(queueUrl.searchParams.get('since')).toBe(schedulerUrl.searchParams.get('since'));
        expect(getByText('Current Queue State')).toBeDefined();
        expect(getByText('Last 1h')).toBeDefined();

        // Rerender with timeRange="all" -> omits since
        calls.length = 0;
        rerender(<JobsTab timeRange="all" />);
        await waitFor(() => expect(calls.some((u) => u.includes('prefix=queue') && !u.includes('since='))).toBe(true));
        expect(calls.some((u) => u.includes('prefix=scheduler') && !u.includes('since='))).toBe(true);
        expect(getByText('All time')).toBeDefined();
    });

    test('jobs tab ignores a superseded range response even when fetch does not reject on abort (J92 R4)', async () => {
        let releaseFirstStats!: (response: Response) => void;
        const firstStats = new Promise<Response>((resolve) => {
            releaseFirstStats = resolve;
        });
        const firstSignals: AbortSignal[] = [];
        let statsCalls = 0;

        setFetchForTesting((async (input: RequestInfo | URL) => {
            const request = input instanceof Request ? input : new Request(input);
            const url = request.url;
            if (url.includes('/jobs/stats')) {
                statsCalls += 1;
                if (statsCalls === 1) {
                    firstSignals.push(request.signal);
                    return firstStats;
                }
                return jsonResponse({ stats: { pending: 9, processing: 0, completed: 0, failed: 0 } });
            }

            const superseded = url.includes('since=');
            if (superseded) firstSignals.push(request.signal);
            if (url.includes('prefix=queue')) {
                return jsonResponse({
                    events: [
                        {
                            id: superseded ? 'old-event' : 'new-event',
                            eventName: 'queue.job.completed',
                            occurredAt: superseded ? '2026-07-04T20:00:00.000Z' : '2026-07-04T21:00:00.000Z',
                            actor: null,
                            payload: { jobId: superseded ? 'old-job' : 'new-job', type: 'test' },
                        },
                    ],
                    count: 1,
                    catalog: [],
                });
            }
            if (url.includes('prefix=scheduler')) {
                return jsonResponse({ events: [], count: 0, catalog: [] });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const view = render(<JobsTab timeRange="1h" />);
        await waitFor(() => expect(firstSignals).toHaveLength(3));

        view.rerender(<JobsTab timeRange="all" />);
        await waitFor(() => expect(view.getByText('new-job')).toBeDefined());
        expect(firstSignals.every((signal) => signal.aborted)).toBe(true);

        await act(async () => {
            releaseFirstStats(jsonResponse({ stats: { pending: 1, processing: 0, completed: 0, failed: 0 } }));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(view.queryByText('old-job')).toBeNull();
        expect(view.getByText('new-job')).toBeDefined();
    });

    test('jobs tab reports a request error and recovers on the next range selection (J92 R2/R4/R6)', async () => {
        let failStats = true;
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/jobs/stats')) {
                if (failStats) return new Response('unavailable', { status: 503 });
                return jsonResponse({ stats: { pending: 4, processing: 0, completed: 0, failed: 0 } });
            }
            if (url.includes('/events/history')) {
                return jsonResponse({ events: [], count: 0, catalog: [] });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const view = render(<JobsTab timeRange="1h" />);
        await waitFor(() => expect(view.getByRole('alert').textContent).toContain('job stats fetch failed: 503'));

        failStats = false;
        view.rerender(<JobsTab timeRange="all" />);
        await waitFor(() => expect(view.getByText('Current Queue State')).toBeDefined());
        expect(view.queryByRole('alert')).toBeNull();
        expect(view.getByText('4')).toBeDefined();
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

    test('legacy tasks tab is removed from OBSERVABILITY_TABS (J92 R4)', () => {
        const tasksTab = OBSERVABILITY_TABS.find((t) => t.id === 'tasks');
        expect(tasksTab).toBeUndefined();
    });
});

describe('system event tooltip title (R5, 0601)', () => {
    const view = (correlationFields: { label: string; value: string }[]): Parameters<typeof tooltipTitle>[1] => ({
        severity: 'info',
        summary: 's',
        description: 'd',
        fields: [],
        projectName: 'p',
        projectRoot: 'r',
        producer: 'spur',
        correlation: '',
        correlationFields,
        outcome: 'o',
        action: null,
        actionLabel: 'unavailable',
        agent: null,
    });

    test('correlator precedence: entity before run before execution before action before job', () => {
        const row = { id: 'evt-1', eventName: 'task.transitioned' } as SystemEventRow;
        const title = tooltipTitle(
            row,
            view([
                { label: 'Job', value: 'job-1' },
                { label: 'Action', value: 'action-1' },
                { label: 'Execution', value: 'exec-1' },
                { label: 'Run', value: 'run-1' },
                { label: 'Entity', value: 'task:0601' },
            ]),
        );
        expect(title).toBe('task.transitioned · task:0601');
        expect(
            tooltipTitle(
                row,
                view([
                    { label: 'Run', value: 'run-1' },
                    { label: 'Job', value: 'job-1' },
                ]),
            ),
        ).toBe('task.transitioned · run-1');
        expect(tooltipTitle(row, view([{ label: 'Job', value: 'job-1' }]))).toBe('task.transitioned · job-1');
    });

    test('persisted history-row ID is the fallback when no semantic correlator exists', () => {
        const row = { id: 'evt-42', eventName: 'rule.eval' } as SystemEventRow;
        expect(tooltipTitle(row, view([]))).toBe('rule.eval · evt-42');
    });

    test('a live SSE row with a synthetic key renders the event name alone', () => {
        const row = { id: 'live-2026-07-29T17:02:26.000Z-task.updated', eventName: 'task.updated' } as SystemEventRow;
        expect(tooltipTitle(row, view([]))).toBe('task.updated');
    });

    test('empty correlation values are skipped in favor of a lower-precedence non-empty one', () => {
        const row = { id: 'evt-9', eventName: 'workflow.phase' } as SystemEventRow;
        expect(
            tooltipTitle(
                row,
                view([
                    { label: 'Entity', value: '' },
                    { label: 'Run', value: 'run-9' },
                ]),
            ),
        ).toBe('workflow.phase · run-9');
    });
});

describe('system event tooltip footer (R5, 0601)', () => {
    test('hover mode shows guidance to click or Pin; pinned mode shows copy/close guidance', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/events/history')) {
                return jsonResponse({
                    events: [
                        {
                            id: 'evt-footer',
                            eventName: 'queue.job.completed',
                            occurredAt: '2026-07-29T17:02:26.000Z',
                            actor: null,
                            runId: null,
                            payload: eventEnvelope({
                                data: { jobId: 'job-footer-1' },
                                fields: [{ label: 'Job', value: 'job-footer-1' }],
                                correlation: { jobId: 'job-footer-1' },
                            }),
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
        const hoverTip = await waitFor(() => view.getByTestId('system-event-payload-tooltip'));
        expect(hoverTip.getAttribute('data-pinned')).toBe('false');
        // Hover footer: click-to-lock guidance; title identifies the row by correlator.
        expect(view.getByTestId('system-event-tooltip-title').textContent).toBe('queue.job.completed · job-footer-1');
        expect(view.getByTestId('system-event-tooltip-footer').textContent).toBe(
            'Click event name or Pin to lock for copy',
        );

        fireEvent.click(view.getByTestId('system-event-payload-tooltip-pin'));
        await waitFor(() => {
            const tip = document.querySelector('[data-testid="system-event-payload-tooltip"]');
            expect(tip?.getAttribute('data-pinned')).toBe('true');
        });
        const pinnedTip = document.querySelector('[data-testid="system-event-payload-tooltip"]') as HTMLElement;
        expect(pinnedTip.textContent).toContain('Select to copy · Esc or outside click to close');
    });
});

describe('ObservabilityFilters and TimeRange (J92 R1-R7)', () => {
    test('timeRangeSince computes deterministic ISO lower bounds for all presets (J92 R1/R6, J93 R3)', () => {
        const fixedNow = 1700000000000;
        expect(timeRangeSince('30s', fixedNow)).toBe(new Date(fixedNow - 30_000).toISOString());
        expect(timeRangeSince('5m', fixedNow)).toBe(new Date(fixedNow - 300_000).toISOString());
        expect(timeRangeSince('1h', fixedNow)).toBe(new Date(fixedNow - 3600_000).toISOString());
        expect(timeRangeSince('4h', fixedNow)).toBe(new Date(fixedNow - 14_400_000).toISOString());
        expect(timeRangeSince('24h', fixedNow)).toBe(new Date(fixedNow - 86400_000).toISOString());
        expect(timeRangeSince('7d', fixedNow)).toBe(new Date(fixedNow - 604800_000).toISOString());
        expect(timeRangeSince('all', fixedNow)).toBeUndefined();
    });

    test('filter bar exposes the exact responsive range and action contract (J92 R1-R4/R7)', async () => {
        installObservabilityFetchMock();
        const view = render(<SystemEventsTab />);

        await waitFor(() => expect(view.queryAllByText('task.created').length).toBeGreaterThan(0));
        const ranges = view.getByRole('group', { name: 'Time range presets' });
        expect(Array.from(ranges.querySelectorAll('button')).map((button) => button.textContent)).toEqual([
            '30s',
            '5m',
            '1h',
            '4h',
            '24h',
            '7d',
            'All',
        ]);
        expect(view.getByRole('button', { name: '24h' }).getAttribute('aria-pressed')).toBe('true');
        expect(view.getByTestId('observability-retention-badge')).toBeDefined();
        expect(ranges.parentElement?.className).toContain('flex-wrap');
        expect(view.getByLabelText('Toggle filter panel')).toBeDefined();
        expect(view.getByRole('button', { name: 'Pause live event stream' })).toBeDefined();
        expect(view.getByLabelText('Customize visible columns')).toBeDefined();
    });

    test('SystemEventsTab filters by severity client-side (J92 R3/R6)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/events/history')) {
                return jsonResponse({
                    events: [
                        {
                            id: 'evt-info',
                            eventName: 'task.created',
                            occurredAt: '2026-07-04T20:00:00.000Z',
                            actor: 'op',
                            payload: eventEnvelope({ severity: 'info' }),
                        },
                        {
                            id: 'evt-err',
                            eventName: 'rule.eval.error',
                            occurredAt: '2026-07-04T20:00:01.000Z',
                            actor: 'op',
                            payload: eventEnvelope({ severity: 'error' }),
                        },
                    ],
                    count: 2,
                    catalog: [
                        { name: 'task.created', prefix: 'task', source: 'planning', renderer: 'planning' },
                        { name: 'rule.eval.error', prefix: 'rule', source: 'rule', renderer: 'rule' },
                    ],
                });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const { queryAllByText, getByRole } = render(<SystemEventsTab />);
        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));
        expect(queryAllByText('rule.eval.error').length).toBeGreaterThan(0);

        // Click severity error radio
        const errorRadio = getByRole('radio', { name: 'Error' });
        fireEvent.click(errorRadio);

        expect(queryAllByText('rule.eval.error').length).toBeGreaterThan(0);
        expect(queryAllByText('task.created').length).toBe(0);
    });

    test('ObservabilityShell persists selected timeRange across tab switching (J92 R5, J93 R3)', async () => {
        installObservabilityFetchMock();
        const { getByRole, queryAllByText, container } = render(<ObservabilityShell />);

        // Switch to System Events
        fireEvent.click(getByRole('tab', { name: 'System Events' }));
        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        // Default range is 4h (task 0790 R3)
        expect(getByRole('button', { name: '4h' }).getAttribute('aria-pressed')).toBe('true');

        // Switch time range to 1h
        const btn1h = getByRole('button', { name: '1h' });
        fireEvent.click(btn1h);
        expect(btn1h.getAttribute('aria-pressed')).toBe('true');

        // Switch to Routing tab
        fireEvent.click(getByRole('tab', { name: 'Routing' }));
        await waitFor(() => expect(container.querySelector('#observability-tab-panel-routing')).not.toBeNull());

        // Switch back to System Events
        fireEvent.click(getByRole('tab', { name: 'System Events' }));
        await waitFor(() => expect(container.querySelector('#observability-tab-panel-system-events')).not.toBeNull());

        // Range button remains 1h pressed
        expect(getByRole('button', { name: '1h' }).getAttribute('aria-pressed')).toBe('true');
    });

    test('RetentionBadge renders truthful copy and excludes false 7d event purge claim (task 0790 R5)', () => {
        const { getByTestId } = render(<RetentionBadge />);
        const badge = getByTestId('observability-retention-badge');
        expect(badge.textContent).toContain(RETENTION_COPY);
        expect(badge.textContent).toContain('10,000');
        expect(badge.textContent).toContain('30d');
        expect(badge.textContent).not.toContain('7d');
    });
});

describe('System Events customizable columns, sorting, and cell polish (J92 R1-R8)', () => {
    test('selected columns drive headers, cells, detail span, copy affordances, and persisted remounts (R1-R3/R6/R8)', async () => {
        const copied: string[] = [];
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: async (value: string) => copied.push(value) },
            configurable: true,
            writable: true,
        });
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/events/history')) {
                return jsonResponse({
                    events: [
                        {
                            id: 'event-columns',
                            eventName: 'task.created',
                            occurredAt: '2026-07-04T20:00:00.000Z',
                            actor: 'operator',
                            runId: 'run-1',
                            payload: eventEnvelope({ summary: 'Custom summary', correlators: 'corr-1' }),
                        },
                    ],
                    count: 1,
                    catalog: [{ name: 'task.created', prefix: 'task', source: 'planning', renderer: 'planning' }],
                });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const view = render(<SystemEventsTab />);
        await waitFor(() => expect(view.queryAllByText('task.created').length).toBeGreaterThan(0));

        const checkboxes = view.getAllByRole('checkbox') as HTMLInputElement[];
        expect(checkboxes.map((checkbox) => checkbox.getAttribute('aria-label'))).toEqual(
            ALL_COLUMNS.map((column) => column.label),
        );
        expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            false,
            false,
            false,
        ]);

        await act(async () => fireEvent.click(view.getByRole('button', { name: 'Copy event name' })));
        await act(async () => fireEvent.click(view.getByRole('button', { name: 'Copy correlation' })));
        expect(copied).toEqual(['task.created', 'corr-1']);

        fireEvent.click(view.getByLabelText('Summary'));
        const firstRow = view.container.querySelector('tbody > tr');
        expect(firstRow?.querySelectorAll(':scope > td')).toHaveLength(6);
        expect(firstRow?.textContent).not.toContain('Custom summary');
        fireEvent.click(view.getByRole('button', { name: 'Expand detail for task.created' }));
        const detail = view.container.querySelector('section[aria-label="Detail for task.created"]');
        expect(detail?.closest('td')?.getAttribute('colspan')).toBe('6');
        await act(async () => fireEvent.click(view.getByRole('button', { name: 'Copy run ID' })));
        expect(copied).toEqual(['task.created', 'corr-1', 'run-1']);

        fireEvent.click(view.getByLabelText('Producer'));
        expect(view.getAllByText('spur / test').length).toBeGreaterThan(0);
        expect(window.localStorage.getItem('spur:observability:columns:v1')).toBe(
            JSON.stringify(['time', 'severity', 'event', 'correlation', 'outcome', 'agent', 'producer']),
        );
        view.unmount();

        const remount = render(<SystemEventsTab />);
        await waitFor(() => expect(remount.queryAllByText('task.created').length).toBeGreaterThan(0));
        expect(
            Array.from(remount.container.querySelectorAll('[data-system-events-tab] thead th')).map((th) =>
                th.textContent?.trim(),
            ),
        ).toEqual(['Time ▼', 'Severity', 'Event', 'Correlation', 'Outcome', 'Agent', 'Producer']);
    });

    test('validateColumnKeys and loadVisibleColumns validate and fallback properly (R1, R2)', () => {
        // Valid subset in arbitrary order gets canonical order
        const validSubset = ['outcome', 'time', 'agent'];
        expect(validateColumnKeys(validSubset)).toEqual(['time', 'outcome', 'agent']);

        // Empty array falls back to defaults
        expect(validateColumnKeys([])).toEqual([...DEFAULT_VISIBLE_COLUMNS]);

        // Unknown keys are discarded; if all unknown, fallback to defaults
        expect(validateColumnKeys(['unknownKey1', 'unknownKey2'])).toEqual([...DEFAULT_VISIBLE_COLUMNS]);

        // Non-array falls back to defaults
        expect(validateColumnKeys(null)).toEqual([...DEFAULT_VISIBLE_COLUMNS]);
        expect(validateColumnKeys({ foo: 'bar' })).toEqual([...DEFAULT_VISIBLE_COLUMNS]);

        // In-memory mock storage
        const mockStorage: Record<string, string> = {};
        const fakeStore = {
            getItem: (key: string) => mockStorage[key] ?? null,
            setItem: (key: string, val: string) => {
                mockStorage[key] = val;
            },
            removeItem: (key: string) => {
                delete mockStorage[key];
            },
            clear: () => {},
            key: () => null,
            length: 0,
        } as unknown as Storage;

        // No item stored -> defaults
        expect(loadVisibleColumns(fakeStore)).toEqual([...DEFAULT_VISIBLE_COLUMNS]);

        // Save custom columns -> loads back normalized
        saveVisibleColumns(['time', 'agent', 'producer'], fakeStore);
        expect(loadVisibleColumns(fakeStore)).toEqual(['time', 'agent', 'producer']);

        // Malformed JSON -> fallback
        mockStorage['spur:observability:columns:v1'] = 'invalid{json';
        expect(loadVisibleColumns(fakeStore)).toEqual([...DEFAULT_VISIBLE_COLUMNS]);
    });

    test('sortEventRows stably orders rows across all sortable dimensions (R4)', () => {
        const rawEvents: SystemEventRow[] = [
            {
                id: 'evt-1',
                eventName: 'task.created',
                occurredAt: '2026-07-04T20:00:00.000Z',
                actor: 'robin',
                payload: { name: 'B-task' },
                view: {
                    summary: 'B task created',
                    severity: 'info',
                    producer: 'spur / cli',
                    correlation: 'corr-2',
                    agent: 'coder',
                    outcome: 'pending',
                    fields: [],
                    correlationFields: [],
                    description: '',
                    projectName: 'test',
                    projectRoot: '/test',
                    action: null,
                    actionLabel: '',
                },
            },
            {
                id: 'evt-2',
                eventName: 'rule.eval.error',
                occurredAt: '2026-07-04T20:05:00.000Z',
                actor: 'robin',
                payload: { name: 'A-rule' },
                view: {
                    summary: 'A rule failed',
                    severity: 'error',
                    producer: 'spur / rule',
                    correlation: 'corr-1',
                    agent: 'planner',
                    outcome: 'failed',
                    fields: [],
                    correlationFields: [],
                    description: '',
                    projectName: 'test',
                    projectRoot: '/test',
                    action: null,
                    actionLabel: '',
                },
            },
            {
                id: 'evt-3',
                eventName: 'agent.invoked',
                occurredAt: '2026-07-04T20:02:00.000Z',
                actor: 'system',
                payload: { name: 'C-agent' },
                view: {
                    summary: 'C agent running',
                    severity: 'warning',
                    producer: 'spur / runner',
                    correlation: 'corr-3',
                    agent: 'reviewer',
                    outcome: 'success',
                    fields: [],
                    correlationFields: [],
                    description: '',
                    projectName: 'test',
                    projectRoot: '/test',
                    action: null,
                    actionLabel: '',
                },
            },
        ];

        // 1. Time descending (default)
        const sortedTimeDesc = sortEventRows(rawEvents, { key: 'time', direction: 'desc' });
        expect(sortedTimeDesc.map((e) => e.id)).toEqual(['evt-2', 'evt-3', 'evt-1']);

        // 2. Time ascending
        const sortedTimeAsc = sortEventRows(rawEvents, { key: 'time', direction: 'asc' });
        expect(sortedTimeAsc.map((e) => e.id)).toEqual(['evt-1', 'evt-3', 'evt-2']);

        // 3. Severity ascending: info (0) < warning (1) < error (2)
        const sortedSevAsc = sortEventRows(rawEvents, { key: 'severity', direction: 'asc' });
        expect(sortedSevAsc.map((e) => e.id)).toEqual(['evt-1', 'evt-3', 'evt-2']);

        // 4. Severity descending: error > warning > info
        const sortedSevDesc = sortEventRows(rawEvents, { key: 'severity', direction: 'desc' });
        expect(sortedSevDesc.map((e) => e.id)).toEqual(['evt-2', 'evt-3', 'evt-1']);

        // 5. Event name ascending
        const sortedEventAsc = sortEventRows(rawEvents, { key: 'event', direction: 'asc' });
        expect(sortedEventAsc.map((e) => e.eventName)).toEqual(['agent.invoked', 'rule.eval.error', 'task.created']);

        // 6. Summary ascending
        const sortedSumAsc = sortEventRows(rawEvents, { key: 'summary', direction: 'asc' });
        expect(sortedSumAsc.map((e) => e.view?.summary)).toEqual([
            'A rule failed',
            'B task created',
            'C agent running',
        ]);

        // 7. Correlation ascending
        const sortedCorrAsc = sortEventRows(rawEvents, { key: 'correlation', direction: 'asc' });
        expect(sortedCorrAsc.map((e) => e.view?.correlation)).toEqual(['corr-1', 'corr-2', 'corr-3']);

        // 8. Agent ascending
        const sortedAgentAsc = sortEventRows(rawEvents, { key: 'agent', direction: 'asc' });
        expect(sortedAgentAsc.map((e) => e.view?.agent)).toEqual(['coder', 'planner', 'reviewer']);

        // 9. Outcome ascending
        const sortedOutcomeAsc = sortEventRows(rawEvents, { key: 'outcome', direction: 'asc' });
        expect(sortedOutcomeAsc.map((e) => e.view?.outcome)).toEqual(['failed', 'pending', 'success']);

        // 10. Stable tie-breaker with identical values
        const duplicateEvents: SystemEventRow[] = [
            {
                id: 'dup-1',
                eventName: 'task.created',
                occurredAt: '2026-07-04T20:00:00.000Z',
                actor: 'robin',
                payload: { name: 'B-task' },
                view: rawEvents[0]?.view,
            },
            {
                id: 'dup-2',
                eventName: 'task.created',
                occurredAt: '2026-07-04T20:00:00.000Z',
                actor: 'robin',
                payload: { name: 'B-task' },
                view: rawEvents[0]?.view,
            },
            {
                id: 'dup-3',
                eventName: 'task.created',
                occurredAt: '2026-07-04T20:00:00.000Z',
                actor: 'robin',
                payload: { name: 'B-task' },
                view: rawEvents[0]?.view,
            },
        ];
        const stableSort = sortEventRows(duplicateEvents, { key: 'event', direction: 'asc' });
        expect(stableSort.map((e) => e.id)).toEqual(['dup-1', 'dup-2', 'dup-3']);
    });

    test('ColumnCustomizer toggles columns, resets defaults, and enforces at-least-one (R1, R2, R3)', () => {
        let currentCols: EventColumnKey[] = ['time', 'severity'];
        const { getByLabelText, getByRole, rerender } = render(
            <ColumnCustomizer
                visibleColumns={currentCols}
                onVisibleColumnsChange={(next) => {
                    currentCols = next;
                }}
            />,
        );

        // Toggle on 'summary'
        const summaryCheckbox = getByLabelText('Summary') as HTMLInputElement;
        expect(summaryCheckbox.checked).toBe(false);
        fireEvent.click(summaryCheckbox);
        expect(currentCols).toEqual(['time', 'severity', 'summary']);

        rerender(
            <ColumnCustomizer
                visibleColumns={currentCols}
                onVisibleColumnsChange={(next) => {
                    currentCols = next;
                }}
            />,
        );

        // Click Reset defaults
        const resetBtn = getByRole('button', { name: 'Reset columns to default' });
        fireEvent.click(resetBtn);
        expect(currentCols).toEqual([...DEFAULT_VISIBLE_COLUMNS]);

        // When only 1 column is active, unchecking it is disabled
        currentCols = ['time'];
        rerender(
            <ColumnCustomizer
                visibleColumns={currentCols}
                onVisibleColumnsChange={(next) => {
                    currentCols = next;
                }}
            />,
        );
        const timeCheckbox = getByLabelText('Time') as HTMLInputElement;
        expect(timeCheckbox.checked).toBe(true);
        expect(timeCheckbox.disabled).toBe(true);
    });

    test('Header clicking toggles sort direction and updates aria-sort in SystemEventsTable (R4)', async () => {
        installObservabilityFetchMock();
        const { getByRole, queryAllByText } = render(<SystemEventsTab />);

        await waitFor(() => expect(queryAllByText('task.created').length).toBeGreaterThan(0));

        // Time header initial sort: descending
        const timeHeader = getByRole('columnheader', { name: /Time/ });
        expect(timeHeader.getAttribute('aria-sort')).toBe('descending');
        expect(timeHeader.textContent).toContain('▼');

        // Click Time header -> toggles to ascending
        const timeSortBtn = getByRole('button', { name: /Time/ });
        fireEvent.click(timeSortBtn);
        expect(timeHeader.getAttribute('aria-sort')).toBe('ascending');
        expect(timeHeader.textContent).toContain('▲');

        // Click Summary header -> becomes active sort ascending
        const summarySortBtn = getByRole('button', { name: /Summary/ });
        fireEvent.click(summarySortBtn);
        const summaryHeader = getByRole('columnheader', { name: /Summary/ });
        expect(summaryHeader.getAttribute('aria-sort')).toBe('ascending');
        expect(summaryHeader.textContent).toContain('▲');
        expect(timeHeader.getAttribute('aria-sort')).toBe('none');
    });

    test('CopyValueButton copies value to clipboard with accessible feedback (R6)', async () => {
        let copiedText = '';
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: async (text: string) => {
                    copiedText = text;
                },
            },
            configurable: true,
            writable: true,
        });

        const { getByRole } = render(<CopyValueButton value="task.created.v1" label="event name" />);

        const copyBtn = getByRole('button', { name: 'Copy event name' });
        expect(copyBtn).toBeDefined();

        await act(async () => {
            fireEvent.click(copyBtn);
        });

        expect(copiedText).toBe('task.created.v1');

        // Missing/unavailable value renders null
        const { container: emptyContainer } = render(<CopyValueButton value="unavailable" label="missing" />);
        expect(emptyContainer.firstChild).toBeNull();

        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: async () => Promise.reject(new Error('permission denied')) },
            configurable: true,
            writable: true,
        });
        const failed = render(<CopyValueButton value="corr-1" label="correlation" />);
        await act(async () => fireEvent.click(failed.getByRole('button', { name: 'Copy correlation' })));
        expect(failed.getByRole('button', { name: 'Copy correlation failed' })).toBeDefined();
    });

    test('SeverityLabel renders distinct icon and text for all severity levels (R5)', () => {
        const { container: infoContainer } = render(<SeverityLabel severity="info" />);
        expect(infoContainer.textContent).toContain('info');
        expect(infoContainer.textContent).toContain('●');

        const { container: warnContainer } = render(<SeverityLabel severity="warning" />);
        expect(warnContainer.textContent).toContain('warning');
        expect(warnContainer.textContent).toContain('▲');

        const { container: errContainer } = render(<SeverityLabel severity="error" />);
        expect(errContainer.textContent).toContain('error');
        expect(errContainer.textContent).toContain('✕');
    });
});

describe('J92 regression coverage', () => {
    test('jobs tab hides prior range rows while the replacement request is pending (0654 R4)', async () => {
        let statsCalls = 0;
        let releaseSecondStats!: (response: Response) => void;
        const secondStats = new Promise<Response>((resolve) => {
            releaseSecondStats = resolve;
        });

        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/jobs/stats')) {
                statsCalls += 1;
                if (statsCalls === 2) return secondStats;
                return jsonResponse({ stats: { pending: 1, processing: 0, completed: 0, failed: 0 } });
            }
            if (url.includes('prefix=queue')) {
                const priorRange = url.includes('since=');
                return jsonResponse({
                    events: [
                        {
                            id: priorRange ? 'old-event' : 'new-event',
                            eventName: 'queue.job.completed',
                            occurredAt: priorRange ? '2026-07-04T20:00:00.000Z' : '2026-07-04T21:00:00.000Z',
                            actor: null,
                            payload: { jobId: priorRange ? 'old-job' : 'new-job', type: 'test' },
                        },
                    ],
                    count: 1,
                    catalog: [],
                });
            }
            if (url.includes('prefix=scheduler')) {
                return jsonResponse({ events: [], count: 0, catalog: [] });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const view = render(<JobsTab timeRange="1h" />);
        await waitFor(() => expect(view.getByText('old-job')).toBeDefined());

        view.rerender(<JobsTab timeRange="all" />);
        await waitFor(() => expect(statsCalls).toBe(2));
        expect(view.queryByText('old-job')).toBeNull();
        expect(view.getByText(/Loading jobs/)).toBeDefined();

        await act(async () => {
            releaseSecondStats(jsonResponse({ stats: { pending: 2, processing: 0, completed: 0, failed: 0 } }));
        });
        await waitFor(() => expect(view.getByText('new-job')).toBeDefined());
    });

    test('optional Agent column leaves a missing executor blank (0653 R3)', async () => {
        window.localStorage.setItem(
            'spur:observability:columns:v1',
            JSON.stringify([...DEFAULT_VISIBLE_COLUMNS, 'agent']),
        );
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/events/history')) {
                return jsonResponse({
                    events: [
                        {
                            id: 'event-without-agent',
                            eventName: 'task.created',
                            occurredAt: '2026-07-04T20:00:00.000Z',
                            actor: 'operator',
                            payload: eventEnvelope({ summary: 'Created without an executor' }),
                        },
                    ],
                    count: 1,
                    catalog: [{ name: 'task.created', prefix: 'task', source: 'planning', renderer: 'planning' }],
                });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);

        const view = render(<SystemEventsTab />);
        await waitFor(() => expect(view.queryAllByText('task.created').length).toBeGreaterThan(0));

        const headers = Array.from(view.container.querySelectorAll('[data-system-events-tab] thead th'));
        const agentIndex = headers.findIndex((header) => header.textContent?.trim() === 'Agent');
        const cells = view.container.querySelector('tbody > tr')?.querySelectorAll(':scope > td');
        expect(agentIndex).toBeGreaterThan(-1);
        expect(cells?.[agentIndex]?.textContent).toBe('');
    });

    test('stored column validation discards duplicate keys (0653 R2)', () => {
        expect(validateColumnKeys(['agent', 'time', 'agent'])).toEqual(['time', 'agent']);
    });
});
