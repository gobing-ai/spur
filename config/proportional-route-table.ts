/**
 * Proportional route table — D8 S3 pilot scaffold (task 0758).
 *
 * The route table is a closed, mutually exhaustive predicate map. Every input
 * resolves to exactly one route. Missing, unknown, or conflicting evidence
 * always selects the safety path (never a fast path). The safety floor
 * (proof-bracket guards, budget-unverifiable fail-closed dispatch,
 * reviewer/executor independence, run-id confinement) holds on the fast
 * path exactly as on the safety path — no route trades the safety floor
 * for speed.
 *
 * Status: WIP — the route table is data-only here. Wiring into
 * wrapup-pipeline and task-lifecycle (and the run-bound evidence writer)
 * lands in the follow-up pilot session. The closed predicates and the
 * safety floor are frozen; the route table entries for the two pilots
 * are recorded as data and ready for the operator to add per-pilot
 * thresholds.
 *
 * See: docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md §4
 * (route table contract) and §7 (pilot exit bar).
 */

export type RouteId = 'safety' | 'fast';

export interface RoutePredicate {
    /** Stable id for the route this predicate selects. */
    readonly route: RouteId;
    /** Human label for review. */
    readonly label: string;
    /** Stable predicate id for evidence-bound replay. */
    readonly id: string;
}

export interface RouteEvaluation {
    readonly route: RouteId;
    readonly predicateId: string;
    readonly reason: string;
}

/**
 * The closed route table. Every route entry is a predicate that selects
 * either the safety path (default) or the fast path. The table is
 * mutually exhaustive: a missing or unknown evidence input falls through
 * to the safety entry below.
 */
export const ROUTE_TABLE: readonly RoutePredicate[] = Object.freeze([
    // Safety path is the default — listed first so an unevaluated input
    // never reaches the fast path. The reason is recorded for the run
    // artifact, not for routing logic.
    {
        id: 'safety-default',
        route: 'safety',
        label: 'default / unknown / conflicting evidence',
    },
]);

/**
 * Evaluate an input against the route table. The current scaffold resolves
 * every input to the safety path; the per-pilot fast-path predicates are
 * added in the follow-up session (operator consent gate per plan §7).
 */
export function evaluateRoute(_input: RouteInput): RouteEvaluation {
    return {
        route: 'safety',
        predicateId: 'safety-default',
        reason: 'proportional route table is in pilot scaffold; all inputs route to safety until per-pilot predicates land',
    };
}

/**
 * Input shape for route evaluation. Frozen interface so the follow-up
 * pilot session extends it without changing call sites.
 */
export interface RouteInput {
    readonly runId: string;
    readonly definitionDigest: string;
    readonly evidenceRefs: readonly string[];
    readonly costCoverage: number;
    readonly proofBinding: 'current' | 'stale' | 'missing';
    readonly reviewerIndependent: boolean;
    readonly runIdConfined: boolean;
}

/**
 * Safety floor invariant. Every route — safety or fast — must hold these
 * conditions. The fast path cannot trade any of them for speed. This
 * function is the gate the pilot's run-bound evidence writer must
 * enforce before recording a non-safety route.
 */
export function safetyFloorHolds(input: RouteInput): boolean {
    return input.proofBinding === 'current' && input.reviewerIndependent === true && input.runIdConfined === true;
}
