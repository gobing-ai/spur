import type { DbAdapter } from '@gobing-ai/spur-domain';
import {
    classifyTaskAttribution,
    emptyAttributionSummary,
    loadAttributionEvidence,
    type TaskAttributionSummary,
    TaskSessionDao,
} from '@gobing-ai/spur-domain';

export type { TaskAttributionSummary } from '@gobing-ai/spur-domain';

/** Input for one attribution pass over a source's sessions (task 0722 R3/R4). */
export interface AttributeSessionsInput {
    db: DbAdapter;
    source: string;
    /** Session ids to evaluate (from `listAttributionSessions`). */
    sessionIds: readonly string[];
    /** Task-corpus validation: every candidate must resolve through the task locator (R3). */
    isKnownWbs: (wbs: string) => Promise<boolean>;
    resolvedAt: string;
    /** Preview without writes (R4): counts what would be created/present, persists nothing. */
    dryRun?: boolean;
    /**
     * Full-mode reconcile (R4): delete this source's existing links before
     * re-deriving, so the table is a converged projection of current evidence
     * instead of an append-only log that preserves stale rows across re-imports.
     * Never combined with dryRun — a preview never writes or deletes.
     */
    reconcile?: boolean;
}

/**
 * Run the operational-evidence classifier over each session's prefiltered
 * evidence and persist (or preview) locator-validated links. The classifier is
 * pure; this composition owns the side effects — DAO writes, locator validation,
 * and the bounded summary counters (R6). Idempotency comes from the
 * `history_task_session` primary key, so a second identical pass reports
 * `linksAlreadyPresent` and writes nothing new.
 */
export async function attributeSessions(input: AttributeSessionsInput): Promise<TaskAttributionSummary> {
    const dao = new TaskSessionDao(input.db);
    const summary = emptyAttributionSummary();
    const known = new Map<string, boolean>();
    if (input.reconcile === true && input.dryRun !== true) {
        await dao.deleteBySource(input.source);
    }
    for (const sessionId of input.sessionIds) {
        summary.sessionsEvaluated += 1;
        const evidence = await loadAttributionEvidence(input.db, input.source, sessionId);
        if (evidence.length === 0) continue;
        const decision = classifyTaskAttribution(evidence);
        summary.skippedEvidence += decision.skipped;
        summary.ambiguousEvidence += decision.ambiguous;
        for (const candidate of decision.candidates) {
            let valid = known.get(candidate.wbs);
            if (valid === undefined) {
                valid = await input.isKnownWbs(candidate.wbs);
                known.set(candidate.wbs, valid);
            }
            // R3: an unresolvable candidate is skipped evidence, never a link.
            if (!valid) {
                summary.skippedEvidence += 1;
                continue;
            }
            if (input.dryRun === true) {
                const present = await dao.hasLink(candidate.wbs, input.source, sessionId);
                if (present) summary.linksAlreadyPresent += 1;
                else summary.linksCreated += 1;
                continue;
            }
            const outcome = await dao.insert({
                wbs: candidate.wbs,
                source: input.source,
                sessionId,
                exactness: 'estimated',
                mechanism: candidate.mechanism,
                evidenceKind: candidate.evidenceKind,
                evidenceRef: candidate.evidenceRef,
                resolvedAt: input.resolvedAt,
            });
            if (outcome === 'created') summary.linksCreated += 1;
            else summary.linksAlreadyPresent += 1;
        }
    }
    return summary;
}
