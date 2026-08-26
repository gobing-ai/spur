import { useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import type { TaskListFilters } from './types';

/**
 * Single source of truth for kanban view state held in the URL:
 * - Path-based selection: `/board/tasks/0016` selects task 0016 (preferred for clean URLs)
 * - Query-param fallback: `?selected=0016` also works (legacy compat)
 * - Filters: `?folder=&status=&feature=&parent=&assignee=` drive the board filters (R6 — shareable URLs)
 *
 * Board and TaskDetail are sibling components under BoardLayout with no shared React
 * state, so the URL is the seam that links a card click to the detail panel.
 */
export function useTaskParams() {
    const [params, setParams] = useSearchParams();
    const location = useLocation();
    const navigate = useNavigate();

    // Derive selected WBS: path segment takes priority, then query param.
    const selected = useMemo(() => {
        const parts = location.pathname.split('/');
        const tasksIdx = parts.indexOf('tasks');
        const pathWbs = tasksIdx >= 0 ? parts[tasksIdx + 1] : undefined;
        if (pathWbs && /^\d{4}$/.test(pathWbs)) return pathWbs;
        return params.get('selected');
    }, [location.pathname, params]);

    const filters = useMemo<TaskListFilters>(() => {
        const f: TaskListFilters = {};
        const status = params.get('status');
        const featureId = params.get('feature');
        const parentWbs = params.get('parent');
        const assignee = params.get('assignee');
        const folder = params.get('folder');
        if (status !== null) f.status = status;
        if (featureId) f.featureId = featureId;
        if (parentWbs) f.parentWbs = parentWbs;
        if (assignee) f.assignee = assignee;
        if (folder) f.folder = folder;
        return f;
    }, [params]);

    const selectTask = (wbs: string | null) => {
        // Build the target path with existing filter query params preserved
        const next = new URLSearchParams(params);
        next.delete('selected'); // Always clean up the legacy query param
        const qs = next.toString();
        const basePath = wbs ? `/board/tasks/${wbs}` : '/board/tasks';
        navigate(`${basePath}${qs ? `?${qs}` : ''}`, { replace: true });
    };

    const setFilter = (key: 'folder' | 'status' | 'feature' | 'parent' | 'assignee', value: string | null) => {
        setParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                if (key === 'feature') next.delete('parent');
                if (key === 'parent') next.delete('feature');
                if (value !== null) next.set(key, value);
                else next.delete(key);
                return next;
            },
            { replace: true },
        );
    };

    return { selected, filters, selectTask, setFilter };
}
