/**
 * Verified-result and correction-cost operational metrics (feature A6, task 0712).
 *
 * Pure fold over per-task evidence. The caller (app `verified-outcome` service)
 * gathers evidence from the DB planes that actually exist — `task_run_links`,
 * `runs`, verdict artifacts on disk, and the task-file `## History` corpus — and
 * feeds one {@link VerifiedOutcomeTaskInput} row per task that has a pipeline
 * run-link. This module owns the deterministic definitions (R1/R2) and the
 * rate math (R3); it never touches I/O (R7: bounded by the caller's window).
 *
 * Frozen definitions (R2 — deterministic, no heuristics):
 * - **Verified result (R1)**: a task whose final state is `done`, reached
 *   through the guarded record chain, with a recorded PASS verdict whose proof
 *   digest is present and whose certifying pipeline run completed. Forced done
 *   (`done_forced: true`), missing/synthetic verdicts, non-PASS verdicts, and
 *   runs that did not complete (proof mismatch fails the pipeline run) are all
 *   excluded — each exclusion is counted under its reason, never silently
 *   dropped.
 * - **Correction (R2)**: a verified result that later needed repair — a
 *   reopen transition (`done → wip`) in the task's History, or a superseding
 *   linked pipeline run that failed after the verified one.
 * - **Cost (R4)**: only attributable *measured* token cost (exact run→session
 *   mappings; estimated mappings and dollar figures stay unread, per run-cost
 *   R3). When any verified result has no exact mapping, the metric is
 *   `null` plus an explicit coverage pair — absence is never coalesced to zero.
 */

/** Schema version of the verified-outcome block (bump on shape change). */
export const VERIFIED_OUTCOME_SCHEMA_VERSION = 1;

/** Per-task evidence gathered by the app-layer derivation. One row per wbs. */
export interface VerifiedOutcomeTaskInput {
    /** Task WBS id. Duplicate rows for the same wbs are deduped by the fold (R8). */
    wbs: string;
    /** Final task status is `done` (from the corpus History / frontmatter). */
    done: boolean;
    /** Reached done through the guarded chain — frontmatter has no `done_forced: true`. */
    forcedDone: boolean;
    /** A verdict artifact exists and parsed (`.spur/run/<wbs>-verdict.json`). */
    verdictPresent: boolean;
    /** The recorded verdict is PASS. */
    passVerdict: boolean;
    /** A `Verdict:` line exists in the corpus Testing section (synthetic marker when the artifact is absent). */
    sectionVerdictPresent: boolean;
    /** The verdict artifact carries a non-empty proof digest (`proof.digest`, or flat `proofDigest`). */
    proofDigestPresent: boolean;
    /**
     * The certifying pipeline run completed. When the verdict's proof block names a `runId`,
     * this is that exact run's completion; otherwise any completed linked run (0730 §B.2).
     */
    certifyingRunCompleted: boolean;
    /** Any `done → wip` reopen transition appears in the corpus History. */
    reopened: boolean;
    /** A linked pipeline run failed (retry-exhaustion / superseding failed run). */
    supersedingFailedRun: boolean;
    /** First `→ wip` transition timestamp (ISO), when the History records one. */
    firstWipAt: string | null;
    /** Final `→ done` transition timestamp (ISO), when the History records one. */
    doneAt: string | null;
    /** Summed measured tokens (input+output) from exact run→session mappings; null when unmapped. */
    measuredTokens: number | null;
}

/** Bounded time-to-verified distribution (mean/max only — no per-task leak, R7). */
export interface TimeToVerifiedStat {
    /** Number of verified results with both timestamps observed. */
    count: number;
    /** Mean milliseconds from first wip to done, or null when count is 0. */
    meanMs: number | null;
    /** Max milliseconds from first wip to done, or null when count is 0. */
    maxMs: number | null;
}

/** Measured-cost coverage over verified results (R4: never coalesce absence to zero). */
export interface CostCoverageStat {
    /** Verified results with an exact measured-cost mapping. */
    covered: number;
    /** All verified results. */
    total: number;
}

