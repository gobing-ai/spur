import type { WebModule } from '../types';
import PlansShell from './PlansShell';

/**
 * Plans board module.
 *
 * Auto-discovered via the `WebModule` contract. Presents a three-zone layout:
 * - Floating left dock for plan file list (docs/02_ROADMAP.md, docs/plans/*.md).
 * - Central full-width workspace rendering the selected markdown document.
 * - Floating right dock automatically presenting the document's Table of Contents (TOC).
 */
export const module: WebModule = {
    id: 'plans',
    name: 'Plans',
    icon: '🗺️',
    route: 'plans',
    component: PlansShell,
    sidebarLabel: 'Plans',
    description: 'Project roadmap, release commitments, and execution proposals',
    order: 24,
};
