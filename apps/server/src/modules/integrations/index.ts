import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';
import { createIntegrationsHandlers } from './handlers';

/**
 * Integrations module (feature A82, task 1423).
 *
 * Registered unconditionally: the status read is an ANSWER about which protocol surfaces are on,
 * so it must exist when both are off. The procedures are oRPC and wired through the global router,
 * which is why `mount()` here does nothing — same shape as the history/task modules.
 */
export const integrationsModule: ServerModule = {
    name: 'integrations',

    mount(_app: Hono, _ctx: ServerContext | undefined): void {
        // oRPC procedures wired through the global router.
    },
};

/** Re-export handler factory for router composition. */
export { createIntegrationsHandlers };
