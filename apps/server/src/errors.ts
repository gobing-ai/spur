/**
 * Server-side domain errors that map to specific HTTP status codes.
 *
 * Complements ts-utils `AppError` hierarchy (NotFoundError, ValidationError,
 * ConflictError, InternalError) with Spur-specific errors surfaced by the
 * planning write path (lifecycle guard denials and lock contention).
 */

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
