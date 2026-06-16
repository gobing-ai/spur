import type { Hono } from 'hono';
import type { ServerContext } from '../context';
import { featureModule } from './feature';
import { healthModule } from './health';
import { taskModule } from './task';
import type { ServerModule } from './types';

/**
 * Built-in modules registered in deterministic order.
 *
 * Health comes first (reference module). Task and feature modules are
 * registered for discovery + testability; their actual oRPC procedure
 * wiring lives in the global router (router.ts).
 *
 * Order is load-bearing for the route-resolution timeline
 * (explicit routes before wildcard mounts), but modules are
 * self-contained — no module depends on another being mounted first.
 */
const builtins: ServerModule[] = [healthModule, taskModule, featureModule];

/**
 * Mount every built-in module on the Hono app.
 *
 * Each `mount()` is wrapped in a try/catch so a broken built-in
 * aborts startup with a clear `Failed to mount server module '<name>'`
 * message — the server never serves a half-mounted API.
 */
export function registerModules(app: Hono, ctx: ServerContext | undefined, modules: ServerModule[] = builtins): void {
    for (const mod of modules) {
        try {
            mod.mount(app, ctx);
        } catch (err) {
            throw new Error(`Failed to mount server module '${mod.name}': ${String(err)}`);
        }
    }
}

export { builtins };
