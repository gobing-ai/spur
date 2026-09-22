import type { WebModule } from '../types';
import SettingsShell from './SettingsShell';

export { default as SettingsShell } from './SettingsShell';

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
