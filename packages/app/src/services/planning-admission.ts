/**
 * planning-admission — the pure readiness and admission policy behind batch preflight
 * (task 1179/1173 ownership move, ADR-130).
 *
 * Moved out of `plugins/sp/scripts/batch-preflight.ts` (task 1176): the planner adapter keeps the CLI
 * surface, argv/error contracts and recovery hints, while the decisions themselves — TABLE A STOP
 * evaluation, quick command-aware readiness and feature-finding classification — are application
 * policy with no filesystem or corpus access. Pure and side-effect free, so it also runs under Node.
 */

export type TaskStatus = 'backlog' | 'todo' | 'wip' | 'testing' | 'blocked' | 'done' | 'cancelled' | string;

/** Inputs for TABLE A STOP evaluation: the task status plus every dependency status. */
export interface PreflightInput {
    wbs: string;
    status: TaskStatus;
    /** Frontmatter dependencies[] WBS list. */
    dependencies: string[];
    /** Status of each dependency WBS (from spur task show). Missing → treated as unmet. */
    depStatuses: Record<string, string>;
}

/** The STOP decision: launch the pipeline, or skip with the TABLE A code and reason. */
export type PreflightResult =
    | { action: 'run'; code?: string; reason?: string }
    | { action: 'skip'; code: string; reason: string; unmetDeps?: string[] };

// ── Feature preflight classification (1132 R4) ──────────────────────────────
/**
 * 1132 R4: Codes that are expected pre-run states under `feature check --strict`
 * and must not abort the batch. Structured classification in code (replaces prose-only).
 */
export const NON_ABORTING_PREFLIGHT_CODES = new Set<string>([
    'L4.scenario-unverified',
    'L4.verifying-incomplete-tasks',
]);

/** One feature-check finding as the CLI reports it (layer/code/severity plus message). */
export interface FeaturePreflightFinding {
    layer: string;
    code: string;
    severity: string;
    message: string;
    section?: string;
}

/** The split of feature findings into aborting and expected pre-run classes. */
export interface FeaturePreflightClassification {
    aborting: FeaturePreflightFinding[];
    nonAborting: FeaturePreflightFinding[];
    shouldAbort: boolean;
}

/** Classify feature-check findings; the expected pre-run classes never abort a batch. */
export function classifyFeaturePreflightFindings(findings: FeaturePreflightFinding[]): FeaturePreflightClassification {
    const aborting: FeaturePreflightFinding[] = [];
    const nonAborting: FeaturePreflightFinding[] = [];
    for (const f of findings) {
        if (f.severity === 'error') {
            if (NON_ABORTING_PREFLIGHT_CODES.has(f.code)) {
                nonAborting.push(f);
            } else {
                aborting.push(f);
            }
        } else {
            nonAborting.push(f);
        }
    }
    return {
        aborting,
        nonAborting,
        shouldAbort: aborting.length > 0,
    };
}

// ── Command-aware quick readiness (task 0814 R2) ──────────────────────────────
// Read-only admission decision for the requested dev operation. Distinguishes
// runnable / needs-refinement / blocked / skipped / invalid outcomes without
// LLM dispatch, full tests/lint, live-data probes, feature mutation, or
// corpus-wide relational checking. Refinement gaps are work to do, not errors.

export type ReadinessOperation = 'run' | 'refine' | 'verify';

/** Inputs for command-aware readiness: the operation, the task, and its planning gaps. */
export interface QuickReadinessInput {
    wbs: string;
    status: TaskStatus;
    operation: ReadinessOperation;
    /** Frontmatter dependencies[] WBS list (run only). */
    dependencies?: string[];
    /** Status of each dependency WBS; missing → treated as unmet (run only). */
    depStatuses?: Record<string, string>;
    /** Size of the status-filtered candidate set after the selector resolved; 0 = empty set. */
    filteredCount?: number;
    /** Required planning sections for this variant+status; empty = not applicable. */
    requiredSections?: string[];
    /** Sections that are actually present (non-placeholder) in the task. */
    presentSections?: string[];
    /** L1/L2/L3 content-policy findings keyed by section; empty = clean. */
    sectionFindings?: Record<string, string>;
    /** Verify only: re-verification semantics (--force) — never a dirty-tree bypass. */
    force?: boolean;
}

/** The readiness outcome: runnable, needs-refinement, blocked, skipped or invalid. */
export type QuickReadinessResult =
    | { action: 'runnable'; code: string; reason: string }
    | { action: 'needs-refinement'; code: string; reason: string; gaps: string[] }
    | { action: 'blocked'; code: string; reason: string; unmetDeps?: string[] }
    | { action: 'skipped'; code: string; reason: string }
    | { action: 'invalid'; code: string; reason: string };

/**
 * Evaluate quick readiness for a requested dev operation (0814 R2). Read-only:
 * no model, no full tests/lint, no live-data probe, no feature mutation, no
 * corpus-wide relational check. An empty status-filtered set is `skipped`
 * (mirrors the zero-task rule), never an error. Refinement gaps under `refine`
 * are work to do, so they do not block; under `run` they are `needs-refinement`.
 */
