import { useLocation, useNavigate } from 'react-router';
import { DEFAULT_PROJECT_TAB, PROJECT_TABS, type ProjectTabId } from './tabs';

/**
 * URL ⇄ active tab for the Projects module (0840 R3).
 *
 * Active tab comes from the path segment after `projects` — `/board/projects/agents`
 * → `agents` — falling back to {@link DEFAULT_PROJECT_TAB} for an absent or unknown
 * segment. `selectTab` navigates with `{ replace: true }`, preserving the query
 * string (same pattern as `useTaskParams`). The `<route>/*` wildcard in
 * `router.tsx` makes deep links resolve without a router change.
 */
export function useProjectTab(): { activeTab: ProjectTabId; selectTab: (id: ProjectTabId) => void } {
    const location = useLocation();
    const navigate = useNavigate();

    const activeTab = (() => {
        const parts = location.pathname.split('/');
        const idx = parts.indexOf('projects');
        const segment = idx >= 0 ? parts[idx + 1] : undefined;
        return PROJECT_TABS.some((t) => t.id === segment) ? (segment as ProjectTabId) : DEFAULT_PROJECT_TAB;
    })();

    const selectTab = (id: ProjectTabId) => {
        const qs = new URLSearchParams(location.search).toString();
        navigate(`/board/projects/${id}${qs ? `?${qs}` : ''}`, { replace: true });
    };

    return { activeTab, selectTab };
}
