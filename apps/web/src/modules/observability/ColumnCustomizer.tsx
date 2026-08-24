import { useMemo } from 'react';
import { Checkbox } from '@/ui';

export type EventColumnKey =
    | 'time'
    | 'severity'
    | 'event'
    | 'summary'
    | 'correlation'
    | 'outcome'
    | 'agent'
    | 'producer'
    | 'action'
    | 'actor';

export interface ColumnDefinition {
    key: EventColumnKey;
    label: string;
    description: string;
    defaultVisible: boolean;
    sortable: boolean;
    colWidth: string;
}

export const ALL_COLUMNS: readonly ColumnDefinition[] = [
    {
        key: 'time',
        label: 'Time',
        description: 'Event timestamp',
        defaultVisible: true,
        sortable: true,
        colWidth: 'w-36',
    },
    {
        key: 'severity',
        label: 'Severity',
        description: 'Diagnostic severity level',
        defaultVisible: true,
        sortable: true,
        colWidth: 'w-24',
    },
    {
        key: 'event',
        label: 'Event',
        description: 'Event name with domain prefix',
        defaultVisible: true,
        sortable: true,
        colWidth: 'w-[15%]',
    },
    {
        key: 'summary',
        label: 'Summary',
        description: 'Rendered human summary',
        defaultVisible: true,
        sortable: true,
        colWidth: 'w-[20%]',
    },
    {
        key: 'correlation',
        label: 'Correlation',
        description: 'Entity or run correlation identifier',
        defaultVisible: true,
        sortable: true,
        colWidth: 'w-[16%]',
    },
    {
        key: 'outcome',
        label: 'Outcome',
        description: 'Execution result or state change',
        defaultVisible: true,
        sortable: true,
        colWidth: 'w-28',
    },
    {
        key: 'agent',
        label: 'Agent',
        description: 'Target or actor agent role',
        defaultVisible: false,
        sortable: true,
        colWidth: 'w-28',
    },
    {
        key: 'producer',
        label: 'Producer',
        description: 'Subsystem or source package',
        defaultVisible: false,
        sortable: false,
        colWidth: 'w-[16%]',
    },
    {
        key: 'action',
        label: 'Action',
        description: 'Action link or remediation command',
        defaultVisible: false,
        sortable: false,
        colWidth: 'w-[15%]',
    },
    {
        key: 'actor',
        label: 'Actor',
        description: 'Originating user or system actor',
        defaultVisible: false,
        sortable: false,
        colWidth: 'w-24',
    },
] as const;

export const KNOWN_COLUMN_KEYS = new Set<EventColumnKey>(ALL_COLUMNS.map((c) => c.key));

export const DEFAULT_VISIBLE_COLUMNS: readonly EventColumnKey[] = [
    'time',
    'severity',
    'event',
    'summary',
    'correlation',
    'outcome',
];

export const STORAGE_KEY_COLUMNS = 'spur:observability:columns:v1';

/**
 * Validate and normalize stored column keys.
 * Preserves canonical order from ALL_COLUMNS, discards duplicates and unknown keys.
 * Falls back to DEFAULT_VISIBLE_COLUMNS if input is invalid or empty.
 */
export function validateColumnKeys(raw: unknown): EventColumnKey[] {
    if (!Array.isArray(raw) || raw.length === 0) {
        return [...DEFAULT_VISIBLE_COLUMNS];
    }
    const selected = new Set<string>();
    for (const item of raw) {
        if (typeof item === 'string' && KNOWN_COLUMN_KEYS.has(item as EventColumnKey)) {
            selected.add(item);
        }
    }
    if (selected.size === 0) {
        return [...DEFAULT_VISIBLE_COLUMNS];
    }
    // Return in canonical order
    return ALL_COLUMNS.filter((col) => selected.has(col.key)).map((col) => col.key);
}

export function loadVisibleColumns(storage?: Storage): EventColumnKey[] {
    try {
        const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
        if (!store) return [...DEFAULT_VISIBLE_COLUMNS];
        const rawJson = store.getItem(STORAGE_KEY_COLUMNS);
        if (!rawJson) return [...DEFAULT_VISIBLE_COLUMNS];
        const parsed = JSON.parse(rawJson);
        return validateColumnKeys(parsed);
    } catch {
        return [...DEFAULT_VISIBLE_COLUMNS];
    }
}

