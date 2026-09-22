import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { PROJECT_TABS } from './tabs';
import type { OrchestratorState, ProjectFleetSnapshot } from './useProjectContext';
import { useProjectContext } from './useProjectContext';
import { useProjectTab } from './useProjectTab';

/**
 * The dominant header state, first match wins (0840 R5). Facts render
 * simultaneously on their own lines; this attribute names the first degraded
 * fact so tests can snapshot the header per fixture.
 */
type ProjectsHeaderState =
    | 'loading'
    | 'unresolvable'
    | 'fleet-unavailable'
    | OrchestratorState
    | 'no-fleet'
    | 'capacity-missing'
    | 'strategy-unavailable'
    | 'ready';

function headerState(context: {
    state: 'loading' | 'ready' | 'unresolvable';
    fleet: ProjectFleetSnapshot | null;
}): ProjectsHeaderState {
    if (context.state === 'loading') return 'loading';
    if (context.state === 'unresolvable') return 'unresolvable';
    if (context.fleet === null) return 'fleet-unavailable';
    const { orchestrator, capacity, strategy } = context.fleet;
    if (orchestrator.state !== 'bound-online') return orchestrator.state;
    if (capacity.total === 0) return 'no-fleet';
    if (capacity.missing.length > 0) return 'capacity-missing';
    if (strategy === null) return 'strategy-unavailable';
    return 'ready';
}

/**
 * Projects board module shell.
 *
 * Header displays standard module framing (matching Histories) with title,
 * description, and tabs placed in the top-right corner.
 */
export default function ProjectsShell() {
    const project = useProjectContext();
    const { activeTab, selectTab } = useProjectTab();
    const active = PROJECT_TABS.find((t) => t.id === activeTab) ?? PROJECT_TABS[0];
    const Active = active?.component;
    const stateAttr = headerState(project);

    // R7 (0845): tabs are keyboard-navigable — ArrowLeft/ArrowRight move the
    // active tab (wrapping) and move focus with it; Tab/Enter keep working via
    // the native buttons.
    const onTablistKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const idx = PROJECT_TABS.findIndex((t) => t.id === activeTab);
        const delta = e.key === 'ArrowRight' ? 1 : -1;
        const next = PROJECT_TABS[(idx + delta + PROJECT_TABS.length) % PROJECT_TABS.length];
        if (!next) return;
        e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[PROJECT_TABS.indexOf(next)]?.focus();
        selectTab(next.id);
    };

    return (
        <div
            className="projects flex flex-col h-full gap-4 p-4 max-w-[1600px] mx-auto w-full overflow-hidden"
            data-projects-shell
        >
            {/* Header & Tab Navigation Bar */}
            <div
                className="flex flex-wrap items-center justify-between gap-4 border-b border-base-content/10 pb-3 shrink-0"
                data-projects-header
                data-projects-state={stateAttr}
            >
                <div className="flex items-center gap-3">
                    <span className="text-2xl" aria-hidden="true">
                        📁
                    </span>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight">Projects</h1>
                        <p className="text-xs text-base-content/60">Conversation and processes for this project</p>
                    </div>
                </div>

                {/* Tab Strip */}
                <div
                    role="tablist"
                    aria-label="Projects tabs"
                    onKeyDown={onTablistKeyDown}
                    className="flex items-center gap-1 bg-base-300 p-1 rounded-xl"
                >
                    {PROJECT_TABS.map((tab) => {
                        const selected = tab.id === activeTab;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                aria-controls={`projects-tab-panel-${tab.id}`}
                                id={`projects-tab-${tab.id}`}
                                onClick={() => selectTab(tab.id)}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                                    selected
                                        ? 'bg-primary text-primary-content font-bold shadow-sm'
                                        : 'text-base-content/70 hover:bg-base-content/10'
                                }`}
                                data-projects-tab={tab.id}
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
                id={`projects-tab-panel-${activeTab}`}
                aria-labelledby={`projects-tab-${activeTab}`}
                className="flex-1 min-h-0 overflow-hidden"
            >
                {Active ? <Active /> : null}
            </div>
        </div>
    );
}
