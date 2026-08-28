/**
 * Tests for the workflow step reporter — pure event→line and def→plan formatters.
 * Assert on the emitted strings (not timing), per task 0114 R5.
 */
import { describe, expect, test } from 'bun:test';
import type { StateMachineWorkflowDef, TransitionFlowWorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import {
    buildWorkflowSteps,
    renderActionHeartbeat,
    renderRunPlan,
    renderStepLine,
    renderWorkflowTodo,
    type StepEvent,
} from '../../src/workflow/step-reporter';

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
        ).toContain('agent done (1s) · exit 0');
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
            metadata: { agent: 'omp', model: 'zai', role: 'coder', invocation: '/sp:dev-run', timeoutMs: 600_000 },
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
        // 0538 R2: the declared step role renders on the composed action line.
        expect(renderStepLine(started)).toBe(
            '[run r1] → implement/agent.run · agent=omp · model=zai · role=coder => /sp:dev-run · timeout=10m 0s',
        );
        expect(renderStepLine(finished)).toBe('[run r1] ✓ implement/agent.run (4s)');
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

    test('R1: condenses a 36-char run GUID to 8 chars, and omits it entirely when showRunId=false', () => {
        const longRunId = '36fcb2e6-4541-4f83-9c9f-a58e489dfdc3';
        const event: StepEvent = { ...envelope, runId: longRunId, phase: 'verify', status: 'running' };
        expect(renderStepLine(event)).toBe('[run 36fcb2e6] ▶ verify [running]');
        expect(renderStepLine(event, { showRunId: false })).toBe('▶ verify [running]');
        // renderActionHeartbeat honors the same option.
        const action: StepEvent = { ...envelope, runId: longRunId, actionId: 'a1', node: 'x', kind: 'shell' };
        expect(renderActionHeartbeat(action, 1000, { showRunId: false })).toBe(
            '… x/shell · elapsed=1s · budget=unbounded',
        );
    });

    test('R2: non-agent actions omit agent=/model= metadata', () => {
        const event: StepEvent = {
            ...envelope,
            actionId: 'a1',
            node: 'start',
            kind: 'note',
            metadata: { invocation: 'Idea pipeline start' },
        };
        const line = renderStepLine(event);
        expect(line).not.toContain('agent=');
        expect(line).not.toContain('model=');
    });

    test('R3: note actions render the note message', () => {
        const event: StepEvent = {
            ...envelope,
            actionId: 'a1',
            node: 'start',
            kind: 'note',
            metadata: { invocation: 'Idea pipeline start' },
        };
        expect(renderStepLine(event)).toContain('→ start/note => Idea pipeline start');
    });

    test('R4: shell actions render a sanitized command summary', () => {
        const event: StepEvent = {
            ...envelope,
            actionId: 'a1',
            node: 'start',
            kind: 'shell',
            metadata: { invocation: 'mkdir -p .spur/run' },
        };
        expect(renderStepLine(event)).toContain('→ start/shell => mkdir -p .spur/run');
    });

    test('R5: heartbeats show pid and finish events report exit status', () => {
        const base = { ...envelope, executionId: 'exec-1', actionId: 'a1' };
        expect(
            renderStepLine({ ...base, kind: 'started', agent: 'omp', invocation: 'omp -p x', pid: 49281 }),
        ).toContain('pid=49281');
        expect(
            renderStepLine({ ...base, kind: 'heartbeat', elapsedMs: 5000, timeoutMs: 10_000, pid: 49281 }),
        ).toContain('pid=49281');
        expect(
            renderStepLine({
                ...base,
                kind: 'finished',
                outcome: 'done',
                exitCode: 0,
                durationMs: 1000,
                usage: 'unavailable',
            }),
        ).toContain('agent done (1s) · exit 0');
        expect(
            renderStepLine({
                ...base,
                kind: 'finished',
                outcome: 'failed',
                exitCode: 1,
                durationMs: 1000,
                usage: 'unavailable',
            }),
        ).toContain('agent failed (1s) · exit 1');
    });

    test('R6: non-agent finish omits usage unavailable; shows usage only when data exists', () => {
        const finished: StepEvent = {
            ...envelope,
            actionId: 'a1',
            node: 'note',
            kind: 'note',
            status: 'done',
            durationMs: 10,
            ok: true,
            result: { usage: 'unavailable' },
        };
        expect(renderStepLine(finished)).toBe('[run r1] ✓ note/note (0s)');
        const withUsage: StepEvent = { ...finished, result: { usage: '12k tokens' } };
        expect(renderStepLine(withUsage)).toBe('[run r1] ✓ note/note (0s) · usage 12k tokens');
    });

    test('R7: transitions render in standard invocation mode', () => {
        const event: StepEvent = { ...envelope, from: 'discovery', to: 'idea-eval', trigger: null };
        expect(renderStepLine(event, { detail: 'invocation' })).toBe('[run r1] ↪ discovery → idea-eval');
        // still suppressed in minimal mode.
        expect(renderStepLine(event, { detail: 'minimal' })).toBeNull();
    });

    test('R8: child agent stdout/stderr chunks and heartbeats are indented 2 spaces under the agent block', () => {
        const base = { ...envelope, executionId: 'exec-1', actionId: 'a1' };
        // showRunId=false isolates the 2-space child indent from the run prefix.
        const noPfx = { showRunId: false };
        expect(renderStepLine({ ...base, kind: 'output', stream: 'stdout', chunk: 'line\n' }, noPfx)).toBe(
            '  stdout> line',
        );
        expect(renderStepLine({ ...base, kind: 'output', stream: 'stderr', chunk: 'warn\n' }, noPfx)).toBe(
            '  stderr> warn',
        );
        expect(renderStepLine({ ...base, kind: 'heartbeat', elapsedMs: 5000, timeoutMs: 10_000 }, noPfx)).toBe(
            '  … agent execution · elapsed=5s · budget=5s remaining',
        );
        // dropped pressure is not a child stream; it must not get the indent.
        expect(renderStepLine({ ...base, kind: 'dropped', chunks: 3 }, noPfx)).toBe(
            '… output pressure · dropped=3 chunks',
        );
        // in minimal detail, live agent stream/heartbeat noise is suppressed entirely.
        expect(
            renderStepLine({ ...base, kind: 'output', stream: 'stdout', chunk: 'x' }, { detail: 'minimal' }),
        ).toBeNull();
        expect(renderStepLine({ ...base, kind: 'heartbeat', elapsedMs: 5000 }, { detail: 'minimal' })).toBeNull();
    });

    test('R9: shell action output chunks stream as 2-space-indented child lines', () => {
        // workflow.action.output events (R9) render like agent output chunks with
        // the same 2-space child indent under the parent action block.
        const event: StepEvent = {
            ...envelope,
            kind: 'shell',
            node: 'implement',
            stream: 'stdout',
            chunk: 'compiling 42 modules\n',
        };
        expect(renderStepLine(event, { showRunId: false })).toBe('  stdout> compiling 42 modules');
        expect(renderStepLine({ ...event, stream: 'stderr', chunk: 'warning: unused var\n' })).toBe(
            '[run r1]   stderr> warning: unused var',
        );
        // suppressed in minimal detail (live stream noise).
        expect(renderStepLine(event, { detail: 'minimal' })).toBeNull();
    });

    test('R10: failing finish lines include the stderr/stdout snippet explaining what happened', () => {
        const event: StepEvent = {
            ...envelope,
            actionId: 'a1',
            node: 'verify',
            kind: 'shell',
            status: 'failed',
            durationMs: 1000,
            ok: false,
            result: { error: 'command not found: spurr', usage: 'unavailable' },
        };
        expect(renderStepLine(event)).toContain('✗ verify/shell (1s) · command not found: spurr');
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
describe('buildWorkflowSteps', () => {
    test('state-machine: declaration order + initial/terminal/failure/pause/loop-back/conditional markers', () => {
        const def: StateMachineWorkflowDef = {
            kind: 'state-machine',
            name: 'sm',
            initialState: 'a',
            terminalStates: ['e', 'f'],
            failureStates: ['f'],
            states: [{ id: 'a' }, { id: 'b', pause: true }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }],
            transitions: [
                { from: 'a', to: 'b' },
                { from: 'b', to: 'c', guard: { kind: 'always' } },
                { from: 'b', to: 'd' },
                { from: 'd', to: 'c', guard: { kind: 'always' } },
                { from: 'c', to: 'b' }, // source declared after b → b is loop-back
                { from: 'd', to: 'e' },
                { from: 'e', to: 'e' }, // self-loop → e is loop-back
                { from: 'd', to: 'f' },
            ],
        };
        const steps = buildWorkflowSteps(def);
        expect(steps.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
        expect(steps[0]).toMatchObject({ initial: true, terminal: false, failure: false, conditional: false });
        expect(steps[1]).toMatchObject({ pause: true, loopBack: true, conditional: false });
        // c is entered only through guarded transitions → conditional; d has an unguarded incoming edge → not.
        expect(steps[2]).toMatchObject({ conditional: true });
        expect(steps[3]).toMatchObject({ conditional: false, loopBack: false });
        expect(steps[4]).toMatchObject({ terminal: true, failure: false, loopBack: true });
        expect(steps[5]).toMatchObject({ terminal: true, failure: true });
    });

    test('transition-flow: nodeType labels, terminalNodes, condition-only edges, no failure concept', () => {
        const def: TransitionFlowWorkflowDef = {
            kind: 'transition-flow',
            name: 'tf',
            initialNode: 'first',
            terminalNodes: ['last'],
            nodes: [
                { id: 'first' },
                { id: 'gate1', type: 'gate' },
                { id: 'branch', type: 'decision' },
                { id: 'fan', type: 'parallel' },
                { id: 'last', pause: true },
            ],
            edges: [
                { from: 'first', to: 'gate1' },
                { from: 'gate1', to: 'branch', condition: { kind: 'flag' } },
                { from: 'branch', to: 'fan' },
                { from: 'fan', to: 'last' },
            ],
        };
        const steps = buildWorkflowSteps(def);
        expect(steps.map((s) => s.id)).toEqual(['first', 'gate1', 'branch', 'fan', 'last']);
        expect(steps[0]).toMatchObject({ initial: true, nodeType: 'action', conditional: false });
        expect(steps[1]).toMatchObject({ nodeType: 'gate', failure: false });
        expect(steps[2]).toMatchObject({ nodeType: 'decision', conditional: true });
        expect(steps[3]).toMatchObject({ nodeType: 'parallel', conditional: false });
        expect(steps[4]).toMatchObject({ terminal: true, pause: true });
    });
});

describe('renderWorkflowTodo', () => {
    test('state-machine: frozen checklist shape with the declared-inventory disclaimer', () => {
        const def: StateMachineWorkflowDef = {
            kind: 'state-machine',
            name: 'task-pipeline',
            initialState: 'precheck',
            terminalStates: ['done', 'failed'],
            failureStates: ['failed'],
            states: [
                { id: 'precheck' },
                { id: 'implement' },
                { id: 'approve', pause: true },
                { id: 'verify' },
                { id: 'done' },
                { id: 'failed' },
            ],
            transitions: [
                { from: 'precheck', to: 'implement' },
                { from: 'implement', to: 'approve' },
                { from: 'approve', to: 'verify' },
                { from: 'verify', to: 'done', guard: { kind: 'approved' } },
                { from: 'verify', to: 'implement' }, // loop-back
                { from: 'done', to: 'done' },
                { from: 'verify', to: 'failed' },
            ],
        };
        expect(renderWorkflowTodo(def)).toBe(
            [
                '# task-pipeline (state-machine) — declared steps',
                '',
                'Declared step inventory in declaration order, not a predicted execution path.',
                '',
                '- [ ] precheck — initial',
                '- [ ] implement — loop-back',
                '- [ ] approve — pause',
                '- [ ] verify',
                '- [ ] done — terminal · loop-back',
                '- [ ] failed — terminal · failure',
            ].join('\n'),
        );
    });

    test('transition-flow: node-type markers appended, no disclaimer line', () => {
        const def: TransitionFlowWorkflowDef = {
            kind: 'transition-flow',
            name: 'flow',
            initialNode: 'start',
            terminalNodes: ['end'],
            nodes: [{ id: 'start' }, { id: 'gate', type: 'gate' }, { id: 'end' }],
            edges: [
                { from: 'start', to: 'gate' },
                { from: 'gate', to: 'end' },
            ],
        };
        expect(renderWorkflowTodo(def)).toBe(
            [
                '# flow (transition-flow) — declared steps',
                '',
                '- [ ] start — initial',
                '- [ ] gate — gate',
                '- [ ] end — terminal',
            ].join('\n'),
        );
    });
});

describe('renderRunPlan (builder parity, 0695 R5)', () => {
    test('plan sequence is exactly the shared builder sequence for both kinds', () => {
        const sm: StateMachineWorkflowDef = {
            kind: 'state-machine',
            name: 'sm',
            initialState: 'a',
            states: [{ id: 'a' }, { id: 'b' }],
            transitions: [{ from: 'a', to: 'b', guard: { kind: 'always' } }],
        };
        expect(renderRunPlan(sm)).toBe(
            `plan: ${buildWorkflowSteps(sm)
                .map((s) => s.id)
                .join(' → ')}`,
        );
        expect(renderRunPlan(sm)).toBe('plan: a → b');
        const tf: TransitionFlowWorkflowDef = {
            kind: 'transition-flow',
            name: 'tf',
            initialNode: 'x',
            nodes: [{ id: 'x' }, { id: 'y' }],
            edges: [{ from: 'x', to: 'y' }],
        };
        expect(renderRunPlan(tf)).toBe(
            `plan: ${buildWorkflowSteps(tf)
                .map((s) => s.id)
                .join(' → ')}`,
        );
    });
});
