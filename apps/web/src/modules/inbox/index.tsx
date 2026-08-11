import type { WebModule } from '../types';
import InboxShell from './InboxShell';

/**
 * Inbox board module (0422; task 0197 / ADR-052).
 *
 * Auto-discovered by `apps/web/src/modules/discover.ts` (eager glob over
 * sibling directories exporting a `WebModule`). Ships the All / Supervisor /
 * per-agent tabs over the durable message plane only — it opens no process
 * stream and renders no stdout/stderr (Teams owns the process plane).
 * An optional `teamId` scope (Workspace) narrows the feed.
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
