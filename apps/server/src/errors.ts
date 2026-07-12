/**
 * Server-side domain errors that map to specific HTTP status codes.
 *
 * Re-exported from `@gobing-ai/spur-app` so the HTTP error-handler and the
 * PlanningWriteService throw sites share one class identity (`instanceof` works
 * across the package boundary).
 */
export { GuardDeniedError, LockTimeoutError } from '@gobing-ai/spur-app';
