registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import ProcessesView, { buildWatchRows, filterWatchRows } from '../../../src/modules/projects/ProcessesView';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

afterAll(teardownHappyDom);

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

// ── R5: the three supervised-row cases (0262 AC + 0264), ported from the retired teams suite ──

describe('ProcessesView supervised rows (0852 R5)', () => {
    test('renders supervised process rows from /api/processes (0262 AC)', async () => {
        const processCalls: string[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/processes')) {
                processCalls.push(url);
                return jsonResponse({
                    processes: [
                        {
                            agentId: 'planner',
                            pid: 4242,
                            status: 'running',
                            startedAt: '2026-07-15T12:00:00.000Z',
                            exitCode: null,
                            teamId: null,
                        },
                        {
                            agentId: 'builder',
                            pid: 4243,
                            status: 'exited',
                            startedAt: '2026-07-15T11:00:00.000Z',
                            exitCode: 0,
                            teamId: null,
                        },
                    ],
                    count: 2,
                    executions: [],
                    executionsCount: 0,
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { getByText, container } = render(<ProcessesView />);

        await waitFor(() => expect(getByText('planner')).toBeDefined());
        expect(getByText('builder')).toBeDefined();
        expect(getByText('4242')).toBeDefined();
        expect(getByText('4243')).toBeDefined();
        expect(getByText('running')).toBeDefined();
        expect(getByText('exited')).toBeDefined();
        // Header labels the watch list and its registry backing.
        const root = container.querySelector('[data-processes-tab]');
        expect(root?.textContent).toContain('Process watch list');
        expect(root?.textContent).toContain('ProcessExecutor registry');
        // Polled the team processes endpoint, not the observability tree.
        expect(processCalls.some((u) => u.includes('/processes'))).toBe(true);
        expect(processCalls.some((u) => u.includes('/observability/processes'))).toBe(false);
        // Rows are read-only — no control buttons on supervised rows.
        expect(container.querySelectorAll('[data-processes-attach-btn]').length).toBe(0);
        expect(container.querySelectorAll('[data-processes-toggle-btn]').length).toBe(0);
    });

    test('shows registry one-shots alongside supervised rows and dedups the covered agent (0264)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/processes')) {
                return jsonResponse({
                    processes: [
                        {
                            agentId: 'planner',
                            pid: 4242,
                            status: 'running',
                            startedAt: '2026-07-15T12:00:00.000Z',
                            exitCode: null,
                            teamId: null,
                        },
                    ],
                    count: 1,
                    executions: [
                        {
                            id: 'pe_1',
                            label: 'git.status',
                            command: 'git',
                            args: ['status'],
                            pid: 99,
                            status: 'exited',
                            startedAt: '2026-07-15T12:01:00.000Z',
                            exitedAt: '2026-07-15T12:01:01.000Z',
                            exitCode: 0,
                            source: 'one-shot',
                            teamId: null,
                            agentId: null,
                        },
                        // Duplicate of the supervised agent — de-duped by agentId (0264).
                        {
                            id: 'pe_2',
                            label: 'agent:planner',
                            command: 'bun',
                            args: [],
                            pid: 4242,
                            status: 'running',
                            startedAt: '2026-07-15T12:00:00.000Z',
                            exitedAt: null,
                            exitCode: null,
                            source: 'supervisor',
                            teamId: null,
                            agentId: 'planner',
                        },
                    ],
                    executionsCount: 2,
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { getByText, container } = render(<ProcessesView />);

        await waitFor(() => expect(getByText('planner')).toBeDefined());
        expect(getByText('git.status')).toBeDefined();
        // Source cell for the one-shot row.
        expect(container.querySelector('[data-process-source="one-shot"]')).not.toBeNull();
        // Exactly two rows — supervised agent plus the uncovered one-shot; pe_2 is deduped.
        const keys = [...container.querySelectorAll('[data-processes-row]')].map((r) =>
            r.getAttribute('data-processes-row'),
        );
        expect(keys).toEqual(['sup:planner', 'reg:pe_1']);
    });

    test('shows empty state when no processes exist (0262 edge)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/processes')) {
                return jsonResponse({ processes: [], count: 0, executions: [], executionsCount: 0 });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { getByText, container } = render(<ProcessesView />);

        await waitFor(() => expect(getByText(/No processes/)).toBeDefined());
        // Actionable guidance survives the port, retargeted at the Projects surface.
        expect(getByText(/spur agent start/)).toBeDefined();
        expect(container.querySelector('[data-processes-tab-empty]')).not.toBeNull();
        expect(container.querySelector('[data-processes-tab-loading]')).toBeNull();
    });

    // 0860 R1: the moved route dropped the grouping id from the registry half and the strict
    // field check rejected the whole response, so the watch list never left its loading state
    // (the writer-side fix is pinned by the server key-shape test). The parser narrows a missing
    // grouping id to null instead, the tolerance `parseProcessList` already documents.
    test('tolerates a registry row without the grouping key (0860 R1)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/processes')) {
                return jsonResponse({
                    processes: [],
                    count: 0,
                    executions: [
                        {
                            id: 'pe_9',
                            label: 'git.status',
                            command: 'git',
                            args: ['status'],
                            pid: 98,
                            status: 'exited',
                            startedAt: '2026-07-15T12:01:00.000Z',
                            exitedAt: '2026-07-15T12:01:01.000Z',
                            exitCode: 0,
                            source: 'one-shot',
                            agentId: null,
                        },
                    ],
                    executionsCount: 1,
                });
            }
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);

        const { getByText, container } = render(<ProcessesView />);

        await waitFor(() => expect(getByText('git.status')).toBeDefined());
        expect(container.querySelector('[data-processes-tab-loading]')).toBeNull();
        const keys = [...container.querySelectorAll('[data-processes-row]')].map((r) =>
            r.getAttribute('data-processes-row'),
        );
        expect(keys).toEqual(['reg:pe_9']);
    });
});

