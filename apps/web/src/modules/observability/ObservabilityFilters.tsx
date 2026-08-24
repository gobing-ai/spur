import { type ReactNode, useMemo } from 'react';
import { Input } from '@/ui';
import type { ObservabilityTimeRange } from './tabs';

export interface ObservabilityFilterValues {
    selectedPrefixes: Set<string>;
    searchQuery: string;
    searchScope: 'all' | 'name' | 'actor' | 'payload';
    severity: 'all' | 'info' | 'warning' | 'error';
    tierFilter: 'all' | 'default' | 'diagnostic';
    runId: string;
}

export interface ObservabilityFiltersProps {
    timeRange: ObservabilityTimeRange;
    onTimeRangeChange: (range: ObservabilityTimeRange) => void;
    filters: ObservabilityFilterValues;
    onFiltersChange: (
        next: ObservabilityFilterValues | ((prev: ObservabilityFilterValues) => ObservabilityFilterValues),
    ) => void;
    onClearFilters: () => void;
    prefixOptions: string[];
    getPrefixColor: (prefix: string) => string;
    liveEnabled: boolean;
    onToggleLive: () => void;
    shownCount: number;
    totalCount: number;
    actions?: ReactNode;
}

export const TIME_RANGES: readonly ObservabilityTimeRange[] = ['30s', '5m', '1h', '24h', '7d', 'all'];

export const TIME_RANGE_MS: Record<ObservabilityTimeRange, number | null> = {
    '30s': 30_000,
    '5m': 5 * 60_000,
    '1h': 60 * 60_000,
    '24h': 24 * 60 * 60_000,
    '7d': 7 * 24 * 60 * 60_000,
    all: null,
};

export function timeRangeSince(range: ObservabilityTimeRange, nowMs: number = Date.now()): string | undefined {
    const ms = TIME_RANGE_MS[range];
    if (ms === null || ms === undefined) return undefined;
    return new Date(nowMs - ms).toISOString();
}

export function isFilterActive(filters: ObservabilityFilterValues): boolean {
    return (
        filters.selectedPrefixes.size > 0 ||
        filters.searchQuery.trim() !== '' ||
        filters.searchScope !== 'all' ||
        filters.severity !== 'all' ||
        filters.tierFilter !== 'all' ||
        filters.runId.trim() !== ''
    );
}

export function SegmentedToggle<T extends string>({
    label,
    value,
    onChange,
    options,
}: {
    label: string;
    value: T;
    onChange: (val: T) => void;
    options: { value: T; label: string }[];
}) {
    return (
        <fieldset
            className="flex items-center gap-0.5 bg-base-100 border border-base-content/20 rounded-md p-0.5"
            aria-label={label}
        >
            <legend className="sr-only">{label}</legend>
            {options.map((opt) => {
                const checked = opt.value === value;
                return (
                    <label
                        key={opt.value}
                        className={`flex-1 text-[11px] text-center px-2 py-0.5 rounded cursor-pointer transition-all ${
                            checked
                                ? 'bg-primary text-primary-content font-bold shadow-xs'
                                : 'text-base-content/70 hover:bg-base-content/10'
                        }`}
                    >
                        <input
                            type="radio"
                            name={`segmented-${label}`}
                            value={opt.value}
                            checked={checked}
                            onChange={() => onChange(opt.value)}
                            className="sr-only"
                        />
                        {opt.label}
                    </label>
                );
            })}
        </fieldset>
    );
}