export function quickReadiness(input: QuickReadinessInput): QuickReadinessResult {
    const status = (input.status ?? '').toLowerCase();
    const operation = input.operation;

    if (operation !== 'run' && operation !== 'refine' && operation !== 'verify') {
        return {
            action: 'invalid',
            code: 'IV',
            reason: `quick-readiness: unknown operation '${operation}' (${input.wbs})`,
        };
    }

    if (input.filteredCount !== undefined) {
        if (input.filteredCount < 0) {
            return {
                action: 'invalid',
                code: 'IV',
                reason: `quick-readiness: invalid negative filtered count '${input.filteredCount}' (${input.wbs})`,
            };
        }
        if (input.filteredCount === 0) {
            return {
                action: 'skipped',
                code: 'EMPTY',
                reason: `quick-readiness: empty status-filtered set — nothing to ${operation} (${input.wbs})`,
            };
        }
    }

    if (status === 'cancelled' || status === 'done') {
        // verify --force re-verification (R2 AC): an already-verified terminal task
        // is re-checked, not skipped — but force never bypasses a dirty tree or the
        // owning gates; it only re-admits a terminal task for re-verification.
        if (operation === 'verify' && input.force === true) {
            return {
                action: 'runnable',
                code: 'FORCE',
                reason: `quick-readiness: verify --force re-verification of ${status} task ${input.wbs}`,
            };
        }
        return {
            action: 'skipped',
            code: status === 'done' ? 'DONE' : 'CANCELLED',
            reason: `quick-readiness: already ${status} — no ${operation} hop (${input.wbs})`,
        };
    }

    if (status === 'blocked') {
        return {
            action: 'blocked',
            code: 'BLK',
            reason: `quick-readiness: blocked — human/handover first (${input.wbs})`,
        };
    }

    // Unmet out-of-set dependency is a block for the operation that needs it.
    if (operation === 'run' && input.dependencies && input.dependencies.length > 0) {
        const unmet = input.dependencies.filter((d) => (input.depStatuses?.[d] ?? 'missing').toLowerCase() !== 'done');
        if (unmet.length > 0) {
            return {
                action: 'blocked',
                code: 'DEP',
                reason: `quick-readiness: unmet deps — ${unmet.join(', ')} (${input.wbs})`,
                unmetDeps: unmet,
            };
        }
    }

    const required = input.requiredSections ?? [];
    const present = input.presentSections ?? [];
    // A required section is a gap when it is absent from the present-set OR carries a
    // content-policy finding (the caller-supplied `sectionFindings` from the matrix /
    // `TaskCheckService.checkContentPolicy`). This lets the function detect a gap itself
    // rather than depending on the caller to pre-enumerate every missing section.
    const gaps = required.filter((s) => {
        const finding = input.sectionFindings?.[s];
        return !present.includes(s) || (finding !== undefined && finding !== '');
    });

    // refine: missing/incomplete planning sections are the work, not a failure.
    if (operation === 'refine') {
        if (status !== 'backlog' && status !== 'todo') {
            return {
                action: 'skipped',
                code: 'NONPLAN',
                reason: `quick-readiness: refine targets backlog/todo only, not '${status}' (${input.wbs})`,
            };
        }
        return {
            action: 'runnable',
            code: 'OK',
            reason: `quick-readiness: refine ready for ${input.wbs} (${gaps.length} planning gap(s) to fill)`,
        };
    }

    if (operation === 'verify') {
        if (status !== 'testing' && status !== 'wip') {
            return {
                action: 'invalid',
                code: 'NOVERIFY',
                reason: `quick-readiness: verify needs testing/wip, not '${status}' (${input.wbs})`,
            };
        }
        return {
            action: 'runnable',
            code: 'OK',
            reason: `quick-readiness: verify ready for ${input.wbs}`,
        };
    }

    // run: implementation admission. Eligible statuses are todo/wip/testing;
    // a backlog task needs the chain's auto-promotion first (step 0).
    if (status !== 'todo' && status !== 'wip' && status !== 'testing') {
        return {
            action: 'invalid',
            code: 'NORUN',
            reason: `quick-readiness: run needs todo/wip/testing, not '${status}' (${input.wbs})`,
        };
    }
    if (gaps.length > 0) {
        return {
            action: 'needs-refinement',
            code: 'REFINE',
            reason: `quick-readiness: implementation sections incomplete (${input.wbs})`,
            gaps,
        };
    }
    return {
        action: 'runnable',
        code: 'OK',
        reason: `quick-readiness: run ready for ${input.wbs}`,
    };
}

/**
 * Evaluate whether the batch should launch task-pipeline.yaml for this WBS.
 * STOP codes align with routing-table TABLE A row ids (A2, A7, A8, A9).
 */
export function preflightTask(input: PreflightInput): PreflightResult {
    const status = (input.status ?? '').toLowerCase();
    const deps = input.dependencies ?? [];
    const depStatuses = input.depStatuses ?? {};

    if (status === 'cancelled') {
        return {
            action: 'skip',
            code: 'A9',
            reason: `dev-next: cancelled — nothing to advance (${input.wbs})`,
        };
    }

    if (status === 'done') {
        return {
            action: 'skip',
            code: 'A8',
            reason: `dev-next: already done — batch does not auto-wrap (${input.wbs})`,
        };
    }

    if (status === 'blocked') {
        return {
            action: 'skip',
            code: 'A7',
            reason: `dev-next: blocked — do not launch pipeline; human/handover first (${input.wbs})`,
        };
    }

    // A2: todo/backlog with any dependency not done (mirrors TABLE A2 / ready filter).
    if (status === 'todo' || status === 'backlog') {
        const unmet = deps.filter((d) => {
            const st = (depStatuses[d] ?? 'missing').toLowerCase();
            return st !== 'done';
        });
        if (unmet.length > 0) {
            return {
                action: 'skip',
                code: 'A2',
                reason: `dev-next: blocked by deps — unmet: ${unmet.join(', ')} (${input.wbs})`,
                unmetDeps: unmet,
            };
        }
    }

    // Ready for pipeline: backlog/todo (deps ok), wip, testing.
    return { action: 'run', code: 'OK', reason: `preflight clear — launch task-pipeline for ${input.wbs}` };
}
