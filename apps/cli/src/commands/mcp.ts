import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { Command } from '@commander-js/extra-typings';
import { isGatewayAnswering, normalizeProjectPath, ProjectRegistry } from '@gobing-ai/spur-app';
import { buildConfigFromEnv, isLocalHost, resolveProjectGatewayUrl, type SpurConfig } from '@gobing-ai/spur-config';
import { loadSpurConfig } from '@gobing-ai/spur-config/loader';
import { bootFree } from '../boot-free-route';
import { CLI_CONFIG } from '../config';
import type { CliContext } from '../context';
import { CommandError, errorMessage } from '../errors';
import type { CommandOutput } from '../output';
import { resolveServeCwd } from './self/serve';
import { SHARED_OPTIONS } from './shared-options';

/**
 * `spur mcp` — thin stdio-to-HTTP bridge (feature B9, task 1373) so stdio-only MCP clients can
 * reach the embedded `/mcp` endpoint mounted by task 1372. Stateless requests are proxied verbatim.
 * The bridge translates the legacy stdio lifecycle and result envelopes for tool clients.
 *
 * Server settings (`server.mcp.authEnv`, ports) read from the same app-layer env config as
 * `spur self serve` (`buildConfigFromEnv`) — the server config surface is env-scoped, not project-file.
 */

/** Mirrors the server adapter's `MIN_MCP_PROTOCOL_VERSION` (`apps/server/src/modules/mcp/protocol.ts`);
 * the server barrel does not re-export it and deep cross-workspace imports are forbidden. */
export const MCP_PROTOCOL_VERSION = '2026-07-28';

const LEGACY_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];

interface RpcMessage {
    jsonrpc?: unknown;
    id?: unknown;
    method?: unknown;
    params?: { protocolVersion?: unknown; clientInfo?: { name?: unknown } };
    result?: unknown;
}

function parseRpc(text: string): RpcMessage | undefined {
    try {
        const message = JSON.parse(text) as RpcMessage | null;
        return message?.jsonrpc === '2.0' ? message : undefined;
    } catch {
        return undefined;
    }
}

/** The client's self-reported name, or `null` when absent or unusable as a header value (1446 P3). */
function clientName(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const name = value.trim();
    // The server would drop an out-of-charset actor anyway; forwarding it would instead make the
    // bridge's own fetch throw and kill the session, so the shape is checked before it is a header.
    return /^[A-Za-z0-9._:@-]{1,64}$/.test(name) ? name : null;
}

/** The context slice the bridge reads — the same shape `registerServeCommand` takes. */
type McpBridgeContext = Pick<CliContext, 'cwd' | 'output' | 'env' | 'setExitCode'>;

/** Injectable IO for {@link runMcpStdioBridge} (tests inject stdin/stdout captures). */
export interface McpStdioBridgeOptions {
    /** Resolved MCP endpoint URL (`--url`, the gateway prefix, or the direct server port). */
    url: string;
    /** Bearer token from the variable `server.mcp.authEnv` names; `null` sends no Authorization header. */
    token: string | null;
    /** NDJSON request source (process.stdin in production). */
    input: Readable;
    /** Stdout is the JSON-RPC channel; errors go to `output.error` (stderr) only. */
    output: CommandOutput;
}

/**
 * Forward newline-delimited JSON-RPC from `input` to `POST url`. Returns 0 on clean EOF, 1 when
 * the upstream is unreachable (transport failures stop
 * the bridge — every later line would fail the same way). HTTP error statuses are NOT failures:
 * their JSON bodies are forwarded like any other response.
 */
