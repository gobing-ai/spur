/**
 * task-freeze — the ADR-137 deprecated-task freeze predicate and its exit command, in one place.
 *
 * Import-free on purpose: `planning-admission.ts` stays a light, domain-barrel-free module (it was
 * bundled into the Node-run plugin until script-absorption PR-6 retired that bundle).
 */

/** True when a task status is the frozen `deprecated` state (case-insensitive, missing → false). */
export function isTaskFrozen(status: string | null | undefined): boolean {
    return status?.toLowerCase() === 'deprecated';
}

/** The un-deprecate command a freeze refusal names as its exit. */
export function undeprecateTaskCommand(wbs: string): string {
    return `spur task update ${wbs} todo`;
}
