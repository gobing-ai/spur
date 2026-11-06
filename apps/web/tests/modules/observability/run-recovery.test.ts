/**
 * Task 1307: policy failure cases, then a rendered journey from a task link
 * to redacted evidence and a copyable recovery command.
 *
 * happy-dom stands in for a browser. The journey asserts GET-only traffic.
 */
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { workflowProgressProjectionSchema } from '@gobing-ai/spur-contracts';
import type { EvidenceStatus, RecoveryInput, RecoveryView } from '../../../src/modules/observability/run-recovery';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

registerHappyDom();

const { act, cleanup, fireEvent, render, waitFor } = await import('@testing-library/react');
const { createElement } = await import('react');
const { MemoryRouter, Route, Routes, useParams } = await import('react-router');
const { resetFetchForTesting, setFetchForTesting } = await import('../../../src/lib/rpc-client');
const { default: ObservabilityShell } = await import('../../../src/modules/observability/ObservabilityShell');
const { TaskRunEvidenceLink } = await import('../../../src/modules/task-kanban/TaskRunEvidenceLink');
const { TASK_STATUS_ACTIONS } = await import('../../../src/modules/task-kanban/task-actions');
const policy = await import('../../../src/modules/observability/run-recovery');

afterAll(teardownHappyDom);
afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

const SECRET = 'super-secret-prompt';

function recovery(over: Partial<RecoveryInput> = {}): RecoveryView {
    return policy.buildRecovery({
        runId: 'run-1',
        runStatus: 'failed',
        wbs: '1307',
        taskStatus: 'wip',
        resultSummary: null,
        recordStatus: 'record',
        ...over,
    });
}

function linkedRun(id: string, status: string, startedAt = '2020-01-01T00:00:00.000Z') {
    return {
        id,
        workflowName: 'task-pipeline',
        status,
        mode: 'auto',
        agent: 'grok',
        startedAt,
        completedAt: status === 'done' ? '2020-01-01T01:00:00.000Z' : null,
    };
}

function projection(
    runId: string,
    state: string,
    stateStatus: 'running' | 'failed' | 'passed',
    runStatus: 'running' | 'failed' | 'completed',
) {
    const body = {
        schemaVersion: 1,
        runId,
        workflow: 'task-pipeline',
        status: runStatus,
        definitionDigest: null,
        currentState: state,
        states: [
            {
                state,
                visit: 1,
                status: stateStatus,
                actions: [
                    {
                        actionKey: 'implement',
                        kind: 'agent.run',
                        stateEffect: 'write',
                        evidenceEffect: 'write',
                        status: stateStatus === 'passed' ? 'passed' : stateStatus,
                        attempts: [],
                    },
                ],
            },
        ],
        transitions: [],
        artifacts: [],
        nextTransitions: [],
        diagnostics: [],
        projectedAt: '2026-11-05T00:00:00.000Z',
    };
    const parsed = workflowProgressProjectionSchema.safeParse(body);
    if (!parsed.success) throw new Error(parsed.error.message);
    return parsed.data;
}

function detail(runId: string, status: string, node: string, resultSummary: unknown) {
    return {
        run: linkedRun(runId, status),
        phases: [],
        transitions: [],
        actions: [
            {
                id: 'action-1',
                node,
                kind: 'agent.run',
                status: 'running',
                durationMs: null,
                ok: null,
                resultSummary,
                startedAt: null,
                completedAt: null,
            },
        ],
    };
}

interface RouteReply {
    status?: number;
    body: unknown;
}

function installFetch(reply: (url: URL) => RouteReply) {
    const calls: { method: string; url: string }[] = [];
    setFetchForTesting((async (input: Request) => {
        calls.push({ method: input.method, url: input.url });
        const result = reply(new URL(input.url));
        return new Response(JSON.stringify(result.body), {
            status: result.status ?? 200,
            headers: { 'content-type': 'application/json' },
        });
    }) as typeof fetch);
    return calls;
}

function renderTrace(wbs = '1307') {
    return render(
        createElement(
            MemoryRouter,
            { initialEntries: [`/board/observability?tab=trace&wbs=${wbs}`] },
            createElement(
                Routes,
                null,
                createElement(Route, { path: '/board/observability', element: createElement(ObservabilityShell) }),
            ),
        ),
    );
}

