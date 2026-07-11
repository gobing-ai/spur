import { describe, expect, test } from 'bun:test';
import type { WorkflowPersistenceAdapter, WorkflowRunRecord } from '@gobing-ai/ts-dual-workflow-engine';
import { EventBus } from '@gobing-ai/ts-infra';
import { ObservableWorkflowAdapter, type WorkflowObservabilityEventMap } from '../../src/workflow/observability';

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

    test('action start/finish: returns the inner actionId AND emits both action events', async () => {
        const { adapter } = stubAdapter();
        const bus = new EventBus<WorkflowObservabilityEventMap>();
        const started: string[] = [];
        const finished: Array<{ actionId: string; ok: boolean }> = [];
        bus.on('workflow.action.started', (e) => started.push(e.actionId));
        bus.on('workflow.action.finished', (e) => finished.push({ actionId: e.actionId, ok: e.ok }));

        const dec = new ObservableWorkflowAdapter(adapter, bus);
        const id = await dec.saveActionStart('run-1', 'implement', 'agent.run');
        await dec.saveActionFinalize(id, 'done', 42, true);

        expect(id).toBe('action-1'); // inner id propagated unchanged
        expect(started).toEqual(['action-1']);
        expect(finished).toEqual([{ actionId: 'action-1', ok: true }]);
    });

    test('finalizeRun: emits workflow.run.finalized with the terminal status', async () => {
        const { adapter } = stubAdapter();
        const bus = new EventBus<WorkflowObservabilityEventMap>();
        const seen: string[] = [];
        bus.on('workflow.run.finalized', (e) => seen.push(e.status));

        await new ObservableWorkflowAdapter(adapter, bus).finalizeRun('run-1', 'done', '2026-06-23T01:00:00.000Z');

        expect(seen).toEqual(['done']);
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
