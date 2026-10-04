import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { workflowProgressProjectionSchema } from '@gobing-ai/spur-contracts';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import ObservabilityShell from '../../../src/modules/observability/ObservabilityShell';
import TraceTab, { buildRunsUrl, historyCommand, slowestAttemptIds } from '../../../src/modules/observability/TraceTab';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

/** Minimal EventSource stub — the shell test mounts SystemEventsTab's live tail. */
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

let originalEventSource: typeof EventSource | undefined;

beforeAll(() => {
    registerHappyDom();
    originalEventSource = globalThis.EventSource;
});

beforeEach(() => {
    FakeEventSource.instances = [];
    Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: FakeEventSource });
});

afterEach(() => {
    cleanup();
    resetFetchForTesting();
    Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: originalEventSource });
});

afterAll(async () => {
    await teardownHappyDom();
});

function jsonResponse(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

interface RunEntry {
    id: string;
    workflowName: string | null;
    status: string;
    mode: string | null;
    agent: string | null;
    startedAt: string;
    completedAt: string | null;
}

const runOne: RunEntry = {
    id: 'run-1',
    workflowName: 'task-pipeline',
    status: 'done',
    mode: 'auto',
    agent: 'omp',
    startedAt: '2026-09-23T10:00:00.000Z',
    completedAt: '2026-09-23T10:01:00.000Z',
};

const runTwo: RunEntry = {
    id: 'run-2',
    workflowName: 'idea-pipeline',
    status: 'failed',
    mode: 'auto',
    agent: null,
    startedAt: '2026-09-23T09:00:00.000Z',
    completedAt: '2026-09-23T09:00:30.000Z',
};

function attempt(actionRunId: string, durationMs: number | null, provenance: string, estimated = false) {
    return {
        actionRunId,
        status: 'passed',
        ok: true,
        startedAt: '2026-09-23T10:00:00.000Z',
        completedAt: '2026-09-23T10:00:01.000Z',
        durationMs,
        provenance,
        estimated,
    };
}

const projectionFixture = {
    schemaVersion: 1,
    runId: 'run-1',
    workflow: 'task-pipeline',
    status: 'completed',
    definitionDigest: 'abcdef1234567890',
    version: '1.2',
    currentState: 'test',
    states: [
        {
            state: 'precheck',
            visit: 1,
            status: 'passed',
            actions: [
                {
                    actionKey: 'precheck.gate',
                    kind: 'command',
                    stateEffect: 'read',
                    evidenceEffect: 'none',
                    status: 'passed',
                    attempts: [attempt('att-1', 400, 'host-reported', true)],
                },
            ],
        },
        {
            state: 'test',
            visit: 1,
            status: 'passed',
            actions: [
                {
                    actionKey: 'test.run',
                    kind: 'command',
                    stateEffect: 'read',
                    evidenceEffect: 'write',
                    status: 'passed',
                    attempts: [attempt('att-2', 346000, 'host-reported'), attempt('att-3', 2500, 'host-reported')],
                },
                {
                    actionKey: 'test.lint',
                    kind: 'command',
                    stateEffect: 'read',
                    evidenceEffect: 'none',
                    status: 'passed',
                    attempts: [attempt('att-4', 12000, 'unknown')],
                },
                {
                    actionKey: 'test.report',
                    kind: 'command',
                    stateEffect: 'read',
                    evidenceEffect: 'write',
                    status: 'passed',
                    attempts: [attempt('att-5', 100, 'host-reported')],
                },
            ],
        },
    ],
    transitions: [{ from: 'precheck', to: 'test', trigger: 'gate-passed', at: '2026-09-23T10:00:30.000Z' }],
    artifacts: [],
    nextTransitions: [],
    diagnostics: [{ code: 'definition-drift', message: 'definition changed since run start' }],
    projectedAt: '2026-09-23T10:02:00.000Z',
};

interface MockOptions {
    runs?: RunEntry[];
    nextCursor?: string | null;
    runsAfterCursor?: RunEntry[];
    projection?: unknown;
    projectionStatus?: number;
    record?: unknown;
    recordStatus?: number;
}

function installFetchMock(opts: MockOptions = {}): string[] {
    const calls: string[] = [];
    setFetchForTesting((async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        calls.push(url);

        if (url.includes('/progress')) {
            const status = opts.projectionStatus ?? 200;
            if (status !== 200) return jsonResponse({ error: 'run not found', code: 'RUN_NOT_FOUND' }, status);
            return jsonResponse(opts.projection ?? projectionFixture);
        }
        if (url.includes('/observability/run-record/')) {
            return jsonResponse(opts.record ?? { status: 'missing' }, opts.recordStatus ?? 200);
        }
        if (url.includes('/runs?')) {
            const cursor = new URL(url).searchParams.get('cursor');
            if (cursor !== null && opts.runsAfterCursor) {
                return jsonResponse({ runs: opts.runsAfterCursor, count: 1, nextCursor: null, hasMore: false });
            }
            const runs = opts.runs ?? [runOne];
            const nextCursor = opts.nextCursor ?? null;
            return jsonResponse({
                runs,
                count: runs.length,
                nextCursor,
                hasMore: nextCursor !== null,
            });
        }
        if (url.includes('/events/history')) {
            return jsonResponse({ events: [], count: 0, catalog: [] });
        }
        return jsonResponse({ error: `unmocked ${url}` }, 404);
    }) as unknown as typeof fetch);
    return calls;
}