function TaskPage() {
    const params = useParams();
    return createElement(TaskRunEvidenceLink, { wbs: params.wbs ?? '' });
}

function renderJourney() {
    return render(
        createElement(
            MemoryRouter,
            { initialEntries: ['/board/tasks/1307'] },
            createElement(
                Routes,
                null,
                createElement(Route, { path: '/board/tasks/:wbs', element: createElement(TaskPage) }),
                createElement(Route, { path: '/board/observability', element: createElement(ObservabilityShell) }),
            ),
        ),
    );
}

async function expand(runId: string, key: 'Enter' | 'click' = 'click') {
    const row = document.querySelector(`[data-run-id="${runId}"]`);
    if (!(row instanceof HTMLElement)) throw new Error(`missing run row ${runId}`);
    if (key === 'click') fireEvent.click(row);
    else fireEvent.keyDown(row, { key });
    await waitFor(() => {
        const guidance = document.querySelector('[data-recovery-guidance]');
        if (guidance === null) throw new Error('recovery guidance did not render');
    });
}

describe('run recovery policy', () => {
    test('retry eligibility follows the task board run action', () => {
        for (const [status, actions] of Object.entries(TASK_STATUS_ACTIONS)) {
            expect(policy.taskRetryPermitted(status)).toBe(actions.includes('run'));
        }
        expect(policy.taskRetryPermitted(null)).toBe(false);
        expect(policy.taskRetryPermitted('nope')).toBe(false);
        expect(policy.taskRetryCommand('1307')).toBe('/sp:dev-run 1307 --auto');
        expect(policy.taskRetryCommand('12')).toBeNull();
        expect(policy.taskRetryCommand('abcd')).toBeNull();
    });

    test('redacts sensitive keys, nested values, arrays, and long strings', () => {
        const long = 'x'.repeat(257);
        const redacted = policy.redactForDisplay({
            prompt: SECRET,
            nested: [{ value: 'hidden', note: long }],
            ok: true,
        }) as { prompt: string; nested: { value: string; note: string }[]; ok: boolean };
        expect(redacted.prompt).toBe('[redacted]');
        expect(redacted.nested[0]?.value).toBe('[redacted]');
        expect(redacted.nested[0]?.note.endsWith('…')).toBe(true);
        expect(redacted.nested[0]?.note.includes(long)).toBe(false);
        expect(redacted.ok).toBe(true);
        expect(policy.redactForDisplay(7)).toBe(7);
        expect(policy.redactForDisplay(null)).toBeNull();
    });

    test('parses linked runs and rejects null, mismatched, and unreadable rows', () => {
        expect(policy.parseLinkedRuns(null)).toBeNull();
        expect(policy.parseLinkedRuns([])).toBeNull();
        expect(policy.parseLinkedRuns({ count: 0 })).toBeNull();
        const valid = linkedRun('run-1', 'paused');
        const parsed = policy.parseLinkedRuns({
            links: [
                null,
                { runId: '', run: valid },
                { runId: 4, run: valid },
                { runId: 'gone', run: null },
                { runId: 'foreign', run: linkedRun('other', 'failed') },
                { runId: 'bad', run: { id: 1 } },
                { runId: 'bad-name', run: { ...valid, id: 'bad-name', workflowName: 1 } },
                { runId: 'bad-status', run: { ...valid, id: 'bad-status', status: 1 } },
                { runId: 'bad-mode', run: { ...valid, id: 'bad-mode', mode: 1 } },
                { runId: 'bad-agent', run: { ...valid, id: 'bad-agent', agent: 1 } },
                { runId: 'bad-start', run: { ...valid, id: 'bad-start', startedAt: 1 } },
                { runId: 'bad-end', run: { ...valid, id: 'bad-end', completedAt: 1 } },
                { runId: 'run-1', run: valid },
            ],
        });
        expect(parsed?.runs.map((run) => run.id)).toEqual(['run-1']);
        expect(parsed?.rejectedIds).toEqual([
            'gone',
            'foreign',
            'bad',
            'bad-name',
            'bad-status',
            'bad-mode',
            'bad-agent',
            'bad-start',
            'bad-end',
        ]);
        expect(policy.parseLinkedRuns({ links: [{ nope: true }] })).toEqual({ runs: [], rejectedIds: [] });
    });

    test('selects the failed state and the detail row that explains it', () => {
        expect(policy.selectCause({ currentState: null, states: [] }, [])).toBeNull();
        const states = [
            {
                state: 'plan',
                status: 'passed',
                actions: [{ actionKey: 'plan', status: 'passed' }],
            },
            {
                state: 'implement',
                status: 'failed',
                actions: [
                    { actionKey: 'lint', status: 'passed' },
                    { actionKey: 'implement', status: 'failed' },
                ],
            },
        ];
        const chosen = policy.selectCause({ currentState: 'plan', states }, [
            { node: 'implement', status: 'passed', resultSummary: { outcome: 'done' } },
            { node: 'implement', status: 'failed', resultSummary: { outcome: 'failed', proof: 'stale' } },
        ]);
        expect(chosen).toEqual({
            state: 'implement',
            actionKey: 'implement',
            actionStatus: 'failed',
            resultSummary: { outcome: 'failed', proof: 'stale' },
        });
        const current = policy.selectCause(
            {
                currentState: 'plan',
                states: [{ state: 'plan', status: 'running', actions: [{ actionKey: 'plan', status: 'running' }] }],
            },
            [{ node: 'plan', status: 'running', resultSummary: { ok: true } }],
        );
        expect(current?.state).toBe('plan');
        expect(current?.resultSummary).toEqual({ ok: true });
        const first = policy.selectCause(
            {
                currentState: null,
                states: [{ state: 'only', status: 'running', actions: [] }],
            },
            [{ node: 'only', status: 'running', resultSummary: null }],
        );
        expect(first).toEqual({ state: 'only', actionKey: null, actionStatus: 'running', resultSummary: null });
        const summaryOnly = policy.selectCause(
            { currentState: 'missing', states: [{ state: 'only', status: 'passed', actions: [] }] },
            [{ node: 'only', status: 'passed', resultSummary: { outcome: 'done' } }],
        );
        expect(summaryOnly?.resultSummary).toEqual({ outcome: 'done' });
        const bare = policy.selectCause(
            { currentState: 'only', states: [{ state: 'only', status: 'passed', actions: [] }] },
            [{ node: 'only', status: 'passed', resultSummary: null }],
        );
        expect(bare?.actionStatus).toBe('passed');
    });

    test('paused continue uses a placeholder and rejects a work item for another run', () => {
        const workItem = {
            prompt: SECRET,
            data: { workItem: { runId: 'run-1', state: 'review' }, reason: 'host-work-item' },
        };
        const paused = recovery({ runStatus: 'PAUSED', resultSummary: workItem, recordStatus: 'missing' });
        expect(paused.guidance).toEqual({
            kind: 'continue',
            command: 'spur workflow continue run-1 --answer-text <input>',
            inputLabel: 'Input: receipt path for the paused work item.',
        });
        expect(paused.rejected).toBe(false);
        expect(JSON.stringify(paused)).not.toContain(SECRET);
        expect(paused.evidence.reusableAsFresh).toBe(false);
        expect(paused.evidence.provenanceUsable).toBe(true);

        const gate = recovery({
            runStatus: 'paused',
            resultSummary: { reason: 'hitl-pause', kind: 'confirm', prompt: SECRET },
        });
        expect(gate.guidance).toMatchObject({
            kind: 'continue',
            command: 'spur workflow continue run-1 --answer <input>',
            inputLabel: 'Input: yes, no, or cancel. This label is not an answer.',
        });
        for (const kind of ['hitl.confirm', 'select', 'hitl.select'] as const) {
            const view = recovery({ runStatus: 'paused', resultSummary: { reason: 'hitl-pause', kind } });
            expect(view.guidance).toMatchObject({
                kind: 'continue',
                command: expect.stringContaining('--answer <input>'),
            });
            expect(JSON.stringify(view.guidance)).not.toContain('--answer-text');
        }
        for (const kind of ['input', 'hitl.input'] as const) {
            const view = recovery({ runStatus: 'paused', resultSummary: { reason: 'hitl-pause', kind } });
            expect(view.guidance).toMatchObject({
                kind: 'continue',
                command: 'spur workflow continue run-1 --answer-text <input>',
            });
        }
        const both = recovery({
            runStatus: 'paused',
            resultSummary: {
                ...workItem,
                reason: 'hitl-pause',
                kind: 'confirm',
            },
        });
        expect(both.guidance).toMatchObject({ command: 'spur workflow continue run-1 --answer-text <input>' });

        const rejected = recovery({
            runStatus: 'paused',
            resultSummary: {
                data: { workItem: { runId: 'other-run', state: 'review' } },
                reason: 'hitl-pause',
                kind: 'confirm',
            },
        });
        expect(rejected.rejected).toBe(true);
        expect(rejected.guidance).toMatchObject({
            kind: 'inspection-only',
            reason: 'Work item belongs to a different run and was rejected. Inspection only.',
        });
        expect(JSON.stringify(rejected.guidance)).not.toContain('workflow continue');

        const emptyState = recovery({
            runStatus: 'paused',
            resultSummary: { workItem: { runId: 'run-1', state: '' } },
        });
        expect(emptyState.rejected).toBe(false);
        expect(emptyState.guidance).toMatchObject({
            reason: 'Paused run has no valid work item or operator-gate metadata. Inspection only.',
        });
        const unknownGate = recovery({
            runStatus: 'paused',
            resultSummary: { reason: 'hitl-pause', kind: 'approve', workItem: 'nope' },
        });
        expect(unknownGate.guidance.kind).toBe('inspection-only');
    });

    test('failed retry follows the current lifecycle and refuses a bad run id', () => {
        expect(recovery().guidance).toEqual({
            kind: 'retry',
            traceCommand: 'spur workflow trace run-1',
            retryCommand: '/sp:dev-run 1307 --auto',
        });
        expect(recovery({ taskStatus: 'todo' }).guidance).toMatchObject({ kind: 'retry' });
        expect(recovery({ taskStatus: null }).guidance).toMatchObject({
            kind: 'inspection-only',
            reason: 'Task lifecycle is unknown. Inspection only.',
        });
        expect(recovery({ taskStatus: 'testing' }).guidance).toMatchObject({
            reason: 'Task lifecycle does not permit retry. Inspection only.',
        });
        expect(recovery({ taskStatus: 'done' }).guidance).toMatchObject({ kind: 'inspection-only' });
        expect(recovery({ wbs: null }).guidance).toMatchObject({
            reason: 'Task lifecycle does not permit retry. Inspection only.',
        });
        expect(recovery({ wbs: '12' }).guidance).toMatchObject({
            reason: 'Task lifecycle does not permit retry. Inspection only.',
        });
        const unsafe = recovery({ runId: 'run/1', runStatus: 'paused' });
        expect(unsafe.guidance).toEqual({
            kind: 'inspection-only',
            traceCommand: null,
            reason: 'Run id cannot be copied into a command. Inspection only.',
        });
        expect(recovery({ runStatus: 'interrupted' }).guidance).toMatchObject({
            reason: 'This run is not a failed or paused run with a recovery command. Inspection only.',
            traceCommand: 'spur workflow trace run-1',
        });
        expect(recovery({ runStatus: 'done' }).guidance.kind).toBe('inspection-only');
        expect(JSON.stringify(recovery({ runStatus: 'done' }).guidance)).not.toContain('dev-run');
    });

    test('evidence and proof stay explicit and are never fresh receipts', () => {
        const cases: { status: EvidenceStatus; reason?: string; message: string }[] = [
            {
                status: 'record',
                message:
                    'Retained run record is usable provenance. It is not a fresh receipt and cannot be reused as evidence for a new attempt.',
            },
            {
                status: 'incomplete',
                reason: 'disk',
                message:
                    'Scratch record is incomplete (disk) and cannot be reused as fresh evidence. Retained run progress remains usable provenance.',
            },
            {
                status: 'incomplete',
                message:
                    'Scratch record is incomplete (unspecified) and cannot be reused as fresh evidence. Retained run progress remains usable provenance.',
            },
            {
                status: 'legacy',
                message:
                    'Legacy scratch record cannot be reused as fresh evidence. Retained run progress remains usable provenance.',
            },
            {
                status: 'oversized',
                message:
                    'Run record is oversized and cannot be reused as fresh evidence. Retained run progress remains usable provenance.',
            },
            {
                status: 'missing',
                message:
                    'Disposable scratch is expired or missing and cannot be reused as fresh evidence. Retained run progress remains usable provenance.',
            },
            {
                status: 'unread',
                message:
                    'Run record could not be read and cannot be reused as fresh evidence. Retained run progress remains usable provenance.',
            },
        ];
        for (const item of cases) {
            const view = recovery({ recordStatus: item.status, recordReason: item.reason });
            expect(view.evidence).toEqual({
                message: item.message,
                provenanceUsable: true,
                reusableAsFresh: false,
            });
        }
        expect(recovery({ resultSummary: { proof: 'stale' } }).proof).toEqual({
            kind: 'invalid',
            message: 'Invalid proof cannot be reused as fresh evidence.',
        });
        for (const proof of ['missing', 'invalid'] as const) {
            expect(recovery({ resultSummary: { proof } }).proof?.kind).toBe('invalid');
        }
        for (const outcome of ['failed', 'not-started', 'outcome-unknown', 'contract-violation'] as const) {
            expect(recovery({ resultSummary: [{ outcome }] }).proof?.kind).toBe('invalid');
        }
        expect(recovery({ resultSummary: { outcome: 'done', proof: 'stale' } }).proof?.kind).toBe('invalid');
        expect(recovery({ resultSummary: { outcome: 'done' } }).proof).toEqual({
            kind: 'retained',
            message: 'A retained receipt is not fresh evidence and cannot be reused.',
        });
        expect(recovery({ resultSummary: { outcome: 'running', proof: 'fresh' } }).proof).toBeNull();
        expect(recovery({ resultSummary: { note: 'plain' } }).proof).toBeNull();
    });
});

