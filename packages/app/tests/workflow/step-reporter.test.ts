/**
 * Tests for the workflow step reporter — pure event→line and def→plan formatters.
 * Assert on the emitted strings (not timing), per task 0114 R5.
 */
import { describe, expect, test } from 'bun:test';
import type { StateMachineWorkflowDef, TransitionFlowWorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { renderRunPlan, renderStepLine, type StepEvent } from '../../src/workflow/step-reporter';

const at = '2026-06-25T00:00:00.000Z';

describe('renderStepLine', () => {
    test('action.started renders a node + kind entry line', () => {
        const event: StepEvent = { runId: 'r1', actionId: 'a1', node: 'implement', kind: 'agent.run', at };
        expect(renderStepLine(event)).toBe('  → implement: agent.run…');
    });

    test('action.finished renders outcome mark + status + duration (seconds)', () => {
        const event: StepEvent = { runId: 'r1', actionId: 'a1', status: 'done', durationMs: 4200, ok: true, at };
        expect(renderStepLine(event)).toBe('  ✓ done (4s)');
    });

    test('action.finished renders minutes for long steps (the 5-9min blind spot)', () => {
        const event: StepEvent = { runId: 'r1', actionId: 'a1', status: 'done', durationMs: 320_000, ok: true, at };
        // WHY: the whole point of 0114 — a 5min+ step must read as live, not hung.
        expect(renderStepLine(event)).toBe('  ✓ done (5m 20s)');
    });

    test('action.finished marks a failed action distinctly', () => {
        const event: StepEvent = { runId: 'r1', actionId: 'a1', status: 'failed', durationMs: 1000, ok: false, at };
        expect(renderStepLine(event)).toBe('  ✗ failed (1s)');
    });

    test('phase event renders a state header line', () => {
        const event: StepEvent = { runId: 'r1', phase: 'verify', status: 'running', at };
        expect(renderStepLine(event)).toBe('▶ verify [running]');
    });
});

describe('renderRunPlan', () => {
    test('state-machine def lists states in declared order', () => {
        const def = {
            kind: 'state-machine',
            name: 'task-pipeline',
            initialState: 'precheck',
            states: [{ id: 'precheck' }, { id: 'implement' }, { id: 'done' }],
            transitions: [],
        } as unknown as StateMachineWorkflowDef;
        expect(renderRunPlan(def)).toBe('plan: precheck → implement → done');
    });

    test('transition-flow def lists nodes in declared order', () => {
        const def = {
            kind: 'transition-flow',
            name: 'flow',
            initialNode: 'start',
            nodes: [{ id: 'start' }, { id: 'work' }, { id: 'end' }],
            edges: [],
        } as unknown as TransitionFlowWorkflowDef;
        expect(renderRunPlan(def)).toBe('plan: start → work → end');
    });
});
