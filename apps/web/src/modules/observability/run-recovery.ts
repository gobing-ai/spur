import { TASK_STATUS_ACTIONS } from '../task-kanban/task-actions';

/**
 * Recovery guidance for one linked run (task 1307).
 *
 * Commands are text for the operator to copy. Nothing here calls continue, retry,
 * or any other mutating route. A placeholder `<input>` is never a prefilled answer.
 */

/** Placeholder for a required continue argument. Not an authorized answer. */
export const RECOVERY_INPUT_PLACEHOLDER = '<input>';

/** Run ids copied into a command must be one shell token. */
const RUN_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Task ids the board retry command can name. Matches the task show path. */
const WBS_TOKEN = /^\d{4}$/;

const SENSITIVE_KEYS = new Set(['body', 'content', 'message', 'prompt', 'query', 'response', 'value']);

const ANSWER_FLAG: Record<string, '--answer' | '--answer-text'> = {
    confirm: '--answer',
    'hitl.confirm': '--answer',
    select: '--answer',
    'hitl.select': '--answer',
    input: '--answer-text',
    'hitl.input': '--answer-text',
};

const STALE_OUTCOMES = new Set(['failed', 'not-started', 'outcome-unknown', 'contract-violation']);

const PROOF_WORDS = new Set(['stale', 'missing', 'invalid']);

/** How the operator may act on this run. */
export type RecoveryGuidance =
    | { kind: 'continue'; command: string; inputLabel: string }
    | { kind: 'retry'; traceCommand: string; retryCommand: string }
    | { kind: 'inspection-only'; traceCommand: string | null; reason: string };

/** Run-record inspection status, plus `unread` when the read itself failed. */
export type EvidenceStatus = 'record' | 'incomplete' | 'legacy' | 'oversized' | 'missing' | 'unread';

/** One action result the run detail already redacts server-side. */
export interface RecoveryAction {
    node: string;
    status: string;
    resultSummary: unknown;
}

/** One state visit the progress projection already exposes. */
export interface RecoveryState {
    state: string;
    status: string;
    actions: readonly { actionKey: string; status: string }[];
}

/** Inputs for {@link buildRecovery}. `taskStatus` null means the lifecycle is unknown. */
export interface RecoveryInput {
    runId: string;
    runStatus: string;
    wbs: string | null;
    taskStatus: string | null;
    resultSummary: unknown;
    recordStatus: EvidenceStatus;
    recordReason?: string;
}

/** Evidence line. `reusableAsFresh` is always false: a retained record is not a new receipt. */
export interface EvidenceNotice {
    message: string;
    provenanceUsable: boolean;
    reusableAsFresh: false;
}

/** Guidance, evidence, and proof for one selected run. */
export interface RecoveryView {
    guidance: RecoveryGuidance;
    evidence: EvidenceNotice;
    proof: { kind: 'invalid' | 'retained'; message: string } | null;
    /** True when a work item names a different run and was refused. */
    rejected: boolean;
}

/** The state and action that explain the run, plus the matching redacted result. */
export interface CauseView {
    state: string;
    actionKey: string | null;
    actionStatus: string | null;
    resultSummary: unknown;
}

/** One linked run row, same fields as a Trace list entry. */
export interface LinkedRunEntry {
    id: string;
    workflowName: string | null;
    status: string;
    mode: string | null;
    agent: string | null;
    startedAt: string;
    completedAt: string | null;
}

/**
 * True when the task board already offers `run` for this status.
 * Unknown and unrecognized statuses are not eligible.
 */
export function taskRetryPermitted(status: string | null): boolean {
    if (status === null) return false;
    return (TASK_STATUS_ACTIONS[status] ?? []).includes('run');
}

/**
 * Blank sensitive keys and bound long strings before the result is painted.
 * The server already redacts; this is the display guard.
 */
export function redactForDisplay(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => redactForDisplay(item));
    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            out[key] = SENSITIVE_KEYS.has(key) ? '[redacted]' : redactForDisplay(child);
        }
        return out;
    }
    if (typeof value === 'string' && value.length > 256) return `${value.slice(0, 256)}…`;
    return value;
}

/**
 * Parse `GET /api/runs/by-wbs/:wbs`. A null or mismatched run is rejected and
 * must not be opened. A body that is not a link list returns null.
 */
export function parseLinkedRuns(body: unknown): { runs: LinkedRunEntry[]; rejectedIds: string[] } | null {
    if (body === null || typeof body !== 'object') return null;
    const links = (body as { links?: unknown }).links;
    if (!Array.isArray(links)) return null;
    const runs: LinkedRunEntry[] = [];
    const rejectedIds: string[] = [];
    for (const link of links) {
        if (link === null || typeof link !== 'object') continue;
        const row = link as { runId?: unknown; run?: unknown };
        if (typeof row.runId !== 'string' || row.runId === '') continue;
        if (row.run === null) {
            rejectedIds.push(row.runId);
            continue;
        }
        const parsed = parseLinkedEntry(row.run);
        if (parsed === null || parsed.id !== row.runId) {
            rejectedIds.push(row.runId);
            continue;
        }
        runs.push(parsed);
    }
    return { runs, rejectedIds };
}

