import type { WorkflowStatus } from '@gobing-ai/ts-dual-workflow-engine';

/**
 * The closed terminal-reason vocabulary every workflow run row ends with (0937 R1).
 * Spur owns the enum; the engine reason is an opaque string.
 */
export const TERMINAL_REASONS = [
    'done',
    'paused-operator',
    'failed-check',
    'failed-agent',
    'failed-timeout',
    'failed-guard',
    'cancelled',
    'interrupted',
    'retry-exhausted',
] as const;

/** A closed terminal-reason enum value — the element type of {@link TERMINAL_REASONS}. */
export type TerminalReason = (typeof TERMINAL_REASONS)[number];

/** True when value is a member of {@link TERMINAL_REASONS} — the guard behind declared-reason passthrough. */
export function isTerminalReason(value: string): value is TerminalReason {
    return (TERMINAL_REASONS as readonly string[]).includes(value);
}

/**
 * Bookkeeping workflows are excluded from cost reports by default (0937 R5; the 0938
 * consumer). Classified at report time from the workflow name — no second schema column.
 */
export const BOOKKEEPING_WORKFLOWS = ['task-lifecycle', 'feature-lifecycle'] as const;

/** True when the workflow is one of {@link BOOKKEEPING_WORKFLOWS} — the bookkeeping-row check for 0938 reports. */
export function isBookkeepingWorkflow(workflowName: string): boolean {
    return (BOOKKEEPING_WORKFLOWS as readonly string[]).includes(workflowName);
}

/** Inputs to {@link classifyTerminalReason} — the run status plus whatever context the caller holds. */
export interface TerminalReasonInput {
    status: WorkflowStatus;
    /** The engine's opaque reason (`terminal:<stateId>`, `no-passing-transition`, …) or a declared enum value. */
    engineReason?: string | null;
    /** Action kind of the failing step, when the caller has it (R4: agent.run failures → failed-agent). */
    actionKind?: string | null;
    /** Error text, when the caller has it (R4: timeout errors → failed-timeout). */
    errorText?: string | null;
}

/**
 * Map a terminal close to exactly one enum reason (0937 R4). A declared reason that is
 * already an enum value passes through unchanged — declared YAML `terminalReason` and
 * pre-classified callers win. Engine guard/bound reasons map deterministically; statuses
 * classify the rest. Legacy nulls are NOT guessed here (R6): reports read the column.
 */
export function classifyTerminalReason({
    status,
    engineReason,
    actionKind,
    errorText,
}: TerminalReasonInput): TerminalReason {
    if (engineReason !== undefined && engineReason !== null && isTerminalReason(engineReason)) return engineReason;
    if (status === 'interrupted') return 'interrupted';
    if (status === 'paused') return 'paused-operator';
    if (status === 'done') return 'done';
    if (engineReason === 'no-passing-transition' || engineReason === 'no-passing-edge') return 'failed-guard';
    if (engineReason === 'iteration-bound-exceeded') return 'retry-exhausted';
    if (errorText !== undefined && errorText !== null && /timeout/i.test(errorText)) return 'failed-timeout';
    if (actionKind === 'agent.run') return 'failed-agent';
    return 'failed-check';
}
