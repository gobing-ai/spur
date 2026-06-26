/**
 * Planning-folder resolver — now a thin re-export from the canonical facade.
 *
 * The real implementation lives in `@gobing-ai/spur-config/loader` (ADR-027).
 * This file preserves the `@gobing-ai/spur-app` public API surface so existing
 * consumers (`resolvePlanningFolders` callers in CLI, team-service) don't need
 * to change their import paths from `@gobing-ai/spur-app`.
 *
 * Re-exported here (not aliased) so the type identities stay stable across packages.
 */
export { type PlanningFolders, resolvePlanningFolders } from '@gobing-ai/spur-config/loader';
