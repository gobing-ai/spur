import type { ComponentType } from 'react';
import DatabaseView from './DatabaseView';
import InboxView from './InboxView';
import ProcessesView from './ProcessesView';

/** Tab contract for the Projects module (0840 R3). */
export type ProjectTabId = 'fleet' | 'inbox' | 'database';

export interface ProjectTab {
    id: ProjectTabId;
    label: string;
    component: ComponentType;
}

export const DEFAULT_PROJECT_TAB: ProjectTabId = 'fleet';

/** Projects tabs: Fleet, Inbox, Database. Tasks and Features are their own modules. */
export const PROJECT_TABS: readonly ProjectTab[] = [
    { id: 'fleet', label: 'Fleet', component: ProcessesView },
    { id: 'inbox', label: 'Inbox', component: InboxView },
    { id: 'database', label: 'Database', component: DatabaseView },
];
