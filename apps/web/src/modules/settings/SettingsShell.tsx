import ModuleIcon from '../../components/ModuleIcon';
import { ModuleHeader, ModuleShell, ModuleTabs } from '../../components/module-kit';
import { SETTINGS_TABS } from './tabs';
import { useSettingsTab } from './useSettingsTab';

/**
 * Settings board module shell.
 *
 * Renders through the module kit (A81/A83 1426): `ModuleShell` owns the rail and padding,
 * `ModuleHeader` the one `h1` + tab strip, so this module carries no header markup of its own.
 * Tabs stay URL-driven through {@link useSettingsTab}; the kit strip keeps the arrow-key nav.
 */
export default function SettingsShell() {
    const { activeTab, selectTab } = useSettingsTab();
    const active = SETTINGS_TABS.find((t) => t.id === activeTab) ?? SETTINGS_TABS[0];
    const Active = active?.component;

    return (
        <ModuleShell className="settings h-full overflow-hidden" data-settings-shell>
            <ModuleHeader
                icon={<ModuleIcon id="settings" size="lg" className="h-7 w-7 text-spur-accent" aria-hidden="true" />}
                title="Settings"
                subtitle="System configuration, agent executors, and workspace preferences"
                tabs={
                    <ModuleTabs
                        tabs={SETTINGS_TABS}
                        value={activeTab}
                        onChange={(id) => selectTab(id as typeof activeTab)}
                        label="Settings tabs"
                        idPrefix="settings-tab"
                    />
                }
            />

            <div
                role="tabpanel"
                id={`settings-tab-panel-${activeTab}`}
                aria-labelledby={`settings-tab-${activeTab}`}
                className="flex-1 min-h-0 overflow-hidden"
            >
                {Active ? <Active /> : null}
            </div>
        </ModuleShell>
    );
}
