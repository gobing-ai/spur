import type { ComponentType } from 'react';
import AgentsView from './AgentsView';
import ConversationView from './ConversationView';
import ProcessesView from './ProcessesView';

/** Tab contract for the Projects module (0840 R3). */
export type ProjectTabId = 'conversation' | 'agents' | 'processes';

export interface ProjectTab {
    id: ProjectTabId;
    label: string;
    component: ComponentType;
}

export const DEFAULT_PROJECT_TAB: ProjectTabId = 'conversation';

/** Projects tabs: Conversation, Agents, Processes (frozen order). Tasks and Features are their own modules. */
export const PROJECT_TABS: readonly ProjectTab[] = [
    { id: 'conversation', label: 'Conversation', component: ConversationView },
    { id: 'agents', label: 'Agents', component: AgentsView },
    { id: 'processes', label: 'Processes', component: ProcessesView },
];
