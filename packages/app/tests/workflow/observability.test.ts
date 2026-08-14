import { describe, expect, test } from 'bun:test';
import type { WorkflowPersistenceAdapter, WorkflowRunRecord } from '@gobing-ai/ts-dual-workflow-engine';
import { EventBus } from '@gobing-ai/ts-infra';
import {
    ObservableWorkflowAdapter,
    projectActionMetadata,
    type WorkflowObservabilityEventMap,
} from '../../src/workflow/observability';

// A minimal in-memory persistence stub that records the calls it received, so each test
// asserts BOTH that the decorator delegated (persistence is unchanged) AND that it emitted
// the matching observability event. The decorator's value is precisely this dual behavior.
function stubAdapter(): { adapter: WorkflowPersistenceAdapter; calls: string[] } {
    const calls: string[] = [];
    const adapter = {
        async createRun() {
            calls.push('createRun');
        },
        async finalizeRun() {
            calls.push('finalizeRun');
        },
        async savePhase() {
            calls.push('savePhase');
        },
        async saveTransition() {
            calls.push('saveTransition');
        },
        async commitTransition() {
            calls.push('commitTransition');
        },
        async saveActionStart() {
            calls.push('saveActionStart');
            return 'action-1';
        },
        async saveActionFinalize() {
            calls.push('saveActionFinalize');
        },
        async saveWorkflowState() {
            calls.push('saveWorkflowState');
        },
        async loadRun() {
            calls.push('loadRun');
            return undefined;
        },
        async listRuns() {
            return [];
        },
        async findRunByKey() {
            return undefined;
        },
        async createOrAttachRun(r: WorkflowRunRecord) {
            return r;
        },
        async reseedRun() {
            return { ok: true } as unknown as Awaited<ReturnType<WorkflowPersistenceAdapter['reseedRun']>>;
        },
        async loadCurrentState() {
            return undefined;
        },
        async listPausedRuns() {
            return [];
        },
    } as unknown as WorkflowPersistenceAdapter;
    return { adapter, calls };
}

const record: WorkflowRunRecord = {
    id: 'run-1',
    workflow_name: 'task-pipeline',
    mode: 'state-machine',
    status: 'running',
    started_at: '2026-06-23T00:00:00.000Z',
    completed_at: null,
    metadata_json: '{}',
};

