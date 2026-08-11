import type { WebModule } from '../types';
import WorkspaceShell from './WorkspaceShell';

/**
 * Workspace board module (task 0197 / feature G3, ADR-052).
 *
 * A composition shell over the existing collaboration surfaces: it selects the
 * first project-local (`isCurrentProject`) team and composes the scoped Teams,
 * Inbox, and Tasks views. Auto-discovered by `apps/web/src/modules/discover.ts`.
 * Owns selection + scope only — no message delivery or process management.
 */
export const module: WebModule = {
    id: 'workspace',
    name: 'Workspace',
    icon: '🧩',
    route: 'workspace',
    component: WorkspaceShell,
    sidebarLabel: 'Workspace',
    // 0197 R5: declared order 0 (sorts with observability's order 0; the stable
    // id pre-sort keeps observability first).
    order: 0,
};
