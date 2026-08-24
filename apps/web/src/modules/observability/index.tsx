import type { WebModule } from '../types';
import ObservabilityShell from './ObservabilityShell';

/**
 * Observability board module (task 0189 / feature J).
 *
 * Auto-discovered by `apps/web/src/modules/discover.ts` (eager glob over
 * sibling directories exporting a `WebModule`). v1 ships the System Events +
 * Inbox Messages tabs; the Jobs tab (0190) and Process List tab (0195) are
 * appended to `tabs.ts` as data without changing the shell.
 */
export const module: WebModule = {
    id: 'observability',
    name: 'Observability',
    icon: '📡',
    route: 'observability',
    component: ObservabilityShell,
    sidebarLabel: 'Observability',
    order: 0,
};
