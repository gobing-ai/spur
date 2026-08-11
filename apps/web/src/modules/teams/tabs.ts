import type { ComponentType } from 'react';
import ActivityTab from './ActivityTab';
import ProcessesTab from './ProcessesTab';
import SupervisorTab from './SupervisorTab';
import TerminalTab from './TerminalTab';

/** Tab contract for the Teams module (0254 R2). Append-only, id-stable. */
export interface TeamsTab {
    readonly id: string;
    readonly label: string;
    /** Optional `teamId` scope (task 0197 R4); omission preserves the global view. */
    readonly component: ComponentType<{ teamId?: string }>;
}

/** v1 tabs: Supervisor (default, 0378 R1), Terminal, Processes, Activity. Messages moved to Inbox (0422 R7). */
export const TEAMS_TABS: readonly TeamsTab[] = [
    { id: 'supervisor', label: 'Supervisor', component: SupervisorTab },
    { id: 'terminal', label: 'Terminal', component: TerminalTab },
    { id: 'processes', label: 'Process', component: ProcessesTab },
    { id: 'activity', label: 'Activity', component: ActivityTab },
];