export default function ObservabilityFilters({
    timeRange,
    onTimeRangeChange,
    filters,
    onFiltersChange,
    onClearFilters,
    prefixOptions,
    getPrefixColor,
    liveEnabled,
    onToggleLive,
    shownCount,
    totalCount,
    actions,
}: ObservabilityFiltersProps) {
    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (filters.selectedPrefixes.size > 0) count += filters.selectedPrefixes.size;
        if (filters.searchQuery.trim() !== '') count += 1;
        if (filters.severity !== 'all') count += 1;
        if (filters.tierFilter !== 'all') count += 1;
        if (filters.runId.trim() !== '') count += 1;
        return count;
    }, [filters]);

    const hasActiveFilters = isFilterActive(filters);

    const togglePrefix = (prefix: string) => {
        onFiltersChange((prev) => {
            const next = new Set(prev.selectedPrefixes);
            if (next.has(prefix)) next.delete(prefix);
            else next.add(prefix);
            return { ...prev, selectedPrefixes: next };
        });
    };

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-base-200/50 rounded-xl border border-base-content/10">
            {/* Left: Time Range Presets */}
            <fieldset
                className="flex items-center gap-1 bg-base-200 p-1 rounded-lg border-0 m-0"
                aria-label="Time range presets"
            >
                <legend className="sr-only">Time range presets</legend>
                {TIME_RANGES.map((preset) => {
                    const active = timeRange === preset;
                    return (
                        <button
                            key={preset}
                            type="button"
                            onClick={() => onTimeRangeChange(preset)}
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

            {/* Right: Results Count, Filter Popover, Live Stream Toggle, & Custom Actions */}
            <div className="flex flex-wrap items-center gap-2">
                {/* Result count */}
                <span
                    aria-live="polite"
                    className="text-xs font-mono text-base-content/60 whitespace-nowrap"
                    data-testid="observability-result-count"
                >
                    {shownCount} of {totalCount} shown
                </span>

                {/* Filter Disclosure Popover */}
                <details className="relative inline-block" data-testid="observability-filter-disclosure">
                    <summary
                        className="px-2.5 py-1 text-xs font-medium rounded-lg border border-base-content/20 bg-base-200 text-base-content/80 hover:bg-base-300 transition-colors cursor-pointer list-none flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40"
                        aria-label="Toggle filter panel"
                    >
                        <span>🔍 Filter</span>
                        {activeFilterCount > 0 && (
                            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-primary text-primary-content">
                                {activeFilterCount}
                            </span>
                        )}
                    </summary>

                    <div className="absolute right-0 top-full z-30 p-3 shadow-xl bg-base-200 border border-base-content/10 rounded-xl w-80 sm:w-96 mt-2 flex flex-col gap-3">
                        <div className="flex items-center justify-between pb-2 border-b border-base-content/10">
                            <span className="text-xs font-bold uppercase tracking-wide text-base-content/70">
                                Filters
                            </span>
                            {hasActiveFilters && (
                                <button
                                    type="button"
                                    onClick={onClearFilters}
                                    className="text-xs text-error hover:underline cursor-pointer"
                                    aria-label="Clear all filters"
                                >
                                    Clear all
                                </button>
                            )}
                        </div>

                        {/* Search + Scope */}
                        <div className="flex flex-col gap-1">
                            <label
                                htmlFor="filter-search-input"
                                className="text-[11px] font-semibold text-base-content/60"
                            >
                                Search
                            </label>
                            <div className="flex items-center gap-1">
                                <select
                                    value={filters.searchScope}
                                    onChange={(e) =>
                                        onFiltersChange((prev) => ({
                                            ...prev,
                                            searchScope: e.target.value as ObservabilityFilterValues['searchScope'],
                                        }))
                                    }
                                    className="bg-base-100 border border-base-content/20 rounded px-2 py-1 text-xs text-base-content focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
                                    aria-label="Search scope"
                                >
                                    <option value="all">all</option>
                                    <option value="name">name</option>
                                    <option value="actor">actor</option>
                                    <option value="payload">payload</option>
                                </select>
                                <Input
                                    id="filter-search-input"
                                    size="sm"
                                    variant="bordered"
                                    placeholder={`Search ${filters.searchScope}…`}
                                    value={filters.searchQuery}
                                    onChange={(e) =>
                                        onFiltersChange((prev) => ({ ...prev, searchQuery: e.target.value }))
                                    }
                                    className="flex-1 input-xs"
                                    aria-label={`Search ${filters.searchScope}`}
                                />
                            </div>
                        </div>

                        {/* Severity */}
                        <div className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold text-base-content/60">Severity</span>
                            <SegmentedToggle
                                label="Severity"
                                value={filters.severity}
                                onChange={(sev) => onFiltersChange((prev) => ({ ...prev, severity: sev }))}
                                options={[
                                    { value: 'all', label: 'All' },
                                    { value: 'info', label: 'Info' },
                                    { value: 'warning', label: 'Warning' },
                                    { value: 'error', label: 'Error' },
                                ]}
                            />
                        </div>

                        {/* Visibility Tier */}
                        <div className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold text-base-content/60">Tier</span>
                            <SegmentedToggle
                                label="Tier"
                                value={filters.tierFilter}
                                onChange={(t) => onFiltersChange((prev) => ({ ...prev, tierFilter: t }))}
                                options={[
                                    { value: 'all', label: 'All' },
                                    { value: 'default', label: 'Default' },
                                    { value: 'diagnostic', label: 'Diagnostic' },
                                ]}
                            />
                        </div>

                        {/* Prefix Filter Pills */}
                        {prefixOptions.length > 0 && (
                            <div className="flex flex-col gap-1">
                                <span className="text-[11px] font-semibold text-base-content/60">Prefix</span>
                                <fieldset
                                    className="flex flex-wrap items-center gap-1.5 border-0 p-0 m-0"
                                    aria-label="Filter by prefix"
                                >
                                    <legend className="sr-only">Filter by prefix</legend>
                                    {prefixOptions.map((prefix) => {
                                        const active = filters.selectedPrefixes.has(prefix);
                                        const colorClass = getPrefixColor(prefix);
                                        return (
                                            <button
                                                key={prefix}
                                                type="button"
                                                role="switch"
                                                aria-checked={active}
                                                aria-label={`Prefix ${prefix}${active ? ' (selected)' : ''}`}
                                                onClick={() => togglePrefix(prefix)}
                                                className={`px-2 py-0.5 rounded-full text-[11px] font-mono border transition-colors cursor-pointer ${
                                                    active
                                                        ? `${colorClass} border-current bg-base-100 font-bold`
                                                        : 'text-base-content/60 border-base-content/20 hover:bg-base-100'
                                                }`}
                                            >
                                                {prefix}.*
                                            </button>
                                        );
                                    })}
                                </fieldset>
                            </div>
                        )}

                        {/* Run ID Filter */}
                        <div className="flex flex-col gap-1">
                            <label
                                htmlFor="filter-run-id-input"
                                className="text-[11px] font-semibold text-base-content/60"
                            >
                                Run ID
                            </label>
                            <Input
                                id="filter-run-id-input"
                                size="sm"
                                variant="bordered"
                                placeholder="Filter by run id…"
                                value={filters.runId}
                                onChange={(e) => onFiltersChange((prev) => ({ ...prev, runId: e.target.value }))}
                                className="w-full input-xs"
                                aria-label="Filter by run id"
                            />
                        </div>
                    </div>
                </details>

                {/* Live Stream Pause/Resume Button */}
                <button
                    type="button"
                    onClick={onToggleLive}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
                        liveEnabled
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'
                            : 'border-amber-500/40 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20'
                    }`}
                    aria-label={liveEnabled ? 'Pause live event stream' : 'Resume live event stream'}
                    aria-pressed={liveEnabled}
                >
                    <span>{liveEnabled ? '⏸ Pause Live' : '▶ Resume Live'}</span>
                </button>

                {/* Optional Actions Slot (e.g. Columns Customizer in Task 0653) */}
                {actions}
            </div>
        </div>
    );
}
