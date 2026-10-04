import { describe, expect, test } from 'bun:test';

import { contract } from '../src';
import { runsContract, workflowProgressProjectionSchema } from '../src/runs';

/** Extract the route metadata from an oRPC contract procedure. */
function routeOf(proc: object): { method: string; path: string } | undefined {
    const orpc = (proc as Record<string, unknown>)['~orpc'] as { route: { method: string; path: string } } | undefined;
    return orpc?.route;
}

const fullProjectionFixture = {
    schemaVersion: 1,
    runId: 'r1',
    workflow: 'test-pipeline',
    status: 'completed',
    definitionDigest: 'sha256:abc',
    version: '2.0.0',
    currentState: 'done',
    states: [
        {
            state: 'precheck',
            visit: 1,
            status: 'passed',
            actions: [
                {
                    actionKey: 'precheck:onEnter:0',
                    kind: 'shell',
                    stateEffect: 'may-write',
                    evidenceEffect: 'none',
                    status: 'passed',
                    attempts: [
                        {
                            actionRunId: 'a1',
                            status: 'success',
                            ok: true,
                            startedAt: '2026-08-19T00:00:01Z',
                            completedAt: '2026-08-19T00:00:02Z',
                            durationMs: 100,
                        },
                    ],
                },
            ],
        },
    ],
    transitions: [{ from: 'precheck', to: 'implement', trigger: 'precheck passed', at: '2026-08-19T00:00:03Z' }],
    artifacts: [{ kind: 'test-artifact', path: '.spur/run/out.json' }],
    nextTransitions: [{ from: 'implement', to: 'done', trigger: 'implement passed', eligibility: 'eligible' }],
    diagnostics: [{ code: 'definition-drift', message: 'digest differs' }],
    projectedAt: '2026-10-04T00:00:00.000Z',
};

describe('runs contract (1069 / E72 R5)', () => {
    test('schema accepts a full projection fixture', () => {
        const result = workflowProgressProjectionSchema.parse(fullProjectionFixture);
        expect(result.runId).toBe('r1');
        expect(result.states[0]?.actions[0]?.attempts[0]?.ok).toBe(true);
    });

    test('schema accepts the unknown-run shape (states: [], orphan-row diagnostic, no version key)', () => {
        const unknownRun = {
            schemaVersion: 1,
            runId: 'nope',
            workflow: 'unknown',
            status: 'unknown',
            definitionDigest: null,
            currentState: null,
            states: [],
            transitions: [],
            artifacts: [],
            nextTransitions: [],
            diagnostics: [{ code: 'orphan-row', message: 'No workflow run found with id "nope"' }],
            projectedAt: '2026-10-04T00:00:00.000Z',
        };
        const result = workflowProgressProjectionSchema.parse(unknownRun);
        expect(result.version).toBeUndefined();
        expect(result.diagnostics[0]?.code).toBe('orphan-row');
    });

    test('schema rejects schemaVersion 2 and a bad status', () => {
        expect(() => workflowProgressProjectionSchema.parse({ ...fullProjectionFixture, schemaVersion: 2 })).toThrow();
        expect(() => workflowProgressProjectionSchema.parse({ ...fullProjectionFixture, status: 'done' })).toThrow();
        expect(() =>
            workflowProgressProjectionSchema.parse({
                ...fullProjectionFixture,
                diagnostics: [{ code: 'bogus-code', message: 'x' }],
            }),
        ).toThrow();
    });

    test('contract.runs.progress exists with the documented route', () => {
        expect(routeOf(runsContract.progress)).toMatchObject({ method: 'GET', path: '/runs/{runId}/progress' });
        expect(contract.runs.progress).toBeDefined();
        expect(routeOf(contract.runs.progress)).toMatchObject({ method: 'GET', path: '/runs/{runId}/progress' });
    });
});
