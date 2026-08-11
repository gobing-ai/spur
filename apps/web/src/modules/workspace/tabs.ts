import type { ComponentType } from 'react';
import InboxShell from '../inbox/InboxShell';
import { TaskKanbanView } from '../task-kanban';
import TeamsShell from '../teams/TeamsShell';
import OverviewTab from './OverviewTab';

/** Tab contract for the Workspace module (task 0197 R5/R6). */
export interface WorkspaceTab {
    readonly id: string;
    readonly label: string;
    /** Rendered with the selected `teamId` scope. */
    readonly component: ComponentType<{ teamId?: string }>;
}

/** v1 Workspace tabs: Overview, Team, Inbox, Tasks (project-local Kanban). */
export const WORKSPACE_TABS: readonly WorkspaceTab[] = [
    { id: 'overview', label: 'Overview', component: OverviewTab },
    { id: 'team', label: 'Team', component: TeamsShell },
    { id: 'inbox', label: 'Inbox', component: InboxShell },
    { id: 'tasks', label: 'Tasks', component: TaskKanbanView },
];