function runsCalls(calls: string[]): string[] {
    return calls.filter((url) => url.includes('/runs?'));
}

describe('TraceTab URL and helpers (E72 R1/R2/R7)', () => {
    test('buildRunsUrl carries the active filters, cursor and limit', () => {
        expect(buildRunsUrl('http://localhost/api', { limit: 50 })).toBe('http://localhost/api/runs?limit=50');
        expect(
            buildRunsUrl('http://localhost/api', {
                status: 'failed',
                workflow: 'task-pipeline',
                since: '2026-09-23T09:00:00.000Z',
                cursor: 'cur-1',
                limit: 50,
            }),
        ).toBe(
            'http://localhost/api/runs?status=failed&workflow=task-pipeline&since=2026-09-23T09%3A00%3A00.000Z&cursor=cur-1&limit=50',
        );
    });

    test('historyCommand renders the window, and only --since while running', () => {
        expect(historyCommand(runOne)).toBe(
            'spur history analyze --since 2026-09-23T10:00:00.000Z --until 2026-09-23T10:01:00.000Z',
        );
        expect(historyCommand({ startedAt: '2026-09-23T10:00:00.000Z', completedAt: null })).toBe(
            'spur history analyze --since 2026-09-23T10:00:00.000Z',
        );
    });

    test('slowestAttemptIds returns the n slowest non-null attempts', () => {
        const projection = workflowProgressProjectionSchema.parse(projectionFixture);
        expect([...slowestAttemptIds(projection)].sort()).toEqual(['att-2', 'att-3', 'att-4']);
        expect([...slowestAttemptIds(projection, 1)]).toEqual(['att-2']);
    });
});

