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

/** Orchestrator availability by its own name (0840 R5 state 2). */
function orchestratorText(fleet: ProjectFleetSnapshot): string {
    switch (fleet.orchestrator.state) {
        case 'bound-online':
            return `online${fleet.orchestrator.instanceId ? ` — ${fleet.orchestrator.instanceId}` : ''}`;
        case 'bound-offline':
            return 'bound but not responding';
        case 'missing':
            return 'no orchestrator bound';
        case 'unresolvable':
            return `unresolvable${fleet.orchestrator.reason ? ` — ${fleet.orchestrator.reason}` : ''}`;
    }
}

/**
 * Projects board module shell (0840).
 *
 * Renders the SERVED project directly — one server instance serves one project;
 * the switcher navigates between servers. Header names the project/worktree,
 * strategy, orchestrator availability, and fleet capacity; every degraded fact
 * is named, never rendered as an empty shell (R5). Tabs mount in every state.
 */
export default function ProjectsShell() {
    const project = useProjectContext();
    const { activeTab, selectTab } = useProjectTab();
    const active = PROJECT_TABS.find((t) => t.id === activeTab) ?? PROJECT_TABS[0];
    const Active = active?.component;
    const stateAttr = headerState(project);
    const fleet = project.fleet;

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
        <div className="projects flex flex-col h-full overflow-hidden bg-spur-bg" data-projects-shell>
            <div
                className="px-4 py-2 border-b border-spur-border bg-spur-surface shrink-0 flex flex-col gap-1"
                data-projects-header
                data-projects-state={stateAttr}
            >
                {project.state === 'unresolvable' ? (
                    <div className="text-xs">
                        <span className="font-semibold text-spur-text">Project path unavailable</span>
                        <span className="text-spur-text-muted">
                            {' '}
                            — the server did not report this project's worktree path; project-scoped state stays
                            unloaded.
                        </span>
                    </div>
                ) : (
                    <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-sm font-semibold text-spur-text shrink-0">
                            {project.name || 'Projects'}
                        </span>
                        <span className="text-xs text-spur-text-muted font-mono">{project.path}</span>
                    </div>
                )}
                {project.state !== 'unresolvable' && fleet === null && (
                    <div className="text-xs text-spur-text-muted">Fleet status unavailable</div>
                )}
                {fleet !== null && (
                    <>
                        <div className="text-xs text-spur-text-muted">
                            Orchestrator: <span className="text-spur-text">{orchestratorText(fleet)}</span>
                        </div>
                        <div className="text-xs text-spur-text-muted">
                            Fleet:{' '}
                            {fleet.capacity.total === 0 ? (
                                <span className="text-spur-text">
                                    no fleet declared — expected{' '}
                                    <code className="font-mono">{`${project.path ?? 'this project'}/.spur/fleet.json`}</code>
                                </span>
                            ) : (
                                <span className="text-spur-text">
                                    {fleet.capacity.total} member{fleet.capacity.total === 1 ? '' : 's'} ·{' '}
                                    {fleet.capacity.enabled} enabled · {fleet.capacity.writeCapable} write-capable
                                    {fleet.capacity.missing.length > 0
                                        ? ` · unresolved: ${fleet.capacity.missing.join(', ')}`
                                        : ''}
                                </span>
                            )}
                        </div>
                        <div className="text-xs text-spur-text-muted">
                            Strategy:{' '}
                            {fleet.strategy === null ? (
                                <span className="text-spur-text">strategy unavailable</span>
                            ) : (
                                <span className="text-spur-text">
                                    {fleet.strategy.name} (v{fleet.strategy.version})
                                </span>
                            )}
                        </div>
                    </>
                )}
            </div>
            <div
                role="tablist"
                aria-label="Projects tabs"
                onKeyDown={onTablistKeyDown}
                className="flex items-center gap-1 px-2 py-1 border-b border-spur-border bg-spur-surface shrink-0"
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
                            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                                selected
                                    ? 'bg-spur-accent text-white'
                                    : 'text-spur-text-muted hover:text-spur-text hover:bg-spur-surface-3'
                            }`}
                            data-projects-tab={tab.id}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>
            <div
                role="tabpanel"
                id={`projects-tab-panel-${activeTab}`}
                aria-labelledby={`projects-tab-${activeTab}`}
                className="flex-1 overflow-hidden"
            >
                {Active ? <Active /> : null}
            </div>
        </div>
    );
}
