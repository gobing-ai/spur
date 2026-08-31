import type { ComponentType } from 'react';
import InsightsTab from './InsightsTab';
import SessionsTab from './SessionsTab';
import SourcesTab from './SourcesTab';
import SummaryTab from './SummaryTab';
import TimelineTab from './TimelineTab';
import ToolUsingTab from './ToolUsingTab';

/**
 * Tab contract for the History board module (task 0626 R1, task 0725 R1).
 *
 * Tab IDs are stable and append-only — never renamed or removed, because persisted
 * state and URL navigation key on the id. Visual position in the strip is presentational
 * and may change across releases.
 */
export interface HistoryTab {
    readonly id: string;
    readonly label: string;
    readonly component: ComponentType;
}

/** Built-in tabs shipped in the History module. */
export const HISTORY_TABS: readonly HistoryTab[] = [
    { id: 'summary', label: 'Summary', component: SummaryTab },
    { id: 'timeline', label: 'Timeline', component: TimelineTab },
    { id: 'tool-using', label: 'Tool Using', component: ToolUsingTab },
    { id: 'sessions', label: 'Sessions', component: SessionsTab },
    { id: 'insights', label: 'Insights', component: InsightsTab },
    { id: 'sources', label: 'Sources', component: SourcesTab },
];
