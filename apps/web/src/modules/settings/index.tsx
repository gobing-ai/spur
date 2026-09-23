import type { WebModule } from '../types';
import SettingsShell from './SettingsShell';

export { default as AgentsView } from './AgentsView';
export { default as GeneralView } from './GeneralView';
export { default as SettingsShell } from './SettingsShell';
export { default as WorkflowsView } from './WorkflowsView';
export { default as YamlViewer } from './YamlViewer';

/**
 * Settings board module.
 *
 * System-level configuration: Agent executors, roles, pipeline stages, and workspace preferences.
 * Auto-discovered by `apps/web/src/modules/discover.ts`.
 */
export const module: WebModule = {
    id: 'settings',
    name: 'Settings',
    icon: '⚙️',
    route: 'settings',
    component: SettingsShell,
    sidebarLabel: 'Settings',
    description: 'System configuration, agent executors, and workspace preferences',
    order: 50,
};