// ── R3: pure filter semantics (0267 suite, ported verbatim) ──

describe('buildWatchRows + filterWatchRows (0267 port, 0852 R3)', () => {
    const supervised = [
        {
            agentId: 'alpha',
            pid: 100,
            status: 'running',
            startedAt: '2026-07-15T00:00:00Z',
            exitCode: null,
            teamId: 'red',
        },
        {
            agentId: 'beta',
            pid: 101,
            status: 'exited',
            startedAt: '2026-07-15T00:00:00Z',
            exitCode: 0,
            teamId: null,
        },
    ];
    const executions = [
        {
            id: 'e1',
            label: 'one-shot',
            command: 'run',
            args: [],
            pid: 200,
            status: 'running',
            startedAt: '2026-07-15T00:00:00Z',
            exitedAt: null,
            exitCode: null,
            source: 'one-shot',
            teamId: 'blue',
            agentId: null,
        },
        {
            id: 'e2',
            label: 'sidecar',
            command: 'run',
            args: [],
            pid: 201,
            status: 'running',
            startedAt: '2026-07-15T00:00:00Z',
            exitedAt: null,
            exitCode: null,
            source: 'serve',
            teamId: null,
            agentId: 'gamma',
        },
    ];

    test('buildWatchRows threads teamId from both supervised and registry rows', () => {
        const rows = buildWatchRows(supervised, executions);
        const byKey = new Map(rows.map((r) => [r.key, r]));
        expect(byKey.get('sup:alpha')?.teamId).toBe('red');
        expect(byKey.get('sup:beta')?.teamId).toBeNull();
        expect(byKey.get('reg:e1')?.teamId).toBe('blue');
        expect(byKey.get('reg:e2')?.teamId).toBeNull();
    });

    test('runningOnly filter hides non-running rows', () => {
        const rows = buildWatchRows(supervised, executions);
        const filtered = filterWatchRows(rows, { runningOnly: true, source: 'all', team: 'all' });
        const keys = filtered.map((r) => r.key);
        expect(keys).toContain('sup:alpha');
        expect(keys).toContain('reg:e1');
        expect(keys).toContain('reg:e2');
        // beta is exited — filtered out.
        expect(keys).not.toContain('sup:beta');
    });

    test('source=supervisor hides non-supervisor rows', () => {
        const rows = buildWatchRows(supervised, executions);
        const filtered = filterWatchRows(rows, { runningOnly: false, source: 'supervisor', team: 'all' });
        expect(filtered.map((r) => r.key)).toEqual(['sup:alpha', 'sup:beta']);
    });

    test('source=one-shot keeps only one-shot registry rows', () => {
        const rows = buildWatchRows(supervised, executions);
        const filtered = filterWatchRows(rows, { runningOnly: false, source: 'one-shot', team: 'all' });
        expect(filtered.map((r) => r.key)).toEqual(['reg:e1']);
    });

    test('source=other keeps rows that are neither supervisor nor one-shot', () => {
        const rows = buildWatchRows(supervised, executions);
        const filtered = filterWatchRows(rows, { runningOnly: false, source: 'other', team: 'all' });
        expect(filtered.map((r) => r.key)).toEqual(['reg:e2']);
    });

    test('team filter narrows to a specific team', () => {
        const rows = buildWatchRows(supervised, executions);
        const filtered = filterWatchRows(rows, { runningOnly: false, source: 'all', team: 'red' });
        expect(filtered.map((r) => r.key)).toEqual(['sup:alpha']);
    });

    test('team=unassigned selects only rows with null teamId', () => {
        const rows = buildWatchRows(supervised, executions);
        const filtered = filterWatchRows(rows, { runningOnly: false, source: 'all', team: 'unassigned' });
        const keys = filtered.map((r) => r.key);
        expect(keys).toContain('sup:beta');
        expect(keys).toContain('reg:e2');
        expect(keys).not.toContain('sup:alpha');
        expect(keys).not.toContain('reg:e1');
    });

    test('combined runningOnly + team filter intersects correctly', () => {
        const rows = buildWatchRows(supervised, executions);
        const filtered = filterWatchRows(rows, { runningOnly: true, source: 'all', team: 'unassigned' });
        // Only reg:e2 is both running AND unassigned (beta is exited).
        expect(filtered.map((r) => r.key)).toEqual(['reg:e2']);
    });

    test('all-pass filter returns every row unchanged', () => {
        const rows = buildWatchRows(supervised, executions);
        const filtered = filterWatchRows(rows, { runningOnly: false, source: 'all', team: 'all' });
        expect(filtered).toHaveLength(rows.length);
    });
});

