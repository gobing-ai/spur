import type { ComponentType } from 'react';
import InsightsTab from './InsightsTab';
import SessionsTab from './SessionsTab';
import SourcesTab from './SourcesTab';
import SummaryTab from './SummaryTab';
import TimelineTab from './TimelineTab';

/**
 * Tab contract for the History board module (task 0626 R1).
 *
 * Append-only contract: never reorder or rename an entry - the board's tab
 * strip and any persisted user state (e.g. last-selected tab) key on the id.
 */
export interface HistoryTab {
    readonly id: string;
    readonly label: string;
    readonly component: ComponentType;
}

/** Built-in tabs shipped in v1 of the History module. */
export const HISTORY_TABS: readonly HistoryTab[] = [
    { id: 'summary', label: 'Summary', component: SummaryTab },
    { id: 'timeline', label: 'Timeline', component: TimelineTab },
    { id: 'sessions', label: 'Sessions', component: SessionsTab },
    { id: 'insights', label: 'Insights', component: InsightsTab },
    { id: 'sources', label: 'Sources', component: SourcesTab },
];
