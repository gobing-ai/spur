/**
 * Frozen description of what the module-kit barrel publishes at runtime.
 *
 * The Board runtime facade generator cannot measure this list the way it measures React: it
 * loads a resolved specifier with `createRequire`, and a TSX barrel is not requireable. The list
 * is therefore declared here, next to the barrel it describes, and a unit test asserts it equals
 * the barrel's real runtime export keys — the facade and the barrel cannot drift silently.
 */

/** Runtime value exports of `./index.ts`, in barrel order. */
export const MODULE_KIT_EXPORTS = [
    'Diagnostic',
    'EmptyState',
    'ModuleHeader',
    'ModuleShell',
    'ModuleTabs',
    'TimeRangePresets',
    'Loading',
    'Card',
    'CardBody',
    'Badge',
    'Button',
] as const;

/**
 * Semver of the kit's public prop contract, recorded as `uiKitVersion` in `board-runtime.json`.
 *
 * Breaking a prop is a major bump; removing the specifier is a contribution API change and out of
 * scope (ADR-150).
 */
export const BOARD_UI_KIT_VERSION = '1.0.0';
