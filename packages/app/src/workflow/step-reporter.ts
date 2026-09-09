/**
 * Workflow step reporter — pure formatters that turn observability events and a
 * workflow definition into human-readable CLI lines.
 *
 * Two pure functions, no I/O: the CLI subscribes `renderStepLine` to the
 * `WorkflowObservabilityBus` and prints non-null results, and prints
 * `renderRunPlan(def)` once before a synchronous run starts. Keeping them pure
 * (event/def → string) makes them unit-testable without spawning a run and lets
 * any future surface (board, SSE) reuse the same mapping.
 *
 * Design note: the run-plan preview is built from the parsed workflow DEFINITION
 * (its declared states/nodes), NOT from a `WorkflowRunResult` — that terminal
 * shape carries no step list (dogfood 0114 correction).
 */

import type { WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import type { AgentExecutionEvent } from '../observability/agent-execution';
import type { NormalizedAgentUsage } from '../services/agent-usage';
import type {
    WorkflowActionFinishedEvent,
    WorkflowActionOutputEvent,
    WorkflowActionStartedEvent,
    WorkflowActionUsageSummary,
    WorkflowPhaseEvent,
    WorkflowTransitionEvent,
} from './observability';

/** The subset of observability events the CLI reporter renders as progress lines. */
export type StepEvent =
    | AgentExecutionEvent
    | WorkflowActionOutputEvent
    | WorkflowActionStartedEvent
    | WorkflowActionFinishedEvent
    | WorkflowPhaseEvent
    | WorkflowTransitionEvent;
/** Human workflow progress content depth, independent from JSON machine mode. */
export type WorkflowOutputDetail = 'minimal' | 'invocation' | 'full';
/** Options accepted by pure workflow progress renderers. */
export interface StepRenderOptions {
    detail?: WorkflowOutputDetail;
    /** Whether to prepend `[run <runId>]` to output lines (default: true). */
    showRunId?: boolean;
}

/** A reporter maps one event to a display line, or `null` to emit nothing. */
export type StepLineRenderer = (event: StepEvent) => string | null;

const isAgentExecution = (e: StepEvent): e is AgentExecutionEvent => 'executionId' in e;
const isActionOutput = (e: StepEvent): e is WorkflowActionOutputEvent =>
    'stream' in e && 'chunk' in e && !('executionId' in e);
const isActionStarted = (e: StepEvent): e is WorkflowActionStartedEvent => 'kind' in e && 'node' in e;
const isActionFinished = (e: StepEvent): e is WorkflowActionFinishedEvent => 'durationMs' in e && 'ok' in e;
const isPhase = (e: StepEvent): e is WorkflowPhaseEvent => 'phase' in e;
const isTransition = (e: StepEvent): e is WorkflowTransitionEvent => 'from' in e && 'to' in e;

function runPrefix(runId: string, options: StepRenderOptions): string {
    if (options.showRunId === false) return '';
    // Single-run CLI output omits the run id entirely (it is printed once in the
    // header). When shown, condense the 36-char GUID to its first 8 chars so the
    // id is never repeated verbatim across 30+ progress lines (R1).
    return `[run ${runId.slice(0, 8)}] `;
}

/**
 * Render a single progress line for a workflow observability event, or `null`
 * when the event has no operator-facing line. Action-started lines mark the
 * blind-spot entry; action-finished lines close it with outcome + duration.
 */
export function renderStepLine(event: StepEvent, options: StepRenderOptions = {}): string | null {
    const detail = options.detail ?? 'invocation';
    const pfx = runPrefix(event.runId, options);

    if (isAgentExecution(event)) {
        if (event.kind === 'output') {
            if (detail === 'minimal') return null;
            const label = event.stream === 'stderr' ? 'stderr' : 'stdout';
            return `${pfx}  ${label}> ${event.chunk.replace(/\s+$/, '')}`;
        }
        if (event.kind === 'heartbeat') {
            if (detail === 'minimal') return null;
            const budget =
                event.timeoutMs === undefined
                    ? 'unbounded'
                    : `${formatDuration(Math.max(0, event.timeoutMs - event.elapsedMs))} remaining`;
            const pidPart = event.pid === undefined ? '' : ` · pid=${event.pid}`;
            return `${pfx}  … agent execution · elapsed=${formatDuration(event.elapsedMs)} · budget=${budget}${pidPart}`;
        }
        if (event.kind === 'dropped') {
            return detail === 'minimal' ? null : `${pfx}… output pressure · dropped=${event.chunks} chunks`;
        }
        if (event.kind === 'started') {
            if (detail === 'minimal') return null;
            const model = event.model === undefined ? '' : `(${event.model})`;
            const pidPart = event.pid === undefined ? '' : ` · pid=${event.pid}`;
            const full = detail === 'full' ? ` · execution=${event.executionId}` : '';
            return `${pfx}  agent=${event.agent}${model} => ${event.invocation}${pidPart}${full}`;
        }
        const mark = event.outcome === 'done' ? '✓' : '✗';
        const full = detail === 'full' ? ` · execution=${event.executionId}` : '';
        const exitPart = event.exitCode !== null && event.exitCode !== undefined ? ` · exit ${event.exitCode}` : '';
        return detail === 'minimal'
            ? null
            : `${pfx}${mark} agent ${event.outcome} (${formatDuration(event.durationMs)})${exitPart} · ${formatUsage(event.usage)}${event.reason ? ` · ${event.reason}` : ''}${full}`;
    }
    if (isActionOutput(event)) {
        if (detail === 'minimal') return null;
        const label = event.stream === 'stderr' ? 'stderr' : 'stdout';
        // 2-space child indent under the parent action block (R8/R9 streaming).
        return `${pfx}  ${label}> ${event.chunk.replace(/\s+$/, '')}`;
    }
    if (isActionFinished(event)) {
        const mark = event.ok ? '✓' : '✗';
        if (detail === 'minimal') return `  ${mark} ${event.status} (${formatDuration(event.durationMs)})`;
        const failure = event.result?.error === undefined ? '' : ` · ${event.result.error}`;
        const usagePart = formatUsageSummary(event.result?.usage);
        const full = detail === 'full' ? ` · action=${event.actionId} · seq=${event.sequence}` : '';
        return `${pfx}${mark} ${event.node}/${event.kind} (${formatDuration(event.durationMs)})${usagePart}${failure}${full}`;
    }
    if (isActionStarted(event)) {
        if (detail === 'minimal') return `  → ${event.node}: ${event.kind}…`;
        const agentPart =
            event.metadata?.agent && event.metadata.agent !== 'unavailable' ? ` · agent=${event.metadata.agent}` : '';
        const modelPart =
            event.metadata?.model && event.metadata.model !== 'unavailable' ? ` · model=${event.metadata.model}` : '';
        const rolePart =
            event.metadata?.role && event.metadata.role !== 'unavailable' ? ` · role=${event.metadata.role}` : '';
        const invocationPart =
            event.metadata?.invocation && event.metadata.invocation !== 'unavailable'
                ? ` => ${event.metadata.invocation}`
                : '';
        const timeout =
            event.metadata?.timeoutMs === undefined ? 'unbounded' : formatDuration(event.metadata.timeoutMs);
        const full = detail === 'full' ? ` · action=${event.actionId} · seq=${event.sequence}` : '';
        return `${pfx}→ ${event.node}/${event.kind}${agentPart}${modelPart}${rolePart}${invocationPart} · timeout=${timeout}${full}`;
    }
    if (isPhase(event)) {
        return detail === 'minimal' ? `▶ ${event.phase} [${event.status}]` : `${pfx}▶ ${event.phase} [${event.status}]`;
    }
    if (isTransition(event)) {
        if (detail === 'minimal') return null;
        const seqPart = detail === 'full' ? ` · seq=${event.sequence}` : '';
        return `${pfx}↪ ${event.from} → ${event.to}${event.trigger ? ` [${event.trigger}]` : ''}${seqPart}`;
    }
    return null;
}

/** Render liveness for an action that has not yet produced a finish event. */
export function renderActionHeartbeat(
    event: WorkflowActionStartedEvent,
    elapsedMs: number,
    options: StepRenderOptions = {},
): string | null {
    const detail = options.detail ?? 'invocation';
    if (detail === 'minimal') return null;
    const elapsed = formatDuration(elapsedMs);
    const budget =
        event.metadata?.timeoutMs === undefined
            ? 'unbounded'
            : `${formatDuration(Math.max(0, event.metadata.timeoutMs - elapsedMs))} remaining`;
    const full = detail === 'full' ? ` · action=${event.actionId}` : '';
    return `${runPrefix(event.runId, options)}… ${event.node}/${event.kind} · elapsed=${elapsed} · budget=${budget}${full}`;
}

/** One declared workflow step with its structural markers (task 0695). */
export interface WorkflowStep {
    id: string;
    initial: boolean;
    terminal: boolean;
    failure: boolean;
    pause: boolean;
    loopBack: boolean;
    conditional: boolean;
    /** transition-flow only; absent for state-machine steps. */
    nodeType?: 'action' | 'gate' | 'parallel' | 'decision';
    /** Declared description text (0768 R2); absent when the definition declares none. */
    description?: string;
}

/**
 * The single step-sequence builder behind both the run-start plan preview and
 * the todo projection (0695 R5): one entry per declared state/node, in
 * DECLARATION order — no topological reordering for either kind. Markers are
 * structural, not predictive: `conditional` means every incoming edge is
 * guarded, not that the step will be entered; `loopBack` means some declared
 * source at-or-after this position transitions back here (self-loops included).
 */
export function buildWorkflowSteps(def: WorkflowDef): WorkflowStep[] {
    if (def.kind === 'transition-flow') {
        const order = new Map(def.nodes.map((n, i) => [n.id, i] as const));
        const terminal = new Set<string>(def.terminalNodes ?? []);
        return def.nodes.map((node) => {
            const incoming = def.edges.filter((e) => e.to === node.id);
            return {
                id: node.id,
                initial: node.id === def.initialNode,
                terminal: terminal.has(node.id),
                failure: false, // transition-flow has no failure-state concept.
                pause: node.pause === true,
                loopBack: incoming.some((e) => (order.get(e.from) ?? -1) >= (order.get(node.id) ?? 0)),
                conditional:
                    node.id !== def.initialNode &&
                    incoming.length > 0 &&
                    incoming.every((e) => e.condition !== undefined),
                nodeType: node.type ?? 'action',
                ...(typeof node.description === 'string' && node.description !== ''
                    ? { description: node.description }
                    : {}),
            };
        });
    }
    const order = new Map(def.states.map((s, i) => [s.id, i] as const));
    const terminal = new Set<string>(def.terminalStates ?? []);
    const failure = new Set<string>(def.failureStates ?? []);
    return def.states.map((state) => {
        const incoming = def.transitions.filter((t) => t.to === state.id);
        return {
            id: state.id,
            initial: state.id === def.initialState,
            terminal: terminal.has(state.id),
            failure: failure.has(state.id),
            pause: state.pause === true,
            loopBack: incoming.some((t) => (order.get(t.from) ?? -1) >= (order.get(state.id) ?? 0)),
            conditional:
                state.id !== def.initialState && incoming.length > 0 && incoming.every((t) => t.guard !== undefined),
            ...(typeof state.description === 'string' && state.description !== ''
                ? { description: state.description }
                : {}),
        };
    });
}

/**
 * Convert a zero-based declaration index to a stable spreadsheet-style display
 * label: 0→A … 25→Z, 26→AA, 27→AB, … (task 0814 R5). Display address only —
 * never a workflow execution key; canonical step ids stay the identity.
 */
export function columnLabel(index: number): string {
    let n = Math.max(0, Math.floor(index));
    let label = '';
    do {
        label = String.fromCharCode(65 + (n % 26)) + label;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
}

/** Build one stable top-level label per declared step, in declaration order (0814 R5). */
export function buildStepLabels(count: number): string[] {
    const labels: string[] = [];
    for (let i = 0; i < Math.max(0, Math.floor(count)); i++) labels.push(columnLabel(i));
    return labels;
}

/**
 * A visible child's label under a parent label: parent A → A1, A2, …; child
 * numbering restarts at 1 under each parent (0814 R5). Display address only.
 */
export function labelChild(parentLabel: string, childIndex: number): string {
    return `${parentLabel}${Math.max(0, Math.floor(childIndex)) + 1}`;
}

/**
 * Render the todo projection of a workflow definition: a markdown checklist of
 * the declared steps (the same sequence as {@link renderRunPlan} — one shared
 * builder), markers appended after ` — ` joined by ` · `. For state-machine
 * definitions the header states that the list is a declared inventory, not a
 * predicted execution path. Built from the DEFINITION, not a run result.
 */
export function renderWorkflowTodo(def: WorkflowDef): string {
    const kind = def.kind ?? 'state-machine';
    const lines = [`# ${def.name} (${kind}) — declared steps`, ''];
    if (kind === 'state-machine') {
        lines.push('Declared step inventory in declaration order, not a predicted execution path.', '');
    }
    const steps = buildWorkflowSteps(def);
    const labels = buildStepLabels(steps.length);
    steps.forEach((step, i) => {
        lines.push(formatWorkflowStepLine(step, labels[i]));
    });
    return lines.join('\n');
}

/**
 * One checklist line for a declared step: checkbox + optional display label +
 * step id + structural markers (0768 R2). The label (0814 R5) is a display
 * address (A, B, …; children A1, A2) — it is never the execution key, which
 * remains `step.id`. When no label is supplied the line renders exactly as
 * before, so existing callers/tests are unchanged.
 */
function formatWorkflowStepLine(step: WorkflowStep, label?: string): string {
    const markers = [
        step.initial ? 'initial' : undefined,
        step.terminal ? 'terminal' : undefined,
        step.failure ? 'failure' : undefined,
        step.pause ? 'pause' : undefined,
        step.loopBack ? 'loop-back' : undefined,
        step.conditional ? 'conditional' : undefined,
        step.nodeType !== undefined && step.nodeType !== 'action' ? step.nodeType : undefined,
    ].filter((m): m is string => m !== undefined);
    const head = label === undefined ? step.id : `${label}. ${step.id}`;
    return markers.length > 0 ? `- [ ] ${head} — ${markers.join(' · ')}` : `- [ ] ${head}`;
}

/**
 * Render the active step's visible children with labels that restart under the
 * parent (parent A → A1, A2, …), bounding the view to a single parent so a
 * complex plan never renders every state × every action (0814 R5 "expand only
 * the active task/stage to bound display size"). Pure: the caller supplies the
 * child rows (id + markers) it wants shown for the active parent; this only
 * applies stable display labels and keeps child numbering per-parent.
 */
export function renderWorkflowActiveDetail(
    parentLabel: string,
    children: Array<{ id: string; markers?: string[] }>,
): string {
    return children
        .map((child, i) => {
            const label = labelChild(parentLabel, i);
            const markers = (child.markers ?? []).filter((m): m is string => m !== undefined && m !== '');
            return markers.length > 0
                ? `- [ ] ${label}. ${child.id} — ${markers.join(' · ')}`
                : `- [ ] ${label}. ${child.id}`;
        })
        .join('\n');
}

/**
 * Render the pre-execution run plan (0768 R2): a declared-step checklist — NOT
 * an arrow chain, which would imply an inevitable route. Derived from the
 * shared {@link buildWorkflowSteps} builder (0695 R1/R5) with the same
 * conditional/loop markers as the todo projection, so the plan shown before a
 * run can never disagree with the todo projection about what the steps are;
 * built from the DEFINITION, not a run result — the plan answers "what does
 * this workflow declare", before any execution.
 */
export function renderRunPlan(def: WorkflowDef): string {
    const kind = def.kind ?? 'state-machine';
    const steps = buildWorkflowSteps(def);
    const labels = buildStepLabels(steps.length);
    return [
        `plan (${kind}) — declared inventory, not a predicted route:`,
        ...steps.map((step, i) => formatWorkflowStepLine(step, labels[i])),
    ].join('\n');
}

/**
 * Visible-item outcome states for the host todo/plan projection (0814 R6).
 * Kept distinct so failed/skipped/blocked/unattempted work is never rendered as
 * completed just to clear the UI.
 */
export type VisibleOutcome = 'pending' | 'active' | 'completed' | 'skipped' | 'failed' | 'blocked' | 'unattempted';

/** One visible plan item with its stable display label and observed outcome. */
export interface VisibleItem {
    /** Display address (A, B, A1, A2, …) — a presentation key, never an execution key. */
    label: string;
    /** Canonical identity (workflow step id / stage id / command) — the execution key. */
    id: string;
    outcome: VisibleOutcome;
    /** Optional human note (e.g. an attempt number, a halt reason). */
    note?: string;
}

/** Options for the Markdown progress fallback (0814 R6). */
export interface ProgressRenderOptions {
    /** Title for the rendered progress block. */
    title?: string;
    /** Concise capability note when no native todo tool is available or it failed. */
    capabilityNote?: string;
}

const OUTCOME_ANNOTATION: Record<VisibleOutcome, string | null> = {
    pending: null,
    active: 'active',
    completed: null,
    skipped: 'skipped',
    failed: 'failed',
    blocked: 'blocked',
    unattempted: 'unattempted',
};

/**
 * Render a truthful Markdown progress checklist (0814 R6 fallback). Only an
 * observed `completed` item is checked `[x]`; every other outcome stays `[ ]`
 * and is annotated with its state. This is the explicit fallback used when the
 * host exposes no native todo/plan tool or the tool fails — it never fabricates
 * a successful native invocation, and it never marks skipped/failed/blocked/
 * unattempted work as done merely to clear the UI.
 */
export function renderProgressMarkdown(items: VisibleItem[], options: ProgressRenderOptions = {}): string {
    const lines: string[] = [];
    if (options.title !== undefined && options.title !== '') lines.push(`# ${options.title}`, '');
    for (const item of items) {
        const mark = item.outcome === 'completed' ? '[x]' : '[ ]';
        const annotation = OUTCOME_ANNOTATION[item.outcome];
        const suffix = annotation === null ? '' : ` [${annotation}]`;
        const note = item.note !== undefined && item.note !== '' ? ` — ${item.note}` : '';
        lines.push(`${mark} ${item.label}. ${item.id}${suffix}${note}`);
    }
    if (options.capabilityNote !== undefined && options.capabilityNote !== '') {
        lines.push('', `> ${options.capabilityNote}`);
    }
    return lines.join('\n');
}

/** Format a millisecond duration as a compact `Ns` / `Nm Ns` string. */
function formatDuration(ms: number): string {
    const totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
}

/** 0707 R3: usage renders only what was measured — unavailable stays silent, never zero. */
function formatUsage(usage: NormalizedAgentUsage): string {
    if (usage.availability === 'unavailable') return 'usage unavailable';
    const parts: string[] = [];
    if (usage.inputTokens !== undefined) parts.push(`${usage.inputTokens} in`);
    if (usage.outputTokens !== undefined) parts.push(`${usage.outputTokens} out`);
    if (usage.costUsd !== undefined) parts.push(`$${usage.costUsd}`);
    return parts.length > 0 ? `usage ${parts.join(', ')}` : 'usage measured';
}

function formatUsageSummary(usage: WorkflowActionUsageSummary | undefined): string {
    if (usage === undefined || usage.availability === 'unavailable') return '';
    const parts: string[] = [];
    if (usage.totalTokens !== undefined) parts.push(`${usage.totalTokens} tok`);
    if (usage.costUsd !== undefined) parts.push(`$${usage.costUsd}`);
    return parts.length > 0 ? ` · usage ${parts.join(', ')}` : ' · usage measured';
}
