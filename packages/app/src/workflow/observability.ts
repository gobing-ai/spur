/**
 * Workflow observability — typed per-step event map and a persistence-adapter
 * decorator that emits to a ts-infra `EventBus` on every lifecycle hook.
 *
 * The board (and any future SSE/WS surface) subscribes to `EventBus<WorkflowObservabilityEventMap>`
 * for a live per-step stream, while persistence stays exactly as the engine defines it.
 * The decorator wraps the engine's `DbWorkflowPersistenceAdapter` and, on each hook,
 * delegates to it (durability unchanged) AND publishes a structured event — so adding
 * observability never alters what is persisted, only mirrors it onto the bus.
 *
 * Mirrors the `BusPlanningEventEmitter` precedent (planning-events.ts): emit to the bus,
 * persistence is the source of truth. No engine change — the seam is the adapter interface.
 */

import type {
    ActionRedactor,
    WorkflowPersistenceAdapter,
    WorkflowRunRecord,
    WorkflowStatus,
} from '@gobing-ai/ts-dual-workflow-engine';
import type { EventBus } from '@gobing-ai/ts-infra';

/** The engine does not export its reseed-result type; derive it from the interface. */
type ReseedResult = Awaited<ReturnType<WorkflowPersistenceAdapter['reseedRun']>>;

/** Base fields every workflow observability event carries. */
interface WorkflowEventBase {
    /** The run this event belongs to. */
    runId: string;
    /** ISO timestamp the event was emitted. */
    at: string;
}

/** A run has been created and is about to execute its first state. */
export interface WorkflowRunStartedEvent extends WorkflowEventBase {
    /** The workflow definition's name (e.g. `task-pipeline`). */
    workflowName: string;
}
/** A run reached a terminal status (`done` / `failed` / `paused` / `cancelled`). */
export interface WorkflowRunFinalizedEvent extends WorkflowEventBase {
    /** The terminal status the run settled on. */
    status: WorkflowStatus;
}
/** A state-machine phase changed status (entered / completed / failed). */
export interface WorkflowPhaseEvent extends WorkflowEventBase {
    /** The phase (state id) this event is about. */
    phase: string;
    /** The phase's new status. */
    status: WorkflowStatus;
}
/** A transition between two states was committed. */
export interface WorkflowTransitionEvent extends WorkflowEventBase {
    /** Source state. */
    from: string;
    /** Destination state. */
    to: string;
    /** The trigger/guard kind that fired the transition, or null. */
    trigger: string | null;
}
/** An action (e.g. `agent.run`, `shell`) started executing within a state. */
export interface WorkflowActionStartedEvent extends WorkflowEventBase {
    /** The persisted action-row id, correlating start ↔ finish. */
    actionId: string;
    /** The state (node) the action runs in. */
    node: string;
    /** The action kind (e.g. `agent.run`, `shell`, `hitl.confirm`). */
    kind: string;
}
/** An action finished, carrying its outcome and timing. */
export interface WorkflowActionFinishedEvent extends WorkflowEventBase {
    /** The action-row id matching the corresponding {@link WorkflowActionStartedEvent}. */
    actionId: string;
    /** Final action status. */
    status: WorkflowStatus;
    /** Wall-clock duration in milliseconds. */
    durationMs: number;
    /** Whether the action succeeded. */
    ok: boolean;
}

/**
 * Typed event map for `EventBus<WorkflowObservabilityEventMap>`. Names are namespaced
 * `workflow.*` so a single shared bus can host planning, rule, and workflow streams.
 */
export type WorkflowObservabilityEventMap = {
    'workflow.run.started': (event: WorkflowRunStartedEvent) => void;
    'workflow.run.finalized': (event: WorkflowRunFinalizedEvent) => void;
    'workflow.phase': (event: WorkflowPhaseEvent) => void;
    'workflow.transition': (event: WorkflowTransitionEvent) => void;
    'workflow.action.started': (event: WorkflowActionStartedEvent) => void;
    'workflow.action.finished': (event: WorkflowActionFinishedEvent) => void;
};

/** The typed event bus consumers subscribe to for the live per-step workflow stream. */
export type WorkflowObservabilityBus = EventBus<WorkflowObservabilityEventMap>;

const now = (): string => new Date().toISOString();

/**
 * Wraps a `WorkflowPersistenceAdapter`, delegating every call unchanged while
 * mirroring the per-step lifecycle onto the observability bus. Pure decorator —
 * read paths and non-lifecycle methods pass straight through.
 */
