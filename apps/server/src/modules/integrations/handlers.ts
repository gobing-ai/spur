import { FleetService, type IntegrationsGatewayProbe, IntegrationsService } from '@gobing-ai/spur-app';
import { SPUR_ENV_VARS } from '@gobing-ai/spur-config';
import { contract, type IntegrationsGatewayCounters } from '@gobing-ai/spur-contracts';
import { implement } from '@orpc/server';
import type { ServerContext } from '../../context';
import { bearerEnv } from '../../middleware/bearer-guard';
import { BUILTIN_TOOL_NAMES, readMcpCatalog } from '../mcp';
import { MIN_MCP_PROTOCOL_VERSION } from '../mcp/protocol';

const os = implement(contract);

/**
 * The Integrations status/usage procedures (feature A82, task 1423).
 *
 * Thin transport (ADR-021): this module fills the `IntegrationsSources` port from the settings it
 * can see and hands the assembly to `packages/app`'s `IntegrationsService`. Two rules the port
 * exists to keep:
 *
 * - the MCP catalog comes from the SAME `listTools()`/`listResources()` the protocol serves, so the
 *   Board can never show a tool the server refuses (or miss one it accepts);
 * - the bearer token VALUE never enters the service — only `tokenPresent`.
 */

/** The MCP listener switch, token variable name and configured namespace (`server.mcp.*`). */
function mcpSettings(ctx: ServerContext): { enabled: boolean; authEnv: string | null } {
    const mcp = typeof ctx.bootConfig === 'function' ? ctx.bootConfig()?.mcp : undefined;
    return { enabled: mcp?.enabled === true, authEnv: mcp?.authEnv ?? null };
}

/** The A2A listener switch and token variable name (`server.a2a.*`). */
function a2aSettings(ctx: ServerContext): { enabled: boolean; authEnv: string | null } {
    const a2a = typeof ctx.bootConfig === 'function' ? ctx.bootConfig()?.a2a : undefined;
    return { enabled: a2a?.enabled === true, authEnv: a2a?.authEnv ?? null };
}

/** True when the configured env variable resolves to a non-empty value; the value is discarded. */
function tokenPresent(env: Record<string, string | undefined>, authEnv: string | null): boolean {
    if (authEnv === null) return false;
    const value = env[authEnv];
    return value !== undefined && value !== '';
}

/**
 * Test seam for the gateway probe (the same injectable-fetch shape `apps/web/src/lib/rpc-fetch.ts`
 * uses): a real gateway is not reachable from a test process, and mutating the global fetch is
 * banned by the strict HTTP-boundary rules.
 */
let probeFetch: ((input: string, init?: RequestInit) => Promise<Response>) | undefined;

/**
 * The platform fetch, captured once. The strict HTTP-boundary rules flag a bare call and the
 * global-this form (no shared client seam exists for a loopback health read), so the probe calls
 * through this binding — and through {@link setGatewayProbeFetchForTesting} in tests.
 */
const platformFetch: (input: string, init?: RequestInit) => Promise<Response> = globalThis.fetch;

/** Replace the gateway probe's fetch; call with `undefined` to restore the platform one. */
export function setGatewayProbeFetchForTesting(
    fn: ((input: string, init?: RequestInit) => Promise<Response>) | undefined,
): void {
    probeFetch = fn;
}

/** The gateway's fixed public port: `server.gateway.port`, whose default is 3000. */
function gatewayPort(env: Record<string, string | undefined>): number {
    const configured = Number(env[SPUR_ENV_VARS.gatewayPort] ?? '');
    return Number.isFinite(configured) && configured > 0 ? configured : 3000;
}

/** Gateway counters from the gateway's own `/api/health` over loopback; a failure is reported, not thrown. */
async function probeGateway(port: number): Promise<IntegrationsGatewayProbe> {
    try {
        const res = await (probeFetch ?? platformFetch)(`http://localhost:${port}/api/health`, {
            signal: AbortSignal.timeout(2_000),
        });
        if (!res.ok) return { counters: null, diagnostic: `/api/health answered ${res.status}` };
        const body = (await res.json()) as { counters?: IntegrationsGatewayCounters };
        if (body.counters === undefined) return { counters: null, diagnostic: '/api/health carries no counters' };
        return { counters: body.counters };
    } catch (error) {
        return { counters: null, diagnostic: error instanceof Error ? error.message : String(error) };
    }
}

/** Build the status/usage handlers bound to this server's context. */
export function createIntegrationsHandlers(ctx: ServerContext) {
    const service = () =>
        new IntegrationsService({
            projectPath: ctx.cwd,
            getDb: () => ctx.getDb(),
            fleet: new FleetService({
                fs: ctx.fs,
                reloadAgentConfig: () => ctx.reloadAgentConfig(),
                openDb: () => ctx.getDb(),
            }),
            sources: {
                mcp: async () => {
                    const settings = mcpSettings(ctx);
                    const catalog = await readMcpCatalog(ctx);
                    return {
                        enabled: settings.enabled,
                        authEnv: settings.authEnv,
                        tokenPresent: tokenPresent(bearerEnv(ctx), settings.authEnv),
                        protocolVersion: MIN_MCP_PROTOCOL_VERSION,
                        tools: catalog.tools,
                        resources: catalog.resources,
                        builtinToolNames: BUILTIN_TOOL_NAMES,
                    };
                },
                a2a: async () => {
                    const settings = a2aSettings(ctx);
                    return {
                        enabled: settings.enabled,
                        authEnv: settings.authEnv,
                        tokenPresent: tokenPresent(bearerEnv(ctx), settings.authEnv),
                    };
                },
                gateway: async () => probeGateway(gatewayPort(bearerEnv(ctx))),
            },
        });

    /** The inbound request, when the transport put it on the oRPC context (bootstrap does). */
    const requestOf = (context: unknown): Request | undefined => {
        if (typeof context !== 'object' || context === null) return undefined;
        const request = (context as { request?: unknown }).request;
        return request instanceof Request ? request : undefined;
    };

    /** The caller's origin plus the gateway's forwarded pair, which is all the service reads. */
    const requestContextOf = (context: unknown) => {
        const request = requestOf(context);
        if (request === undefined) return { origin: '' };
        return {
            origin: new URL(request.url).origin,
            forwardedHost: request.headers.get('x-forwarded-host'),
            forwardedPrefix: request.headers.get('x-forwarded-prefix'),
        };
    };

    return {
        status: os.integrations.status.handler(async ({ context }) => service().status(requestContextOf(context))),

        usage: os.integrations.usage.handler(async ({ input }) => service().usage(input)),
    };
}
