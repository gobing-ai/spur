import { TASK_STATUSES } from '@gobing-ai/spur-domain/schema';
import type { TaskListFilters } from './types';

interface Props {
    filters: TaskListFilters;
    onChange: (key: 'status' | 'feature' | 'parent' | 'assignee', value: string | null) => void;
}

/** Board filter bar (R6) — status / feature / parent-WBS / assignee, all reflected in URL query params. */
export default function TaskFilters({ filters, onChange }: Props) {
    return (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-spur-border">
            <select
                aria-label="Filter by status"
                className="select select-xs select-bordered"
                value={filters.status ?? ''}
                onChange={(e) => onChange('status', e.target.value || null)}
            >
                <option value="">All statuses</option>
                {(TASK_STATUSES as readonly string[]).map((s) => (
                    <option key={s} value={s}>
                        {s}
                    </option>
                ))}
            </select>
            <input
                aria-label="Filter by feature"
                type="text"
                placeholder="Feature"
                className="input input-xs input-bordered w-28"
                value={filters.featureId ?? ''}
                onChange={(e) => onChange('feature', e.target.value || null)}
            />
            <input
                aria-label="Filter by parent WBS"
                type="text"
                placeholder="Parent WBS"
                className="input input-xs input-bordered w-28"
                value={filters.parentWbs ?? ''}
                onChange={(e) => onChange('parent', e.target.value || null)}
            />
            <input
                aria-label="Filter by assignee"
                type="text"
                placeholder="Assignee"
                className="input input-xs input-bordered w-28"
                value={filters.assignee ?? ''}
                onChange={(e) => onChange('assignee', e.target.value || null)}
            />
        </div>
    );
}