/**
 * Pick the failed state, otherwise the current state, and the detail result
 * recorded for that state.
 */
export function selectCause(
    projection: { currentState: string | null; states: readonly RecoveryState[] },
    actions: readonly RecoveryAction[],
): CauseView | null {
    const failed = projection.states.find((state) => state.status === 'failed');
    const current =
        projection.currentState === null
            ? undefined
            : projection.states.find((state) => state.state === projection.currentState);
    const chosen = failed ?? current ?? projection.states[0];
    if (chosen === undefined) return null;
    const failedAction = chosen.actions.find((action) => action.status === 'failed');
    const action = failedAction ?? chosen.actions[0];
    const detail =
        actions.find((row) => row.node === chosen.state && row.status === 'failed' && row.resultSummary != null) ??
        actions.find((row) => row.node === chosen.state && row.resultSummary != null) ??
        actions.find((row) => row.node === chosen.state);
    return {
        state: chosen.state,
        actionKey: action?.actionKey ?? null,
        actionStatus: action?.status ?? detail?.status ?? null,
        resultSummary: detail?.resultSummary ?? null,
    };
}

/**
 * Decide the recovery text for one run. Failed runs gain a retry command only
 * when the task lifecycle already offers `run`. Paused runs gain `workflow continue`
 * only from a matching work item or an operator gate. Every other case is inspection.
 */
export function buildRecovery(input: RecoveryInput): RecoveryView {
    const evidence = evidenceNotice(input.recordStatus, input.recordReason);
    const proof = proofNotice(input.resultSummary);
    if (!RUN_TOKEN.test(input.runId)) {
        return {
            guidance: {
                kind: 'inspection-only',
                traceCommand: null,
                reason: 'Run id cannot be copied into a command. Inspection only.',
            },
            evidence,
            proof,
            rejected: false,
        };
    }
    const status = input.runStatus.toLowerCase();
    const traceCommand = `spur workflow trace ${input.runId}`;
    if (status === 'paused') {
        return { guidance: pausedGuidance(input, traceCommand), evidence, proof, rejected: workItemRejected(input) };
    }
    if (status === 'failed') {
        return { guidance: failedGuidance(input, traceCommand), evidence, proof, rejected: false };
    }
    return {
        guidance: {
            kind: 'inspection-only',
            traceCommand,
            reason: 'This run is not a failed or paused run with a recovery command. Inspection only.',
        },
        evidence,
        proof,
        rejected: false,
    };
}

/**
 * Existing task retry command.
 * Same text as `TASK_ACTION_COMMANDS.run` in `packages/app/src/services/task-service.ts`.
 * The web bundle does not import the app package (ADR-021).
 */
export function taskRetryCommand(wbs: string): string | null {
    if (!WBS_TOKEN.test(wbs)) return null;
    return `/sp:dev-run ${wbs} --auto`;
}

function pausedGuidance(input: RecoveryInput, traceCommand: string): RecoveryGuidance {
    if (workItemRejected(input)) {
        return {
            kind: 'inspection-only',
            traceCommand,
            reason: 'Work item belongs to a different run and was rejected. Inspection only.',
        };
    }
    const workItem = matchingWorkItem(input);
    if (workItem !== null) {
        return {
            kind: 'continue',
            command: continueCommand(input.runId, '--answer-text'),
            inputLabel: 'Input: receipt path for the paused work item.',
        };
    }
    const flag = operatorFlag(input.resultSummary);
    if (flag === '--answer') {
        return {
            kind: 'continue',
            command: continueCommand(input.runId, '--answer'),
            inputLabel: 'Input: yes, no, or cancel. This label is not an answer.',
        };
    }
    if (flag === '--answer-text') {
        return {
            kind: 'continue',
            command: continueCommand(input.runId, '--answer-text'),
            inputLabel: 'Input: free text for the operator gate.',
        };
    }
    return {
        kind: 'inspection-only',
        traceCommand,
        reason: 'Paused run has no valid work item or operator-gate metadata. Inspection only.',
    };
}

function failedGuidance(input: RecoveryInput, traceCommand: string): RecoveryGuidance {
    if (input.taskStatus === null) {
        return {
            kind: 'inspection-only',
            traceCommand,
            reason: 'Task lifecycle is unknown. Inspection only.',
        };
    }
    if (!taskRetryPermitted(input.taskStatus) || input.wbs === null) {
        return {
            kind: 'inspection-only',
            traceCommand,
            reason: 'Task lifecycle does not permit retry. Inspection only.',
        };
    }
    const retryCommand = taskRetryCommand(input.wbs);
    if (retryCommand === null) {
        return {
            kind: 'inspection-only',
            traceCommand,
            reason: 'Task lifecycle does not permit retry. Inspection only.',
        };
    }
    return { kind: 'retry', traceCommand, retryCommand };
}

