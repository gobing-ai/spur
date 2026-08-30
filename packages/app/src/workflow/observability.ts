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
    WorkflowDef,
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
    /** Declared agent.run step role (0538 R2) — the routing reason. */
    role?: string;
    invocation?: string;
    timeoutMs?: number;
    /** Declared hard budgets (0707 R4) — identifiers only, never usage numbers. */
    maxTokens?: number;
    maxCostUsd?: number;
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
    result?: { error?: string; usage: WorkflowActionUsageSummary };
}
/** Bounded usage summary carried on action-finished events (0707 R3/R9). */
export interface WorkflowActionUsageSummary {
    availability: 'measured' | 'unavailable';
    /** Sum of reported token counts, present only when tokens were measured. */
    totalTokens?: number;
    costUsd?: number;
    source?: string;
    /** Present only when unavailable. */
    reason?: string;
}

/**
 * Bounded hard-budget verdict for one `agent.run` step (0707 R6): identifiers
 * and scalars only — no prompts, output, or raw provider payloads. Emitted
 * directly by the action runner at the post-dispatch safe boundary (standalone
 * event, ordered by `at`; sequence numbering belongs to the lifecycle stream).
 */
export interface WorkflowAgentBudgetEvent {
    readonly schemaVersion: 1;
    readonly eventId: string;
    readonly runId: string;
    readonly at: string;
    readonly severity: 'warning';
    /** The state (node) whose action breached/was unverifiable. */
    readonly node: string;
    /** The action kind (always `agent.run`). */
    readonly kind: string;
    /** Resolved executor label. */
    readonly agent: string;
    readonly verdict: 'over' | 'unverifiable';
    /** The declared caps that were evaluated. */
    readonly budget: { maxTokens?: number; maxCostUsd?: number };
    /** Human-readable violations (over) or the fail-closed reason (unverifiable). */
    readonly violations: readonly string[];
}

/**
 * An escalation packet was projected and persisted from run evidence (0709 R6).
 * Identifiers and the artifact reference only — the packet JSON stays on disk.
 */
export interface WorkflowEscalationCreatedEvent {
    /** Envelope schema version. Increment only for a breaking payload change. */
    readonly schemaVersion: 1;
    readonly eventId: string;
    readonly runId: string;
    readonly workflowName?: string;
    readonly at: string;
    /** Stable failure fingerprint of the projected packet. */
    readonly fingerprint: string;
    /** Path of the canonical JSON packet artifact. */
    readonly artifactPath: string;
    /** The unresolved operator decision kind (closed vocabulary, 0709 R1). */
    readonly decision: string;
}

/**
 * Secondary diagnostic when escalation projection itself failed (0709 R7): the
 * original trip wire / terminal failure is untouched; this only records that
 * the packet could not be rendered.
 */
export interface WorkflowEscalationProjectionFailedEvent {
    readonly schemaVersion: 1;
    readonly eventId: string;
    readonly runId: string;
    readonly workflowName?: string;
    readonly at: string;
    /** Bounded error message. */
    readonly error: string;
}

/**
 * Canonical bounded trip-wire event (0708 R4): policy id/version, run/action/task
 * correlation, threshold, observed value, and evidence refs — identifiers and
 * scalars only, never raw output. Emitted at the existing workflow/action safe
 * boundaries when a catalog condition fires.
 */
export interface WorkflowTripwireFiredEvent {
    readonly schemaVersion: 1;
    readonly eventId: string;
    readonly runId: string;
    readonly at: string;
    readonly severity: 'warning';
    /** The state (node) at whose safe boundary the wire fired. */
    readonly node: string;
    /** The action kind that observed the signal (e.g. `agent.run`, `proof.fingerprint`). */
    readonly kind: string;
    /** Fired policy from the closed catalog, with its per-policy version. */
    readonly policy: { id: string; version: number };
    /** What the workflow does: fail (stop dispatch) or continue (record only). */
    readonly response: 'fail' | 'continue';
    /** What was observed, bounded and redacted by the emitting boundary. */
    readonly observed: string;
    /** Threshold that was crossed, in the owning contract's terms. */
    readonly threshold?: string;
    /** Correlation ids: the action and, when known, the task wbs. */
    readonly actionId: string;
    readonly task?: string;
    /** Where the evidence lives (artifact path, digest pair, trace ids, …). */
    readonly evidenceRefs: readonly string[];
    /** The exact next decision required from an operator (R7). */
    readonly nextDecision: string;
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
    /** Bounded hard-budget verdict emitted at the agent.run safe boundary (0707 R6). */
    'workflow.agent.budget': (event: WorkflowAgentBudgetEvent) => void;
    /** Canonical operational trip-wire event emitted at workflow safe boundaries (0708 R4). */
    'workflow.tripwire.fired': (event: WorkflowTripwireFiredEvent) => void;
    /** Canonical escalation packet projected from run evidence (0709 R6). */
    'workflow.escalation.created': (event: WorkflowEscalationCreatedEvent) => void;
    /** Escalation projection failed; original failure preserved (0709 R7). */
    'workflow.escalation.projection_failed': (event: WorkflowEscalationProjectionFailedEvent) => void;
    /** Unified agent lifecycle emitted by both direct and workflow dispatch paths. */
    'workflow.agent': (event: AgentExecutionEvent) => void;
    'workflow.steering': (event: SteeringAck) => void;
};