export class ObservableWorkflowAdapter implements WorkflowPersistenceAdapter {
    constructor(
        private readonly inner: WorkflowPersistenceAdapter,
        private readonly bus: WorkflowObservabilityBus,
    ) {}

    async createRun(record: WorkflowRunRecord): Promise<void> {
        await this.inner.createRun(record);
        await this.bus.emit('workflow.run.started', {
            runId: record.id,
            workflowName: record.workflow_name,
            at: now(),
        });
    }

    async finalizeRun(runId: string, status: WorkflowStatus, completedAt: string): Promise<void> {
        await this.inner.finalizeRun(runId, status, completedAt);
        await this.bus.emit('workflow.run.finalized', { runId, status, at: completedAt });
    }

    async savePhase(runId: string, phase: string, status: WorkflowStatus): Promise<void> {
        await this.inner.savePhase(runId, phase, status);
        await this.bus.emit('workflow.phase', { runId, phase, status, at: now() });
    }

    async saveTransition(runId: string, from: string, to: string, trigger: string | null): Promise<void> {
        await this.inner.saveTransition(runId, from, to, trigger);
        await this.bus.emit('workflow.transition', { runId, from, to, trigger, at: now() });
    }
    /**
     * Atomic equivalent of saveTransition + saveWorkflowState (+ optional savePhase):
     * delegate to inner, then emit the same observability events those individual
     * methods would have emitted — transition always, phase only when provided.
     * Mirrors the engine's commitHop semantics (ts-dual-workflow-engine 0.4.7, ADR-020).
     */
    async commitTransition(
        runId: string,
        from: string,
        to: string,
        trigger: string | null,
        _state: string,
        _data: Record<string, unknown>,
        phase?: { phase: string; status: WorkflowStatus },
    ): Promise<void> {
        await this.inner.commitTransition(runId, from, to, trigger, _state, _data, phase);
        await this.bus.emit('workflow.transition', { runId, from, to, trigger, at: now() });
        if (phase) {
            await this.bus.emit('workflow.phase', { runId, phase: phase.phase, status: phase.status, at: now() });
        }
    }

    async saveActionStart(runId: string, node: string, kind: string): Promise<string> {
        const actionId = await this.inner.saveActionStart(runId, node, kind);
        await this.bus.emit('workflow.action.started', { runId, actionId, node, kind, at: now() });
        return actionId;
    }

    async saveActionFinalize(
        actionId: string,
        status: WorkflowStatus,
        durationMs: number,
        ok: boolean,
        result?: unknown,
        redactor?: ActionRedactor,
    ): Promise<void> {
        await this.inner.saveActionFinalize(actionId, status, durationMs, ok, result, redactor);
        // runId is not a param of this hook; the actionId correlates back to its run on the
        // consumer side (action_runs.run_id). The board joins on actionId for the finish event.
        await this.bus.emit('workflow.action.finished', {
            runId: '',
            actionId,
            status,
            durationMs,
            ok,
            at: now(),
        });
    }

    // ── pass-through (non-lifecycle / read paths) ──
    saveWorkflowState(runId: string, state: string, data: Record<string, unknown>): Promise<void> {
        return this.inner.saveWorkflowState(runId, state, data);
    }
    loadRun(runId: string): Promise<WorkflowRunRecord | undefined> {
        return this.inner.loadRun(runId);
    }
    listRuns(): Promise<readonly WorkflowRunRecord[]> {
        return this.inner.listRuns();
    }
    findRunByKey(workflowName: string, externalKey: string): Promise<WorkflowRunRecord | undefined> {
        return this.inner.findRunByKey(workflowName, externalKey);
    }
    createOrAttachRun(record: WorkflowRunRecord): Promise<WorkflowRunRecord> {
        return this.inner.createOrAttachRun(record);
    }
    reseedRun(runId: string, newState: string): Promise<ReseedResult> {
        return this.inner.reseedRun(runId, newState);
    }
    loadCurrentState(runId: string): Promise<string | undefined> {
        return this.inner.loadCurrentState(runId);
    }
    loadLatestStateSnapshot(runId: string): Promise<{ state: string; data: Record<string, unknown> } | undefined> {
        return this.inner.loadLatestStateSnapshot(runId);
    }
    listPausedRuns(options?: { workflowName?: string; limit?: number }): Promise<readonly WorkflowRunRecord[]> {
        return this.inner.listPausedRuns(options);
    }
}
