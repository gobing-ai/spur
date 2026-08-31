import type { HistoryFilter, HistoryRange } from '@gobing-ai/spur-contracts';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { AgentIcon } from './AgentIcon';

export interface HistoryFilterOption {
    id: string;
    label: string;
    color?: string;
}

export interface HistoryFiltersScope {
    rangeLabel: string;
    sessionCount: number | null | undefined;
    sourceCount: number | undefined;
}

export interface HistoryFiltersProps {
    filter: HistoryFilter;
    onChange: (next: HistoryFilter) => void;
    sourceOptions?: HistoryFilterOption[];
    modelOptions?: HistoryFilterOption[];
    toolOptions?: HistoryFilterOption[];
    skillOptions?: HistoryFilterOption[];
    scope?: HistoryFiltersScope;
}

const AGENT_ICON_IDS = new Set(['claude', 'codex', 'agy', 'omp', 'openclaw', 'hermes', 'grok', 'opencode', 'pi']);

const toggleId = (ids: readonly string[], id: string): string[] =>
    ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

interface MultiSelectFilterProps {
    label: string;
    unconstrainedLabel: string;
    options: HistoryFilterOption[];
    selected: readonly string[];
    onChange: (next: string[] | undefined) => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    showIcon?: boolean;
}

const MultiSelectFilter: React.FC<MultiSelectFilterProps> = ({
    label,
    unconstrainedLabel,
    options,
    selected,
    onChange,
    open,
    onOpenChange,
    showIcon = false,
}) => {
    const rootRef = useRef<HTMLDivElement>(null);
    const [query, setQuery] = useState('');

    // Close on outside pointer press.
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) onOpenChange(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        return () => document.removeEventListener('mousedown', onPointerDown);
    }, [open, onOpenChange]);

    const needle = query.trim().toLowerCase();
    const visible = needle
        ? options.filter((o) => o.label.toLowerCase().includes(needle) || o.id.toLowerCase().includes(needle))
        : options;

    const setSelection = (ids: string[]) => onChange(ids.length > 0 ? ids : undefined);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            onOpenChange(false);
            return;
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('input[type="checkbox"]') ?? []);
        if (items.length === 0) return;
        const idx = items.indexOf(document.activeElement as HTMLElement);
        const next =
            e.key === 'ArrowDown'
                ? items[(idx + 1 + items.length) % items.length]
                : items[(idx - 1 + items.length) % items.length];
        next?.focus();
    };

    const triggerLabel = selected.length === 0 ? unconstrainedLabel : `${selected.length} selected`;

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open}
                className="px-2.5 py-1 text-xs rounded border border-base-content/20 hover:bg-base-content/10 font-medium text-base-content"
                onClick={() => onOpenChange(!open)}
            >
                {label}: {triggerLabel}
            </button>
            {open && (
                <div
                    role="dialog"
                    aria-label={`Filter by ${label}`}
                    onKeyDown={handleKeyDown}
                    className="absolute left-0 mt-1 z-20 p-2 shadow-lg bg-base-300 rounded-lg border border-base-content/10 w-60 text-xs flex flex-col gap-1.5"
                >
                    <input
                        type="search"
                        aria-label={`Search ${label}`}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search…"
                        className="px-2 py-1 rounded border border-base-content/20 bg-base-100 text-base-content focus:outline-none focus:border-primary"
                    />
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                        <button
                            type="button"
                            className="text-primary hover:underline cursor-pointer"
                            onClick={() => setSelection(visible.map((o) => o.id))}
                        >
                            Select all
                        </button>
                        <button
                            type="button"
                            className="text-error/80 hover:text-error underline cursor-pointer"
                            onClick={() => onChange(undefined)}
                        >
                            Clear all
                        </button>
                    </div>
                    <div className="flex flex-col gap-0.5 max-h-56 overflow-y-auto">
                        {visible.map((o) => (
                            <label
                                key={o.id}
                                className="flex items-center gap-2 cursor-pointer py-1 px-1.5 hover:bg-base-200 rounded"
                            >
                                {showIcon && (
                                    <span className="w-3.5 inline-flex items-center justify-center shrink-0">
                                        {AGENT_ICON_IDS.has(o.id) ? (
                                            <AgentIcon id={o.id} />
                                        ) : (
                                            <span
                                                className="w-2.5 h-2.5 rounded-full"
                                                style={{ backgroundColor: o.color ?? '#5e6ad2' }}
                                            />
                                        )}
                                    </span>
                                )}
                                <span className="font-mono text-[11px] flex-1 truncate">{o.label}</span>
                                <input
                                    type="checkbox"
                                    className="h-3.5 w-3.5 rounded border-base-content/30 text-primary"
                                    checked={selected.includes(o.id)}
                                    onChange={() => setSelection(toggleId(selected, o.id))}
                                />
                            </label>
                        ))}
                        {visible.length === 0 && <span className="text-base-content/50 px-1.5 py-1">No matches</span>}
                    </div>
                </div>
            )}
        </div>
    );
};