function continueCommand(runId: string, flag: '--answer' | '--answer-text'): string {
    return `spur workflow continue ${runId} ${flag} ${RECOVERY_INPUT_PLACEHOLDER}`;
}

function workItemRejected(input: RecoveryInput): boolean {
    return collectWorkItems(input.resultSummary).some((item) => item.runId !== input.runId);
}

function matchingWorkItem(input: RecoveryInput): { runId: string; state: string } | null {
    return (
        collectWorkItems(input.resultSummary).find((item) => item.runId === input.runId && item.state !== '') ?? null
    );
}

function operatorFlag(value: unknown): '--answer' | '--answer-text' | null {
    for (const kind of collectGates(value)) {
        const flag = ANSWER_FLAG[kind];
        if (flag !== undefined) return flag;
    }
    return null;
}

function collectWorkItems(value: unknown): { runId: string; state: string }[] {
    const out: { runId: string; state: string }[] = [];
    walk(value, (record) => {
        const item = record.workItem;
        if (item === null || typeof item !== 'object' || Array.isArray(item)) return;
        const candidate = item as Record<string, unknown>;
        if (typeof candidate.runId === 'string' && typeof candidate.state === 'string') {
            out.push({ runId: candidate.runId, state: candidate.state });
        }
    });
    return out;
}

function collectGates(value: unknown): string[] {
    const out: string[] = [];
    walk(value, (record) => {
        if (record.reason === 'hitl-pause' && typeof record.kind === 'string') out.push(record.kind);
    });
    return out;
}

function proofNotice(value: unknown): RecoveryView['proof'] {
    let invalid = false;
    let retained = false;
    walk(value, (record) => {
        if (typeof record.proof === 'string' && PROOF_WORDS.has(record.proof)) invalid = true;
        if (typeof record.outcome !== 'string') return;
        if (STALE_OUTCOMES.has(record.outcome)) invalid = true;
        else if (record.outcome === 'done') retained = true;
    });
    if (invalid) return { kind: 'invalid', message: 'Invalid proof cannot be reused as fresh evidence.' };
    if (retained)
        return { kind: 'retained', message: 'A retained receipt is not fresh evidence and cannot be reused.' };
    return null;
}

function evidenceNotice(status: EvidenceStatus, reason: string | undefined): EvidenceNotice {
    const reusableAsFresh = false as const;
    switch (status) {
        case 'record':
            return {
                provenanceUsable: true,
                reusableAsFresh,
                message:
                    'Retained run record is usable provenance. It is not a fresh receipt and cannot be reused as evidence for a new attempt.',
            };
        case 'incomplete':
            return {
                provenanceUsable: true,
                reusableAsFresh,
                message:
                    `Scratch record is incomplete (${reason ?? 'unspecified'}) and cannot be reused as fresh evidence. ` +
                    'Retained run progress remains usable provenance.',
            };
        case 'legacy':
            return {
                provenanceUsable: true,
                reusableAsFresh,
                message:
                    'Legacy scratch record cannot be reused as fresh evidence. Retained run progress remains usable provenance.',
            };
        case 'oversized':
            return {
                provenanceUsable: true,
                reusableAsFresh,
                message:
                    'Run record is oversized and cannot be reused as fresh evidence. Retained run progress remains usable provenance.',
            };
        case 'missing':
            return {
                provenanceUsable: true,
                reusableAsFresh,
                message:
                    'Disposable scratch is expired or missing and cannot be reused as fresh evidence. Retained run progress remains usable provenance.',
            };
        case 'unread':
            return {
                provenanceUsable: true,
                reusableAsFresh,
                message:
                    'Run record could not be read and cannot be reused as fresh evidence. Retained run progress remains usable provenance.',
            };
    }
}

function walk(value: unknown, visit: (record: Record<string, unknown>) => void): void {
    if (Array.isArray(value)) {
        for (const item of value) walk(item, visit);
        return;
    }
    if (value === null || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    visit(record);
    for (const child of Object.values(record)) walk(child, visit);
}

function parseLinkedEntry(value: unknown): LinkedRunEntry | null {
    if (value === null || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    if (
        typeof row.id !== 'string' ||
        !isOptStr(row.workflowName) ||
        typeof row.status !== 'string' ||
        !isOptStr(row.mode) ||
        !isOptStr(row.agent) ||
        typeof row.startedAt !== 'string' ||
        !isOptStr(row.completedAt)
    ) {
        return null;
    }
    return {
        id: row.id,
        workflowName: row.workflowName,
        status: row.status,
        mode: row.mode,
        agent: row.agent,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
    };
}

function isOptStr(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}
