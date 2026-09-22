import type { ComponentType } from 'react';
import AgentsView from './AgentsView';
import GeneralView from './GeneralView';

/** Tab contract for the Settings module. */
export type SettingsTabId = 'general' | 'agents';

export interface SettingsTab {
    id: SettingsTabId;
    label: string;
    component: ComponentType;
}

export const DEFAULT_SETTINGS_TAB: SettingsTabId = 'general';

export const SETTINGS_TABS: readonly SettingsTab[] = [
    { id: 'general', label: 'General', component: GeneralView },
    { id: 'agents', label: 'Agents', component: AgentsView },
];
