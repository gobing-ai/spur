import type { HistoryFilter } from '@gobing-ai/spur-contracts';
import type React from 'react';
import { useState } from 'react';

export interface HistoryFiltersProps {
    filter: HistoryFilter;
    onChange: (next: HistoryFilter) => void;
    availableSources?: string[];
    availableModels?: string[];
    availableTools?: string[];
    availableSkills?: string[];
}

export const HistoryFilters: React.FC<HistoryFiltersProps> = ({
    filter,
    onChange,
    availableSources = ['claude', 'codex', 'agy', 'omp', 'openclaw', 'hermes', 'grok', 'opencode', 'pi'],
    availableModels = ['claude-opus-4.6', 'claude-sonnet-4.6', 'gpt-5.6-sol', 'grok-4.6', 'other'],
    availableTools = ['Read', 'Bash', 'Edit', 'Grep', 'Write', 'Glob', 'Task', 'WebSearch'],
    availableSkills = ['sp-spur-cli', 'sp-dev-verify', 'sp-dev-run', 'sp-code-verification'],
}) => {
    const [openDropdown, setOpenDropdown] = useState<string | null>(null);

    const handleRangeChange = (range: '24h' | '7d' | '30d' | 'all' | 'custom') => {
        onChange({ ...filter, range });
    };

    const handleBucketChange = (bucket: 'auto' | '5m' | '10m' | '30m' | '1h' | '4h' | '1d') => {
        onChange({ ...filter, bucket });
    };

    const toggleArrayItem = (key: 'sources' | 'models' | 'tools' | 'skills', item: string) => {
        const current = filter[key] || [];
        const next = current.includes(item) ? current.filter((x) => x !== item) : [...current, item];
        onChange({ ...filter, [key]: next.length > 0 ? next : undefined });
    };

    const removeFilter = (key: 'sources' | 'models' | 'tools' | 'skills', item: string) => {
        const current = filter[key] || [];
        const next = current.filter((x) => x !== item);
        onChange({ ...filter, [key]: next.length > 0 ? next : undefined });
    };

    return (
        <div className="flex flex-col gap-2.5 p-3.5 bg-base-200/50 rounded-xl border border-base-content/10 mb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Time Range Presets */}
                <div className="flex items-center gap-1.5 bg-base-300 p-1 rounded-lg">
                    {(['24h', '7d', '30d', 'all'] as const).map((r) => (
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

                {/* Granularity / Bucket Selector */}
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-base-content/70">Granularity:</span>
                    <select
                        aria-label="Granularity"
                        className="px-2 py-1 text-xs rounded border border-base-content/20 bg-base-300 font-mono text-base-content focus:outline-none"
                        value={filter.bucket || 'auto'}
                        onChange={(e) => handleBucketChange((e.target.value as HistoryFilter['bucket']) || 'auto')}
                    >
                        <option value="auto">Auto</option>
                        <option value="5m">5m</option>
                        <option value="10m">10m</option>
                        <option value="30m">30m</option>
                        <option value="1h">1h</option>
                        <option value="4h">4h</option>
                        <option value="1d">1d</option>
                    </select>
                </div>
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

            {/* Multi-Select Dropdowns */}
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-base-content/10">
                {/* Sources */}
                <div className="relative">
                    <button
                        type="button"
                        className="px-2.5 py-1 text-xs rounded border border-base-content/20 hover:bg-base-content/10 font-medium text-base-content"
                        onClick={() => setOpenDropdown(openDropdown === 'sources' ? null : 'sources')}
                    >
                        Agents ({filter.sources?.length ?? 0})
                    </button>
                    {openDropdown === 'sources' && (
                        <div className="absolute left-0 mt-1 z-20 p-2 shadow-lg bg-base-300 rounded-lg border border-base-content/10 w-52 text-xs flex flex-col gap-1">
                            {availableSources.map((src) => (
                                <label
                                    key={src}
                                    className="flex items-center justify-between cursor-pointer py-1 px-1.5 hover:bg-base-200 rounded"
                                >
                                    <span className="capitalize">{src}</span>
                                    <input
                                        type="checkbox"
                                        className="h-3.5 w-3.5 rounded border-base-content/30 text-primary"
                                        checked={filter.sources?.includes(src) ?? false}
                                        onChange={() => toggleArrayItem('sources', src)}
                                    />
                                </label>
                            ))}
                        </div>
                    )}
                </div>

                {/* Models */}
                <div className="relative">
                    <button
                        type="button"
                        className="px-2.5 py-1 text-xs rounded border border-base-content/20 hover:bg-base-content/10 font-medium text-base-content"
                        onClick={() => setOpenDropdown(openDropdown === 'models' ? null : 'models')}
                    >
                        Models ({filter.models?.length ?? 0})
                    </button>
                    {openDropdown === 'models' && (
                        <div className="absolute left-0 mt-1 z-20 p-2 shadow-lg bg-base-300 rounded-lg border border-base-content/10 w-56 text-xs flex flex-col gap-1">
                            {availableModels.map((m) => (
                                <label
                                    key={m}
                                    className="flex items-center justify-between cursor-pointer py-1 px-1.5 hover:bg-base-200 rounded"
                                >
                                    <span className="font-mono text-[11px]">{m}</span>
                                    <input
                                        type="checkbox"
                                        className="h-3.5 w-3.5 rounded border-base-content/30 text-primary"
                                        checked={filter.models?.includes(m) ?? false}
                                        onChange={() => toggleArrayItem('models', m)}
                                    />
                                </label>
                            ))}
                        </div>
                    )}
                </div>

                {/* Tools */}
                <div className="relative">
                    <button
                        type="button"
                        className="px-2.5 py-1 text-xs rounded border border-base-content/20 hover:bg-base-content/10 font-medium text-base-content"
                        onClick={() => setOpenDropdown(openDropdown === 'tools' ? null : 'tools')}
                    >
                        Tools ({filter.tools?.length ?? 0})
                    </button>
                    {openDropdown === 'tools' && (
                        <div className="absolute left-0 mt-1 z-20 p-2 shadow-lg bg-base-300 rounded-lg border border-base-content/10 w-48 text-xs flex flex-col gap-1">
                            {availableTools.map((t) => (
                                <label
                                    key={t}
                                    className="flex items-center justify-between cursor-pointer py-1 px-1.5 hover:bg-base-200 rounded"
                                >
                                    <span className="font-mono text-[11px]">{t}</span>
                                    <input
                                        type="checkbox"
                                        className="h-3.5 w-3.5 rounded border-base-content/30 text-primary"
                                        checked={filter.tools?.includes(t) ?? false}
                                        onChange={() => toggleArrayItem('tools', t)}
                                    />
                                </label>
                            ))}
                        </div>
                    )}
                </div>

                {/* Skills */}
                <div className="relative">
                    <button
                        type="button"
                        className="px-2.5 py-1 text-xs rounded border border-base-content/20 hover:bg-base-content/10 font-medium text-base-content"
                        onClick={() => setOpenDropdown(openDropdown === 'skills' ? null : 'skills')}
                    >
                        Skills ({filter.skills?.length ?? 0})
                    </button>
                    {openDropdown === 'skills' && (
                        <div className="absolute left-0 mt-1 z-20 p-2 shadow-lg bg-base-300 rounded-lg border border-base-content/10 w-56 text-xs flex flex-col gap-1">
                            {availableSkills.map((sk) => (
                                <label
                                    key={sk}
                                    className="flex items-center justify-between cursor-pointer py-1 px-1.5 hover:bg-base-200 rounded"
                                >
                                    <span className="font-mono text-[11px]">{sk}</span>
                                    <input
                                        type="checkbox"
                                        className="h-3.5 w-3.5 rounded border-base-content/30 text-primary"
                                        checked={filter.skills?.includes(sk) ?? false}
                                        onChange={() => toggleArrayItem('skills', sk)}
                                    />
                                </label>
                            ))}
                        </div>
                    )}
                </div>

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
