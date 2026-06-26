import { Input } from '@/ui';
import type { TaskListFilters } from './types';

interface Props {
    filters: TaskListFilters;
    onChange: (key: 'status' | 'feature' | 'parent' | 'assignee', value: string | null) => void;
}

/** Board filter bar — feature / parent-WBS / assignee. Status is controlled by the lane toggle group. */
export default function TaskFilters({ filters, onChange }: Props) {
    return (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-spur-border">
            <Input
                aria-label="Filter by feature"
                type="text"
                placeholder="Feature"
                variant="bordered"
                size="xs"
                className="w-28"
                value={filters.featureId ?? ''}
                onChange={(e) => onChange('feature', e.target.value || null)}
            />
            <Input
                aria-label="Filter by parent WBS"
                type="text"
                placeholder="Parent WBS"
                variant="bordered"
                size="xs"
                className="w-28"
                value={filters.parentWbs ?? ''}
                onChange={(e) => onChange('parent', e.target.value || null)}
            />
            <Input
                aria-label="Filter by assignee"
                type="text"
                placeholder="Assignee"
                variant="bordered"
                size="xs"
                className="w-28"
                value={filters.assignee ?? ''}
                onChange={(e) => onChange('assignee', e.target.value || null)}
            />
        </div>
    );
}
