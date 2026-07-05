import type React from 'react';
import { Input } from '@/ui';
import type { TaskListFilters } from './types';

type FilterKey = 'feature' | 'parent' | 'assignee';

interface Props {
    filters: TaskListFilters;
    onChange: (key: 'status' | 'feature' | 'parent' | 'assignee', value: string | null) => void;
}

/** Per-input config — `field` is the key in {@link TaskListFilters}. */
const INPUTS: Array<{ key: FilterKey; field: keyof TaskListFilters; label: string; placeholder: string }> = [
    { key: 'feature', field: 'featureId', label: 'Filter by feature', placeholder: 'Feature' },
    { key: 'parent', field: 'parentWbs', label: 'Filter by parent WBS', placeholder: 'Parent WBS' },
    { key: 'assignee', field: 'assignee', label: 'Filter by assignee', placeholder: 'Assignee' },
];

/** Board filter bar — feature / parent-WBS / assignee. Status is controlled by the lane toggle group. */
export default function TaskFilters({ filters, onChange }: Props) {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(e.currentTarget.dataset.key as FilterKey, e.currentTarget.value || null);
    };
    return (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-spur-border">
            {INPUTS.map((input) => (
                <Input
                    key={input.key}
                    aria-label={input.label}
                    data-key={input.key}
                    type="text"
                    placeholder={input.placeholder}
                    variant="bordered"
                    size="xs"
                    className="w-28"
                    value={filters[input.field] ?? ''}
                    onChange={handleChange}
                />
            ))}
        </div>
    );
}
