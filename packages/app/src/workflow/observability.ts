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
import type { AgentExecutionEvent } from '../observability/agent-execution';
import type { SteeringAck } from './steering';

/** The engine does not export its reseed-result type; derive it from the interface. */
type ReseedResult = Awaited<ReturnType<WorkflowPersistenceAdapter['reseedRun']>>;

/** Base fields every workflow observability event carries. */
interface WorkflowEventBase {
    /** Envelope schema version. Increment only for a breaking payload change. */
    schemaVersion: 1;
    /** Unique event identity for replay/deduplication. */
    eventId: string;
    /** Monotonic sequence within one run. */
    sequence: number;
    /** The run this event belongs to. */
    runId: string;
    /** Workflow definition name, when known. */
    workflowName?: string;
    /** ISO timestamp the event was emitted. */
    at: string;
    /** Producer-owned observability severity. */
    severity?: 'info' | 'warning' | 'error';
}

/** Bounded, trace-safe projection of resolved action options. */
export interface WorkflowActionMetadata {
    agent?: string;
    model?: string;
    invocation?: string;
    timeoutMs?: number;
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
    /** Redacted resolved metadata; raw prompts, commands, and environment never cross this seam. */
    metadata?: WorkflowActionMetadata;
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
    /** State/node copied from the correlated start event. */
    node: string;
    /** Action kind copied from the correlated start event. */
    kind: string;
    /** Trace-safe result summary; absent when the action returned no result. */
    result?: { error?: string; usage: string };
}
/** One live stdout/stderr chunk emitted by a non-agent action (e.g. `shell`) during execution. */
export interface WorkflowActionOutputEvent extends WorkflowEventBase {
    /** The action kind (e.g. `shell`). */
    kind: string;
    /** State/node the action runs in. */
    node: string;
    /** Which child stream produced the chunk. */
    stream: 'stdout' | 'stderr';
    /** One bounded, redacted output chunk. */
    chunk: string;
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
    /** Live stdout/stderr chunk from a non-agent action (e.g. `shell`) during execution. */
    'workflow.action.output': (event: WorkflowActionOutputEvent) => void;
    /** Unified agent lifecycle emitted by both direct and workflow dispatch paths. */
    'workflow.agent': (event: AgentExecutionEvent) => void;
    'workflow.steering': (event: SteeringAck) => void;
};

/** The typed event bus consumers subscribe to for the live per-step workflow stream. */
export type WorkflowObservabilityBus = EventBus<WorkflowObservabilityEventMap>;

