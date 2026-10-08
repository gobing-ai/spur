import type { ComponentType } from 'react';
import DecisionsTab from './DecisionsTab';
import JobsTab from './JobsTab';
import RoutingTab from './RoutingTab';
import SummaryTab from './SummaryTab';
import SystemEventsTab from './SystemEventsTab';
import TraceTab from './TraceTab';

/** Time range filter presets supported across observability tabs. */
export type ObservabilityTimeRange = '30s' | '5m' | '1h' | '4h' | '24h' | '7d' | 'all';

/** Real-time SSE connection and throughput status reported by active tabs. */
export type ObservabilityLiveness = {
    status: 'connecting' | 'live' | 'errored' | 'paused';
    rate: number;
    lastEventAt: string | null;
};

/** Cross-tab navigation intent emitted by Summary hotspot activators (task 0791 R6). */
export type ObservabilityNavIntent =
    | { tab: 'jobs'; jobId?: string }
    | { tab: 'system-events'; eventName?: string; runId?: string };

/** Common props passed from ObservabilityShell to each tab view.
 *
 * The shell owns the time range for every tab (task 0793 R2/Q3): `timeRange`
 * is required and tabs must not fall back to local state for it. The range
 * control itself stays shell-owned via `TimeRangePresets`; tabs only consume
 * the value (task 0802 R6).
 */
export interface ObservabilityTabProps {
    onLivenessChange?: (next: ObservabilityLiveness) => void;
    timeRange: ObservabilityTimeRange;
    onNavigate?: (intent: ObservabilityNavIntent) => void;
    /** Last cross-tab intent, replayed by the shell so a target tab can apply it
     * (feature E72 R6: the System Events tab filters to the intent's run id). */
    navIntent?: ObservabilityNavIntent | null;
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
 * jobs, and routing. Legacy tasks and tool-using tabs removed. E72 adds the
 * run-centric Trace tab in place of the removed task-centric TasksTab.
 * Task 1100 adds the Decisions tab over `decision_logs`.
 */
export const OBSERVABILITY_TABS: readonly ObservabilityTab[] = [
    { id: 'summary', label: 'Summary', component: SummaryTab },
    { id: 'system-events', label: 'System Events', component: SystemEventsTab },
    { id: 'jobs', label: 'Jobs', component: JobsTab },
    { id: 'trace', label: 'Trace', component: TraceTab },
    { id: 'routing', label: 'Routing', component: RoutingTab },
    { id: 'decisions', label: 'Decisions', component: DecisionsTab },
];
