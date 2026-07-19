/**
 * Server-side domain errors that map to specific HTTP status codes.
 *
 * The narrow `@gobing-ai/spur-app/errors` entry preserves class identity with
 * PlanningWriteService without pulling the Node-oriented app barrel into the
 * Cloudflare Worker module graph.
 */
export { GuardDeniedError, LockTimeoutError } from '@gobing-ai/spur-app/errors';