const now = (): string => new Date().toISOString();
const MAX_FIELD_LENGTH = 256;
const SECRET_PATTERN = /(?:sk-[a-z0-9_-]{8,}|(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+|bearer\s+\S+)/gi;

/** Bound a string to a max length, redacting secret-like patterns, for trace-safe event fields. */
export function bounded(value: string, maxLength = MAX_FIELD_LENGTH): string {
    const redacted = value.replace(SECRET_PATTERN, '[REDACTED]');
    return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength)}…`;
}

/**
 * Project resolved action options into an intentionally small allow-list. Prompt
 * bodies and shell commands are summarized, never copied to an event payload.
 */
export function projectActionMetadata(
    kind: string,
    options?: Record<string, unknown>,
): WorkflowActionMetadata | undefined {
    if (options === undefined) return undefined;
    const metadata: WorkflowActionMetadata = {};
    if (typeof options.agent === 'string' && options.agent !== '') metadata.agent = bounded(options.agent);
    if (typeof options.model === 'string' && options.model !== '') metadata.model = bounded(options.model);
    if (typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)) {
        metadata.timeoutMs = Math.max(0, options.timeoutMs);
    }
    const input = typeof options.input === 'string' ? options.input.trim() : '';
    if (kind === 'agent.run' && input !== '') {
        const command = input.startsWith('/') ? input.split(/\s+/, 1)[0] : undefined;
        metadata.invocation = command === undefined ? `[prompt ${input.length} chars]` : bounded(command);
    } else if (kind === 'shell' && typeof options.command === 'string' && options.command.trim() !== '') {
        metadata.invocation = bounded(sanitizeCommand(options.command), 80);
    } else if (kind === 'note' && typeof options.message === 'string' && options.message.trim() !== '') {
        metadata.invocation = bounded(options.message.trim(), 80);
    }
    return Object.keys(metadata).length === 0 ? undefined : metadata;
}

function sanitizeCommand(cmd: string): string {
    const trimmed = cmd.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    if (/(?:authorization|bearer|password|secret|token|api_key|private_key)/i.test(trimmed)) {
        return '[shell command redacted]';
    }
    return trimmed;
}

function projectResult(result: unknown): { error?: string; usage: string } | undefined {
    if (result === undefined) return undefined;
    if (typeof result !== 'object' || result === null) return { usage: 'unavailable' };
    const obj = result as Record<string, unknown>;
    const error = typeof obj.error === 'string' ? bounded(obj.error) : undefined;
    const stderr =
        typeof obj.stderr === 'string' && obj.stderr.trim() !== '' ? bounded(obj.stderr.trim(), 120) : undefined;
    const stdout =
        typeof obj.stdout === 'string' && obj.stdout.trim() !== '' ? bounded(obj.stdout.trim(), 120) : undefined;
    const detail = error ?? stderr ?? stdout;
    return { ...(detail !== undefined ? { error: detail } : {}), usage: 'unavailable' };
}

/**
 * Wraps a `WorkflowPersistenceAdapter`, delegating every call unchanged while
 * mirroring the per-step lifecycle onto the observability bus. Pure decorator —
 * read paths and non-lifecycle methods pass straight through.
 */
export class ObservableWorkflowAdapter implements WorkflowPersistenceAdapter {
    private readonly sequences = new Map<string, number>();
    private readonly workflowNames = new Map<string, string>();
    private readonly actions = new Map<string, { runId: string; node: string; kind: string }>();

    constructor(
        private readonly inner: WorkflowPersistenceAdapter,
        private readonly bus: WorkflowObservabilityBus,
    ) {}

    async createRun(record: WorkflowRunRecord): Promise<void> {
        await this.inner.createRun(record);
        this.workflowNames.set(record.id, record.workflow_name);
        await this.bus.emit('workflow.run.started', {
            ...this.envelope(record.id),
            workflowName: record.workflow_name,
        });
    }

    async finalizeRun(runId: string, status: WorkflowStatus, completedAt: string): Promise<void> {
        await this.inner.finalizeRun(runId, status, completedAt);
        await this.bus.emit('workflow.run.finalized', {
            ...this.envelope(runId, completedAt),
            status,
            severity: status === 'failed' ? 'error' : status === 'paused' ? 'warning' : 'info',
        });
        // Do not clear correlation state here: the upstream engine deliberately
        // finalizes action rows fire-and-forget, so a late action-finished projection
        // may arrive after the run-finalized projection on the same adapter instance.
    }

    async savePhase(runId: string, phase: string, status: WorkflowStatus): Promise<void> {
        await this.inner.savePhase(runId, phase, status);
        await this.bus.emit('workflow.phase', { ...this.envelope(runId), phase, status });
    }

    async saveTransition(runId: string, from: string, to: string, trigger: string | null): Promise<void> {
        await this.inner.saveTransition(runId, from, to, trigger);
        await this.bus.emit('workflow.transition', { ...this.envelope(runId), from, to, trigger });
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
        await this.bus.emit('workflow.transition', { ...this.envelope(runId), from, to, trigger });
        if (phase) {
            await this.bus.emit('workflow.phase', {
                ...this.envelope(runId),
                phase: phase.phase,
                status: phase.status,
            });
        }
    }

    async saveActionStart(
        runId: string,
        node: string,
        kind: string,
        options?: Record<string, unknown>,
    ): Promise<string> {
        const actionId = await this.inner.saveActionStart(runId, node, kind, options);
        this.actions.set(actionId, { runId, node, kind });
        const metadata = projectActionMetadata(kind, options);
        await this.bus.emit('workflow.action.started', {
            ...this.envelope(runId),
            actionId,
            node,
            kind,
            ...(metadata !== undefined ? { metadata } : {}),
        });
        return actionId;
    }

    async saveActionFinalize(
        actionId: string,
        status: WorkflowStatus,
        durationMs: number,
        ok: boolean,
        kind: string,
        result?: unknown,
        redactor?: ActionRedactor,
    ): Promise<void> {
        await this.inner.saveActionFinalize(actionId, status, durationMs, ok, kind, result, redactor);
        const action = this.actions.get(actionId);
        if (action === undefined) {
            // The decorator may be attached after an action started (process resume).
            // Suppress an uncorrelated event instead of violating the non-empty runId contract.
            return;
        }
        this.actions.delete(actionId);
        const projected = projectResult(result);
        await this.bus.emit('workflow.action.finished', {
            ...this.envelope(action.runId),
            actionId,
            status,
            durationMs,
            ok,
            node: action.node,
            kind: action.kind,
            ...(projected !== undefined ? { result: projected } : {}),
            severity: ok ? 'info' : 'error',
        });
    }

    private envelope(runId: string, at = now()): WorkflowEventBase {
        const sequence = (this.sequences.get(runId) ?? 0) + 1;
        this.sequences.set(runId, sequence);
        const workflowName = this.workflowNames.get(runId);
        return {
            schemaVersion: 1,
            eventId: crypto.randomUUID(),
            sequence,
            runId,
            ...(workflowName !== undefined ? { workflowName } : {}),
            at,
            severity: 'info',
        };
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
