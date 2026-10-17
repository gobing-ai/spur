import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
    DagWorkflowDef,
    StateMachineWorkflowDef,
    TransitionFlowWorkflowDef,
} from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { attachHostPause, selectsHostExecutor, withHostExecutorPause } from '../../src/workflow/host-executor';
import { writeWorkItem } from '../../src/workflow/receipt';

const STATE_MACHINE: StateMachineWorkflowDef = {
    kind: 'state-machine',
    name: 'host-flow',
    initialState: 'precheck',
    states: [
        { id: 'precheck', onEnter: [{ kind: 'shell', options: { command: 'true' } }] },
        {
            id: 'implement',
            onEnter: [
                { kind: 'shell', options: { command: 'true' } },
                { kind: 'agent.run', options: { role: 'coder', input: 'implement' } },
            ],
        },
        { id: 'done' },
    ],
    transitions: [
        { from: 'precheck', to: 'implement' },
        { from: 'implement', to: 'done' },
    ],
    terminalStates: ['done'],
};

describe('selectsHostExecutor', () => {
    test('true only when the run var says host', () => {
        expect(selectsHostExecutor({ executor: 'host' })).toBe(true);
        expect(selectsHostExecutor({ executor: 'fleet' })).toBe(false);
        expect(selectsHostExecutor({ executor: 'subprocess' })).toBe(false);
        expect(selectsHostExecutor({})).toBe(false);
        expect(selectsHostExecutor(undefined)).toBe(false);
    });
});

describe('withHostExecutorPause', () => {
    test('marks every state that runs agent.run with the engine pause declaration', () => {
        const paused = withHostExecutorPause(STATE_MACHINE) as StateMachineWorkflowDef;
        expect(paused.states.map((state) => [state.id, state.pause])).toEqual([
            ['precheck', undefined],
            ['implement', true],
            ['done', undefined],
        ]);
    });

    test('does not mutate the definition it was given', () => {
        withHostExecutorPause(STATE_MACHINE);
        expect(STATE_MACHINE.states[1]?.pause).toBeUndefined();
    });

    test('returns the same definition object when no state runs agent.run', () => {
        const def: StateMachineWorkflowDef = {
            kind: 'state-machine',
            name: 'no-agent',
            initialState: 'a',
            states: [{ id: 'a', onEnter: [{ kind: 'shell', options: { command: 'true' } }] }, { id: 'b' }],
            transitions: [{ from: 'a', to: 'b' }],
            terminalStates: ['b'],
        };
        expect(withHostExecutorPause(def)).toBe(def);
        expect(JSON.stringify(withHostExecutorPause(def))).toBe(JSON.stringify(def));
    });

    test('an already-pausing state is not re-marked and the definition object survives', () => {
        const def: StateMachineWorkflowDef = {
            kind: 'state-machine',
            name: 'already-paused',
            initialState: 'a',
            states: [
                { id: 'a', pause: true, onEnter: [{ kind: 'agent.run', options: { role: 'coder', input: 'x' } }] },
                { id: 'b' },
            ],
            transitions: [{ from: 'a', to: 'b' }],
            terminalStates: ['b'],
        };
        expect(withHostExecutorPause(def)).toBe(def);
    });

    test('marks a transition-flow node whose action is agent.run', () => {
        const def: TransitionFlowWorkflowDef = {
            kind: 'transition-flow',
            name: 'flow',
            initialNode: 'work',
            nodes: [
                { id: 'work', action: { kind: 'agent.run', options: { role: 'coder', input: 'x' } } },
                { id: 'note', action: { kind: 'note', options: { message: 'hi' } } },
                { id: 'end' },
            ],
            edges: [
                { from: 'work', to: 'note' },
                { from: 'note', to: 'end' },
            ],
            terminalNodes: ['end'],
        };
        const paused = withHostExecutorPause(def) as TransitionFlowWorkflowDef;
        expect(paused.nodes.map((node) => [node.id, node.pause])).toEqual([
            ['work', true],
            ['note', undefined],
            ['end', undefined],
        ]);
    });

    test('marks a dag node whose action is agent.run', () => {
        const def: DagWorkflowDef = {
            kind: 'dag',
            name: 'dag',
            nodes: [
                { id: 'work', action: { kind: 'agent.run', options: { role: 'coder', input: 'x' } } },
                { id: 'after', dependsOn: ['work'] },
            ],
        };
        const paused = withHostExecutorPause(def) as DagWorkflowDef;
        expect(paused.nodes.map((node) => [node.id, node.pause])).toEqual([
            ['work', true],
            ['after', undefined],
        ]);
    });
});

describe('attachHostPause', () => {
    const workItem = {
        runId: 'run-1',
        state: 'implement',
        skill: null,
        prompt: 'implement',
        inputs: [],
        expectFiles: [],
        ownedSections: [],
    };

    test('attaches the work item as the pause payload for the paused state', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-host-pause-'));
        await writeWorkItem(createNodeFileSystem(dir), dir, workItem);
        const result: Record<string, unknown> & { status: string; runId: string; finalState: string } = {
            runId: 'run-1',
            status: 'paused',
            finalState: 'implement',
        };

        await attachHostPause(createNodeFileSystem(dir), dir, result);

        expect(result.pause).toEqual({ kind: 'input', workItem: expect.objectContaining({ state: 'implement' }) });
    });

    test('leaves a run that did not pause untouched', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-host-pause-'));
        await writeWorkItem(createNodeFileSystem(dir), dir, workItem);
        const result: Record<string, unknown> & { status: string; runId: string; finalState: string } = {
            runId: 'run-1',
            status: 'done',
            finalState: 'done',
        };

        await attachHostPause(createNodeFileSystem(dir), dir, result);

        expect(result.pause).toBeUndefined();
    });

    test('ignores a work item left by an earlier host stage of the same run (stale payload)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-host-pause-'));
        await writeWorkItem(createNodeFileSystem(dir), dir, workItem);
        const result: Record<string, unknown> & { status: string; runId: string; finalState: string } = {
            runId: 'run-1',
            status: 'paused',
            finalState: 'approve',
        };

        await attachHostPause(createNodeFileSystem(dir), dir, result);

        expect(result.pause).toBeUndefined();
    });
});
