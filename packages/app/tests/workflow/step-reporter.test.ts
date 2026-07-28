/**
 * Tests for the workflow step reporter — pure event→line and def→plan formatters.
 * Assert on the emitted strings (not timing), per task 0114 R5.
 */
import { describe, expect, test } from 'bun:test';
import type { StateMachineWorkflowDef, TransitionFlowWorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { renderActionHeartbeat, renderRunPlan, renderStepLine, type StepEvent } from '../../src/workflow/step-reporter';

const at = '2026-06-25T00:00:00.000Z';
const envelope = { schemaVersion: 1 as const, eventId: 'e1', sequence: 1, runId: 'r1', at };

describe('renderStepLine', () => {
    test('renders resolved agent lifecycle, live chunks, heartbeat, pressure, and completion', () => {
        const base = { ...envelope, executionId: 'execution-1', actionId: 'action-1' };
        expect(
            renderStepLine({
                ...base,
                kind: 'started',
                agent: 'omp',
                model: 'zai',
                invocation: 'omp -p [redacted prompt]',
            }),
        ).toBe('[run r1]   agent=omp(zai) => omp -p [redacted prompt]');
        expect(renderStepLine({ ...base, kind: 'output', stream: 'stdout', chunk: 'partial\n' })).toBe(
            '[run r1]   stdout> partial',
        );
        expect(renderStepLine({ ...base, kind: 'heartbeat', elapsedMs: 5000, timeoutMs: 10_000 })).toContain(
            'budget=5s remaining',
        );
        expect(renderStepLine({ ...base, kind: 'dropped', chunks: 3 })).toContain('dropped=3 chunks');
        expect(
            renderStepLine({
                ...base,
                kind: 'finished',
                outcome: 'done',
                exitCode: 0,
                durationMs: 1000,
                usage: 'unavailable',
            }),
        ).toContain('agent done (1s) · usage unavailable');
    });

    test('action.started renders a node + kind entry line', () => {
        const event: StepEvent = { ...envelope, actionId: 'a1', node: 'implement', kind: 'agent.run' };
        expect(renderStepLine(event, { detail: 'minimal' })).toBe('  → implement: agent.run…');
    });

    test('default action lines include correlation, resolved metadata, timeout, and unavailable usage', () => {
        const started: StepEvent = {
            ...envelope,
            actionId: 'a1',
            node: 'implement',
            kind: 'agent.run',
            metadata: { agent: 'omp', model: 'zai', invocation: '/sp:dev-run', timeoutMs: 600_000 },
        };
        const finished: StepEvent = {
            ...envelope,
            sequence: 2,
            actionId: 'a1',
            node: 'implement',
            kind: 'agent.run',
            status: 'done',
            durationMs: 4200,
            ok: true,
            result: { usage: 'unavailable' },
        };
        expect(renderStepLine(started)).toBe(
            '[run r1] → implement/agent.run · agent=omp · model=zai => /sp:dev-run · timeout=10m 0s',
        );
        expect(renderStepLine(finished)).toBe('[run r1] ✓ implement/agent.run (4s) · usage unavailable');
    });

    test('action.finished renders minutes for long steps (the 5-9min blind spot)', () => {
        const event: StepEvent = {
            ...envelope,
            actionId: 'a1',
            node: 'implement',
            kind: 'agent.run',
            status: 'done',
            durationMs: 320_000,
            ok: true,
        };
        // WHY: the whole point of 0114 — a 5min+ step must read as live, not hung.
        expect(renderStepLine(event, { detail: 'minimal' })).toBe('  ✓ done (5m 20s)');
    });

    test('action.finished marks a failed action distinctly', () => {
        const event: StepEvent = {
            ...envelope,
            actionId: 'a1',
            node: 'verify',
            kind: 'shell',
            status: 'failed',
            durationMs: 1000,
            ok: false,
        };
        expect(renderStepLine(event, { detail: 'minimal' })).toBe('  ✗ failed (1s)');
    });

    test('phase event renders a state header line', () => {
        const event: StepEvent = { ...envelope, phase: 'verify', status: 'running' };
        expect(renderStepLine(event, { detail: 'minimal' })).toBe('▶ verify [running]');
    });

    test('heartbeat reports elapsed time and remaining timeout budget', () => {
        const event = {
            ...envelope,
            actionId: 'a1',
            node: 'implement',
            kind: 'agent.run',
            metadata: { timeoutMs: 600_000 },
        };
        expect(renderActionHeartbeat(event, 65_000)).toBe(
            '[run r1] … implement/agent.run · elapsed=1m 5s · budget=8m 55s remaining',
        );
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