export async function runMcpStdioBridge(options: McpStdioBridgeOptions): Promise<number> {
    const reader = createInterface({ input: options.input });
    let legacy = false;
    // 1446 R1/AC3: the standard client identity is `initialize.params.clientInfo.name`, which only
    // this bridge sees — cache it and forward it as `X-Spur-Actor` (sanitized server-side).
    let actor: string | null = null;
    try {
        for await (const line of reader) {
            const body = line.trim();
            if (body === '') continue;
            const message = parseRpc(body);
            const id = message?.id;
            const hasId = typeof id === 'string' || typeof id === 'number';
            if (legacy && message?.method === 'notifications/initialized' && id === undefined) continue;
            if (legacy && message?.method === 'ping' && hasId) {
                options.output.write(JSON.stringify({ jsonrpc: '2.0', id, result: {} }));
                continue;
            }
            const requestedVersion = message?.params?.protocolVersion;
            const initialize = message?.method === 'initialize' && hasId && typeof requestedVersion === 'string';
            if (initialize) actor = clientName(message?.params?.clientInfo?.name);
            let res: Response;
            try {
                res = await fetch(options.url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Mcp-Protocol-Version': MCP_PROTOCOL_VERSION,
                        'X-Spur-Mcp-Via': 'stdio',
                        ...(actor !== null ? { 'X-Spur-Actor': actor } : {}),
                        ...(options.token !== null ? { Authorization: `Bearer ${options.token}` } : {}),
                    },
                    // A successful discovery proves the endpoint and bearer before we acknowledge stdio startup.
                    body: initialize ? JSON.stringify({ jsonrpc: '2.0', id, method: 'server/discover' }) : body,
                });
            } catch (err) {
                options.output.error(`spur mcp: cannot reach ${options.url}: ${errorMessage(err)}`);
                return 1;
            }
            const response = await res.text();
            if (!res.ok || (!initialize && !(legacy && message?.method === 'tools/call'))) {
                options.output.write(response);
                continue;
            }
            const reply = parseRpc(response);
            if (reply?.result === undefined) {
                options.output.write(response);
                continue;
            }
            if (initialize) {
                legacy = true;
                options.output.write(
                    JSON.stringify({
                        jsonrpc: '2.0',
                        id,
                        result: {
                            protocolVersion: LEGACY_VERSIONS.includes(requestedVersion)
                                ? requestedVersion
                                : '2025-11-25',
                            capabilities: { tools: {} },
                            serverInfo: { name: CLI_CONFIG.binaryName, version: CLI_CONFIG.binaryVersion },
                        },
                    }),
                );
                continue;
            }
            const result = reply.result as { content?: unknown } | null;
            options.output.write(
                Array.isArray(result?.content)
                    ? response
                    : JSON.stringify({
                          ...reply,
                          result: { content: [{ type: 'text', text: JSON.stringify(reply.result) }] },
                      }),
            );
        }
        return 0;
    } finally {
        reader.close();
    }
}

/**
 * Resolve the project's `/mcp` URL: explicit `--url` wins; otherwise every registered local entry
 * uses its canonical gateway prefix regardless of liveness. Only an unregistered project uses the
 * direct `server.port` fallback. The gateway-hosted root `/mcp` resolver is separate.
 */
export async function resolveMcpUrl(projectRoot: string, env: Record<string, string | undefined>): Promise<string> {
    const entry = findRegisteredEntry(projectRoot);
    const config = buildConfigFromEnv(env);
    if (entry !== undefined && isLocalHost(entry.host)) {
        const url = resolveProjectGatewayUrl(
            entry,
            { host: config.server.host, port: config.server.gateway.port },
            '/mcp',
        );
        if (url !== null) return url;
    }
    const port = entry !== undefined && entry.port > 0 ? entry.port : config.server.port;
    const host =
        entry !== undefined && entry.host !== undefined && entry.host.trim() !== '' ? entry.host.trim() : '127.0.0.1';
    return `http://${host}:${port}/mcp`;
}

/**
 * Resolve the GATEWAY's own `/mcp` endpoint (task 1401 R1): the root route on the gateway port, with
 * the token from `server.gateway.mcp.authEnv`. Every refusal names the fix; no token value is ever
 * printed. Checked before any traffic, so a misconfiguration fails at launch, not mid-session.
 */
export async function resolveGatewayMcpUrl(
    env: Record<string, string | undefined>,
    spurConfig?: Pick<SpurConfig, 'server'> | null,
): Promise<{ url: string; authEnv: string | undefined; allowUnauthenticated: boolean }> {
    const config = buildConfigFromEnv(env, spurConfig);
    const gateway = config.server.gateway;
    if (!gateway.mcp.enabled) {
        throw new CommandError(
            'the gateway MCP entry is disabled; set server.gateway.mcp.enabled true (SPUR_GATEWAY_MCP_ENABLED) and name its token variable with server.gateway.mcp.authEnv',
        );
    }
    const authEnv = gateway.mcp.authEnv;
    const allowUnauthenticated = gateway.mcp.allowUnauthenticated === true;
    const value = authEnv !== undefined ? env[authEnv] : undefined;
    if ((value === undefined || value === '') && !allowUnauthenticated) {
        throw new CommandError(
            `server.gateway.mcp.authEnv names "${authEnv ?? ''}" but that variable is unset or empty; the gateway would refuse every request`,
        );
    }
    if (!(await isGatewayAnswering(gateway.port))) {
        throw new CommandError(
            `no gateway is answering on port ${gateway.port}; start it with \`spur self serve --gateway\` (or pass --url for a direct project endpoint)`,
        );
    }
    return { url: `http://localhost:${gateway.port}/mcp`, authEnv, allowUnauthenticated };
}

