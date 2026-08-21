import { describe, expect, test } from 'bun:test';
import type { WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { renderWorkflowMermaid } from '../../src/workflow/mermaid-render';

// Task 0620 R1–R4: the mermaid FSM renderer — every declared state/node and
// transition/edge, terminal/failure distinguished, both engine kinds.

function stateMachine(): WorkflowDef {
    return {
        kind: 'state-machine',
        name: 'pipeline',
        initialState: 'start',
        terminalStates: ['done'],
        failureStates: ['failed'],
        states: [
            { id: 'start', description: 'begin' },
            { id: 'mid', description: 'middle' },
            { id: 'done', description: 'finished' },
            { id: 'failed', description: 'broke' },
        ],
        transitions: [
            { from: 'start', to: 'mid', trigger: 'go' },
            { from: 'mid', to: 'done' },
            { from: 'mid', to: 'failed', guard: { kind: 'no-retry' } },
        ],
    };
}

function transitionFlow(): WorkflowDef {
    return {
        kind: 'transition-flow',
        name: 'flow',
        initialNode: 'enter',
        terminalNodes: ['end'],
        nodes: [
            { id: 'enter', type: 'action' },
            { id: 'check', type: 'gate' },
            { id: 'branch', type: 'decision' },
            { id: 'fan', type: 'parallel' },
            { id: 'end', type: 'action' },
        ],
        edges: [
            { from: 'enter', to: 'check' },
            { from: 'check', to: 'branch', condition: { kind: 'is-ok' } },
            { from: 'branch', to: 'fan' },
            { from: 'fan', to: 'end' },
        ],
    };
}

describe('renderWorkflowMermaid', () => {
    test('state-machine: emits a fenced mermaid flowchart with every state and transition', () => {
        const out = renderWorkflowMermaid(stateMachine());
        expect(out.startsWith('```mermaid')).toBe(true);
        expect(out.endsWith('```')).toBe(true);
        expect(out).toContain('flowchart LR');
        for (const s of ['start', 'mid', 'done', 'failed']) {
            expect(out).toContain(`["${s}"]`);
        }
        expect(out).toContain('start -->|trigger:go| mid');
        expect(out).toContain('mid -->|guard:no-retry| failed');
    });

    test('state-machine: terminal and failure states are visually distinguished', () => {
        const out = renderWorkflowMermaid(stateMachine());
        expect(out).toContain('class done terminal;');
        expect(out).toContain('class failed failure;');
        expect(out).toContain('class start initial;');
        expect(out).toContain('classDef terminal');
        expect(out).toContain('classDef failure');
    });

    test('transition-flow: renders every node and edge with node-type shapes', () => {
        const out = renderWorkflowMermaid(transitionFlow());
        expect(out).toContain('check{{"check"');
        expect(out).toContain('branch{"branch"');
        expect(out).toContain('fan[("fan"');
        expect(out).toContain('check -->|cond:is-ok| branch');
        expect(out).toContain('class check gate;');
        expect(out).toContain('class branch decision;');
        expect(out).toContain('class fan parallel;');
        expect(out).toContain('class end terminal;');
        expect(out).toContain('class enter initial;');
    });

    test('escapes quotes and brackets in ids', () => {
        const def: WorkflowDef = {
            kind: 'state-machine',
            name: 'x',
            initialState: 'a"b',
            terminalStates: ['c[d]'],
            states: [{ id: 'a"b' }, { id: 'c[d]' }],
            transitions: [{ from: 'a"b', to: 'c[d]' }],
        };
        const out = renderWorkflowMermaid(def);
        expect(out).toContain('&quot;');
        expect(out).toContain('&#91;');
        expect(out).toContain('&#93;');
    });
});
