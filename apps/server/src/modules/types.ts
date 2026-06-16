import type { Hono, MiddlewareHandler } from 'hono';
import type { ServerContext } from '../context';

/**
 * Standard contract for adding a new API domain to the server.
 *
 * Mirrors `apps/cli`'s `register<Noun>Command(program, context)` pattern.
 * Each module contributed its oRPC router sub-tree into the merged global
 * handler — one oRPC dispatch, one contract merge, one OpenAPI document.
 *
 * @see design §2.4
 */
export interface ServerModule {
    /** Stable module identifier (e.g. 'health', 'task', 'feature'). */
    readonly name: string;

    /**
     * Mount module-specific routes and middleware on the Hono app AFTER the
     * shared middleware pipeline (secureHeaders, cors, requestId, …).
     *
     * Modules that contribute oRPC procedures merge their contract sub-tree
     * into the composed `contract` (packages/contracts/src/index.ts); the
     * global `OpenAPIHandler` serves all of them through `/api/*`.
     *
     * Modules that add raw Hono routes (e.g. health liveness) register
     * them here — they take precedence over the `/api/*` wildcard mount
     * because `registerModules` is called before it.
     *
     * `ctx` is `undefined` when the server starts without an
     * `ApplicationRuntime` (stand-alone / test mode).
     */
    mount(app: Hono, ctx: ServerContext | undefined): void;

    /** Optional module-scoped middleware applied ONLY to this module's routes. */
    readonly middleware?: MiddlewareHandler[];
}
