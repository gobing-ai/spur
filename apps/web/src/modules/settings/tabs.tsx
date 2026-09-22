import type { ComponentType } from 'react';
import AgentsView from './AgentsView';

/** Tab contract for the Settings module. */
export type SettingsTabId = 'agents';

export interface SettingsTab {
    id: SettingsTabId;
    label: string;
    component: ComponentType;
}

export const DEFAULT_SETTINGS_TAB: SettingsTabId = 'agents';

export const SETTINGS_TABS: readonly SettingsTab[] = [{ id: 'agents', label: 'Agents', component: AgentsView }];