/** Find this project's registry entry over `peek()` — the read-only snapshot never heals, purges
 * or probes, so resolving the URL has no side effects on the registry or on stale processes. */
function findRegisteredEntry(projectRoot: string) {
    const normalized = normalizeProjectPath(projectRoot);
    return new ProjectRegistry()
        .peek()
        .projects.find((p) => isLocalHost(p.host) && normalizeProjectPath(p.path) === normalized);
}

/** The bearer token for the variable `server.mcp.authEnv` names (R2). Unset/empty is a loud
 * misconfiguration unless `allowUnauthenticated` is true. */
function bearerToken(
    authEnv: string | undefined,
    env: Record<string, string | undefined>,
    allowUnauthenticated = false,
): string | null {
    if (authEnv === undefined) return null;
    const value = env[authEnv];
    if (value === undefined || value === '') {
        if (allowUnauthenticated) return null;
        throw new CommandError(
            `server.mcp.authEnv names "${authEnv}" but that variable is unset or empty; the endpoint would refuse every request`,
        );
    }
    return value;
}

/** Shared command name for registration and stdio banner suppression. */
export const MCP_COMMAND_NAME = 'mcp';

/** Register `spur mcp [--cwd <path>] [--url <mcpUrl>]` (frozen names, task 1373 Design). */
export function registerMcpCommand(
    program: Command,
    context: McpBridgeContext,
    loadProjectConfig?: (root: string) => Promise<SpurConfig | null>,
): void {
    bootFree(program.command(MCP_COMMAND_NAME, { hidden: true }))
        .summary('bridge stdio MCP clients to the project MCP endpoint (stdio-to-HTTP transport shim)')
        .option(...SHARED_OPTIONS.cwdServe, context.cwd)
        .option('--url <mcpUrl>', 'MCP endpoint URL (default: gateway prefix when routed, else the direct server port)')
        .option('--gateway', 'bridge to the gateway-hosted MCP entry at http://localhost:<server.gateway.port>/mcp')
        .action(async (options) => {
            try {
                if (options.gateway === true && options.url !== undefined) {
                    throw new CommandError(
                        '--gateway and --url are mutually exclusive: --gateway targets the gateway root, --url names an explicit endpoint',
                    );
                }
                const projectRoot = resolveServeCwd(options.cwd);
                // The composition root injects the tolerant loader (ADR-082); the facade call is the
                // fallback for an embedder that registers this command directly.
                const spurConfig = await (loadProjectConfig ?? loadSpurConfig)(projectRoot).catch(() => null);
                const config = buildConfigFromEnv(context.env, spurConfig);
                // --gateway takes ITS OWN token variable: a gateway credential is not a project's.
                const gatewayTarget =
                    options.gateway === true ? await resolveGatewayMcpUrl(context.env, spurConfig) : undefined;
                const token =
                    gatewayTarget !== undefined
                        ? bearerToken(gatewayTarget.authEnv, context.env, gatewayTarget.allowUnauthenticated)
                        : bearerToken(
                              config.server.mcp.authEnv,
                              context.env,
                              config.server.mcp.allowUnauthenticated === true,
                          );
                const url = gatewayTarget?.url ?? options.url ?? (await resolveMcpUrl(projectRoot, context.env));
                const exit = await runMcpStdioBridge({
                    url,
                    token,
                    input: process.stdin,
                    output: context.output,
                });
                if (exit !== 0) context.setExitCode(exit);
            } catch (err) {
                // stdout is the JSON-RPC channel — failures report on stderr only.
                context.output.error(errorMessage(err));
                context.setExitCode(1);
            }
        });
}
