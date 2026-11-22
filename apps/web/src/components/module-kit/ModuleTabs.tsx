import { useRef } from 'react';

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
export function ModuleTabs({ tabs, value, onChange, label, idPrefix, className }: ModuleTabsProps) {
    const strip = useRef<HTMLDivElement>(null);

    /**
     * Roving arrow-key navigation, standard for a tablist (WAI-ARIA Authoring Practices): Left/Right
     * move the selection and focus with it, wrapping at the ends. It lives here rather than in each
     * adopting module because every module wants it, and a second copy is how the strips drift.
     */
    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        const index = tabs.findIndex((tab) => tab.id === value);
        if (index < 0) return;
        event.preventDefault();
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        const next = tabs[(index + delta + tabs.length) % tabs.length];
        if (next === undefined) return;
        onChange(next.id);
        strip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[tabs.indexOf(next)]?.focus();
    };

    return (
        <div
            ref={strip}
            role="tablist"
            aria-label={label}
            onKeyDown={onKeyDown}
            className={`flex items-center gap-1 bg-base-300 p-1 rounded-xl ${className ?? ''}`.trim()}
        >
            {tabs.map((tab) => {
                const selected = tab.id === value;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        aria-controls={`${idPrefix}-panel-${tab.id}`}
                        id={`${idPrefix}-${tab.id}`}
                        onClick={() => onChange(tab.id)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                            selected
                                ? 'bg-primary text-primary-content font-bold shadow-sm'
                                : 'text-base-content/70 hover:bg-base-content/10'
                        }`}
                    >
                        {tab.label}
                        {tab.badge === undefined || tab.badge === null ? null : (
                            <span
                                className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-base-content/10"
                                data-testid={`${idPrefix}-badge-${tab.id}`}
                            >
                                {tab.badge}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
