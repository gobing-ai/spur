import type { ComponentType } from 'react';
import ActivityTab from './ActivityTab';
import MessagesTab from './MessagesTab';
import RosterTab from './RosterTab';
import TerminalTab from './TerminalTab';

/** Tab contract for the Teams module (0254 R2). Append-only, id-stable. */
export interface TeamsTab {
    readonly id: string;
    readonly label: string;
    readonly component: ComponentType;
}

/** v1 tabs: Roster, Terminal, Messages, Activity (0254 R2). */
export const TEAMS_TABS: readonly TeamsTab[] = [
    { id: 'roster', label: 'Roster', component: RosterTab },
    { id: 'terminal', label: 'Terminal', component: TerminalTab },
    { id: 'messages', label: 'Messages', component: MessagesTab },
    { id: 'activity', label: 'Activity', component: ActivityTab },
];
