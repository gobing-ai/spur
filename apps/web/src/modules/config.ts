/**
 * Static discovery inputs for the board module registry.
 *
 * Source of truth for which roots are scanned and which discovered modules are
 * disabled by id. Kept as a pure TS module (not `.spur/config.yaml`) so module
 * discovery stays a pure web build-time concern with no server round-trip. The
 * runtime registry API takes these as inputs, so a future RPC-backed config can
 * layer on without rework.
 */

/**
 * Roots to scan for modules, expressed relative to `apps/web/src/modules/`.
 * First cut: a single default root (the modules directory itself). Order is
 * significant: enabled modules are ordered by root order, then by stable
 * discovery (sorted directory name) order within a root.
 */
export const moduleRoots = ['./'] as const;

/**
 * Module ids to drop after discovery. A discovered module listed here is absent
 * from {@link modules} / {@link getModule} / {@link defaultModule} without being
 * deleted from disk; `enableModule(id)` restores it at runtime.
 */
export const disabledModules: readonly string[] = [];
