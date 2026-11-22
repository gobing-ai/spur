import type { WebModule } from '../types';
import ProjectsShell from './ProjectsShell';

export { default as ProjectsShell } from './ProjectsShell';

/**
 * Projects board module (0840, feature G63).
 *
 * Opens the SERVED project directly, with the Fleet, Inbox and Database tabs
 * (`./tabs.tsx`, in that declared order).
 * Auto-discovered by `apps/web/src/modules/discover.ts` — no wiring file
 * changes. `order: 45` remains stable without renumbering other module descriptors
 * (0840 R6); the Projects tab contract owns navigation within this route.
 */
export const module: WebModule = {
    id: 'projects',
    name: 'Projects',
    route: 'projects',
    component: ProjectsShell,
    sidebarLabel: 'Projects',
    description: 'Fleet, inbox and database for this project',
    order: 45,
};
