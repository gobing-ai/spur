import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';
import { createTaskHandlers } from './handlers';

/**
 * Task domain module — mounts the task oRPC handler sub-tree.
 *
 * The handlers themselves are created in `handlers.ts` and merged into the
 * global oRPC router by `router.ts`. This module's `mount()` is a no-op
 * because oRPC procedures are wired through the unified `OpenAPIHandler`,
 * not through per-module Hono route registration.
 *
 * The module exists in the builtins array so `require-corresponding-test`
 * and module discovery see it as a declared domain — even though the
 * actual route wiring lives in the router.
 */
export const taskModule: ServerModule = {
    name: 'task',

    mount(_app: Hono, _ctx: ServerContext | undefined): void {
        // oRPC procedures are wired through the global router — no Hono
        // route registration needed here. The module is registered so
        // the S2 registry and tests can discover it.
    },
};

/** Re-export handler factory for router composition. */
export { createTaskHandlers };
