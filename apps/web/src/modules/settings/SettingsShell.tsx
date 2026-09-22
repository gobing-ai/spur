import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { SETTINGS_TABS } from './tabs';
import { useSettingsTab } from './useSettingsTab';

/**
 * Settings board module shell.
 *
 * Header displays standard module framing (matching Projects, Histories, Observabilities)
 * with title, description, and tabs placed in the top-right corner.
 */
export default function SettingsShell() {
    const { activeTab, selectTab } = useSettingsTab();
    const active = SETTINGS_TABS.find((t) => t.id === activeTab) ?? SETTINGS_TABS[0];
    const Active = active?.component;

    // Tabs are keyboard-navigable — ArrowLeft/ArrowRight move the active tab (wrapping)
    const onTablistKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const idx = SETTINGS_TABS.findIndex((t) => t.id === activeTab);
        const delta = e.key === 'ArrowRight' ? 1 : -1;
        const next = SETTINGS_TABS[(idx + delta + SETTINGS_TABS.length) % SETTINGS_TABS.length];
        if (!next) return;
        e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[SETTINGS_TABS.indexOf(next)]?.focus();
        selectTab(next.id);
    };

    return (
        <div
            className="settings flex flex-col h-full gap-4 p-4 max-w-[1600px] mx-auto w-full overflow-hidden"
            data-settings-shell
        >
            {/* Header & Tab Navigation Bar */}
            <div
                className="flex flex-wrap items-center justify-between gap-4 border-b border-base-content/10 pb-3 shrink-0"
                data-settings-header
            >
                <div className="flex items-center gap-3">
                    <span className="text-2xl" aria-hidden="true">
                        ⚙️
                    </span>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight">Settings</h1>
                        <p className="text-xs text-base-content/60">
                            System configuration, agent executors, and workspace preferences
                        </p>
                    </div>
                </div>

                {/* Tab Strip */}
                <div
                    role="tablist"
                    aria-label="Settings tabs"
                    onKeyDown={onTablistKeyDown}
                    className="flex items-center gap-1 bg-base-300 p-1 rounded-xl"
                >
                    {SETTINGS_TABS.map((tab) => {
                        const selected = tab.id === activeTab;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                aria-controls={`settings-tab-panel-${tab.id}`}
                                id={`settings-tab-${tab.id}`}
                                onClick={() => selectTab(tab.id)}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                                    selected
                                        ? 'bg-primary text-primary-content font-bold shadow-sm'
                                        : 'text-base-content/70 hover:bg-base-content/10'
                                }`}
                                data-settings-tab={tab.id}
                            >
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Tab Panel */}
            <div
                role="tabpanel"
                id={`settings-tab-panel-${activeTab}`}
                aria-labelledby={`settings-tab-${activeTab}`}
                className="flex-1 min-h-0 overflow-hidden"
            >
                {Active ? <Active /> : null}
            </div>
        </div>
    );
}
