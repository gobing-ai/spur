import { useLocation, useNavigate } from 'react-router';
import { DEFAULT_SETTINGS_TAB, SETTINGS_TABS, type SettingsTabId } from './tabs';

/**
 * URL ⇄ active tab for the Settings module.
 *
 * Active tab comes from the path segment after `settings` — `/board/settings/agents`
 * → `agents` — falling back to {@link DEFAULT_SETTINGS_TAB} for an absent or unknown
 * segment. `selectTab` navigates with `{ replace: true }`, preserving the query string.
 */
export function useSettingsTab(): { activeTab: SettingsTabId; selectTab: (id: SettingsTabId) => void } {
    const location = useLocation();
    const navigate = useNavigate();

    const activeTab = (() => {
        const parts = location.pathname.split('/');
        const idx = parts.indexOf('settings');
        const segment = idx >= 0 ? parts[idx + 1] : undefined;
        return SETTINGS_TABS.some((t) => t.id === segment) ? (segment as SettingsTabId) : DEFAULT_SETTINGS_TAB;
    })();

    const selectTab = (id: SettingsTabId) => {
        const qs = new URLSearchParams(location.search).toString();
        navigate(`/board/settings/${id}${qs ? `?${qs}` : ''}`, { replace: true });
    };

    return { activeTab, selectTab };
}
