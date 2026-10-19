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
 * One run's current causal action failure: the action that most recently failed without a
 * later success, plus its bounded error text. The tracker stores identifiers and the action's
 * own error string only — never options, config or env values.
 */
export interface CausalActionFailure {
    /** Action kind of the failing step (`agent.run`, `shell`, …). */
    kind: string;
    /** The action's own bounded error text, when the result carried one. */
    errorText?: string;
}

/** Bounded run retention: a long-lived process hosts many runs; only live ones need context. */
const CAUSAL_CONTEXT_MAX_RUNS = 64;

/** Diagnostic keys an action result uses for its failure text, in precedence order. */
const CAUSAL_ERROR_KEYS = ['error', 'message', 'reason'] as const;

/** The bounded error text of a failed action result, or `undefined` when it carries none. */
function causalErrorText(result: unknown): string | undefined {
    if (result === null || typeof result !== 'object') return undefined;
    const record = result as Record<string, unknown>;
    for (const key of CAUSAL_ERROR_KEYS) {
        const value = record[key];
        if (typeof value === 'string' && value.trim() !== '') return value;
    }
    return undefined;
}

/**
 * Run-scoped causal action context for terminal-reason classification (task 1256 R1/R2).
 *
 * The persistence decorators already see every action boundary, but only the run-row closure
 * carried a reason — so an immediate `agent.run` failure reached {@link classifyTerminalReason}
 * without the action kind that identifies it, and fell through to `failed-check`. A tracker
 * remembers the run's **current** failure at the action boundary and forgets it the moment the run
 * makes progress (any successful action finalize) or closes. A previously recovered failure can
 * therefore never relabel a later, unrelated close.
 *
 * Each decorator owns its own tracker instance: they classify the same run's closure independently,
 * so one consuming the context must not blind the other.
 */
export interface CausalActionTracker {
    /**
     * Record one action's outcome for its run. A successful finalize clears the run's context
     * (recovery/progression); a failed one replaces it with this action's own identity.
     */
    noteActionFinalize(runId: string, kind: string, ok: boolean, result?: unknown): void;
    /** The run's current causal failure, removed at the run's own terminal close. */
    consume(runId: string): CausalActionFailure | undefined;
}

/**
 * Create one run-scoped causal action tracker. Bounded to {@link CAUSAL_CONTEXT_MAX_RUNS} live runs —
 * a long-lived process hosts many, and only live ones need context.
 */
export function createCausalActionContext(): CausalActionTracker {
    const current = new Map<string, CausalActionFailure>();
    return {
        noteActionFinalize(runId: string, kind: string, ok: boolean, result?: unknown): void {
            if (runId === '') return;
            if (ok) {
                current.delete(runId);
                return;
            }
            if (!current.has(runId) && current.size >= CAUSAL_CONTEXT_MAX_RUNS) {
                const oldest = current.keys().next().value;
                if (oldest !== undefined) current.delete(oldest);
            }
            const errorText = causalErrorText(result);
            current.set(runId, { kind, ...(errorText !== undefined ? { errorText } : {}) });
        },
        consume(runId: string): CausalActionFailure | undefined {
            const found = current.get(runId);
            current.delete(runId);
            return found;
        },
    };
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
    // G71 R2 (ADR-126 A4): a fleet wait that stopped without a definite receipt is
    // outcome-unknown — the member may still be working, so the run closes `interrupted`
    // (resumable) rather than a `failed-*` reason. Checked BEFORE the /timeout/i rule,
    // which would otherwise claim any error text that happened to mention a timeout.
    if (errorText !== undefined && errorText !== null && /outcome[-_ ]?unknown/i.test(errorText)) return 'interrupted';
    if (errorText !== undefined && errorText !== null && /timeout/i.test(errorText)) return 'failed-timeout';
    if (actionKind === 'agent.run') return 'failed-agent';
    return 'failed-check';
}
