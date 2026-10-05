import { describe, expect, test } from 'bun:test';
import type {
    StateMachineWorkflowDef,
    TransitionFlowWorkflowDef,
    WorkflowDef,
    WorkflowPersistenceAdapter,
    WorkflowRunRecord,
} from '@gobing-ai/ts-dual-workflow-engine';
import { assertStartStateStartable, readContinuedFrom, StartStateRefusedError } from '../../src/workflow/start-state';

function stateMachine(overrides: Partial<StateMachineWorkflowDef> = {}): WorkflowDef {
    return {
        kind: 'state-machine',
        name: 'sm',
        initialState: 's1',
        terminalStates: ['done', 'broken'],
        failureStates: ['broken'],
        states: [
            { id: 's1' },
            { id: 's2', startable: true },
            { id: 's3', startable: true },
            { id: 'done' },
            { id: 'broken', startable: true },
        ],
        transitions: [
            { from: 's1', to: 's2' },
            { from: 's2', to: 's3' },
            { from: 's3', to: 'done' },
        ],
        ...overrides,
    };
}

function transitionFlow(): WorkflowDef {
    const def: TransitionFlowWorkflowDef = {
        kind: 'transition-flow',
        name: 'tf',
        initialNode: 'n1',
        terminalNodes: ['end'],
        nodes: [{ id: 'n1' }, { id: 'n2', startable: true }, { id: 'end' }],
        edges: [
            { from: 'n1', to: 'n2' },
            { from: 'n2', to: 'end' },
        ],
    };
    return def;
}

/** A source-run stub: only the two adapter members `readContinuedFrom` reads. */
function sourceRuns(
    runs: Record<string, { status: string; metadata_json: string; effectiveVars?: unknown }>,
): WorkflowPersistenceAdapter {
    return {
        loadRun: async (runId: string): Promise<WorkflowRunRecord | undefined> => {
            const row = runs[runId];
            if (row === undefined) return undefined;
            return { id: runId, status: row.status, metadata_json: row.metadata_json } as WorkflowRunRecord;
        },
        loadLatestStateSnapshot: async (runId: string) => {
            const row = runs[runId];
            if (row === undefined || row.effectiveVars === undefined) return undefined;
            return { state: 'x', data: { effectiveVars: row.effectiveVars } };
        },
    } as unknown as WorkflowPersistenceAdapter;
}

describe('assertStartStateStartable (task 1072 R2/R3)', () => {
    test('accepts a state the author marked startable', () => {
        expect(() => assertStartStateStartable(stateMachine(), 's2')).not.toThrow();
        expect(() => assertStartStateStartable(transitionFlow(), 'n2')).not.toThrow();
    });

    test('refuses an undeclared state and lists the startable ids', () => {
        expect(() => assertStartStateStartable(stateMachine(), 'nope')).toThrow(StartStateRefusedError);
        expect(() => assertStartStateStartable(stateMachine(), 'nope')).toThrow(/Startable ids: s2, s3, broken/);
    });

    test('refuses when nothing is startable, naming the opt-in', () => {
        const none: WorkflowDef = {
            kind: 'state-machine',
            name: 'sm',
            initialState: 's1',
            states: [{ id: 's1' }],
            transitions: [],
        };
        expect(() => assertStartStateStartable(none, 'nope')).toThrow(/No state declares startable: true/);
    });

    test('refuses a terminal state and a failure state', () => {
        expect(() => assertStartStateStartable(stateMachine(), 'done')).toThrow(/terminal state/);
        expect(() => assertStartStateStartable(stateMachine(), 'broken')).toThrow(/failure state/);
    });

    test('refuses a declared but non-startable state', () => {
        expect(() => assertStartStateStartable(stateMachine(), 's1')).toThrow(/not marked startable: true/);
    });

    test('refuses a DAG workflow', () => {
        const dag: WorkflowDef = { kind: 'dag', name: 'd', nodes: [{ id: 'a' }, { id: 'b', dependsOn: ['a'] }] };
        expect(() => assertStartStateStartable(dag, 'b')).toThrow(/kind: "dag"/);
    });

    test('refuses a terminal transition-flow node', () => {
        expect(() => assertStartStateStartable(transitionFlow(), 'end')).toThrow(/terminal state/);
    });
});

describe('readContinuedFrom (task 1072 R5)', () => {
    test('reads effective vars and drops engine-internal __* keys', async () => {
        const persistence = sourceRuns({
            src: {
                status: 'done',
                metadata_json: JSON.stringify({ definitionDigest: 'sha256:abc' }),
                effectiveVars: {
                    publish_enabled: 'false',
                    declared: 'from-source',
                    __runId: 'src',
                    __hitlAnswer: 'yes',
                },
            },
        });

        const continued = await readContinuedFrom(persistence, 'src');

        expect(continued.vars).toEqual({ publish_enabled: 'false', declared: 'from-source' });
        expect(continued.digest).toBe('sha256:abc');
        expect(continued.status).toBe('done');
    });

    test('refuses an unknown source run', async () => {
        await expect(readContinuedFrom(sourceRuns({}), 'missing')).rejects.toThrow(StartStateRefusedError);
        await expect(readContinuedFrom(sourceRuns({}), 'missing')).rejects.toThrow(/no such run/);
    });

    test('tolerates a run with no snapshot and unparseable metadata', async () => {
        const persistence = sourceRuns({ src: { status: 'paused', metadata_json: 'not-json' } });

        const continued = await readContinuedFrom(persistence, 'src');

        expect(continued.vars).toEqual({});
        expect(continued.digest).toBeUndefined();
        expect(continued.status).toBe('paused');
    });
});
