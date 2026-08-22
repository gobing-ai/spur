import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';
import { createHistoryHandlers } from './handlers';

/**
 * History domain module — mounts the history oRPC handler sub-tree.
 *
 * Same pattern as taskModule/featureModule: handler creation lives in `handlers.ts`,
 * oRPC wiring in `router.ts`, and this module exists for registry discovery and testability.
 */
export const historyModule: ServerModule = {
    name: 'history',

    mount(_app: Hono, _ctx: ServerContext | undefined): void {
        // oRPC procedures wired through the global router.
    },
};

/** Re-export handler factory for router composition. */
export { createHistoryHandlers };
