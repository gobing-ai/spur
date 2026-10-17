/**
 * The executor matrix's decision contract (task 1238 R2/R3, feature D65).
 *
 * These are the failure modes FIRST: a host column that never paused, a receipt that does not
 * match the paused run, a subprocess column that reached a terminal state without its receipt,
 * a fleet column whose scaffolding failed (blocked with the precondition named, never a pass),
 * and two executors whose action sequences or receipt shapes disagree. The matrix body in
 * `fleet-e2e.ts` only collects observations; every pass/blocked/failed word below is decided by
 * the functions this file pins.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
    compareMatrixColumns,
    hostColumnVerdict,
    type MatrixColumn,
    type MatrixHostProbe,
    matrixExitCode,
    matrixPrecondition,
    receiptShapeOf,
    runColumnVerdict,
} from './fleet-e2e';

describe('1238 R2: the matrix fixture is one agent.run stage and one decision gate', () => {
    const fixture = parseYaml(
        readFileSync(
            join(import.meta.dir, '../../packages/app/tests/fixtures/1238/executor-matrix-fixture.yaml'),
            'utf8',
        ),
    ) as {
        name: string;
        states: Array<{ id: string; onEnter?: Array<{ kind: string }> }>;
        terminalStates: string[];
        initialState: string;
    };

    test('the tracked fixture declares exactly the two actions the matrix proves', () => {
        const kinds = fixture.states.flatMap((state) => (state.onEnter ?? []).map((action) => action.kind));
        expect(fixture.name).toBe('executor-matrix');
        expect(kinds.filter((kind) => kind === 'agent.run')).toHaveLength(1);
        expect(kinds.filter((kind) => kind === 'hitl.confirm')).toHaveLength(1);
        // No deterministic step: every extra action would widen what the matrix proves about dispatch.
        expect(kinds).toHaveLength(2);
    });

    test('it is a fixture, not a shipped definition', () => {
        expect(fixture.initialState).toBe('work');
        expect(fixture.terminalStates).toEqual(['done', 'blocked']);
    });
});

function column(executor: MatrixColumn['executor'], overrides: Partial<MatrixColumn> = {}): MatrixColumn {
    return {
        executor,
        status: 'passed',
        runId: 'run-1',
        finalState: 'done',
        actions: [
            { node: 'work', actionKind: 'agent.run', status: 'done' },
            { node: 'decide', actionKind: 'hitl.confirm', status: 'done' },
        ],
        receiptShape: 'executor,files,finishedAt,outcome,reason,runId,startedAt,state',
        precondition: null,
        evidence: 'observed',
        ...overrides,
    };
}

const HOST_PAUSE: NonNullable<MatrixHostProbe['pause']> = {
    runId: 'run-1',
    state: 'work',
    expectFiles: ['.spur/run/executor-matrix-result.txt'],
};

describe('1238 R2: the host column completes on a work-item receipt', () => {
    test('a pause carrying the work item, a refused mismatch and a done resume pass', () => {
        const verdict = hostColumnVerdict({
            pause: HOST_PAUSE,
            mismatchedReceiptExitCode: 1,
            finalState: 'done',
        });
        expect(verdict).toEqual({ status: 'passed', reason: null });
    });

    test('a run that never paused on the stage fails', () => {
        const verdict = hostColumnVerdict({ pause: null, mismatchedReceiptExitCode: 1, finalState: 'done' });
        expect(verdict.status).toBe('failed');
        expect(verdict.reason).toContain('never paused');
    });

    test('a receipt that does not match the paused run must be refused', () => {
        const verdict = hostColumnVerdict({
            pause: HOST_PAUSE,
            mismatchedReceiptExitCode: 0,
            finalState: 'done',
        });
        expect(verdict.status).toBe('failed');
        expect(verdict.reason).toContain('refused');
    });

    test('a resume that did not reach the terminal state fails', () => {
        const verdict = hostColumnVerdict({ pause: HOST_PAUSE, mismatchedReceiptExitCode: 1, finalState: 'blocked' });
        expect(verdict.status).toBe('failed');
        expect(verdict.reason).toContain('blocked');
    });
});

describe('1238 R2: the subprocess column completes on its own durable receipt', () => {
    test('a done run with a subprocess receipt passes', () => {
        expect(runColumnVerdict('subprocess', { finalState: 'done', receiptExecutor: 'subprocess' })).toEqual({
            status: 'passed',
            reason: null,
        });
    });

    test('a terminal run without a receipt fails: the receipt is the evidence', () => {
        const verdict = runColumnVerdict('subprocess', { finalState: 'done', receiptExecutor: null });
        expect(verdict.status).toBe('failed');
        expect(verdict.reason).toContain('receipt');
    });

    test('a receipt written by another executor fails', () => {
        const verdict = runColumnVerdict('subprocess', { finalState: 'done', receiptExecutor: 'host' });
        expect(verdict.status).toBe('failed');
        expect(verdict.reason).toContain('host');
    });
});

describe('1238 R3: an unavailable fleet is blocked with its precondition, never a pass', () => {
    test('a failed scaffolding precondition blocks the column and names it', () => {
        const verdict = runColumnVerdict('fleet', {
            finalState: null,
            receiptExecutor: null,
            precondition: 'no enabled fleet member for role coder',
        });
        expect(verdict.status).toBe('blocked');
        expect(verdict.reason).toBe('no enabled fleet member for role coder');
    });

    test('a blocked column makes the matrix exit non-zero and never green', () => {
        const columns = [
            column('host'),
            column('subprocess'),
            column('fleet', { status: 'blocked', runId: null, finalState: null, precondition: 'fleet unbound' }),
        ];
        expect(matrixExitCode(columns)).toBe(2);
    });

    test('a failed column outranks a blocked one', () => {
        const columns = [
            column('host', { status: 'failed' }),
            column('subprocess'),
            column('fleet', { status: 'blocked', precondition: 'fleet unbound' }),
        ];
        expect(matrixExitCode(columns)).toBe(1);
    });

    test('the blocked precondition is stable but still names the real cause', () => {
        // The dispatch reason carries volatile ids (member instance, run id); the receipt must
        // repeat across runs while still naming what failed.
        const a = matrixPrecondition(
            'message send to member \'proj-1792-coder-1\' failed: Invalid agent id "workflow:11111111-1111-1111-1111-111111111111"',
        );
        const b = matrixPrecondition(
            'message send to member \'proj-9001-coder-1\' failed: Invalid agent id "workflow:22222222-2222-2222-2222-222222222222"',
        );
        expect(a).toBe(b);
        expect(a).toContain('workflow:<runId>');
        expect(a).toContain('validateAgentId');
        // An unrecognized reason is never generalized away.
        expect(matrixPrecondition('fleet is disabled (agent.fleet.enabled: false)')).toBe(
            'fleet is disabled (agent.fleet.enabled: false)',
        );
    });

    test('an all-passed matrix exits zero', () => {
        expect(matrixExitCode([column('host'), column('subprocess'), column('fleet')])).toBe(0);
    });
});

describe('1238 R2: traces and receipts are identical in shape across executors', () => {
    test('three passed columns with the same action sequence and receipt shape agree', () => {
        const mismatches = compareMatrixColumns([column('host'), column('subprocess'), column('fleet')]);
        expect(mismatches).toEqual([]);
    });

    test('the executor field alone never makes the receipts differ — only their shape is compared', () => {
        // `executor` is the one field the contract expects to differ per column; the shape (the
        // sorted key list) is identical, and the values are not compared at all.
        expect(receiptShapeOf({ runId: 'a', state: 'work', executor: 'host' })).toBe(
            receiptShapeOf({ runId: 'b', state: 'work', executor: 'fleet' }),
        );
    });

    test('a missing action fails the comparison, naming the executor and the step', () => {
        const mismatches = compareMatrixColumns([
            column('host'),
            column('subprocess', { actions: [{ node: 'work', actionKind: 'agent.run', status: 'done' }] }),
        ]);
        expect(mismatches.length).toBe(1);
        expect(mismatches[0]).toContain('subprocess');
        expect(mismatches[0]).toContain('action sequence');
    });

    test('a receipt with a different key set fails the comparison', () => {
        const mismatches = compareMatrixColumns([
            column('host'),
            column('fleet', { receiptShape: 'executor,outcome,runId,state' }),
        ]);
        expect(mismatches.length).toBe(1);
        expect(mismatches[0]).toContain('receipt shape');
    });

    test('a blocked column is excluded from the comparison but must name its precondition', () => {
        const named = compareMatrixColumns([
            column('host'),
            column('subprocess'),
            column('fleet', { status: 'blocked', finalState: null, precondition: 'fleet unbound' }),
        ]);
        expect(named).toEqual([]);
        const unnamed = compareMatrixColumns([
            column('host'),
            column('subprocess'),
            column('fleet', { status: 'blocked', finalState: null, precondition: null }),
        ]);
        expect(unnamed.length).toBe(1);
        expect(unnamed[0]).toContain('without a named precondition');
    });
});
