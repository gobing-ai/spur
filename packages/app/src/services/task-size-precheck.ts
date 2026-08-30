/**
 * Task size precheck — deterministic R-item and Plan-item counting for the
 * pipeline implement guard (R2, task 0454; count-only since task 0723).
 *
 * Exported as a pure function so it can be tested without I/O and called
 * from a thin shell script under `plugins/sp/scripts/`.
 */

/** Per-task limits for the size precheck gate. */
export interface TaskSizeLimits {
    /** Max R-items in Requirements (default 10). Lines matching `- [ ] **R1.**` or `- [x] R1.` */
    maxReqs: number;
    /** Max checklist items under the Plan section (default 16). */
    maxPlanItems: number;
}

/** Result of evaluating a task's content against size limits. */
export interface TaskSizeReport {
    /** Count of requirement items found. */
    reqCount: number;
    /** Count of plan checklist items found. */
    planItemCount: number;
    /** True when both counts are within limits. */
    ok: boolean;
    /** Human-readable reasons when !ok. */
    reasons: string[];
}

/** Default limits: the doubled deterministic ceiling (0723) — max 10 R-items, max 16 Plan items. */
export const DEFAULT_TASK_SIZE_LIMITS: TaskSizeLimits = {
    maxReqs: 10,
    maxPlanItems: 16,
};

/**
 * Regex for requirement items in the `## Requirements` section.
 * Matches `- [ ] **R1.**`, `- [x] **R1.**`, `- [ ] R1.`, `- [x] R1.` etc.
 */
const R_ITEM_RE = /^\s*-\s*\[[ xX]\]\s*(\*\*)?R\d+\./m;

/**
 * Regex for checklist items (any section, used under Plan).
 */
const CHECKLIST_ITEM_RE = /^\s*-\s*\[[ xX]\]/m;

/**
 * Count R-items in a task markdown body.
 * Pure function, no I/O.
 */
export function countRItems(content: string): number {
    const matches = content.match(new RegExp(R_ITEM_RE.source, 'gm'));
    return matches?.length ?? 0;
}

/**
 * Extract the Plan section body from task markdown and count checklist items.
 * Looks for `## Plan` or `### Plan` heading, then counts `- [ ]` / `- [x]` lines.
 * Returns 0 when no Plan section found.
 */
export function countPlanItems(content: string): number {
    // Find the Plan section heading
    const planMatch = content.match(/^#{2,3}\s+Plan\s*$/m);
    if (!planMatch) return 0;

    const planStart = (planMatch.index ?? 0) + planMatch[0].length;
    const rest = content.slice(planStart);

    // Find the next section heading (## or ###) after Plan
    const nextSection = rest.match(/^#{2,3}\s+/m);
    const planBody = nextSection ? rest.slice(0, nextSection.index ?? 0) : rest;

    const matches = planBody.match(new RegExp(CHECKLIST_ITEM_RE.source, 'gm'));
    return matches?.length ?? 0;
}

/**
 * Evaluate a task's size against configured limits.
 * Pure function, no I/O. Count-only since 0723: executor liveness, routing,
 * and capability attestation are enforced fail-closed at the `agent.run`
 * dispatch boundary, not predicted from task shape.
 */
export function evaluateTaskSize(content: string, limits: TaskSizeLimits = DEFAULT_TASK_SIZE_LIMITS): TaskSizeReport {
    const reqCount = countRItems(content);
    const planItemCount = countPlanItems(content);

    const reasons: string[] = [];
    if (reqCount > limits.maxReqs) {
        reasons.push(
            `Task has ${reqCount} R-items (max ${limits.maxReqs}). ` +
                `Consider decomposing into smaller tasks or raise maxImplementReqs via --vars.`,
        );
    }
    if (planItemCount > limits.maxPlanItems) {
        reasons.push(
            `Task has ${planItemCount} Plan items (max ${limits.maxPlanItems}). ` +
                `Consider simplifying the plan or raise maxImplementPlanItems via --vars.`,
        );
    }

    return {
        reqCount,
        planItemCount,
        ok: reasons.length === 0,
        reasons,
    };
}
