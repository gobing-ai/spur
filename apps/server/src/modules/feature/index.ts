import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';
import { createFeatureHandlers } from './handlers';

/**
 * Feature domain module — mounts the feature oRPC handler sub-tree.
 *
 * Same pattern as taskModule: handler creation lives in `handlers.ts`,
 * oRPC wiring in `router.ts`, and this module exists for registry
 * discovery and testability.
 */
export const featureModule: ServerModule = {
    name: 'feature',

    mount(_app: Hono, _ctx: ServerContext | undefined): void {
        // oRPC procedures wired through the global router.
    },
};

/** Re-export handler factory for router composition. */
export { createFeatureHandlers };
