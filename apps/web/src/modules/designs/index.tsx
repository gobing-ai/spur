import type { WebModule } from '../types';
import DesignsShell from './DesignsShell';

/**
 * Designs board module.
 *
 * Auto-discovered via the `WebModule` contract. Presents a three-zone layout:
 * - Floating left dock for design file list (DESIGN.md, docs/04_DESIGN.md, docs/design/*.md).
 * - Central full-width workspace rendering the selected markdown document.
 * - Floating right dock automatically presenting the document's Table of Contents (TOC).
 */
export const module: WebModule = {
    id: 'designs',
    name: 'Designs',
    icon: '📐',
    route: 'designs',
    component: DesignsShell,
    sidebarLabel: 'Designs',
    description: 'Design documents, architecture specifications, and surface contracts',
    order: 25,
};
