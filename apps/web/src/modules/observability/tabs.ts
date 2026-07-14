import type { ComponentType } from 'react';
import JobsTab from './JobsTab';
import SystemEventsTab from './SystemEventsTab';
import ToolUsingTab from './ToolUsingTab';

/**
 * Tab contract for the observability module (task 0189 R6).
 *
 * Tabs are declared as data here so downstream features (0190 Jobs, 0195 Process
 * List) can append entries without touching the shell component. The shell maps
 * over this array; new tabs only need a component + a label.
 *
 * Append-only contract: never reorder or rename an entry — the board's tab
 * strip and any persisted user state (e.g. last-selected tab) key on the id.
 */
export interface ObservabilityTab {
    readonly id: string;
    readonly label: string;
    readonly component: ComponentType;
}

/** Built-in tabs shipped in v1 of the observability module.
 *
 * 0254 migration: `inbox` and `process-list` tabs moved to the Teams module
 * (Messages + Roster tabs cover the same functionality). Observability keeps
 * system-wide telemetry: system events, jobs, tool using.
 */
export const OBSERVABILITY_TABS: readonly ObservabilityTab[] = [
    { id: 'system-events', label: 'System Events', component: SystemEventsTab },
    { id: 'jobs', label: 'Jobs', component: JobsTab },
    { id: 'tool-using', label: 'Tool Using', component: ToolUsingTab },
];
