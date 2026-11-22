/** One tab in a module's append-only strip; `id` is the identity persisted UI state keys on. */
export interface ModuleTab {
    readonly id: string;
    readonly label: string;
    /**
     * Optional count/status shown after the label (A83 1427) — e.g. History's per-tab item count.
     * `null`/absent renders no badge at all, so a caller can pass a computed value directly.
     */
    readonly badge?: string | number | null;
}
/** Controlled tab strip over an append-only tab list. */
export interface ModuleTabsProps {
    /** The module's tabs, in contract order — never reordered at render time. */
    tabs: readonly ModuleTab[];
    /** Id of the selected tab. */
    value: string;
    /** Called with the clicked tab id; the caller owns the state. */
    onChange: (id: string) => void;
    /** Accessible name of the `tablist`. */
    label: string;
    /**
     * Id prefix for the tab buttons: a button is `${idPrefix}-${tab.id}` and points at
     * `${idPrefix}-panel-${tab.id}`, so the caller must render its panel with that id.
     */
    idPrefix: string;
    /** Extra classes on the strip. */
    className?: string;
}
/**
 * ## ModuleTabs
 *
 * The accessible tab list every multi-view module shell renders: `role="tablist"` with one
 * `role="tab"` button per entry, `aria-selected` from `value` and `aria-controls` pointing at
 * the caller's panel. Controlled and stateless — URL or component state stays in the caller.
 */
export declare function ModuleTabs({ tabs, value, onChange, label, idPrefix, className }: ModuleTabsProps): import("react/jsx-runtime").JSX.Element;