describe('TraceTab run list (E72 R1/R2)', () => {
    test('lists runs with workflow, status, start and duration, and omits since for the all range', async () => {
        const calls = installFetchMock();
        const view = render(<TraceTab timeRange="all" />);

        await waitFor(() => expect(view.container.querySelectorAll('[data-run-row]').length).toBe(1));
        const row = view.container.querySelector('[data-run-row]')?.textContent ?? '';
        expect(row).toContain('task-pipeline');
        expect(row).toContain('done');
        expect(row).toContain('Sep 23 10:00:00');
        expect(row).toContain('60.0s');
        expect(row).toContain('omp');

        const [first] = runsCalls(calls);
        expect(first).toContain('limit=50');
        expect(first).not.toContain('since=');
    });

    test('applying status and workflow filters refetches with since and resets paging', async () => {
        const calls = installFetchMock({
            runs: [runOne, runTwo],
            nextCursor: 'cur-1',
            runsAfterCursor: [],
        });
        const view = render(<TraceTab timeRange="24h" />);

        await waitFor(() => expect(view.container.querySelectorAll('[data-run-row]').length).toBe(2));
        fireEvent.click(view.getByRole('button', { name: 'Load more' }));
        await waitFor(() => expect(runsCalls(calls).length).toBe(2));
        expect(runsCalls(calls)[1]).toContain('cursor=cur-1');

        fireEvent.change(document.getElementById('trace-status-filter') as HTMLSelectElement, {
            target: { value: 'failed' },
        });
        fireEvent.change(document.getElementById('trace-workflow-filter') as HTMLSelectElement, {
            target: { value: 'task-pipeline' },
        });

        await waitFor(() => expect(runsCalls(calls).length).toBeGreaterThan(2));
        const last = runsCalls(calls)[runsCalls(calls).length - 1] ?? '';
        expect(last).toContain('status=failed');
        expect(last).toContain('workflow=task-pipeline');
        expect(last).toContain('since=');
        expect(last).not.toContain('cursor=');
    });

    test('follows nextCursor with the same filters on Load more', async () => {
        const calls = installFetchMock({ runs: [runOne], nextCursor: 'cur-9', runsAfterCursor: [runTwo] });
        const view = render(<TraceTab timeRange="all" />);

        await waitFor(() => expect(view.container.querySelectorAll('[data-run-row]').length).toBe(1));
        fireEvent.change(document.getElementById('trace-workflow-filter') as HTMLSelectElement, {
            target: { value: 'task-pipeline' },
        });
        await waitFor(() => expect(runsCalls(calls).length).toBe(2));
        const filtered = runsCalls(calls)[1] ?? '';
        expect(filtered).toContain('workflow=task-pipeline');
        expect(filtered).not.toContain('cursor=');

        fireEvent.click(view.getByRole('button', { name: 'Load more' }));
        await waitFor(() => expect(runsCalls(calls).length).toBe(3));
        const paged = runsCalls(calls)[2] ?? '';
        expect(paged).toContain('workflow=task-pipeline');
        expect(paged).toContain('cursor=cur-9');
        await waitFor(() => expect(view.container.querySelectorAll('[data-run-row]').length).toBe(2));
        expect(view.container.textContent).toContain('idea-pipeline');
    });

    test('shows the empty state and an inline error with retry', async () => {
        installFetchMock({ runs: [] });
        const empty = render(<TraceTab timeRange="4h" />);
        await waitFor(() => expect(empty.getByText('No workflow runs in this window')).toBeDefined());
        empty.unmount();

        setFetchForTesting((async () => jsonResponse({ error: 'boom' }, 500)) as unknown as typeof fetch);
        const failed = render(<TraceTab timeRange="4h" />);
        await waitFor(() => expect(failed.getByRole('alert').textContent).toContain('runs fetch failed: 500'));
        expect(failed.getByRole('button', { name: 'Retry' })).toBeDefined();
    });
});

