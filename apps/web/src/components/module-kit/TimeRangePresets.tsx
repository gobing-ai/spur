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
export function TimeRangePresets<T extends string>({
    presets,
    value,
    onChange,
    label = 'Time range presets',
}: TimeRangePresetsProps<T>) {
    return (
        <fieldset className="flex items-center gap-1 bg-base-200 p-1 rounded-lg border-0 m-0" aria-label={label}>
            <legend className="sr-only">{label}</legend>
            {presets.map((preset) => {
                const active = value === preset;
                return (
                    <button
                        key={preset}
                        type="button"
                        onClick={() => onChange(preset)}
                        aria-pressed={active}
                        className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                            active
                                ? 'bg-primary text-primary-content font-bold shadow-sm'
                                : 'text-base-content/70 hover:bg-base-content/10'
                        }`}
                    >
                        {preset === 'all' ? 'All' : preset}
                    </button>
                );
            })}
        </fieldset>
    );
}
