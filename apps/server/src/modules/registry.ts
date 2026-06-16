import type { Hono } from 'hono';
import type { ServerContext } from '../context';
import { healthModule } from './health';
import type { ServerModule } from './types';

/**
 * Built-in modules registered in deterministic order.
 *
 * Health comes first (reference module). 0078 adds taskModule
 * and featureModule into this array.
 *
 * Order is load-bearing for the route-resolution timeline
 * (explicit routes before wildcard mounts), but modules are
 * self-contained — no module depends on another being mounted first.
 */
const builtins: ServerModule[] = [healthModule];

/**
 * Mount every built-in module on the Hono app.
 *
 * Each `mount()` is wrapped in a try/catch so a broken built-in
 * aborts startup with a clear `Failed to mount server module '<name>'`
 * message — the server never serves a half-mounted API.
 */
export function registerModules(app: Hono, ctx: ServerContext | undefined): void {
    for (const mod of builtins) {
        try {
            mod.mount(app, ctx);
        } catch (err) {
            throw new Error(`Failed to mount server module '${mod.name}': ${String(err)}`);
        }
    }
}

export { builtins };
