import type { ComponentType } from 'react';
import AgentsView from './AgentsView';
import ConversationView from './ConversationView';
import WorkView from './WorkView';

/** Tab contract for the Projects module (0840 R3). */
export type ProjectTabId = 'conversation' | 'agents' | 'work';

export interface ProjectTab {
    id: ProjectTabId;
    label: string;
    component: ComponentType;
}

export const DEFAULT_PROJECT_TAB: ProjectTabId = 'conversation';

/** v1 Projects tabs: Conversation, Agents, Work (frozen order). */
export const PROJECT_TABS: readonly ProjectTab[] = [
    { id: 'conversation', label: 'Conversation', component: ConversationView },
    { id: 'agents', label: 'Agents', component: AgentsView },
    { id: 'work', label: 'Work', component: WorkView },
];
