import type { WebModule } from '../types';
import ProjectsShell from './ProjectsShell';

export { default as ProjectsShell } from './ProjectsShell';

/**
 * Projects board module (0840, feature G63).
 *
 * Opens the SERVED project directly with Conversation and Processes tabs.
 * Auto-discovered by `apps/web/src/modules/discover.ts` — no wiring file
 * changes. `order: 45` was set above Workspace (50), Inbox (60), and Teams (70)
 * without renumbering them (0840 R6); those three modules were deleted by 0849
 * and their routes redirect here, so this is now the lowest declared order after
 * Observability (10), History (20), Features (30), and Tasks (40).
 */
export const module: WebModule = {
    id: 'projects',
    name: 'Projects',
    icon: '📁',
    route: 'projects',
    component: ProjectsShell,
    sidebarLabel: 'Projects',
    description: 'Conversation and processes for this project',
    order: 45,
};
