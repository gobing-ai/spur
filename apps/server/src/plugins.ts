import type { ApiImpl, ApiRegistry, PluginOpenApiFragment } from '@gobing-ai/spur-plugin-sdk';
import type { Hono } from 'hono';

// ── Plugin route mounting ────────────────────────────────────────────
//
// The mount seam lives here (apps/server), not the SDK: ADR-012 keeps the
// SDK Hono-free (ts-infra + zod only). Plugins register a framework-agnostic
// fetch handler under a prefix; the server mounts each under
// /api/plugins/<prefix>/* before the oRPC /api/* middleware and notFound.

/** Base path under which all plugin routes mount. */
export const PLUGIN_ROUTE_BASE = '/api/plugins';

/**
 * Allowed plugin prefix: a single lowercase path segment. The prefix becomes a
 * live Hono route pattern, so anything beyond `[a-z0-9_-]` (slashes, wildcards,
 * `:` params, `..`) could inject unintended routes — reject it at the seam.
 */
const PREFIX_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** Thrown when a plugin's API prefix is not a safe single path segment. */
export class InvalidPluginPrefixError extends Error {
    constructor(prefix: string) {
        super(
            `Invalid plugin API prefix '${prefix}': must match ${PREFIX_PATTERN} ` +
                `(a single lowercase path segment; no '/', '*', ':' or '..').`,
        );
        this.name = 'InvalidPluginPrefixError';
    }
}

/** A resolved plugin route: its prefix and the implementation behind it. */
interface PluginRoute {
    prefix: string;
    impl: ApiImpl;
}

/** Resolve every registered API entry to its prefix + impl, validating each prefix. */
function resolveRoutes(apiRegistry: ApiRegistry): PluginRoute[] {
    const routes: PluginRoute[] = [];
    for (const { name } of apiRegistry.list()) {
        const impl = apiRegistry.get(name);
        if (!impl) continue;
        if (!PREFIX_PATTERN.test(name)) {
            throw new InvalidPluginPrefixError(name);
        }
        routes.push({ prefix: name, impl });
    }
    return routes;
}

/**
 * Mount every registered plugin API route on the Hono app under
 * /api/plugins/<prefix>/*. The handler receives the raw Request; Hono's
 * catch-all forwards any sub-path. Must be called before the oRPC /api/*
 * middleware and notFound so plugin paths are claimed first.
 */
export function mountPluginRoutes(app: Hono, apiRegistry: ApiRegistry): void {
    for (const { prefix, impl } of resolveRoutes(apiRegistry)) {
        const handle = (req: Request) => impl.handler(req);
        // Match both the bare prefix and any sub-path under it.
        app.all(`${PLUGIN_ROUTE_BASE}/${prefix}`, (c) => handle(c.req.raw));
        app.all(`${PLUGIN_ROUTE_BASE}/${prefix}/*`, (c) => handle(c.req.raw));
    }
}

/**
 * Collect OpenAPI path fragments from registered plugin routes, re-prefixed
 * under /plugins/<prefix>. Returned shape is merged into the generated spec.
 */
export function collectPluginOpenApiPaths(apiRegistry: ApiRegistry): Record<string, unknown> {
    const paths: Record<string, unknown> = {};
    for (const { prefix, impl } of resolveRoutes(apiRegistry)) {
        const fragment: PluginOpenApiFragment | undefined = impl.openapi;
        if (!fragment) continue;
        for (const [path, item] of Object.entries(fragment.paths)) {
            const normalized = path.startsWith('/') ? path : `/${path}`;
            paths[`/plugins/${prefix}${normalized}`] = item;
        }
    }
    return paths;
}
