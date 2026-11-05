/**
 * App-layer domain errors shared by PlanningWriteService and the server HTTP
 * error mapper. Kept out of `apps/server` so throw sites in `packages/app` can
 * raise the same types the handler matches via `instanceof`.
 */

/** Thrown when a planning input exists but cannot be read or parsed. Carries its path and original cause. */
export class PlanningReadError extends Error {
    readonly path: string;
    override readonly cause: unknown;

    constructor(path: string, cause: unknown) {
        super(`Failed to read planning input ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
        this.name = 'PlanningReadError';
        this.path = path;
        this.cause = cause;
    }
}

/** Thrown when a lifecycle guard blocks a status transition. Maps to 409 GUARD_DENIED. */
export class GuardDeniedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GuardDeniedError';
    }
}

/** Thrown when a planning write lock cannot be acquired within the TTL. Maps to 503 LOCK_TIMEOUT. */
export class LockTimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LockTimeoutError';
    }
}

/** True when `SPUR_HITL_AUTO_APPROVE=1` — explicit opt-in to auto-approve HITL confirms. */
export function hitlAutoApproveEnabled(env: Record<string, string | undefined> | undefined): boolean {
    return env?.SPUR_HITL_AUTO_APPROVE === '1';
}

/** Default confirm answer for non-interactive HITL: deny unless auto-approve is opted in. */
export function hitlConfirmDefault(env?: Record<string, string | undefined>): 'yes' | 'no' {
    return hitlAutoApproveEnabled(env) ? 'yes' : 'no';
}
