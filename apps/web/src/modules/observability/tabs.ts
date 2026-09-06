import type { ComponentType } from 'react';
import JobsTab from './JobsTab';
import RoutingTab from './RoutingTab';
import SummaryTab from './SummaryTab';
import SystemEventsTab from './SystemEventsTab';

/** Time range filter presets supported across observability tabs. */
export type ObservabilityTimeRange = '30s' | '5m' | '1h' | '4h' | '24h' | '7d' | 'all';

/** Real-time SSE connection and throughput status reported by active tabs. */
export type ObservabilityLiveness = {
    status: 'connecting' | 'live' | 'errored' | 'paused';
    rate: number;
    lastEventAt: string | null;
};

/** Common props passed from ObservabilityShell to each tab view. */
export interface ObservabilityTabProps {
    onLivenessChange?: (next: ObservabilityLiveness) => void;
    timeRange?: ObservabilityTimeRange;
    onTimeRangeChange?: (next: ObservabilityTimeRange) => void;
}

/**
 * Tab contract for the observability module (task 0189 R6; J92 tab consolidation).
 *
 * Tabs are declared as data here so the shell maps over this array. IDs are
 * stable selectors; intentional registry changes update the exact-list test.
 */
export interface ObservabilityTab {
    readonly id: string;
    readonly label: string;
    readonly component: ComponentType<ObservabilityTabProps>;
}

/** Built-in tabs shipped in the observability module.
 *
 * J92 consolidation: Observability keeps system-wide telemetry: system events,
 * jobs, and routing. Legacy tasks and tool-using tabs removed.
 */
export const OBSERVABILITY_TABS: readonly ObservabilityTab[] = [
    { id: 'summary', label: 'Summary', component: SummaryTab },
    { id: 'system-events', label: 'System Events', component: SystemEventsTab },
    { id: 'jobs', label: 'Jobs', component: JobsTab },
    { id: 'routing', label: 'Routing', component: RoutingTab },
];