/** The typed event bus consumers subscribe to for the live per-step workflow stream. */
export type WorkflowObservabilityBus = EventBus<WorkflowObservabilityEventMap>;

const now = (): string => new Date().toISOString();
const MAX_FIELD_LENGTH = 256;
const SECRET_PATTERN = /(?:sk-[a-z0-9_-]{8,}|(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+|bearer\s+\S+)/gi;

// ─── Workflow identity (R3) ──────────────────────────────────────────────

/**
 * Deterministic workflow identity derived once from a loaded definition (R3).
 * `workflowName` is the definition name; `nodeLabels` maps every declared
 * step-bearing id (state-machine `states` / transition-flow `nodes`) to its
 * non-empty trimmed description, falling back to the declared id itself.
 */
export interface WorkflowEventIdentity {
    workflowName: string;
    nodeLabels: ReadonlyMap<string, string>;
}

/** Build the identity from a parsed `WorkflowDef`; no history/DB lookup. */
export function createWorkflowEventIdentity(def: WorkflowDef): WorkflowEventIdentity {
    const nodeLabels = new Map<string, string>();
    const entries = 'states' in def ? def.states : def.nodes;
    for (const step of entries) {
        const description = step.description?.trim();
        nodeLabels.set(step.id, description !== undefined && description !== '' ? description : step.id);
    }
    return { workflowName: def.name, nodeLabels };
}

/**
 * Stamp workflow identity onto one payload: always `workflowName`, plus `nodeLabel`
 * when the payload carries a step-bearing identifier (`node` / `phase` / `from`)
 * that resolves in the identity map. Shallow-copies object payloads; malformed or
 * non-object payloads pass through untouched for the existing failure isolation.
 * `eventName` is accepted for signature symmetry with the bus decorator; decoration
 * is uniform across every `workflow.*` event, so it is not branched on.
 */
export function decorateWorkflowEvent(identity: WorkflowEventIdentity, _eventName: string, payload: unknown): unknown {
    if (typeof payload !== 'object' || payload === null) return payload;
    const source = payload as Record<string, unknown>;
    const decorated: Record<string, unknown> = { ...source, workflowName: identity.workflowName };
    for (const key of ['node', 'phase', 'from'] as const) {
        const id = source[key];
        if (typeof id === 'string') {
            const label = identity.nodeLabels.get(id);
            if (label !== undefined) {
                decorated.nodeLabel = label;
                break;
            }
        }
    }
    return decorated;
}

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
    if (kind === 'agent.run' && typeof options.role === 'string' && options.role !== '') {
        metadata.role = bounded(options.role);
    }
    if (typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)) {
        metadata.timeoutMs = Math.max(0, options.timeoutMs);
    }
    if (typeof options.maxTokens === 'number' && Number.isFinite(options.maxTokens)) {
        metadata.maxTokens = Math.max(0, options.maxTokens);
    }
    if (typeof options.maxCostUsd === 'number' && Number.isFinite(options.maxCostUsd)) {
        metadata.maxCostUsd = Math.max(0, options.maxCostUsd);
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

function projectUsage(raw: unknown): WorkflowActionUsageSummary {
    if (typeof raw === 'object' && raw !== null) {
        const obj = raw as Record<string, unknown>;
        if (obj.availability === 'measured') {
            return {
                availability: 'measured',
                ...(typeof obj.totalTokens === 'number' && Number.isFinite(obj.totalTokens)
                    ? { totalTokens: obj.totalTokens }
                    : {}),
                ...(typeof obj.costUsd === 'number' && Number.isFinite(obj.costUsd) ? { costUsd: obj.costUsd } : {}),
                ...(typeof obj.source === 'string' && obj.source !== '' ? { source: bounded(obj.source) } : {}),
            };
        }
        const reason =
            typeof obj.unavailabilityReason === 'string' && obj.unavailabilityReason !== ''
                ? bounded(obj.unavailabilityReason)
                : undefined;
        return { availability: 'unavailable', ...(reason !== undefined ? { reason } : {}) };
    }
    return { availability: 'unavailable' };
}

function projectResult(result: unknown): { error?: string; usage: WorkflowActionUsageSummary } | undefined {
    if (result === undefined) return undefined;
    if (typeof result !== 'object' || result === null) return { usage: { availability: 'unavailable' } };
    const obj = result as Record<string, unknown>;
    const error = typeof obj.error === 'string' ? bounded(obj.error) : undefined;
    const stderr =
        typeof obj.stderr === 'string' && obj.stderr.trim() !== '' ? bounded(obj.stderr.trim(), 120) : undefined;
    const stdout =
        typeof obj.stdout === 'string' && obj.stdout.trim() !== '' ? bounded(obj.stdout.trim(), 120) : undefined;
    const detail = error ?? stderr ?? stdout;
    return {
        ...(detail !== undefined ? { error: detail } : {}),
        // Producers nest usage under `data` (agent-run buildResultData); a direct
        // `usage` on the envelope stays supported for non-agent actions.
        usage: projectUsage((obj.data as Record<string, unknown> | undefined)?.usage ?? obj.usage),
    };
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