describe('TraceTab run detail (E72 R3/R4/R5/R7)', () => {
    async function openDetail(options: MockOptions = {}) {
        const navigateCalls: unknown[] = [];
        installFetchMock(options);
        const view = render(
            <TraceTab
                timeRange="24h"
                onNavigate={(intent) => {
                    navigateCalls.push(intent);
                }}
            />,
        );
        await waitFor(() => expect(view.container.querySelectorAll('[data-run-row]').length).toBe(1));
        fireEvent.click(view.getByRole('button', { name: /task-pipeline/ }));
        await waitFor(() =>
            expect(
                view.container.querySelector('[data-run-detail]') ??
                    view.container.querySelector('[data-run-detail-error]'),
            ).not.toBeNull(),
        );
        return { view, navigateCalls };
    }

    test('renders states in order with attempts, transitions and diagnostics', async () => {
        const { view } = await openDetail();

        // Header: workflow, status, currentState, short digest.
        expect(view.getAllByText('completed').length).toBeGreaterThan(0);
        expect(document.querySelector('[data-current-state]')?.textContent).toBe('test');
        expect(view.getByText('abcdef123456')).toBeDefined();

        // States in projection order, each with visit and status.
        const states = Array.from(document.querySelectorAll('[data-state]')).map((el) => el.textContent ?? '');
        expect(states).toHaveLength(2);
        expect(states[0]).toContain('precheck');
        expect(states[1]).toContain('test');
        expect(states[0]).toContain('visit 1');
        expect(states[1]).toContain('visit 1');

        // Actions with actionKey, kind and status.
        expect(view.getByText('test.run')).toBeDefined();
        expect(view.getAllByText('command').length).toBeGreaterThan(0);
        expect(view.getAllByText('passed').length).toBeGreaterThan(0);

        // Every attempt duration renders.
        for (const duration of ['400ms', '346.0s', '2.5s', '12.0s', '100ms']) {
            expect(view.getByText(duration)).toBeDefined();
        }

        // Transitions and diagnostics.
        expect(view.getByText('precheck → test')).toBeDefined();
        expect(view.getByText(/gate-passed/)).toBeDefined();
        expect(view.getByText(/definition-drift/)).toBeDefined();
        expect(view.getByText(/definition changed since run start/)).toBeDefined();
    });

    test('marks exactly the three slowest attempts', async () => {
        await openDetail();
        const marked = Array.from(document.querySelectorAll('[data-slowest]')).map((el) => el.textContent ?? '');
        expect(marked).toHaveLength(3);
        expect(marked.some((text) => text.includes('346.0s'))).toBe(true);
        expect(marked.some((text) => text.includes('12.0s'))).toBe(true);
        expect(marked.some((text) => text.includes('2.5s'))).toBe(true);
        expect(marked.some((text) => text.includes('400ms'))).toBe(false);
    });

    test('labels host-reported and estimated attempts and leaves unknown unlabelled', async () => {
        const { view } = await openDetail();
        expect(view.getAllByText('host-reported')).toHaveLength(4);
        expect(view.getAllByText('estimated')).toHaveLength(1);
        expect(view.queryByText('unknown')).toBeNull();
    });

    test('shows the schema-validation message for an invalid progress body', async () => {
        const { view } = await openDetail({ projection: { schemaVersion: 1, runId: 'run-1' } });
        expect(view.getByRole('alert').textContent).toBe('progress response failed schema validation');
    });

    test('shows Run not found for a 404 progress response', async () => {
        const { view } = await openDetail({ projectionStatus: 404 });
        expect(view.getByRole('alert').textContent).toBe('Run not found');
    });

    test('loads the moved run record and keeps the explicit missing message', async () => {
        const { view } = await openDetail({ record: { status: 'record', markdown: '# body', state: {} } });
        fireEvent.click(view.getByRole('button', { name: 'View run record for run run-1' }));
        await waitFor(() => expect(document.querySelector('[data-run-record-text]')?.textContent).toContain('# body'));
        expect(document.body.textContent).not.toContain('expired');
        view.unmount();

        const missing = await openDetail({ record: { status: 'missing' } });
        fireEvent.click(missing.view.getByRole('button', { name: 'View run record for run run-1' }));
        await waitFor(() => expect(missing.view.getByText('No run record found on disk.')).toBeDefined());
    });

    test('shows the run history window with the copyable analyze command', async () => {
        const { view } = await openDetail();
        expect(view.getByText(/Sep 23 10:00:00 → Sep 23 10:01:00/)).toBeDefined();
        expect(document.querySelector('[data-history-command]')?.textContent).toBe(
            'spur history analyze --since 2026-09-23T10:00:00.000Z --until 2026-09-23T10:01:00.000Z',
        );
        expect(view.getByRole('button', { name: 'Copy history analyze command' })).toBeDefined();
    });

    test('the System events link emits the run-id navigation intent', async () => {
        const { view, navigateCalls } = await openDetail();
        fireEvent.click(view.getByRole('button', { name: 'System events for this run' }));
        expect(navigateCalls).toEqual([{ tab: 'system-events', runId: 'run-1' }]);
    });
});

describe('ObservabilityShell run-id intent (E72 R6)', () => {
    test('carries the Trace run link into the System Events run-id filter', async () => {
        installFetchMock({ runs: [runOne], projectionStatus: 200 });
        const view = render(<ObservabilityShell />);

        fireEvent.click(view.getByRole('tab', { name: 'Trace' }));
        await waitFor(() => expect(view.container.querySelectorAll('[data-run-row]').length).toBe(1));

        fireEvent.click(view.getByRole('button', { name: /task-pipeline/ }));
        await waitFor(() => expect(view.getByRole('button', { name: 'System events for this run' })).toBeDefined());
        fireEvent.click(view.getByRole('button', { name: 'System events for this run' }));

        await waitFor(() => {
            const input = document.getElementById('filter-run-id-input') as HTMLInputElement | null;
            expect(input?.value).toBe('run-1');
        });
        expect(view.getByRole('tab', { name: 'System Events' }).getAttribute('aria-selected')).toBe('true');
    });
});
