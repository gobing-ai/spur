import type { ComponentType } from 'react';
import ActivityTab from './ActivityTab';
import MessagesTab from './MessagesTab';
import ProcessesTab from './ProcessesTab';
import TerminalTab from './TerminalTab';

/** Tab contract for the Teams module (0254 R2). Append-only, id-stable. */
export interface TeamsTab {
    readonly id: string;
    readonly label: string;
    readonly component: ComponentType;
}

/** v1 tabs: Terminal, Processes, Messages, Activity (0262 — Processes added per M1 R5). */
export const TEAMS_TABS: readonly TeamsTab[] = [
    { id: 'terminal', label: 'Terminal', component: TerminalTab },
    { id: 'processes', label: 'Processes', component: ProcessesTab },
    { id: 'messages', label: 'Messages', component: MessagesTab },
    { id: 'activity', label: 'Activity', component: ActivityTab },
];
