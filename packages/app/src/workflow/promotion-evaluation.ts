import { openExistingDb, readAgentRunHistoryRows } from '@gobing-ai/spur-domain';

/**
 * Workflow-candidate evaluation (A93 1356 R1/R2), moved out of
 * `scripts/commands/workflow-promotion.ts` so the measurement and the ADR-076 verdict have one app
 * owner instead of a repository-script implementation.
 *
 * What stayed in the repository: the candidate catalogue (load/save/validate), the deadline and
 * parallel-definition policy, the retirement ledger, the check/evaluate/resolve grammar and its
 * output. What moved: reading recorded `agent.run` history, summarizing it, and turning that into a
 * verdict — pure functions over domain-owned query rows, with no repository-path defaults.
 *
 * Semantics preserved exactly:
 *  - zero recorded real runs can never promote (the gate refuses unmeasured evidence);
 *  - a candidate is promoted only when it projects strictly FEWER `agent.run` actions than the
 *    incumbent, and `delta.baselineAgentRunCount` pins that incumbent when present;
 *  - duration folds only runs that recorded an `agent.run` action, so an unmeasured duration stays
 *    `null`, never 0;
 *  - the verdict's `evaluatedAt` is the caller's clock, not read here.
 */

/** The candidate's projected graph change, as a resolved-facts delta. */
export interface WorkflowCandidateDelta {
    /** The candidate's projected number of `agent.run` actions per run. */
    agentRunCount: number;
    /**
     * The incumbent's declared `agent.run` count at registration (0921). The ADR-076 bar compares
     * the projection against this baseline, so a candidate whose canonical change has already
     * landed (live count == projection) still evaluates against what it replaces. Absent, the
     * live canonical count stays the comparator (pre-0921 records).
     */
    baselineAgentRunCount?: number;
    note?: string;
}

/** Recorded real-run inputs the shadow-run replays. */
export interface WorkflowCandidateMeasurement {
    /** Workflow whose recorded runs are the replay inputs. */
    workflow: string;
    /** Optional recorded run ids to replay; absent = every terminal non-dry run. */
    runIds?: string[];
}

/** A summarized measured quantity (median etc.) over a run population. */
export interface AgentRunStat {
    /** Number of runs the statistic folds. */
    runs: number;
    mean: number | null;
    median: number | null;
    min: number | null;
    max: number | null;
}

/** The shadow-run verdict: cites `agent.run` count and duration measured from run history. */
/** The shadow-run verdict: cites `agent.run` count and duration measured from run history. */
export interface WorkflowCandidateVerdict {
    decision: 'promote' | 'delete';
    evaluatedAt: string;
    /** Measured per-run `agent.run` action count (from `action_runs`). */
    agentRunCount: AgentRunStat;
    /** Measured per-run summed `agent.run` duration in ms (from `action_runs`). */
    agentRunDurationMs: AgentRunStat;
    /** The candidate's projected `agent.run` count (the comparison surface). */
    candidateAgentRunCount: number;
    /** The canonical definition's declared `agent.run` action count (the ADR-076 bar). */
    canonicalAgentRunCount: number;
    reason: string;
}

/** Per-run `agent.run` action count and summed duration over terminal non-dry runs. */
interface AgentRunPerRun {
    runId: string;
    count: number;
    durationMs: number | null;
}

/**
 * Read the recorded real-run inputs for a workflow: per terminal non-dry run, the number of
 * `agent.run` actions and their summed `duration_ms`. A run with no `agent.run` rows counts as zero
 * actions with an unmeasured duration (null, never 0 — the 0284 invariant). `runIds` narrows the
 * replay to specific recorded runs. The adapter is opened here because the caller supplies the
 * database path; the rows come from the domain query owner.
 */
/** One registered candidate. The catalogue's load/save/validate policy stays in the repository. */
export interface WorkflowCandidate {
    id: string;
    /** Canonical workflow name (basename without `.yaml`). */
    canonical: string;
    /** Named at creation — the candidate is promoted or deleted by this date (YYYY-MM-DD). */
    deadline: string;
    createdAt: string;
    rationale: string;
    measurement: WorkflowCandidateMeasurement;
    delta: WorkflowCandidateDelta;
    /** null = pending; filled by `evaluate`. */
    verdict: WorkflowCandidateVerdict | null;
}

/**
 * Read the recorded real-run inputs for a workflow: per terminal non-dry run, the number of
 * `agent.run` actions and their summed `duration_ms`. A run with no `agent.run` rows counts as zero
 * actions with an unmeasured duration (null, never 0 — the 0284 invariant). `runIds` narrows the
 * replay to specific recorded runs. The caller supplies the database path; the rows come from the
 * domain query owner.
 */
