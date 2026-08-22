import type { WebModule } from '../types';
import HistoryShell from './HistoryShell';

/**
 * History Board web module (task 0626 / feature E8).
 *
 * Auto-discovered by `apps/web/src/modules/discover.ts`.
 * Exposes 5 tabs: Summary, Timeline, Sessions, Insights, Sources.
 */
export const module: WebModule = {
    id: 'history',
    name: 'History',
    icon: '📊',
    route: 'history',
    component: HistoryShell,
    sidebarLabel: 'History',
    order: 3,
};
