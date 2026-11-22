import type { WebModule } from '../types';
import IntegrationsModule from './IntegrationsModule';

/**
 * Integrations board module (feature A82, task 1424).
 *
 * Auto-discovered by `apps/web/src/modules/discover.ts`. Read-only: it reports which
 * agent-protocol surfaces this project exposes and what recently happened on them.
 */
export const module: WebModule = {
    id: 'integrations',
    name: 'Integrations',
    icon: '🔌',
    route: 'integrations',
    component: IntegrationsModule,
    sidebarLabel: 'Integrations',
    description: 'MCP and A2A surfaces: what is on, how it is secured, and recent traffic',
    order: 12,
};
