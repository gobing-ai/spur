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
import type {
    WorkflowActionFinishedEvent,
    WorkflowActionStartedEvent,
    WorkflowPhaseEvent,
    WorkflowTransitionEvent,
} from './observability';

/** The subset of observability events the CLI reporter renders as progress lines. */
export type StepEvent =
    | AgentExecutionEvent
    | WorkflowActionStartedEvent
    | WorkflowActionFinishedEvent
    | WorkflowPhaseEvent
    | WorkflowTransitionEvent;
/** Human workflow progress content depth, independent from JSON machine mode. */
export type WorkflowOutputDetail = 'minimal' | 'invocation' | 'full';
/** Options accepted by pure workflow progress renderers. */
export interface StepRenderOptions {
    detail?: WorkflowOutputDetail;
}

/** A reporter maps one event to a display line, or `null` to emit nothing. */
export type StepLineRenderer = (event: StepEvent) => string | null;

const isAgentExecution = (e: StepEvent): e is AgentExecutionEvent => 'executionId' in e;
const isActionStarted = (e: StepEvent): e is WorkflowActionStartedEvent => 'kind' in e && 'node' in e;
const isActionFinished = (e: StepEvent): e is WorkflowActionFinishedEvent => 'durationMs' in e && 'ok' in e;
const isPhase = (e: StepEvent): e is WorkflowPhaseEvent => 'phase' in e;
const isTransition = (e: StepEvent): e is WorkflowTransitionEvent => 'from' in e && 'to' in e;

/**
 * Render a single progress line for a workflow observability event, or `null`
 * when the event has no operator-facing line. Action-started lines mark the
 * blind-spot entry; action-finished lines close it with outcome + duration.
 */
export function renderStepLine(event: StepEvent, options: StepRenderOptions = {}): string | null {
    const detail = options.detail ?? 'invocation';
    if (isAgentExecution(event)) {
        if (event.kind === 'output') {
            if (detail === 'minimal') return null;
            const label = event.stream === 'stderr' ? 'stderr' : 'stdout';
            return `[run ${event.runId}]   ${label}> ${event.chunk.replace(/\s+$/, '')}`;
        }
        if (event.kind === 'heartbeat') {
            if (detail === 'minimal') return null;
            const budget =
                event.timeoutMs === undefined
                    ? 'unbounded'
                    : `${formatDuration(Math.max(0, event.timeoutMs - event.elapsedMs))} remaining`;
            return `[run ${event.runId}] … agent execution · elapsed=${formatDuration(event.elapsedMs)} · budget=${budget}`;
        }
        if (event.kind === 'dropped') {
            return detail === 'minimal'
                ? null
                : `[run ${event.runId}] … output pressure · dropped=${event.chunks} chunks`;
        }
        if (event.kind === 'started') {
            if (detail === 'minimal') return null;
            const model = event.model === undefined ? '' : `(${event.model})`;
            const full = detail === 'full' ? ` · execution=${event.executionId}` : '';
            return `[run ${event.runId}]   agent=${event.agent}${model} => ${event.invocation}${full}`;
        }
        const mark = event.outcome === 'done' ? '✓' : '✗';
        const full = detail === 'full' ? ` · execution=${event.executionId}` : '';
        return detail === 'minimal'
            ? null
            : `[run ${event.runId}] ${mark} agent ${event.outcome} (${formatDuration(event.durationMs)}) · usage ${event.usage}${event.reason ? ` · ${event.reason}` : ''}${full}`;
    }
    if (isActionFinished(event)) {
        const mark = event.ok ? '✓' : '✗';
        if (detail === 'minimal') return `  ${mark} ${event.status} (${formatDuration(event.durationMs)})`;
        const failure = event.result?.error === undefined ? '' : ` · ${event.result.error}`;
        const full = detail === 'full' ? ` · action=${event.actionId} · seq=${event.sequence}` : '';
        return `[run ${event.runId}] ${mark} ${event.node}/${event.kind} (${formatDuration(event.durationMs)}) · usage ${event.result?.usage ?? 'unavailable'}${failure}${full}`;
    }
    if (isActionStarted(event)) {
        if (detail === 'minimal') return `  → ${event.node}: ${event.kind}…`;
        const agent = event.metadata?.agent ?? 'unavailable';
        const model = event.metadata?.model ?? 'unavailable';
        const invocation = event.metadata?.invocation ?? 'unavailable';
        const timeout =
            event.metadata?.timeoutMs === undefined ? 'unbounded' : formatDuration(event.metadata.timeoutMs);
        const full = detail === 'full' ? ` · action=${event.actionId} · seq=${event.sequence}` : '';
        return `[run ${event.runId}] → ${event.node}/${event.kind} · agent=${agent} · model=${model} => ${invocation} · timeout=${timeout}${full}`;
    }
    if (isPhase(event)) {
        return detail === 'minimal'
            ? `▶ ${event.phase} [${event.status}]`
            : `[run ${event.runId}] ▶ ${event.phase} [${event.status}]`;
    }
    if (isTransition(event)) {
        if (detail !== 'full') return null;
        return `[run ${event.runId}] ↪ ${event.from} → ${event.to}${event.trigger ? ` [${event.trigger}]` : ''} · seq=${event.sequence}`;
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
    return `[run ${event.runId}] … ${event.node}/${event.kind} · elapsed=${elapsed} · budget=${budget}${full}`;
}

/**
 * Render a one-line run plan from a parsed workflow definition: the states (or
 * nodes, for transition-flow) the run will attempt, in declared order. Built
 * from the DEFINITION, not a run result — the preview answers "what does this
 * workflow define", before any execution.
 */
export function renderRunPlan(def: WorkflowDef): string {
    const steps = def.kind === 'transition-flow' ? def.nodes.map((n) => n.id) : def.states.map((s) => s.id);
    return `plan: ${steps.join(' → ')}`;
}

/** Format a millisecond duration as a compact `Ns` / `Nm Ns` string. */
function formatDuration(ms: number): string {
    const totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
}
