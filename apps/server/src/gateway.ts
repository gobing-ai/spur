import { createGatewayHandler, type GatewayDeps } from '@gobing-ai/spur-app';

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
}

/**
 * Start the one-port project gateway (feature K4, ADR-151 §4).
 *
 * Deliberately not `startServer`: the gateway owns no database, fleet, scheduler or job worker, so
 * its lifetime is independent of any project's serve. Binding failures surface as one actionable
 * message because `spur self status` and the daemon plist both read it.
 */
export function startGateway(options: StartGatewayOptions): GatewayHandle {
    const handler = createGatewayHandler(options.deps);
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