// ── R3: the filter bar drives the same semantics in the component ──

describe('ProcessesView filter bar (0852 R3 / 0267)', () => {
    function stubProcesses(body: unknown): void {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/processes')) return jsonResponse(body);
            return jsonResponse({ ok: true });
        }) as unknown as typeof fetch);
    }

    test('renders filter controls and the team column (0267 R2)', async () => {
        stubProcesses({
            processes: [
                {
                    agentId: 'alpha',
                    pid: 1,
                    status: 'running',
                    startedAt: '2026-07-15T12:00:00Z',
                    exitCode: null,
                    teamId: 'red',
                },
            ],
            count: 1,
            executions: [],
            executionsCount: 0,
        });

        const { container } = render(<ProcessesView />);

        await waitFor(() => expect(container.querySelector('[data-processes-tab]')).not.toBeNull());
        expect(container.querySelector('[data-processes-filters]')).not.toBeNull();
        expect(container.querySelector('[data-processes-filter-running-input]')).not.toBeNull();
        expect(container.querySelector('[data-processes-filter-source]')).not.toBeNull();
        expect(container.querySelector('[data-processes-filter-team]')).not.toBeNull();
        // Team column shows the teamId.
        expect(container.querySelector('[data-process-team="red"]')).not.toBeNull();
    });

    test('running-only checkbox hides non-running rows (0267 R2)', async () => {
        stubProcesses({
            processes: [
                {
                    agentId: 'runner',
                    pid: 1,
                    status: 'running',
                    startedAt: '2026-07-15T12:00:00Z',
                    exitCode: null,
                    teamId: null,
                },
                {
                    agentId: 'stopped',
                    pid: 2,
                    status: 'exited',
                    startedAt: '2026-07-15T12:00:00Z',
                    exitCode: 0,
                    teamId: null,
                },
            ],
            count: 2,
            executions: [],
            executionsCount: 0,
        });

        const { container } = render(<ProcessesView />);

        await waitFor(() => expect(container.querySelector('[data-processes-row="sup:runner"]')).not.toBeNull());
        expect(container.querySelector('[data-processes-row="sup:stopped"]')).not.toBeNull();

        const checkbox = container.querySelector('[data-processes-filter-running-input]') as HTMLInputElement;
        act(() => fireEvent.click(checkbox));

        await waitFor(() => expect(container.querySelector('[data-processes-row="sup:stopped"]')).toBeNull());
        expect(container.querySelector('[data-processes-row="sup:runner"]')).not.toBeNull();
    });

    test('source select narrows rows to the selected source (0267 R2)', async () => {
        stubProcesses({
            processes: [
                {
                    agentId: 'alpha',
                    pid: 1,
                    status: 'running',
                    startedAt: '2026-07-15T12:00:00Z',
                    exitCode: null,
                    teamId: null,
                },
            ],
            count: 1,
            executions: [
                {
                    id: 'job',
                    label: 'one-shot',
                    command: 'run',
                    args: [],
                    pid: 200,
                    status: 'running',
                    startedAt: '2026-07-15T12:00:00Z',
                    exitedAt: null,
                    exitCode: null,
                    source: 'one-shot',
                    teamId: null,
                    agentId: null,
                },
            ],
            executionsCount: 1,
        });

        const { container } = render(<ProcessesView />);

        await waitFor(() => expect(container.querySelector('[data-processes-row="sup:alpha"]')).not.toBeNull());
        expect(container.querySelector('[data-processes-row="reg:job"]')).not.toBeNull();

        const select = container.querySelector('[data-processes-filter-source]') as HTMLSelectElement;
        act(() => fireEvent.change(select, { target: { value: 'one-shot' } }));

        await waitFor(() => expect(container.querySelector('[data-processes-row="sup:alpha"]')).toBeNull());
        expect(container.querySelector('[data-processes-row="reg:job"]')).not.toBeNull();
    });

    test('team filter narrows rows to the selected team (0267 R2)', async () => {
        stubProcesses({
            processes: [
                {
                    agentId: 'alpha',
                    pid: 1,
                    status: 'running',
                    startedAt: '2026-07-15T12:00:00Z',
                    exitCode: null,
                    teamId: 'red',
                },
                {
                    agentId: 'beta',
                    pid: 2,
                    status: 'running',
                    startedAt: '2026-07-15T12:00:00Z',
                    exitCode: null,
                    teamId: 'blue',
                },
            ],
            count: 2,
            executions: [],
            executionsCount: 0,
        });

        const { container } = render(<ProcessesView />);

        await waitFor(() => expect(container.querySelector('[data-processes-row="sup:alpha"]')).not.toBeNull());

        const select = container.querySelector('[data-processes-filter-team]') as HTMLSelectElement;
        act(() => fireEvent.change(select, { target: { value: 'red' } }));

        await waitFor(() => expect(container.querySelector('[data-processes-row="sup:beta"]')).toBeNull());
        expect(container.querySelector('[data-processes-row="sup:alpha"]')).not.toBeNull();
    });

    test('team=unassigned selects only rows with no teamId (0267 R2)', async () => {
        stubProcesses({
            processes: [
                {
                    agentId: 'alpha',
                    pid: 1,
                    status: 'running',
                    startedAt: '2026-07-15T12:00:00Z',
                    exitCode: null,
                    teamId: 'red',
                },
                {
                    agentId: 'beta',
                    pid: 2,
                    status: 'running',
                    startedAt: '2026-07-15T12:00:00Z',
                    exitCode: null,
                    teamId: null,
                },
            ],
            count: 2,
            executions: [],
            executionsCount: 0,
        });

        const { container } = render(<ProcessesView />);

        await waitFor(() => expect(container.querySelector('[data-processes-row="sup:alpha"]')).not.toBeNull());

        const select = container.querySelector('[data-processes-filter-team]') as HTMLSelectElement;
        act(() => fireEvent.change(select, { target: { value: 'unassigned' } }));

        await waitFor(() => expect(container.querySelector('[data-processes-row="sup:alpha"]')).toBeNull());
        expect(container.querySelector('[data-processes-row="sup:beta"]')).not.toBeNull();
    });

    test('filters hiding all rows show the no-matches empty state (0267 R4)', async () => {
        stubProcesses({
            processes: [
                {
                    agentId: 'alpha',
                    pid: 1,
                    status: 'exited',
                    startedAt: '2026-07-15T12:00:00Z',
                    exitCode: 0,
                    teamId: null,
                },
            ],
            count: 1,
            executions: [],
            executionsCount: 0,
        });

        const { container } = render(<ProcessesView />);

        await waitFor(() => expect(container.querySelector('[data-processes-row="sup:alpha"]')).not.toBeNull());

        // Toggle running-only — the only row is exited, so nothing matches.
        const checkbox = container.querySelector('[data-processes-filter-running-input]') as HTMLInputElement;
        act(() => fireEvent.click(checkbox));

        await waitFor(() => expect(container.querySelector('[data-processes-tab-no-matches]')).not.toBeNull());
        // Filter controls stay visible so the user can widen the view.
        expect(container.querySelector('[data-processes-filters]')).not.toBeNull();
        expect(container.querySelector('[data-processes-tab-filtered-empty]')).not.toBeNull();
    });
});
