/**
 * Task size precheck — deterministic R-item and Plan-item counting for the
 * pipeline implement guard (R2, task 0454; count-only since task 0723).
 *
 * Exported as a pure function so it can be tested without I/O and called
 * from a thin shell script under `plugins/sp/scripts/`.
 */

/** Per-task limits for the size precheck gate. */
export interface TaskSizeLimits {
    /** Max R-items in Requirements (default 10). House `- **R1** —` or legacy `- [ ] R1.` lines. */
    maxReqs: number;
    /** Max Plan items (default 16): top-level numbered steps plus checklist items. */
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
 * Requirement item: one list marker required, then an optional checkbox, then the R-number in the
 * house `- **R1** — <text>` or legacy `- [ ] R1. <text>` form. A bare `R1 <text>` line carries no
 * list marker and stays prose, not a requirement. Mirrored by the lockstep copy in
 * `plugins/sp/scripts/task-size-precheck.ts`.
 */
const R_ITEM_RE_SOURCE = '^\\s*[-*]\\s+(?:\\[[ xX]\\]\\s*)?[*_]{0,2}R(\\d+)\\.?[*_]{0,2}(?:\\s|$)';

/** Top-level numbered Plan step (`1. <text>`). */
const NUMBERED_PLAN_ITEM_RE_SOURCE = '^\\d+\\.\\s';

/** Checklist Plan item (`- [ ] <text>`, `- [x] <text>`). */
const CHECKLIST_ITEM_RE_SOURCE = '^\\s*[-*]\\s+\\[[ xX]\\]';

/**
 * Body of a `##`/`###` section (heading line excluded), up to the next `##`/`###` heading.
 * `null` when the heading is absent — callers decide the fallback.
 */
function sectionBody(content: string, headingPattern: string): string | null {
    const heading = content.match(new RegExp(headingPattern, 'm'));
    if (!heading) return null;
    const rest = content.slice((heading.index ?? 0) + heading[0].length);
    const nextHeading = rest.match(/^#{2,3}\s+/m);
    return nextHeading ? rest.slice(0, nextHeading.index ?? 0) : rest;
}

/**
 * Count distinct R-items in the `## Requirements` section (whole content when the heading is
 * absent, as before). Deduped by number so a continuation line citing `R1` cannot double-count.
 * Pure function, no I/O.
 */
export function countRItems(content: string): number {
    const body = sectionBody(content, '^#{2,3}\\s+Requirements\\s*$') ?? content;
    const numbers = new Set<string>();
    for (const match of body.matchAll(new RegExp(R_ITEM_RE_SOURCE, 'gm'))) {
        numbers.add(match[1] ?? '');
    }
    return numbers.size;
}

/**
 * Extract the Plan section body and count its items: top-level numbered steps plus checklist
 * items. Returns 0 when no Plan section is found.
 */
export function countPlanItems(content: string): number {
    const body = sectionBody(content, '^#{2,3}\\s+Plan\\s*$');
    if (body === null) return 0;

    const numbered = body.match(new RegExp(NUMBERED_PLAN_ITEM_RE_SOURCE, 'gm'))?.length ?? 0;
    const checklist = body.match(new RegExp(CHECKLIST_ITEM_RE_SOURCE, 'gm'))?.length ?? 0;
    return numbered + checklist;
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
