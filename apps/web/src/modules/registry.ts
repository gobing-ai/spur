import { TaskKanbanModule } from './task-kanban';
import type { WebModule } from './types';

/**
 * Built-in modules in registration order. The first entry is the default landing route
 * (`/` redirects to `/board/<defaultModule.route>`).
 */
const builtins: WebModule[] = [TaskKanbanModule];

/** Read-only module list — registry entries appended in the builtins array above. */
export const modules: ReadonlyArray<WebModule> = builtins;

/** Look up a module by its id. Returns undefined for unknown ids. */
export function getModule(id: string): WebModule | undefined {
    return builtins.find((m) => m.id === id);
}

/** The first registered module — used as the default landing route. */
export const defaultModule = builtins[0];
