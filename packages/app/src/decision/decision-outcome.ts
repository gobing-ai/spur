/**
 * Decision outcome recording (task 1263 R2/R3).
 *
 * Acceptance is not accuracy: `decision.end` says what was answered, never whether the answer
 * was right. This module publishes `decision.outcome` for a served invocation, so the reliability
 * report can score a decision maker against what actually happened (R4).
 *
 * Two rules shape it. The `decision.end` row must exist — an outcome for an unknown invocation is
 * a caller mistake, refused before any write. And the first write wins: an outcome is recorded
 * once per invocation, because a later observation describes the same decision again and would
 * double-count the sample.
 *
 * Reads go through `SystemEventDao`; the write goes through the same event bus the decision events
 * use, so one producer's rows keep one envelope shape, one `run_id` correlation and one redaction
 * path.
 */
import type { SystemEventDao } from '@gobing-ai/spur-domain';
import { SYSTEM_EVENT_CATALOG } from '../services/event-names';
import type { ReviewFindingsOptions } from '../services/residual-scan';
import { parseReviewFindings } from '../services/residual-scan';
import { buildSystemEventEnvelope, systemEventProjectContext } from '../services/system-event-envelope';

/** Outcome vocabulary that may be recorded — lowercase slug, bounded. */
export const DECISION_OUTCOME_PATTERN = /^[a-z0-9-]{1,32}$/;

/** Outcome recorded for an unknown invocation id (the verb exits 1). */
export class UnknownDecisionInvocationError extends Error {
    constructor(readonly invocationId: string) {
        super(`no decision.end row carries invocation id "${invocationId}"`);
        this.name = 'UnknownDecisionInvocationError';
    }
}

/** Result of one record attempt — `recorded: false` means a previous outcome already stands. */
export interface DecisionOutcomeResult {
    readonly invocationId: string;
    readonly decisionId: string;
    /** The outcome now recorded for this invocation (the first one, on a refused duplicate). */
    readonly outcome: string;
    readonly recorded: boolean;
}

/**
 * Dependencies: the ledger it reads and writes, plus the two envelope inputs the tap uses so a
 * hand-written row is byte-compatible with one the tap persists.
 *
 * The write goes through the DAO rather than the bus on purpose: an outcome must be stored or
 * refused, and a detached tap persists asynchronously (a failed attach is swallowed), so a
 * bus-only write could report `recorded: true` for a row nobody kept.
 */
export interface RecordDecisionOutcomeDeps {
    readonly dao: SystemEventDao;
    /** Values redacted out of the payload (configured secrets). */
    readonly secretValues?: readonly string[];
    /** Project identity stamped into the envelope context. */
    readonly projectRoot?: string;
    /** Clock seam for tests; defaults to `Date.now`. */
    readonly now?: () => number;
}

/** Record one outcome for a served invocation; first write wins. */
export async function recordDecisionOutcome(
    deps: RecordDecisionOutcomeDeps,
    input: { invocationId: string; outcome: string; source?: string },
): Promise<DecisionOutcomeResult> {
    const end = await deps.dao.decisionEndByInvocation(input.invocationId);
    if (end === undefined) throw new UnknownDecisionInvocationError(input.invocationId);
    const existing = await deps.dao.decisionOutcomeByInvocation(input.invocationId);
    if (existing !== undefined) {
        return { invocationId: input.invocationId, decisionId: end.decisionId, outcome: existing, recorded: false };
    }
    // The outcome row is copied onto the decision's run, so the Board shows it beside the events
    // it explains rather than as an uncorrelated row.
    const entry = SYSTEM_EVENT_CATALOG.find((candidate) => candidate.name === 'decision.outcome');
    const envelope = buildSystemEventEnvelope(
        entry,
        {
            invocationId: input.invocationId,
            decisionId: end.decisionId,
            outcome: input.outcome,
            ...(input.source !== undefined ? { source: input.source } : {}),
            ...(end.source !== null ? { decisionSource: end.source } : {}),
            severity: 'info',
            ...(end.runId !== null ? { correlation: { runId: end.runId } } : {}),
        },
        systemEventProjectContext(deps.projectRoot ?? ''),
        deps.secretValues ?? [],
        null,
    );
    await deps.dao.insert({
        id: `dec_${crypto.randomUUID()}`,
        event_name: 'decision.outcome',
        occurred_at: new Date(deps.now?.() ?? Date.now()).toISOString(),
        payload_json: JSON.stringify(envelope),
        run_id: end.runId,
    });
    return { invocationId: input.invocationId, decisionId: end.decisionId, outcome: input.outcome, recorded: true };
}

/** Ordering the severity vocabulary maps to; `none` sits below P4. */
const SEVERITY_ORDER = ['p1', 'p2', 'p3', 'p4'] as const;

/**
 * The review-severity outcome for a task's Review table (task 1263 R3b): its worst finding
 * severity as `p1`–`p4`, or `none` when the table records no finding.
 *
 * Resolved rows count on purpose (Q&A): a P2 the remediation later fixed was still in the diff,
 * and the question this outcome answers is "was the change risky?", not "is it still broken?".
 * `parseReviewFindings` keeps its own default (resolved rows dropped) — the option is explicit.
 */
export function reviewSeverityOutcome(taskContent: string): string {
    const options: ReviewFindingsOptions = { includeResolved: true };
    const rows = parseReviewFindings(taskContent, options);
    // `parseReviewFindings` only admits P1-P4 rows, so a parsed row always matches one of these.
    for (const severity of SEVERITY_ORDER) {
        const prefix = severity.toUpperCase();
        if (rows.some((row) => row.priority.trim().toUpperCase().startsWith(prefix))) return severity;
    }
    return 'none';
}
