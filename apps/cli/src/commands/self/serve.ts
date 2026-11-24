import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import { createJsonlEventSink, ProjectRegistry, startRegisteredProject } from '@gobing-ai/spur-app';
import { buildConfigFromEnv, DEFAULT_DATABASE_URL, getEnvVars } from '@gobing-ai/spur-config';
import { loadSpurConfig } from '@gobing-ai/spur-config/loader';
import { type StartGatewayOptions, startGateway, startServer } from '@gobing-ai/spur-server';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { bootFree } from '../../boot-free-route';
import type { CliContext } from '../../context';
import { CommandError, errorMessage } from '../../errors';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { resolveSpurArgv } from '../../workflow/resolve-spur-bin';
import { SHARED_OPTIONS } from '../shared-options';

/**
 * Where `serve --gateway` writes its structured event log (task 1384): next to the launchd logs on
 * darwin, under the config dir elsewhere — a foreground `spur self serve --gateway` on any OS has no
 * launchd log directory of its own.
 */
function gatewayEventLogPath(): string {
    const home = homedir();
    return process.platform === 'darwin'
        ? `${home}/Library/Logs/spur/gateway.events.jsonl`
        : `${home}/.config/spur/logs/gateway.events.jsonl`;
}

/** Resolve the database URL used by `spur self serve`, matching normal CLI DB defaults. */
export function resolveServeDbUrl(cwd: string, env: Record<string, string | undefined>, configuredUrl: string): string {
    return env.DATABASE_URL === undefined ? join(cwd, DEFAULT_DATABASE_URL) : configuredUrl;
}

/**
 * Resolve the `serve --cwd` project root (task 0805 R2): a relative target is
 * resolved against the invocation directory (path.resolve), and the result must
 * exist and be a directory BEFORE server startup. A missing/non-directory target
 * is a command error, not a server that silently serves the wrong root.
 */
export function resolveServeCwd(cwd: string): string {
    const resolved = resolve(cwd);
    let isDirectory = false;
    try {
        isDirectory = statSync(resolved).isDirectory();
    } catch {
        isDirectory = false;
    }
    if (!isDirectory) {
        throw new CommandError(`--cwd ${cwd} does not resolve to an existing directory (resolved: ${resolved})`, 1);
    }
    return resolved;
}

/** Options for {@link registerServeCommand}. */
export interface RegisterServeOptions {
    /**
     * Injectable `startServer` for tests (defaults to the real server entry).
     * Mirrors the server's StartServerDeps seam so the CLI startup composition
     * can be exercised with injected dependencies (task 0805 AC2).
     */
    startServer?: typeof startServer;
    /** Injectable `startGateway` for tests (defaults to the real gateway listener). */
    startGateway?: typeof startGateway;
    /** Read project workflow configuration for gateway discovery. */
    loadProjectConfig?: StartGatewayOptions['deps']['loadProjectConfig'];
}

