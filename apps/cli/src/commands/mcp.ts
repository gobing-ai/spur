import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { Command } from '@commander-js/extra-typings';
import { isGatewayAnswering, normalizeProjectPath, ProjectRegistry } from '@gobing-ai/spur-app';
import { buildConfigFromEnv, isLocalHost, resolveProjectPrefix } from '@gobing-ai/spur-config';
import type { CliContext } from '../context';
import { CommandError, errorMessage } from '../errors';
import type { CommandOutput } from '../output';
import { resolveServeCwd } from './self/serve';
import { SHARED_OPTIONS } from './shared-options';

/**
 * `spur mcp` — thin stdio-to-HTTP bridge (feature B9, task 1373) so stdio-only MCP clients can
 * reach the embedded `/mcp` endpoint mounted by task 1372. Strictly a transport shim: every
 * stdin line is one `POST /mcp` request and each response body is echoed to stdout verbatim —
 * no tool/resource execution here (anti-pattern), the endpoint owns the whole protocol.
 *
 * Server settings (`server.mcp.authEnv`, ports) read from the same app-layer env config as
 * `spur self serve` (`buildConfigFromEnv`) — the server config surface is env-scoped, not project-file.
 */

/** Mirrors the server adapter's `MIN_MCP_PROTOCOL_VERSION` (`apps/server/src/modules/mcp/protocol.ts`);
 * the server barrel does not re-export it and deep cross-workspace imports are forbidden. */
export const MCP_PROTOCOL_VERSION = '2026-07-28';

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
 * Forward newline-delimited JSON-RPC from `input` to `POST url`, echoing each response body
 * verbatim. Returns 0 on clean EOF, 1 when the upstream is unreachable (transport failures stop
 * the bridge — every later line would fail the same way). HTTP error statuses are NOT failures:
 * their JSON bodies are forwarded like any other response.
 */
export async function runMcpStdioBridge(options: McpStdioBridgeOptions): Promise<number> {
    const reader = createInterface({ input: options.input });
    try {
        for await (const line of reader) {
            const body = line.trim();
            if (body === '') continue;
            let res: Response;
            try {
                res = await fetch(options.url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Mcp-Protocol-Version': MCP_PROTOCOL_VERSION,
                        ...(options.token !== null ? { Authorization: `Bearer ${options.token}` } : {}),
                    },
                    body,
                });
            } catch (err) {
                options.output.error(`spur mcp: cannot reach ${options.url}: ${errorMessage(err)}`);
                return 1;
            }
            options.output.write(await res.text());
        }
        return 0;
    } finally {
        reader.close();
    }
}

/**
 * Resolve the project's `/mcp` URL (R1): explicit `--url` wins; else the gateway prefix URL when
 * this project is registered and the gateway answers on its fixed port (same precedence as the
 * `projects list` URL column, K4 R7); else the direct port — the registry's recorded live port,
 * falling back to `server.port` from the app-layer config.
 */
export async function resolveMcpUrl(projectRoot: string, env: Record<string, string | undefined>): Promise<string> {
    const entry = findRegisteredEntry(projectRoot);
    const config = buildConfigFromEnv(env);
    if (entry !== undefined && isLocalHost(entry.host)) {
        const prefix = resolveProjectPrefix(entry);
        if (prefix !== null && (await isGatewayAnswering(config.server.gateway.port))) {
            return `http://127.0.0.1:${config.server.gateway.port}${prefix}/mcp`;
        }
    }
    const port = entry !== undefined && entry.port > 0 ? entry.port : config.server.port;
    const host =
        entry !== undefined && entry.host !== undefined && entry.host.trim() !== '' ? entry.host.trim() : '127.0.0.1';
    return `http://${host}:${port}/mcp`;
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
 * misconfiguration: the endpoint would refuse every request (same posture as task 1372). */
function bearerToken(authEnv: string | undefined, env: Record<string, string | undefined>): string | null {
    if (authEnv === undefined) return null;
    const value = env[authEnv];
    if (value === undefined || value === '') {
        throw new CommandError(
            `server.mcp.authEnv names "${authEnv}" but that variable is unset or empty; the endpoint would refuse every request`,
        );
    }
    return value;
}

/** Register `spur mcp [--cwd <path>] [--url <mcpUrl>]` (frozen names, task 1373 Design). */
export function registerMcpCommand(program: Command, context: McpBridgeContext): void {
    program
        .command('mcp')
        .summary('bridge stdio MCP clients to the project MCP endpoint (stdio-to-HTTP transport shim)')
        .option(...SHARED_OPTIONS.cwdServe, context.cwd)
        .option('--url <mcpUrl>', 'MCP endpoint URL (default: gateway prefix when routed, else the direct server port)')
        .action(async (options) => {
            try {
                const projectRoot = resolveServeCwd(options.cwd);
                const config = buildConfigFromEnv(context.env);
                const token = bearerToken(config.server.mcp.authEnv, context.env);
                const url = options.url ?? (await resolveMcpUrl(projectRoot, context.env));
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
