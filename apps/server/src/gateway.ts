import { createGatewayHandler, type GatewayDeps, type McpGatewayRegistry } from '@gobing-ai/spur-app';
import { getEnvVars, SPUR_ENV_VARS } from '@gobing-ai/spur-config';
import { bearerGuard } from './middleware/bearer-guard';
import { TOOL_DESCRIPTORS } from './modules/mcp';
import { handleMcpHttpRequest, type McpHandlerRegistry, MIN_MCP_PROTOCOL_VERSION } from './modules/mcp/protocol';

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
     * Gateway-hosted MCP (task 1382), driven by `server.mcp` (K44 1450): one switch and one token
     * variable both authenticate callers here and are forwarded to each project's loopback `/mcp`.
     * The handler is composed here so `packages/app` never imports this transport.
     */
    mcp?: {
        enabled: boolean;
        authEnv?: string;
        allowUnauthenticated?: boolean;
        env?: Record<string, string | undefined>;
    };
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
 * prefix. Enabled means the SAME bearer guard and token variable the project surfaces use (K44
 * 1450: one `server.mcp` credential), under its own realm, plus a registry whose only job is discover (1383 fills tools and calls).
 */
function withGatewayMcp(deps: GatewayDeps, mcp: StartGatewayOptions['mcp']): GatewayDeps {
    if (mcp?.enabled !== true) return deps;
    const env = mcp.env ?? getEnvVars();
    const allowUnauthenticated = mcp.allowUnauthenticated === true;
    const guard = bearerGuard({
        realm: 'spur-gateway-mcp',
        authEnv: mcp.authEnv ?? null,
        allowUnauthenticated,
        env,
        unauthenticated: () => ({ error: { code: 'UNAUTHENTICATED', message: 'a bearer token is required' } }),
        unconfigured: () => ({
            error: {
                code: 'INTERNAL_ERROR',
                message:
                    'the gateway mcp endpoint has no token configured; set the variable named by server.mcp.authEnv',
            },
        }),
    });
    return {
        ...deps,
        mcpAuth: {
            envName: mcp.authEnv ?? '',
            // 1449 R3: presence and policy are separate signals — an unauthenticated gateway has no token.
            tokenPresent: Boolean(mcp.authEnv && env[mcp.authEnv]),
            ...(allowUnauthenticated ? { allowUnauthenticated: true } : {}),
        },
        // Task 1383 R1/R3: the five `sp_*` descriptors and the upstream protocol version.
        builtinTools: () => TOOL_DESCRIPTORS,
        projectMcpNamespace: env[SPUR_ENV_VARS.mcpNamespace],
        projectMcpToken: () => {
            const value = mcp.authEnv === undefined ? undefined : env[mcp.authEnv];
            if (value === undefined || value === '') return allowUnauthenticated ? '' : undefined;
            return value;
        },
        mcpProtocolVersion: MIN_MCP_PROTOCOL_VERSION,
        mcp: async (req: Request, registry: McpGatewayRegistry): Promise<Response> => {
            // The guard speaks the Hono-shaped context the project mounts use; adapt the raw request.
            const denied = guard.authorize({
                req: {
                    header: (name: string) => req.headers.get(name) ?? undefined,
                    path: new URL(req.url).pathname,
                },
            });
            if (denied !== null) return denied;
            // The app layer owns routing; the server adapter owns the wire protocol (1383 R3).
            return handleMcpHttpRequest(req, registry as unknown as McpHandlerRegistry);
        },
    };
}
