import type { WebModule } from '../types';
import InboxShell from './InboxShell';

/**
 * Inbox board module (0422).
 *
 * Auto-discovered by `apps/web/src/modules/discover.ts` (eager glob over
 * sibling directories exporting a `WebModule`). Ships the All / Supervisor /
 * per-agent tabs over a unified message + process timeline, consolidating the
 * message surfaces formerly scattered across Teams and Observability (R7).
 */
export const module: WebModule = {
    id: 'inbox',
    name: 'Inbox',
    icon: '💬',
    route: 'inbox',
    component: InboxShell,
    sidebarLabel: 'Inbox',
    // 0422 R1: declared order keeps Inbox immediately adjacent to Teams (order 2).
    order: 1,
};
