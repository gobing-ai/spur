import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { TaskListFilters } from './types';

/**
 * Single source of truth for kanban view state held in the URL query string:
 * `?selected=<wbs>` drives the right-panel detail selection, and
 * `?status=&feature=&parent=&assignee=` drive the board filters (R6 — shareable URLs).
 *
 * Board and TaskDetail are sibling components under BoardLayout with no shared React
 * state, so the URL is the seam that links a card click to the detail panel.
 */
export function useTaskParams() {
    const [params, setParams] = useSearchParams();

    const selected = params.get('selected');

    const filters = useMemo<TaskListFilters>(() => {
        const f: TaskListFilters = {};
        const status = params.get('status');
        const featureId = params.get('feature');
        const parentWbs = params.get('parent');
        const assignee = params.get('assignee');
        if (status) f.status = status;
        if (featureId) f.featureId = featureId;
        if (parentWbs) f.parentWbs = parentWbs;
        if (assignee) f.assignee = assignee;
        return f;
    }, [params]);

    const selectTask = (wbs: string | null) => {
        setParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                if (wbs) next.set('selected', wbs);
                else next.delete('selected');
                return next;
            },
            { replace: true },
        );
    };

    const setFilter = (key: 'status' | 'feature' | 'parent' | 'assignee', value: string | null) => {
        setParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                if (value) next.set(key, value);
                else next.delete(key);
                return next;
            },
            { replace: true },
        );
    };

    return { selected, filters, selectTask, setFilter };
}
