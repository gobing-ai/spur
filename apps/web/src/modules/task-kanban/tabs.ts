import type { ComponentType } from 'react';
import KanbanBoard from './KanbanBoard';
import type { TaskListFilters } from './types';

/** Props the shell threads into the active tab's board component (F72). */
export interface TasksTabProps {
    onSelectTask: (wbs: string) => void;
    filters: TaskListFilters;
    folder: string;
    hiddenColumns: ReadonlySet<string>;
    onConnectionChange: (connected: boolean) => void;
}

/**
 * Tab contract for the Tasks board module (F72).
 *
 * Append-only contract: never reorder or rename an entry — the tab strip and
 * any persisted user state (e.g. last-selected tab) key on the id. Future
 * tabs (List / Swimlanes / Analytics) are additive entries only.
 */
export interface TasksTab {
    readonly id: string;
    readonly label: string;
    readonly component: ComponentType<TasksTabProps>;
}

/** Built-in tabs shipped in v1 of the Tasks module. */
export const TASKS_TABS = [
    { id: 'kanban', label: 'Kanban', component: KanbanBoard },
] as const satisfies readonly TasksTab[];
