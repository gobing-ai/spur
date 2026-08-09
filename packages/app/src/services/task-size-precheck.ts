/**
 * Task size precheck — deterministic R-item and Plan-item counting for the
 * pipeline implement guard (R2, task 0454), plus the size-vs-executor-capability
 * gate (R3, task 0487).
 *
 * Exported as a pure function so it can be tested without I/O and called
 * from a thin shell script under `plugins/sp/scripts/`.
 */

import { type CapabilityTier, TIER_RANK } from '@gobing-ai/spur-domain';

/** Per-task limits for the size precheck gate. */
export interface TaskSizeLimits {
    /** Max R-items in Requirements (default 5). Lines matching `- [ ] **R1.**` or `- [x] R1.` */
    maxReqs: number;
    /** Max checklist items under the Plan section (default 8). */
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

/** Default limits: max 5 R-items, max 8 Plan items. */
export const DEFAULT_TASK_SIZE_LIMITS: TaskSizeLimits = {
    maxReqs: 5,
    maxPlanItems: 8,
};

/**
 * The resolved implement executor, for the size-vs-capability gate (R3, task 0487).
 * `tier` is the *capability* tier (`spur agent doctor --json` → `capabilityTier`),
 * never the doctor row's support tier.
 */
export interface TaskSizeExecutor {
    name: string;
    tier: CapabilityTier | undefined;
}

/**
 * "Large task" thresholds for the executor-capability gate — deliberately the
 * default caps, NOT the (overridable) `limits`. Raising `maxImplementReqs` says
 * "I accept a big task"; it does not make a flash-tier model able to finish one
 * inside `implementTimeoutMs`. Task 0486 burned a full 30-minute budget proving
 * that (run `ca130182`: 7 reqs / 9 plan items → exit 3, 6 of 12 files, no tests).
 */
const LARGE_TASK_THRESHOLDS = DEFAULT_TASK_SIZE_LIMITS;

/**
 * True when the executor is too weak to be handed a large task. An unknown or
 * undeclared-and-uninferrable tier reads as `standard` — conservative, since a
 * false block is one flag away while a false pass costs a timed-out run.
 */
function isBelowCapable(tier: CapabilityTier | undefined): boolean {
    return TIER_RANK[tier ?? 'standard'] < TIER_RANK['capable-1'];
}

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
 * Evaluate a task's size against configured limits, and (when the resolved
 * implement `executor` is supplied) against its capability tier.
 * Pure function, no I/O.
 */
export function evaluateTaskSize(
    content: string,
    limits: TaskSizeLimits = DEFAULT_TASK_SIZE_LIMITS,
    executor?: TaskSizeExecutor,
): TaskSizeReport {
    const reqCount = countRItems(content);
    const planItemCount = countPlanItems(content);

    const reasons: string[] = [];
    if (
        executor !== undefined &&
        isBelowCapable(executor.tier) &&
        (reqCount > LARGE_TASK_THRESHOLDS.maxReqs || planItemCount > LARGE_TASK_THRESHOLDS.maxPlanItems)
    ) {
        reasons.push(
            `Task size (${reqCount} R-items / ${planItemCount} Plan items) requires a capable executor, ` +
                `but ${executor.name} is tier ${executor.tier ?? 'standard'}. ` +
                `Pass \`--agent <capable>\` or \`--vars '{"implementAgent":"<capable>"}'\`, or split the task.`,
        );
    }
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
