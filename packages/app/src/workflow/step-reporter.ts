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
import type { WorkflowActionFinishedEvent, WorkflowActionStartedEvent, WorkflowPhaseEvent } from './observability';

/** The subset of observability events the CLI reporter renders as progress lines. */
export type StepEvent = WorkflowActionStartedEvent | WorkflowActionFinishedEvent | WorkflowPhaseEvent;

/** A reporter maps one event to a display line, or `null` to emit nothing. */
export type StepLineRenderer = (event: StepEvent) => string | null;

const isActionStarted = (e: StepEvent): e is WorkflowActionStartedEvent => 'kind' in e && 'node' in e;
const isActionFinished = (e: StepEvent): e is WorkflowActionFinishedEvent => 'durationMs' in e && 'ok' in e;
const isPhase = (e: StepEvent): e is WorkflowPhaseEvent => 'phase' in e;

/**
 * Render a single progress line for a workflow observability event, or `null`
 * when the event has no operator-facing line. Action-started lines mark the
 * blind-spot entry; action-finished lines close it with outcome + duration.
 */
export function renderStepLine(event: StepEvent): string | null {
    if (isActionFinished(event)) {
        const mark = event.ok ? '✓' : '✗';
        return `  ${mark} ${event.status} (${formatDuration(event.durationMs)})`;
    }
    if (isActionStarted(event)) {
        return `  → ${event.node}: ${event.kind}…`;
    }
    if (isPhase(event)) {
        return `▶ ${event.phase} [${event.status}]`;
    }
    return null;
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
