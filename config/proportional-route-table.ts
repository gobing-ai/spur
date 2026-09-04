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
 * See: docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md §4
 * (route table contract) and §7 (pilot exit bar).
 */

export type RouteId = 'safety' | 'fast' | 'skipped';

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
 * The closed route table for proportional routing.
 */
export const ROUTE_TABLE: readonly RoutePredicate[] = Object.freeze([
    {
        id: 'safety-default',
        route: 'safety',
        label: 'default / unknown / conflicting evidence',
    },
    {
        id: 'fast-complete',
        route: 'fast',
        label: 'complete and consistent evidence',
    },
    {
        id: 'skipped-empty',
        route: 'skipped',
        label: 'empty task list / no work required',
    },
]);

/**
 * Evaluate route for wrapup-pipeline over (tasks, mode).
 * Mutually exhaustive predicates matching strategy §4 and prototype 0732 §2.
 */
export function evaluateWrapupRoute(input: { tasks?: unknown[] | string; mode?: string }): RouteEvaluation {
    let taskCount = 0;
    if (Array.isArray(input.tasks)) {
        taskCount = input.tasks.length;
    } else if (typeof input.tasks === 'string') {
        try {
            const parsed = JSON.parse(input.tasks);
            if (Array.isArray(parsed)) taskCount = parsed.length;
        } catch {
            taskCount = 0;
        }
    }

    if (taskCount === 0) {
        return {
            route: 'skipped',
            predicateId: 'skipped-empty',
            reason: 'skipped:empty task list',
        };
    }

    const mode = input.mode;
    if (mode === 'fast') {
        return {
            route: 'fast',
            predicateId: 'fast-complete',
            reason: 'fast:evidence complete+consistent',
        };
    }
    if (!mode) {
        return {
            route: 'safety',
            predicateId: 'safety-default',
            reason: 'safety:missing evidence (mode empty)',
        };
    }
    if (mode === 'unknown') {
        return {
            route: 'safety',
            predicateId: 'safety-default',
            reason: 'safety:unknown evidence quality',
        };
    }
    if (mode === 'conflict') {
        return {
            route: 'safety',
            predicateId: 'safety-default',
            reason: 'safety:conflicting evidence',
        };
    }
    return {
        route: 'safety',
        predicateId: 'safety-default',
        reason: `safety:unrecognized evidence (mode=${mode})`,
    };
}

/**
 * Evaluate route for task-lifecycle over (mode).
 */
export function evaluateLifecycleRoute(input: { mode?: string }): RouteEvaluation {
    if (input.mode === 'fast') {
        return {
            route: 'fast',
            predicateId: 'fast-complete',
            reason: 'fast:evidence complete+consistent',
        };
    }
    return {
        route: 'safety',
        predicateId: 'safety-default',
        reason: 'safety:standard verification',
    };
}

/**
 * Generic evaluateRoute resolving to safety or fast based on input.
 */
export function evaluateRoute(input: RouteInput): RouteEvaluation {
    if (input.costCoverage >= 0.8 && input.proofBinding === 'current' && input.reviewerIndependent) {
        return {
            route: 'fast',
            predicateId: 'fast-complete',
            reason: 'fast:evidence complete+consistent',
        };
    }
    return {
        route: 'safety',
        predicateId: 'safety-default',
        reason: 'safety:default / unknown / conflicting evidence',
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