export async function readAgentRunHistory(
    dbPath: string,
    workflow: string,
    runIds?: string[],
): Promise<AgentRunPerRun[]> {
    const db = await openExistingDb(dbPath);
    try {
        return await readAgentRunHistoryRows(db, workflow, runIds);
    } finally {
        db.close();
    }
}

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const lower = sorted[mid - 1] ?? sorted[mid] ?? 0;
    const upper = sorted[mid] ?? 0;
    return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper;
}

function stat(values: number[], runs: number): AgentRunStat {
    if (values.length === 0) return { runs, mean: null, median: null, min: null, max: null };
    return {
        runs,
        mean: values.reduce((a, b) => a + b, 0) / values.length,
        median: median(values),
        min: Math.min(...values),
        max: Math.max(...values),
    };
}

/** Measured `agent.run` count and duration for a workflow, summarized over terminal non-dry runs. */
export interface AgentRunMeasurement {
    workflow: string;
    agentRunCount: AgentRunStat;
    agentRunDurationMs: AgentRunStat;
}

/**
 * Summarize the recorded `agent.run` count and duration over the workflow's terminal non-dry
 * runs. Count folds every such run (zero-`agent.run` runs included as 0); duration folds only
 * runs that recorded at least one `agent.run` action (unmeasured stays null).
 */
export async function measureAgentRunHistory(
    dbPath: string,
    workflow: string,
    runIds?: string[],
): Promise<AgentRunMeasurement> {
    const rows = await readAgentRunHistory(dbPath, workflow, runIds);
    const durations = rows.map((r) => r.durationMs).filter((d): d is number => d !== null);
    return {
        workflow,
        agentRunCount: stat(
            rows.map((r) => r.count),
            rows.length,
        ),
        agentRunDurationMs: stat(durations, durations.length),
    };
}

/**
 * Emit the shadow-run verdict. The decision is the ADR-076 bar — a candidate is promoted only
 * when it projects strictly fewer `agent.run` actions than the canonical definition declares
 * ("measurably reduces model-query count"). The verdict *cites* the measured real-run `agent.run`
 * count and duration (from `action_runs`) as the evidence backing that comparison, never a
 * fixture bar. Duration is cited as measured context; it cannot decide promotion because a
 * candidate's duration is only knowable by running it, which the shadow-run deliberately does not.
 */
export function evaluateCandidate(
    candidate: WorkflowCandidate,
    measured: AgentRunMeasurement,
    canonicalAgentRunCount: number,
    nowIso: string,
): WorkflowCandidateVerdict {
    const candidateCount = candidate.delta.agentRunCount;
    // 0921: the incumbent baseline pins what the candidate replaces, so an already-applied change
    // (live count == projection) still compares against its origin. Absent, the live canonical
    // count is the comparator — exactly the pre-0921 rule the 0873 pins assert.
    const baseline = candidate.delta.baselineAgentRunCount ?? canonicalAgentRunCount;
    // ADR-076: the gate decides on the measured data it cites — zero recorded real runs cannot promote.
    const decision: 'promote' | 'delete' =
        measured.agentRunCount.runs > 0 && candidateCount < baseline ? 'promote' : 'delete';
    const measuredCitation =
        measured.agentRunCount.runs === 0
            ? 'no measured real-run history'
            : `${measured.agentRunCount.runs} real run(s), median ${measured.agentRunCount.median ?? 'n/a'} ` +
              `agent.run action(s)/run, median ${measured.agentRunDurationMs.median ?? 'n/a'} ms/run`;
    const countContext =
        baseline === canonicalAgentRunCount
            ? `the canonical ${candidate.canonical} count of ${canonicalAgentRunCount}`
            : `the incumbent baseline of ${baseline} (canonical ${candidate.canonical} now declares ${canonicalAgentRunCount})`;
    let reason: string;
    if (measured.agentRunCount.runs === 0) {
        reason =
            `candidate projects ${candidateCount} agent.run action(s) against ${countContext}, but with no measured ` +
            `real-run history the ADR-076 gate cannot promote unmeasured — ` +
            `decision falls to delete; re-evaluate after real runs`;
    } else if (decision === 'promote') {
        reason = `candidate projects ${candidateCount} agent.run action(s) against ${countContext} (${measuredCitation})`;
    } else {
        reason = `candidate projects ${candidateCount} agent.run action(s), not fewer than ${countContext} (${measuredCitation}) — ADR-076 rejected a graph adding a model hop`;
    }
    return {
        decision,
        evaluatedAt: nowIso,
        agentRunCount: measured.agentRunCount,
        agentRunDurationMs: measured.agentRunDurationMs,
        candidateAgentRunCount: candidateCount,
        canonicalAgentRunCount,
        reason,
    };
}
