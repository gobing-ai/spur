import type { WebModule } from '../types';
import FeaturesShell from './FeaturesShell';

/**
 * Features board module (task 0194 / feature F8).
 *
 * Auto-discovered via the `WebModule` contract — zero manual wiring. v1 ships
 * a tree view (ID-derived hierarchy with status badges), detail panel
 * (frontmatter, Goal, Scope, rendered AC, linked tasks), status transition UI
 * (lifecycle-guarded, denial surface), and a feature check runner (L1–L4
 * findings grouped by layer).
 */
export const module: WebModule = {
    id: 'features',
    name: 'Feature Board',
    icon: '🏷️',
    route: 'features',
    component: FeaturesShell,
    sidebarLabel: 'Features',
    description: 'Feature tree, acceptance criteria, and decomposition into tasks',
    order: 30,
};