export const HistoryFilters: React.FC<HistoryFiltersProps> = ({
    filter,
    onChange,
    sourceOptions = [],
    modelOptions = [],
    toolOptions = [],
    skillOptions = [],
    scope,
}) => {
    const [openDropdown, setOpenDropdown] = useState<string | null>(null);

    const handleRangeChange = (range: HistoryRange) => {
        onChange({ ...filter, range });
    };

    const removeFilter = (key: 'sources' | 'models' | 'tools' | 'skills', item: string) => {
        const current = filter[key] || [];
        const next = current.filter((x) => x !== item);
        onChange({ ...filter, [key]: next.length > 0 ? next : undefined });
    };

    const setKey = (key: 'sources' | 'models' | 'tools' | 'skills', next: string[] | undefined) => {
        onChange({ ...filter, [key]: next });
    };

    return (
        <div className="flex flex-col gap-2.5 p-3.5 bg-base-200/50 rounded-xl border border-base-content/10 mb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Time Range Presets */}
                <div className="flex items-center gap-1.5 bg-base-300 p-1 rounded-lg">
                    {(['1h', '4h', '24h', '7d', '30d', 'all'] as const).map((r) => (
                        <button
                            key={r}
                            type="button"
                            className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                                filter.range === r
                                    ? 'bg-primary text-primary-content font-bold'
                                    : 'text-base-content/70 hover:bg-base-content/10'
                            }`}
                            onClick={() => handleRangeChange(r)}
                        >
                            {r.toUpperCase()}
                        </button>
                    ))}
                    <button
                        type="button"
                        className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                            filter.range === 'custom'
                                ? 'bg-primary text-primary-content font-bold'
                                : 'text-base-content/70 hover:bg-base-content/10'
                        }`}
                        onClick={() => handleRangeChange('custom')}
                    >
                        Custom
                    </button>
                </div>

                {/* Effective Scope Summary */}
                {scope && (
                    <div
                        className="flex items-center gap-2 text-xs text-base-content/70 font-mono"
                        data-testid="history-filter-scope"
                    >
                        <span>{scope.rangeLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                            {scope.sessionCount === undefined
                                ? '… sessions'
                                : scope.sessionCount === null
                                  ? '— sessions'
                                  : `${scope.sessionCount} sessions`}
                        </span>
                        {scope.sourceCount !== undefined && (
                            <>
                                <span aria-hidden="true">·</span>
                                <span>
                                    {filter.sources?.length
                                        ? `${filter.sources.length} sources selected`
                                        : `${scope.sourceCount} sources available`}
                                </span>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Custom Date Pickers */}
            {filter.range === 'custom' && (
                <div className="flex items-center gap-3 pt-1">
                    <label className="text-xs text-base-content/70 flex items-center gap-1">
                        From:
                        <input
                            type="datetime-local"
                            className="px-2 py-1 text-xs rounded border border-base-content/20 bg-base-300 text-base-content"
                            value={filter.from ? filter.from.slice(0, 16) : ''}
                            onChange={(e) =>
                                onChange({
                                    ...filter,
                                    from: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                                })
                            }
                        />
                    </label>
                    <label className="text-xs text-base-content/70 flex items-center gap-1">
                        To:
                        <input
                            type="datetime-local"
                            className="px-2 py-1 text-xs rounded border border-base-content/20 bg-base-300 text-base-content"
                            value={filter.to ? filter.to.slice(0, 16) : ''}
                            onChange={(e) =>
                                onChange({
                                    ...filter,
                                    to: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                                })
                            }
                        />
                    </label>
                </div>
            )}

            {/* Multi-Select Filters */}
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-base-content/10">
                <MultiSelectFilter
                    label="Agents"
                    unconstrainedLabel="All"
                    options={sourceOptions}
                    selected={filter.sources ?? []}
                    onChange={(next) => setKey('sources', next)}
                    open={openDropdown === 'sources'}
                    onOpenChange={(o) => setOpenDropdown(o ? 'sources' : null)}
                    showIcon
                />
                <MultiSelectFilter
                    label="Models"
                    unconstrainedLabel="Any"
                    options={modelOptions}
                    selected={filter.models ?? []}
                    onChange={(next) => setKey('models', next)}
                    open={openDropdown === 'models'}
                    onOpenChange={(o) => setOpenDropdown(o ? 'models' : null)}
                />
                <MultiSelectFilter
                    label="Tools"
                    unconstrainedLabel="Any"
                    options={toolOptions}
                    selected={filter.tools ?? []}
                    onChange={(next) => setKey('tools', next)}
                    open={openDropdown === 'tools'}
                    onOpenChange={(o) => setOpenDropdown(o ? 'tools' : null)}
                />
                <MultiSelectFilter
                    label="Skills"
                    unconstrainedLabel="Any"
                    options={skillOptions}
                    selected={filter.skills ?? []}
                    onChange={(next) => setKey('skills', next)}
                    open={openDropdown === 'skills'}
                    onOpenChange={(o) => setOpenDropdown(o ? 'skills' : null)}
                />

                {/* Active Filter Chips */}
                <div className="flex flex-wrap items-center gap-1.5 ml-auto">
                    {filter.sources?.map((s) => (
                        <div
                            key={s}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-base-300 border border-base-content/10 text-base-content gap-1"
                        >
                            <span className="capitalize">{s}</span>
                            <button
                                type="button"
                                onClick={() => removeFilter('sources', s)}
                                className="hover:text-error"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                    {filter.models?.map((m) => (
                        <div
                            key={m}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-base-300 border border-base-content/10 text-base-content font-mono text-[10px] gap-1"
                        >
                            <span>{m}</span>
                            <button
                                type="button"
                                onClick={() => removeFilter('models', m)}
                                className="hover:text-error"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                    {filter.tools?.map((t) => (
                        <div
                            key={t}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-base-300 border border-base-content/10 text-base-content font-mono text-[10px] gap-1"
                        >
                            <span>{t}</span>
                            <button type="button" onClick={() => removeFilter('tools', t)} className="hover:text-error">
                                ×
                            </button>
                        </div>
                    ))}
                    {filter.skills?.map((sk) => (
                        <div
                            key={sk}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-base-300 border border-base-content/10 text-base-content font-mono text-[10px] gap-1"
                        >
                            <span>{sk}</span>
                            <button
                                type="button"
                                onClick={() => removeFilter('skills', sk)}
                                className="hover:text-error"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                    {((filter.sources?.length ?? 0) > 0 ||
                        (filter.models?.length ?? 0) > 0 ||
                        (filter.tools?.length ?? 0) > 0 ||
                        (filter.skills?.length ?? 0) > 0) && (
                        <button
                            type="button"
                            className="text-xs text-error/80 hover:text-error underline ml-1 cursor-pointer"
                            onClick={() => onChange({ range: filter.range, bucket: filter.bucket })}
                        >
                            Clear all
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
export default HistoryFilters;
