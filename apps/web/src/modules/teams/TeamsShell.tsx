import { useState } from 'react';
import { TeamsProvider } from './TeamsContext';
import { TEAMS_TABS, type TeamsTab } from './tabs';

/** Shell for the Teams board module (0254 R1). Mirrors ObservabilityShell. */
export default function TeamsShell() {
    const [activeId, setActiveId] = useState<string>(TEAMS_TABS[0]?.id ?? '');
    const active: TeamsTab | undefined = TEAMS_TABS.find((t) => t.id === activeId);
    const Active = active?.component;

    return (
        <TeamsProvider>
            <div className="flex flex-col h-full overflow-hidden" data-teams-shell>
                <div
                    role="tablist"
                    aria-label="Teams tabs"
                    className="flex items-center gap-1 px-2 py-1 border-b border-spur-border bg-base-200 shrink-0"
                >
                    {TEAMS_TABS.map((tab) => {
                        const selected = tab.id === activeId;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                aria-controls={`teams-tab-panel-${tab.id}`}
                                id={`teams-tab-${tab.id}`}
                                onClick={() => setActiveId(tab.id)}
                                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                                    selected
                                        ? 'bg-spur-accent text-white'
                                        : 'text-spur-text-muted hover:text-spur-text hover:bg-base-300'
                                }`}
                            >
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
                <div
                    role="tabpanel"
                    id={`teams-tab-panel-${activeId}`}
                    aria-labelledby={`teams-tab-${activeId}`}
                    className="flex-1 overflow-hidden"
                >
                    {Active ? <Active /> : null}
                </div>
            </div>
        </TeamsProvider>
    );
}
