import type { WebModule } from '../types';
import TeamsShell from './TeamsShell';

/**
 * Teams board module (task 0254 / feature M).
 *
 * Auto-discovered by `apps/web/src/modules/discover.ts` (eager glob over
 * sibling directories exporting a `WebModule`). Ships the Terminal, Messages,
 * and Activity tabs (Roster dropped in 0260 per M1). Terminal embeds
 * MemberTerminal (0255) and consumes the team API (0256).
 */
export const module: WebModule = {
    id: 'teams',
    name: 'Teams',
    icon: '👥',
    route: 'teams',
    component: TeamsShell,
    sidebarLabel: 'Teams',
};