/** Register the `self serve` command. */
export function registerServeCommand(
    program: Command,
    context: Pick<CliContext, 'cwd' | 'output' | 'env' | 'setExitCode'>,
    registration: RegisterServeOptions = {},
): void {
    const launch = registration.startServer ?? startServer;
    const launchGateway = registration.startGateway ?? startGateway;
    bootFree(program.command('serve'))
        .summary('start the Spur web server (local fallback)')
        .option(...SHARED_OPTIONS.portServe, parseInt)
        .option('--host <addr>', 'Bind address (env: HOST, default: localhost)')
        .option('--gateway', 'Run the one-port project gateway instead of a project server')
        .option('--no-open', 'Skip opening the browser')
        .option(...SHARED_OPTIONS.cwdServe, context.cwd)
        .option(...SHARED_OPTIONS.jsonServePortUrl)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            try {
                const env = getEnvVars();
                const config = buildConfigFromEnv(env);

                if (options.gateway) {
                    const spurConfig = options.json
                        ? null
                        : await (registration.loadProjectConfig ?? loadSpurConfig)(context.cwd).catch(() => null);
                    const gatewayConfig = buildConfigFromEnv(env, spurConfig);
                    const gatewayPort = options.port ?? gatewayConfig.server.gateway.port;
                    const gatewayHost = options.host ?? gatewayConfig.server.host;
                    if (options.json) {
                        // Dry probe, like the project serve: nothing is bound, so nothing is running.
                        context.output.write(
                            toEnvelopeJson(
                                {
                                    port: gatewayPort,
                                    url: `http://${gatewayHost}:${gatewayPort}`,
                                    gateway: true,
                                    running: false,
                                },
                                { enveloped: options.jsonEnvelope },
                            ),
                        );
                        return;
                    }
                    const registry = new ProjectRegistry();
                    const handle = launchGateway({
                        port: gatewayPort,
                        host: gatewayHost,
                        mcp: {
                            ...gatewayConfig.server.gateway.mcp,
                            projectTokenEnv: gatewayConfig.server.mcp.authEnv,
                            projectAllowUnauthenticated: gatewayConfig.server.mcp.allowUnauthenticated,
                            env,
                        },
                        deps: {
                            loadProjectConfig: registration.loadProjectConfig,
                            // Read-only snapshot: routing must not heal, purge or probe on every request.
                            listProjects: async () => registry.peek().projects,
                            removeProject: async (path, host) => registry.remove(path, host),
                            ensureUpstream: async (entry) =>
                                // Pass the entry the prefix resolved to: adopting by path alone
                                // let a same-path entry on another host supply this port (Q R3).
                                (
                                    await startRegisteredProject(registry, entry.path, {
                                        entry,
                                        reservedPorts: new Set([gatewayPort]),
                                    })
                                ).port,
                            port: gatewayPort,
                            edge: { bindHost: gatewayHost, allowedHosts: gatewayConfig.server.gateway.allowedHosts },
                            onEvent: createJsonlEventSink({ path: gatewayEventLogPath(), fs: createNodeFileSystem() }),
                        },
                    });
                    context.output.write(`Spur gateway listening on ${handle.url}`);
                    context.output.write('Local projects route at /<prefix>/ (Ctrl-C to stop).');
                    return;
                }

                const port = options.port ?? config.server.port;
                const host = options.host ?? config.server.host;
                // 0805 R2: one coherent project root. A relative --cwd resolves against
                // the invocation directory and must exist as a directory before any
                // server startup. Through the real CLI, commander defaults --cwd to
                // context.cwd (the invocation directory), so options.cwd is always set
                // and the resolved root is always passed; the undefined branch covers
                // direct action invocation (tests/embeddings) and keeps the
                // process.cwd() fallback. The default DB still scopes to the resolved
                // root, preserving prior behavior.
                const projectRoot = options.cwd !== undefined ? resolveServeCwd(options.cwd) : undefined;
                const cwd = projectRoot ?? context.cwd;
                const dbUrl = resolveServeDbUrl(cwd, env, config.database.url);
                if (options.json) {
                    // --json is a dry machine-readable probe: no server is started, so
                    // pid would be this CLI process (misleading). Omit pid; report ready=false.
                    context.output.write(
                        toEnvelopeJson(
                            {
                                port,
                                url: `http://${host}:${port}`,
                                pid: null,
                                running: false,
                            },
                            { enveloped: options.jsonEnvelope },
                        ),
                    );
                    return;
                }

                context.output.write(`Starting Spur server on http://${host}:${port} …`);

                await launch({
                    port,
                    host,
                    dbUrl,
                    openBrowser: options.open ?? true,
                    webDistPath: config.server.webDistPath,
                    // PATH-independent child invocation for queued history refreshes (task 0717).
                    spurInvocation: resolveSpurArgv(),
                    ...(projectRoot !== undefined ? { cwd: projectRoot } : {}),
                    onListening: ({ url, boardUrl }) => {
                        context.output.write(`Spur server listening on ${url}`);
                        if (boardUrl) {
                            context.output.write(`Board UI available at ${boardUrl}`);
                        } else {
                            context.output.write(
                                `Board UI static assets not found — /board will return 404 (health check: ${url}/api/health)`,
                            );
                        }
                    },
                });
            } catch (err) {
                // errorMessage() classifies SQLITE_BUSY (bun:sqlite: message "database is locked",
                // code SQLITE_BUSY) into the task 0805 R4 remediation — a raw message here read
                // as an opaque failure with no holder-identification hint (dogfood 2026-09-08).
                writeJsonError(context.output, options, errorMessage(err));
                if (context.env?.SPUR_DEBUG === '1' && err instanceof Error && err.stack) {
                    writeJsonError(context.output, options, err.stack, 'INTERNAL_ERROR');
                }
                context.setExitCode(1);
            }
        });
}
