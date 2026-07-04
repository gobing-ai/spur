import { useState } from 'react';
import { OBSERVABILITY_TABS, type ObservabilityTab } from './tabs';

/**
 * Shell for the observability board module (task 0189 R6).
 *
 * The shell is intentionally dumb: it owns the active-tab state and renders
 * the matching component from the `OBSERVABILITY_TABS` data array. Adding a
 * new tab (Jobs from 0190, Process List from 0195) is a one-line change in
 * `tabs.ts` — the shell does not need to be touched.
 */
export default function ObservabilityShell() {
    const [activeId, setActiveId] = useState<string>(OBSERVABILITY_TABS[0]?.id ?? '');
    const active: ObservabilityTab | undefined = OBSERVABILITY_TABS.find((t) => t.id === activeId);
    const Active = active?.component;

    return (
        <div className="flex flex-col h-full overflow-hidden" data-observability-shell>
            <div
                role="tablist"
                aria-label="Observability tabs"
                className="flex items-center gap-1 px-2 py-1 border-b border-spur-border bg-base-200 shrink-0"
            >
                {OBSERVABILITY_TABS.map((tab) => {
                    const selected = tab.id === activeId;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={selected}
                            aria-controls={`observability-tab-panel-${tab.id}`}
                            id={`observability-tab-${tab.id}`}
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
                id={`observability-tab-panel-${activeId}`}
                aria-labelledby={`observability-tab-${activeId}`}
                className="flex-1 overflow-hidden"
            >
                {Active ? <Active /> : null}
            </div>
        </div>
    );
}