/** The derived verified-outcome block embedded additively in the history artifact. */
export interface VerifiedOutcomeStat {
    schemaVersion: number;
    /** Derivation window bounds (ISO or null = unbounded side), as requested. */
    window: { since: string | null; until: string | null };
    /** Distinct tasks with a pipeline run-link inside the window (the denominator). */
    taskDenominator: number;
    /** Tasks qualifying as verified results (R1). */
    verifiedResults: number;
    /** verifiedResults / taskDenominator; null when the denominator is 0. */
    verifiedRate: number | null;
    /** Verified results with no correction signal (R2/R3). */
    verifiedWithoutCorrection: number;
    /** verifiedWithoutCorrection / taskDenominator; null when the denominator is 0. */
    verifiedWithoutCorrectionRate: number | null;
    /** Correction count and rate over the denominator. */
    correctionCount: number;
    correctionRate: number | null;
    /** Time from first wip to done across verified results. */
    timeToVerified: TimeToVerifiedStat;
    /** Tasks whose linked pipeline run failed (retry-exhaustion signal, R3). */
    retryExhaustedCount: number;
    /** Measured tokens per verified result (exact mappings only); null unless covered > 0. */
    measuredTokensPerVerifiedResult: number | null;
    /** Measured-cost coverage over verified results (R4). */
    costCoverage: CostCoverageStat;
    /** Exclusion counts by frozen reason — every non-verified task lands here. */
    excludedReasons: {
        notDone: number;
        forcedDone: number;
        missingVerdict: number;
        syntheticVerdict: number;
        verdictNotPass: number;
        proofAbsent: number;
        certifyingRunFailed: number;
    };
}

/**
 * Fold per-task evidence into the verified-outcome stat. Pure and synchronous.
 * Duplicate {@link VerifiedOutcomeTaskInput.wbs} rows are deduped to the first
 * occurrence (R8: a task linked from multiple import passes counts once).
 */
export function deriveVerifiedOutcomeStat(
    inputs: readonly VerifiedOutcomeTaskInput[],
    window: { since: string | null; until: string | null },
): VerifiedOutcomeStat {
    const byWbs = new Map<string, VerifiedOutcomeTaskInput>();
    for (const t of inputs) if (!byWbs.has(t.wbs)) byWbs.set(t.wbs, t);
    const tasks = [...byWbs.values()];

    const excluded = {
        notDone: 0,
        forcedDone: 0,
        missingVerdict: 0,
        syntheticVerdict: 0,
        verdictNotPass: 0,
        proofAbsent: 0,
        certifyingRunFailed: 0,
    };
    const verified: VerifiedOutcomeTaskInput[] = [];
    let corrections = 0;
    let retryExhausted = 0;
    const durations: number[] = [];
    let coveredTokens = 0;
    let coveredCount = 0;

    for (const t of tasks) {
        if (t.supersedingFailedRun) retryExhausted += 1;
        if (!t.done) {
            excluded.notDone += 1;
            continue;
        }
        if (t.forcedDone) {
            excluded.forcedDone += 1;
            continue;
        }
        if (!t.verdictPresent) {
            if (t.sectionVerdictPresent) excluded.syntheticVerdict += 1;
            else excluded.missingVerdict += 1;
            continue;
        }
        if (!t.passVerdict) {
            excluded.verdictNotPass += 1;
            continue;
        }
        if (!t.proofDigestPresent) {
            excluded.proofAbsent += 1;
            continue;
        }
        if (!t.certifyingRunCompleted) {
            excluded.certifyingRunFailed += 1;
            continue;
        }
        verified.push(t);
        if (t.reopened || t.supersedingFailedRun) corrections += 1;
        if (t.firstWipAt !== null && t.doneAt !== null) {
            const ms = new Date(t.doneAt).getTime() - new Date(t.firstWipAt).getTime();
            if (Number.isFinite(ms)) durations.push(ms);
        }
        if (t.measuredTokens !== null) {
            coveredTokens += t.measuredTokens;
            coveredCount += 1;
        }
    }

    const denominator = tasks.length;
    const rate = (n: number): number | null => (denominator === 0 ? null : n / denominator);
    const meanMs = durations.length === 0 ? null : durations.reduce((a, b) => a + b, 0) / durations.length;
    const maxMs = durations.length === 0 ? null : Math.max(...durations);

    return {
        schemaVersion: VERIFIED_OUTCOME_SCHEMA_VERSION,
        window: { since: window.since, until: window.until },
        taskDenominator: denominator,
        verifiedResults: verified.length,
        verifiedRate: rate(verified.length),
        verifiedWithoutCorrection: verified.length - corrections,
        verifiedWithoutCorrectionRate: rate(verified.length - corrections),
        correctionCount: corrections,
        correctionRate: rate(corrections),
        timeToVerified: { count: durations.length, meanMs, maxMs },
        retryExhaustedCount: retryExhausted,
        measuredTokensPerVerifiedResult: coveredCount === 0 ? null : coveredTokens / coveredCount,
        costCoverage: { covered: coveredCount, total: verified.length },
        excludedReasons: excluded,
    };
}
