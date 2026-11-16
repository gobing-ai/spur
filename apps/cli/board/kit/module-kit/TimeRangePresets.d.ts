/** Controlled range-preset chip group; `presets` is the module's own range vocabulary. */
export interface TimeRangePresetsProps<T extends string> {
    /** Preset values in display order, e.g. `['1h', '4h', '24h', 'all']`. */
    presets: readonly T[];
    /** The active preset. */
    value: T;
    /** Called with the clicked preset; the caller owns the state. */
    onChange: (next: T) => void;
    /** Accessible name of the group. Default: "Time range presets". */
    label?: string;
}
/**
 * ## TimeRangePresets
 *
 * The shell-owned range chip group rendered once per module, visible on every tab, so no tab
 * renders its own copy. Controlled and stateless; `all` renders as "All".
 */
export declare function TimeRangePresets<T extends string>({ presets, value, onChange, label, }: TimeRangePresetsProps<T>): import("react/jsx-runtime").JSX.Element;