describe('task to run evidence journey', () => {
    const pausedSummary = {
        prompt: SECRET,
        data: { surface: 'host', workItem: { runId: 'paused-run', state: 'review' }, reason: 'host-work-item' },
    };

    function ac1Reply(taskStatus: number | string = 'wip') {
        return (url: URL): RouteReply => {
            const path = url.pathname;
            if (path.endsWith('/runs/by-wbs/1307')) {
                return {
                    body: {
                        wbs: '1307',
                        count: 3,
                        links: [
                            {
                                runId: 'paused-run',
                                kind: 'execute',
                                linkedAt: '2020-01-01T00:00:00.000Z',
                                run: linkedRun('paused-run', 'paused'),
                            },
                            {
                                runId: 'failed-run',
                                kind: 'execute',
                                linkedAt: '2020-01-01T00:00:00.000Z',
                                run: linkedRun('failed-run', 'failed'),
                            },
                            { runId: 'missing-run', kind: 'execute', linkedAt: '2020-01-01T00:00:00.000Z', run: null },
                        ],
                    },
                };
            }
            if (path.endsWith('/tasks/1307')) {
                if (typeof taskStatus === 'number') return { status: taskStatus, body: { ok: false } };
                return { body: { ok: true, data: { status: taskStatus } } };
            }
            if (path.includes('/run-record/')) return { body: { status: 'missing' } };
            if (path.endsWith('/paused-run/progress')) {
                return { body: projection('paused-run', 'execute', 'running', 'running') };
            }
            if (path.endsWith('/failed-run/progress')) {
                return { body: projection('failed-run', 'implement', 'failed', 'failed') };
            }
            if (path.endsWith('/paused-run')) return { body: detail('paused-run', 'paused', 'execute', pausedSummary) };
            if (path.endsWith('/failed-run')) {
                return { body: detail('failed-run', 'failed', 'implement', { outcome: 'failed', proof: 'stale' }) };
            }
            return { status: 500, body: { error: `unexpected ${path}` } };
        };
    }

    test('keyboard reaches redacted paused evidence in two steps and does not execute recovery', async () => {
        const calls = installFetch(ac1Reply());
        renderJourney();
        const link = document.querySelector('[data-task-run-evidence="1307"]');
        expect(link).not.toBeNull();
        expect(link?.getAttribute('href')).toBe('/board/observability?tab=trace&wbs=1307');
        expect(link?.textContent).toContain('Run evidence for 1307');
        expect(document.querySelector('[data-recovery-command]')).toBeNull();
        if (!(link instanceof HTMLElement)) throw new Error('missing task link');
        fireEvent.keyDown(link, { key: 'Enter' });

        await waitFor(() => expect(document.querySelector('[data-run-id="paused-run"]')).not.toBeNull());
        expect(document.querySelector('[data-trace-linked-wbs="1307"]')).not.toBeNull();
        expect(document.querySelector('[data-run-id="failed-run"]')).not.toBeNull();
        expect(document.querySelector('[data-rejected-run="missing-run"]')?.textContent).toContain('was rejected');
        expect(document.querySelector('[data-recovery-command]')).toBeNull();
        const afterLink = calls.map((call) => new URL(call.url).pathname);
        expect(afterLink.some((path) => path.endsWith('/runs/by-wbs/1307'))).toBe(true);
        expect(afterLink.some((path) => path === '/api/runs' || path.endsWith('/runs'))).toBe(false);
        expect(calls.some((call) => new URL(call.url).searchParams.has('since'))).toBe(false);
        expect(calls.some((call) => call.url.includes('missing-run'))).toBe(false);
        expect(afterLink.some((path) => path.includes('/progress'))).toBe(false);

        await expand('paused-run', 'Enter');
        const command = document.querySelector('[data-recovery-command="continue"]');
        expect(command?.textContent).toBe('spur workflow continue paused-run --answer-text <input>');
        expect(document.body.textContent).toContain('<input>');
        expect(document.body.textContent).not.toContain('--answer yes');
        expect(document.body.textContent).not.toContain(SECRET);
        expect(document.body.textContent).toContain('[redacted]');
        expect(document.querySelector('[data-cause]')?.textContent).toContain('execute');
        expect(document.querySelector('[data-evidence-notice]')?.textContent).toContain('expired or missing');
        expect(document.querySelector('[data-reusable-as-fresh="false"]')).not.toBeNull();
        expect(document.querySelector('[data-run-record]')).not.toBeNull();
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
        expect(calls.some((call) => call.url.includes('missing-run'))).toBe(false);

        const copy = document.querySelector('[aria-label="Copy continue command"]');
        if (!(copy instanceof HTMLElement)) throw new Error('missing copy button');
        await act(async () => {
            fireEvent.click(copy);
        });
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
        expect(calls.some((call) => call.url.includes('continue'))).toBe(false);
    });

    test('a click opens the same paused guidance', async () => {
        installFetch(ac1Reply());
        renderTrace();
        await waitFor(() => expect(document.querySelector('[data-run-id="paused-run"]')).not.toBeNull());
        await expand('paused-run', 'click');
        expect(document.querySelector('[data-recovery-command="continue"]')?.textContent).toContain('<input>');
    });

    test('a failed run shows trace plus retry only while the task can run', async () => {
        installFetch(ac1Reply('wip'));
        renderTrace();
        await waitFor(() => expect(document.querySelector('[data-run-id="failed-run"]')).not.toBeNull());
        await expand('failed-run');
        expect(document.querySelector('[data-recovery-command="trace"]')?.textContent).toBe(
            'spur workflow trace failed-run',
        );
        expect(document.querySelector('[data-recovery-command="retry"]')?.textContent).toBe('/sp:dev-run 1307 --auto');
        expect(document.querySelector('[data-proof-notice="invalid"]')?.textContent).toContain(
            'Invalid proof cannot be reused',
        );
        expect(document.body.textContent).not.toContain('workflow continue');
    });

    test('unknown task lifecycle is inspection only', async () => {
        installFetch(ac1Reply(500));
        renderTrace();
        await waitFor(() => expect(document.querySelector('[data-run-id="failed-run"]')).not.toBeNull());
        await expand('failed-run');
        expect(document.querySelector('[data-inspection-only]')?.textContent).toContain(
            'Task lifecycle is unknown. Inspection only.',
        );
        expect(document.querySelector('[data-recovery-command="retry"]')).toBeNull();
    });

    test('a completed run keeps retained provenance and refuses expired scratch and stale proof', async () => {
        installFetch((url) => {
            const path = url.pathname;
            if (path.endsWith('/runs/by-wbs/1307')) {
                return {
                    body: {
                        wbs: '1307',
                        count: 1,
                        links: [
                            {
                                runId: 'done-run',
                                kind: 'execute',
                                linkedAt: '2020-01-01T00:00:00.000Z',
                                run: linkedRun('done-run', 'done'),
                            },
                        ],
                    },
                };
            }
            if (path.endsWith('/tasks/1307')) return { body: { ok: true, data: { status: 'done' } } };
            if (path.includes('/run-record/done-run')) return { body: { status: 'missing' } };
            if (path.endsWith('/done-run/progress')) {
                return { body: projection('done-run', 'wrap', 'passed', 'completed') };
            }
            if (path.endsWith('/done-run')) {
                return { body: detail('done-run', 'done', 'wrap', { outcome: 'done', proof: 'stale' }) };
            }
            return { status: 500, body: { error: path } };
        });
        renderTrace();
        await waitFor(() => expect(document.querySelector('[data-run-id="done-run"]')).not.toBeNull());
        expect(new URL(document.location.href).search).not.toContain('since');
        await expand('done-run');
        expect(document.querySelector('[data-evidence-notice]')?.textContent).toContain(
            'Disposable scratch is expired or missing',
        );
        expect(document.querySelector('[data-proof-notice="invalid"]')).not.toBeNull();
        expect(document.querySelector('[data-inspection-only]')).not.toBeNull();
        expect(document.querySelector('[data-recovery-command="continue"]')).toBeNull();
        expect(document.querySelector('[data-recovery-command="retry"]')).toBeNull();
        expect(document.querySelector('[data-recovery-command="trace"]')?.textContent).toBe(
            'spur workflow trace done-run',
        );
        expect(document.body.textContent).toContain('No run record found on disk.');
    });

    test('a mismatched work item is rejected and a failed detail read cannot mint a continue command', async () => {
        installFetch((url) => {
            const path = url.pathname;
            if (path.endsWith('/runs/by-wbs/1307')) {
                return {
                    body: {
                        wbs: '1307',
                        count: 1,
                        links: [
                            {
                                runId: 'paused-run',
                                kind: 'execute',
                                linkedAt: '2026-11-05T00:00:00.000Z',
                                run: linkedRun('paused-run', 'paused', '2026-11-05T00:00:00.000Z'),
                            },
                        ],
                    },
                };
            }
            if (path.endsWith('/tasks/1307')) return { body: { ok: true, data: { status: 'wip' } } };
            if (path.includes('/run-record/')) return { body: { status: 'legacy', content: 'old log' } };
            if (path.endsWith('/progress')) return { body: projection('paused-run', 'execute', 'running', 'running') };
            if (path.endsWith('/paused-run')) {
                return {
                    status: 500,
                    body: detail('paused-run', 'paused', 'execute', {
                        data: { workItem: { runId: 'other-run', state: 'review' } },
                        reason: 'hitl-pause',
                        kind: 'confirm',
                    }),
                };
            }
            return { status: 500, body: { error: path } };
        });
        renderTrace();
        await waitFor(() => expect(document.querySelector('[data-run-id="paused-run"]')).not.toBeNull());
        await expand('paused-run');
        expect(document.querySelector('[data-recovery-command="continue"]')).toBeNull();
        expect(document.querySelector('[data-inspection-only]')?.textContent).toContain('no valid work item');
    });

    test('a work item for another run is shown as rejected without a continue command', async () => {
        installFetch((url) => {
            const path = url.pathname;
            if (path.endsWith('/runs/by-wbs/1307')) {
                return {
                    body: {
                        wbs: '1307',
                        count: 1,
                        links: [
                            {
                                runId: 'paused-run',
                                kind: 'execute',
                                linkedAt: '2026-11-05T00:00:00.000Z',
                                run: linkedRun('paused-run', 'paused', '2026-11-05T00:00:00.000Z'),
                            },
                        ],
                    },
                };
            }
            if (path.endsWith('/tasks/1307')) return { body: { ok: true, data: { status: 'wip' } } };
            if (path.includes('/run-record/')) return { body: { status: 'record', markdown: '# kept', state: {} } };
            if (path.endsWith('/progress')) return { body: projection('paused-run', 'execute', 'running', 'running') };
            if (path.endsWith('/paused-run')) {
                return {
                    body: detail('paused-run', 'paused', 'execute', {
                        data: { workItem: { runId: 'other-run', state: 'review' } },
                        reason: 'hitl-pause',
                        kind: 'confirm',
                        prompt: SECRET,
                    }),
                };
            }
            return { status: 500, body: { error: path } };
        });
        renderTrace();
        await waitFor(() => expect(document.querySelector('[data-run-id="paused-run"]')).not.toBeNull());
        await expand('paused-run');
        expect(document.querySelector('[data-recovery-rejected="true"]')).not.toBeNull();
        expect(document.querySelector('[data-inspection-only]')?.textContent).toContain('different run');
        expect(document.body.textContent).not.toContain('workflow continue');
        expect(document.body.textContent).not.toContain(SECRET);
    });
});