export function saveVisibleColumns(cols: EventColumnKey[], storage?: Storage): void {
    try {
        const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
        if (!store) return;
        store.setItem(STORAGE_KEY_COLUMNS, JSON.stringify(cols));
    } catch {
        // Storage errors ignored silently
    }
}

export interface ColumnCustomizerProps {
    visibleColumns: EventColumnKey[];
    onVisibleColumnsChange: (next: EventColumnKey[]) => void;
}

export default function ColumnCustomizer({ visibleColumns, onVisibleColumnsChange }: ColumnCustomizerProps) {
    const visibleSet = useMemo(() => new Set(visibleColumns), [visibleColumns]);

    const handleToggle = (key: EventColumnKey) => {
        const nextSet = new Set(visibleSet);
        if (nextSet.has(key)) {
            // Cannot deselect last remaining column
            if (nextSet.size <= 1) return;
            nextSet.delete(key);
        } else {
            nextSet.add(key);
        }
        const nextCols = ALL_COLUMNS.filter((col) => nextSet.has(col.key)).map((col) => col.key);
        onVisibleColumnsChange(nextCols);
        saveVisibleColumns(nextCols);
    };

    const handleReset = () => {
        const nextCols = [...DEFAULT_VISIBLE_COLUMNS];
        onVisibleColumnsChange(nextCols);
        saveVisibleColumns(nextCols);
    };

    return (
        <details className="relative inline-block" data-testid="observability-column-customizer">
            <summary
                className="px-2.5 py-1 text-xs font-medium rounded-lg border border-base-content/20 bg-base-200 text-base-content/80 hover:bg-base-300 transition-colors cursor-pointer list-none flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label="Customize visible columns"
            >
                <span>📊 Columns</span>
                <span className="text-[10px] text-base-content/60 font-mono">
                    ({visibleColumns.length}/{ALL_COLUMNS.length})
                </span>
            </summary>

            <div className="absolute right-0 top-full z-30 p-3 shadow-xl bg-base-200 border border-base-content/10 rounded-xl w-64 mt-2 flex flex-col gap-2">
                <div className="flex items-center justify-between pb-2 border-b border-base-content/10">
                    <span className="text-xs font-bold uppercase tracking-wide text-base-content/70">Columns</span>
                    <button
                        type="button"
                        onClick={handleReset}
                        className="text-xs text-primary hover:underline cursor-pointer"
                        aria-label="Reset columns to default"
                    >
                        Reset defaults
                    </button>
                </div>

                <fieldset className="flex flex-col gap-1.5 border-0 p-0 m-0" aria-label="Visible columns">
                    <legend className="sr-only">Select visible columns</legend>
                    {ALL_COLUMNS.map((col) => {
                        const checked = visibleSet.has(col.key);
                        const isOnlyOne = checked && visibleSet.size === 1;
                        const inputId = `observability-col-${col.key}`;
                        return (
                            <label
                                key={col.key}
                                htmlFor={inputId}
                                className={`flex items-center justify-between px-2 py-1 rounded-md text-xs transition-colors ${
                                    isOnlyOne
                                        ? 'opacity-60 cursor-not-allowed'
                                        : 'hover:bg-base-100 cursor-pointer text-base-content/90'
                                }`}
                            >
                                <span className="flex items-center gap-2">
                                    <Checkbox
                                        id={inputId}
                                        size="xs"
                                        variant="primary"
                                        checked={checked}
                                        disabled={isOnlyOne}
                                        onChange={() => handleToggle(col.key)}
                                        aria-label={col.label}
                                    />
                                    <span className="font-medium">{col.label}</span>
                                </span>
                                {col.defaultVisible && (
                                    <span className="text-[10px] text-base-content/50 uppercase">default</span>
                                )}
                            </label>
                        );
                    })}
                </fieldset>
            </div>
        </details>
    );
}
