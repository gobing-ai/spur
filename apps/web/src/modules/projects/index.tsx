import type { WebModule } from '../types';
import ProjectsShell from './ProjectsShell';

export { default as ProjectsShell } from './ProjectsShell';

/**
 * Projects board module (0840, feature G63).
 *
 * Opens the SERVED project directly with Conversation, Agents, and Work tabs.
 * Auto-discovered by `apps/web/src/modules/discover.ts` — no wiring file
 * changes. `order: 45` sits above Workspace (50), Inbox (60), and Teams (70)
 * without renumbering them (R6; G64 owns retirement).
 */
export const module: WebModule = {
    id: 'projects',
    name: 'Projects',
    icon: '📁',
    route: 'projects',
    component: ProjectsShell,
    sidebarLabel: 'Projects',
    description: 'Conversation, agents, and work for this project',
    order: 45,
};
