/**
 * Search domain module — oRPC-only (no Hono routes), so no ServerModule registry entry
 * is needed (design §4 Server: the Worker mounts no oRPC router, keeping search local-only).
 */

/** Re-export handler factory for router composition. */
export { createSearchHandlers } from './handlers';
