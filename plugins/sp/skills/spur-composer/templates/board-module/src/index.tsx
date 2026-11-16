import type { BoardModuleContribution } from '@gobing-ai/spur/board';
import { EmptyState, ModuleHeader, ModuleShell, ModuleTabs } from '@gobing-ai/spur/board/ui';
import { useState } from 'react';
import './module.css';

/** The module's views. Append-only: the tab strip and saved UI state key on `id`. */
const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'settings', label: 'Settings' },
] as const;

/**
 * Replace this with your module's first view.
 *
 * The shell (header, tabs, states) comes from the host's UI kit; module-private content and its
 * scoped stylesheet are yours. Nothing here ships Tailwind or host CSS — the Board's stylesheet
 * already carries every kit class.
 */
function Overview() {
    return <EmptyState testId="starter-empty">Nothing here yet — replace this view with your module.</EmptyState>;
}

function Settings() {
    return <p className="starter-note">Module settings belong here.</p>;
}

/** The module surface a contribution renders at its Board route. */
function StarterModule() {
    const [tab, setTab] = useState<string>(TABS[0].id);
    return (
        // `data-starter-module` is the module's own hook for its stylesheet and tests; the
        // shell forwards arbitrary attributes, so a module keeps its own marker.
        <ModuleShell data-starter-module>
            <ModuleHeader
                icon={<span aria-hidden="true">◆</span>}
                title="Starter module"
                subtitle="Built from the shared Board UI kit"
                tabs={
                    <ModuleTabs
                        tabs={TABS}
                        value={tab}
                        onChange={setTab}
                        label="Starter module tabs"
                        idPrefix="starter-tab"
                    />
                }
            />
            <div role="tabpanel" id={`starter-tab-panel-${tab}`} aria-labelledby={`starter-tab-${tab}`}>
                {tab === 'settings' ? <Settings /> : <Overview />}
            </div>
        </ModuleShell>
    );
}

/** The only export the Board requires: the declaration shape it reads from your entry. */
export const webModule: BoardModuleContribution = {
    apiVersion: 1,
    component: StarterModule,
};
