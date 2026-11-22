import ModuleIcon from '../../components/ModuleIcon';
import { ModuleHeader, ModuleShell, ModuleTabs } from '../../components/module-kit';
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
 * Renders through the module kit (A81/A83 1426) — `ModuleShell` owns the rail, `ModuleHeader` the
 * one `h1`, the degraded-state status node and the tab strip — so this module carries no header
 * markup of its own. Tab ids and URLs stay owned by {@link useProjectTab}.
 */
export default function ProjectsShell() {
    const project = useProjectContext();
    const { activeTab, selectTab } = useProjectTab();
    const active = PROJECT_TABS.find((t) => t.id === activeTab) ?? PROJECT_TABS[0];
    const Active = active?.component;
    const stateAttr = headerState(project);

    return (
        <ModuleShell className="projects h-full overflow-hidden" data-projects-shell>
            <ModuleHeader
                icon={<ModuleIcon id="projects" size="lg" className="h-7 w-7 text-spur-accent" aria-hidden="true" />}
                title="Projects"
                subtitle="Fleet, inbox and database for this project"
                status={
                    <span role="status" className="sr-only" data-projects-state={stateAttr}>
                        {stateAttr}
                    </span>
                }
                tabs={
                    <ModuleTabs
                        tabs={PROJECT_TABS}
                        value={activeTab}
                        onChange={(id) => selectTab(id as typeof activeTab)}
                        label="Projects tabs"
                        idPrefix="projects-tab"
                    />
                }
            />

            {/* Tab Panel */}
            <div
                role="tabpanel"
                id={`projects-tab-panel-${activeTab}`}
                aria-labelledby={`projects-tab-${activeTab}`}
                className="flex-1 min-h-0 overflow-hidden"
            >
                {Active ? <Active /> : null}
            </div>
        </ModuleShell>
    );
}
