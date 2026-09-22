import type { ComponentType } from 'react';
import ConversationView from './ConversationView';
import ProcessesView from './ProcessesView';

/** Tab contract for the Projects module (0840 R3). */
export type ProjectTabId = 'conversation' | 'processes';

export interface ProjectTab {
    id: ProjectTabId;
    label: string;
    component: ComponentType;
}

export const DEFAULT_PROJECT_TAB: ProjectTabId = 'conversation';

/** Projects tabs: Conversation, Processes (frozen order). Tasks and Features are their own modules. */
export const PROJECT_TABS: readonly ProjectTab[] = [
    { id: 'conversation', label: 'Conversation', component: ConversationView },
    { id: 'processes', label: 'Processes', component: ProcessesView },
];