describe('ObservableWorkflowAdapter', () => {
    test('createRun: delegates AND emits workflow.run.started with run identity', async () => {
        const { adapter, calls } = stubAdapter();
        const bus = new EventBus<WorkflowObservabilityEventMap>();
        const seen: Array<{ runId: string; workflowName: string }> = [];
        bus.on('workflow.run.started', (e) => seen.push({ runId: e.runId, workflowName: e.workflowName }));

        await new ObservableWorkflowAdapter(adapter, bus).createRun(record);

        expect(calls).toContain('createRun'); // persistence unchanged
        expect(seen).toEqual([{ runId: 'run-1', workflowName: 'task-pipeline' }]);
    });

    test('saveTransition: emits workflow.transition with from/to/trigger', async () => {
        const { adapter, calls } = stubAdapter();
        const bus = new EventBus<WorkflowObservabilityEventMap>();
        const seen: Array<{ from: string; to: string; trigger: string | null }> = [];
        bus.on('workflow.transition', (e) => seen.push({ from: e.from, to: e.to, trigger: e.trigger }));

        await new ObservableWorkflowAdapter(adapter, bus).saveTransition('run-1', 'verify', 'record', 'shell');

        expect(calls).toContain('saveTransition');
        expect(seen).toEqual([{ from: 'verify', to: 'record', trigger: 'shell' }]);
    });

    test('commitTransition: delegates AND emits workflow.transition, workflow.phase when phase present', async () => {
        const { adapter, calls } = stubAdapter();
        const bus = new EventBus<WorkflowObservabilityEventMap>();
        const transitions: Array<{ from: string; to: string; trigger: string | null }> = [];
        const phases: Array<{ phase: string; status: string }> = [];
        bus.on('workflow.transition', (e) => transitions.push({ from: e.from, to: e.to, trigger: e.trigger }));
        bus.on('workflow.phase', (e) => phases.push({ phase: e.phase, status: e.status }));

        const dec = new ObservableWorkflowAdapter(adapter, bus);
        // With phase: emits both transition and phase.
        await dec.commitTransition('run-1', 's1', 's2', 'guard', 's2', { x: 1 }, { phase: 's2', status: 'running' });
        // Without phase: emits transition only.
        await dec.commitTransition('run-1', 's2', 's3', null, 's3', { x: 2 });

        expect(calls.filter((c) => c === 'commitTransition')).toHaveLength(2);
        expect(transitions).toEqual([
            { from: 's1', to: 's2', trigger: 'guard' },
            { from: 's2', to: 's3', trigger: null },
        ]);
        expect(phases).toEqual([{ phase: 's2', status: 'running' }]);
    });

    test('action start/finish: emits correlated, ordered, redacted action events', async () => {
        const { adapter } = stubAdapter();
        const bus = new EventBus<WorkflowObservabilityEventMap>();
        const started: Array<{ actionId: string; sequence: number; invocation?: string }> = [];
        const finished: Array<{ actionId: string; ok: boolean; runId: string; sequence: number }> = [];
        bus.on('workflow.action.started', (e) =>
            started.push({ actionId: e.actionId, sequence: e.sequence, invocation: e.metadata?.invocation }),
        );
        bus.on('workflow.action.finished', (e) =>
            finished.push({ actionId: e.actionId, ok: e.ok, runId: e.runId, sequence: e.sequence }),
        );

        const dec = new ObservableWorkflowAdapter(adapter, bus);
        await dec.createRun(record);
        const id = await dec.saveActionStart('run-1', 'implement', 'agent.run', {
            input: 'sk-super-secret raw prompt',
        });
        await dec.saveActionFinalize(id, 'done', 42, true, 'agent.run', { ok: true });

        expect(id).toBe('action-1'); // inner id propagated unchanged
        expect(started).toEqual([{ actionId: 'action-1', sequence: 2, invocation: '[prompt 26 chars]' }]);
        expect(finished).toEqual([{ actionId: 'action-1', ok: true, runId: 'run-1', sequence: 3 }]);
    });

    test('does not emit an action finish when its run cannot be correlated', async () => {
        const { adapter } = stubAdapter();
        const bus = new EventBus<WorkflowObservabilityEventMap>();
        let emitted = 0;
        bus.on('workflow.action.finished', () => emitted++);

        await new ObservableWorkflowAdapter(adapter, bus).saveActionFinalize(
            'unknown',
            'failed',
            10,
            false,
            'agent.run',
        );

        expect(emitted).toBe(0);
    });

    test('finalizeRun: emits workflow.run.finalized with the terminal status', async () => {
        const { adapter } = stubAdapter();
        const bus = new EventBus<WorkflowObservabilityEventMap>();
        const seen: string[] = [];
        bus.on('workflow.run.finalized', (e) => seen.push(e.status));

        await new ObservableWorkflowAdapter(adapter, bus).finalizeRun('run-1', 'done', '2026-06-23T01:00:00.000Z');

        expect(seen).toEqual(['done']);
    });

    test('retains correlation for an action finish that arrives after run finalization', async () => {
        const { adapter } = stubAdapter();
        const bus = new EventBus<WorkflowObservabilityEventMap>();
        const seen: Array<{ runId: string; workflowName?: string; sequence: number }> = [];
        bus.on('workflow.action.finished', (event) =>
            seen.push({ runId: event.runId, workflowName: event.workflowName, sequence: event.sequence }),
        );
        const dec = new ObservableWorkflowAdapter(adapter, bus);
        await dec.createRun(record);
        const actionId = await dec.saveActionStart('run-1', 'implement', 'agent.run');
        await dec.finalizeRun('run-1', 'done', '2026-06-23T01:00:00.000Z');
        await dec.saveActionFinalize(actionId, 'done', 10, true, 'agent.run');

        expect(seen).toEqual([{ runId: 'run-1', workflowName: 'task-pipeline', sequence: 4 }]);
    });

    test('savePhase: delegates AND emits workflow.phase with phase + status', async () => {
        const { adapter, calls } = stubAdapter();
        const bus = new EventBus<WorkflowObservabilityEventMap>();
        const seen: Array<{ phase: string; status: string }> = [];
        bus.on('workflow.phase', (e) => seen.push({ phase: e.phase, status: e.status }));

        await new ObservableWorkflowAdapter(adapter, bus).savePhase('run-1', 'implement', 'running');

        expect(calls).toContain('savePhase');
        expect(seen).toEqual([{ phase: 'implement', status: 'running' }]);
    });

    test('all read/non-lifecycle methods pass through without emitting', async () => {
        const { adapter, calls } = stubAdapter();
        const bus = new EventBus<WorkflowObservabilityEventMap>();
        let emitted = 0;
        for (const name of ['workflow.run.started', 'workflow.phase', 'workflow.transition'] as const) {
            bus.on(name, () => emitted++);
        }

        const dec = new ObservableWorkflowAdapter(adapter, bus);
        await dec.saveWorkflowState('run-1', 'implement', { k: 'v' });
        await dec.loadRun('run-1');
        await dec.listRuns();
        await dec.findRunByKey('task-pipeline', 'wbs:0101');
        await dec.createOrAttachRun(record);
        await dec.reseedRun('run-1', 'verify');
        await dec.loadCurrentState('run-1');
        await dec.listPausedRuns({ workflowName: 'task-pipeline', limit: 5 });

        expect(calls).toContain('saveWorkflowState');
        expect(calls).toContain('loadRun');
        expect(emitted).toBe(0); // non-lifecycle paths are silent
    });
});

describe('projectActionMetadata', () => {
    test('never forwards raw prompt or shell command text', () => {
        expect(projectActionMetadata('agent.run', { input: 'Bearer highly-sensitive-value' })).toEqual({
            invocation: '[prompt 29 chars]',
        });
        expect(projectActionMetadata('shell', { command: 'curl -H "Authorization: Bearer secret"' })).toEqual({
            invocation: '[shell command redacted]',
        });
    });

    test('bounds allow-listed labels after redaction', () => {
        const metadata = projectActionMetadata('agent.run', {
            agent: `api_key=${'x'.repeat(400)}`,
            input: '/sp:dev-run 0365 --auto',
        });
        expect(metadata?.agent).toBe('[REDACTED]');
        expect(metadata?.invocation).toBe('/sp:dev-run');
    });

    test('0538 R2: projects the declared step role onto the action metadata', () => {
        const metadata = projectActionMetadata('agent.run', {
            agent: 'omp',
            role: 'coder',
            input: '/sp:dev-run 0538 --auto',
        });
        expect(metadata?.role).toBe('coder');
        expect(projectActionMetadata('shell', { command: 'true', role: 'coder' })?.role).toBeUndefined();
    });
});
