import type { ComponentType } from 'react';
import ActivityTab from './ActivityTab';
import MessagesTab from './MessagesTab';
import ProcessesTab from './ProcessesTab';
import SupervisorTab from './SupervisorTab';
import TerminalTab from './TerminalTab';

/** Tab contract for the Teams module (0254 R2). Append-only, id-stable. */
export interface TeamsTab {
    readonly id: string;
    readonly label: string;
    readonly component: ComponentType;
}

/** v1 tabs: Supervisor (default, 0378 R1), Terminal, Processes, Messages, Activity. */
export const TEAMS_TABS: readonly TeamsTab[] = [
    { id: 'supervisor', label: 'Supervisor', component: SupervisorTab },
    { id: 'terminal', label: 'Terminal', component: TerminalTab },
    { id: 'processes', label: 'Process', component: ProcessesTab },
    { id: 'messages', label: 'Message', component: MessagesTab },
    { id: 'activity', label: 'Activity', component: ActivityTab },
];
