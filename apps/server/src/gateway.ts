import { createGatewayHandler, type GatewayDeps, isLocalHost, resolveMcpNamespace } from '@gobing-ai/spur-app';
import { getEnvVars, resolveProjectPrefix } from '@gobing-ai/spur-config';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { bearerGuard } from './middleware/bearer-guard';
import { handleMcpHttpRequest, type McpHandlerRegistry } from './modules/mcp/protocol';

/** A running gateway listener. */
export interface GatewayHandle {
    /** Bound port (the requested one unless the caller asked for an ephemeral port). */
    port: number;
    /** Base URL the gateway answers on. */
    url: string;
    /** Stop accepting connections and drop in-flight ones. */
    stop(): void;
}

/** Options for {@link startGateway}. */
export interface StartGatewayOptions {
    /** Fixed public port (default comes from `server.gateway.port`). */
    port: number;
    /** Bind address (default `localhost`). */
    host: string;
    /** Routing/upstream seams; the CLI composes registry + start path. */
    deps: GatewayDeps;
    /**
     * Gateway-hosted MCP (task 1382). Enabled requires a token variable; the handler is composed
     * here so `packages/app` never imports this transport.
     */
    mcp?: { enabled: boolean; authEnv?: string; env?: Record<string, string | undefined> };
}

/**
 * Start the one-port project gateway (feature K4, ADR-151 §4).
 *
 * Deliberately not `startServer`: the gateway owns no database, fleet, scheduler or job worker, so
 * its lifetime is independent of any project's serve. Binding failures surface as one actionable
 * message because `spur self status` and the daemon plist both read it.
 */
export function startGateway(options: StartGatewayOptions): GatewayHandle {
    const handler = createGatewayHandler(withGatewayMcp(options.deps, options.mcp));
    let server: ReturnType<typeof Bun.serve>;
    try {
        server = Bun.serve({
            port: options.port,
            hostname: options.host,
            // Idle SSE streams must not be cut by the runtime's default idle timeout.
            idleTimeout: 0,
            fetch: handler,
        });
    } catch (err) {
        const code = (err as { code?: unknown })?.code;
        if (code === 'EADDRINUSE') {
            throw new Error(`Gateway port ${options.port} is already in use by another process`);
        }
        throw err;
    }
    const port = server.port ?? options.port;
    return { port, url: `http://${options.host}:${port}`, stop: () => server.stop(true) };
}

/**
 * Compose the root `/mcp` handler onto the gateway deps (task 1382 R2/R3).
 *
 * Disabled means no handler at all, so `/mcp` stays a 404 rather than a proxy attempt at a project
 * prefix. Enabled means the SAME bearer guard the project surfaces use, under its own realm and its
 * own token variable, plus a registry whose only job is discover (1383 fills tools and calls).
 */
function withGatewayMcp(deps: GatewayDeps, mcp: StartGatewayOptions['mcp']): GatewayDeps {
    if (mcp?.enabled !== true) return deps;
    const env = mcp.env ?? getEnvVars();
    const guard = bearerGuard({
        realm: 'spur-gateway-mcp',
        authEnv: mcp.authEnv ?? null,
        env,
        unauthenticated: () => ({ error: { code: 'UNAUTHENTICATED', message: 'a bearer token is required' } }),
        unconfigured: () => ({
            error: {
                code: 'INTERNAL_ERROR',
                message:
                    'the gateway mcp endpoint has no token configured; set the variable named by server.gateway.mcp.authEnv',
            },
        }),
    });
    const fs = createNodeFileSystem();
    const registry: McpHandlerRegistry = {
        // 1383 replaces these; discover is the whole contract this task ships.
        listTools: async () => [],
        callTool: async (name) => {
            throw new Error(`unknown tool "${name}"; the gateway exposes no tools yet`);
        },
        listResources: async () => [],
        readResource: async (uri) => {
            throw new Error(`unknown resource "${uri}"; the gateway exposes no resources yet`);
        },
        namespace: () => null,
        discoverExtras: async () => {
            const entries = await deps.listProjects();
            const projects: Array<{ name: string; prefix: string; namespace: string | null }> = [];
            const diagnostics: Array<{ name: string; reason: string; remedy: string }> = [];
            for (const entry of entries) {
                if (!isLocalHost(entry.host)) {
                    diagnostics.push({
                        name: entry.name,
                        reason: 'remote-not-proxied (ADR-151)',
                        remedy: `run the project locally and spur projects add ${entry.path}`,
                    });
                    continue;
                }
                const prefix = resolveProjectPrefix(entry);
                if (prefix === null) continue;
                // The gateway env is shared across projects, so only the plugin manifest can name a
                // namespace here — a per-project configured value is not visible at the root.
                const resolved = await resolveMcpNamespace({ configured: undefined, projectRoot: entry.path, fs });
                projects.push({ name: entry.name, prefix, namespace: resolved.namespace });
            }
            return { projects, diagnostics };
        },
    };
    return {
        ...deps,
        mcp: async (req: Request): Promise<Response> => {
            // The guard speaks the Hono-shaped context the project mounts use; adapt the raw request.
            const denied = guard.authorize({
                req: {
                    header: (name: string) => req.headers.get(name) ?? undefined,
                    path: new URL(req.url).pathname,
                },
            });
            if (denied !== null) return denied;
            return handleMcpHttpRequest(req, registry);
        },
    };
}
