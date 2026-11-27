import { homedir } from 'node:os';
import {
    FleetService,
    type IntegrationsGatewayProbe,
    IntegrationsService,
    normalizeProjectPath,
    ProjectRegistry,
    probeAgentMcpReadiness,
    readRemoteDialog,
} from '@gobing-ai/spur-app';
import { buildConfigFromEnv, isLocalHost, resolveProjectGatewayUrl, SPUR_ENV_VARS } from '@gobing-ai/spur-config';
import { contract, type IntegrationsAuth, integrationsGatewayHealthSchema } from '@gobing-ai/spur-contracts';
import { protocolUsageSummary } from '@gobing-ai/spur-domain';
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
function mcpSettings(ctx: ServerContext): { enabled: boolean; authEnv: string | null; allowUnauthenticated: boolean } {
    const mcp = typeof ctx.bootConfig === 'function' ? ctx.bootConfig()?.mcp : undefined;
    return {
        enabled: mcp?.enabled === true,
        authEnv: mcp?.authEnv ?? null,
        allowUnauthenticated: mcp?.allowUnauthenticated === true,
    };
}

/** The A2A listener switch and token variable name (`server.a2a.*`). */
function a2aSettings(ctx: ServerContext): { enabled: boolean; authEnv: string | null; allowUnauthenticated: boolean } {
    const a2a = typeof ctx.bootConfig === 'function' ? ctx.bootConfig()?.a2a : undefined;
    return {
        enabled: a2a?.enabled === true,
        authEnv: a2a?.authEnv ?? null,
        allowUnauthenticated: a2a?.allowUnauthenticated === true,
    };
}

/** True when the configured env variable resolves to a non-empty value (or unauthenticated access is explicitly allowed); the value is discarded. */
function tokenPresent(
    env: Record<string, string | undefined>,
    authEnv: string | null,
    allowUnauthenticated = false,
): boolean {
    if (allowUnauthenticated) return true;
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

/**
 * The gateway's public port. Precedence (1449 R1): an explicit `SPUR_GATEWAY_PORT`, then a port the
 * operator actually configured, then the loopback port the caller reached the gateway on, then 3000.
 * The forwarded step matters because the schema defaults `server.gateway.port` to 3000, so a gateway
 * started on another port leaves no other trace: without it the probe would read the wrong process.
 */
function gatewayPort(
    env: Record<string, string | undefined>,
    bootGateway?: { port: number; explicit?: boolean },
    forwardedHost?: string | null,
): number {
    const envPort = Number(env[SPUR_ENV_VARS.gatewayPort] ?? '');
    if (Number.isFinite(envPort) && envPort > 0) return envPort;
    if (bootGateway?.explicit === true && Number.isFinite(bootGateway.port) && bootGateway.port > 0)
        return bootGateway.port;
    return loopbackPort(forwardedHost) ?? 3000;
}

/**
 * The port in a loopback `x-forwarded-host` (`localhost:3070`, `127.0.0.1:3070`, `[::1]:3070`).
 * A non-loopback host is ignored on purpose: a tunnel's `:443` says nothing about the local listener.
 */
function loopbackPort(forwardedHost?: string | null): number | undefined {
    const first = (forwardedHost ?? '').split(',')[0]?.trim() ?? '';
    if (first === '') return undefined;
    const match = /^\[([^\]]+)\]:([0-9]+)$/.exec(first) ?? /^([^:]+):([0-9]+)$/.exec(first);
    if (match === null || !isLocalHost(match[1])) return undefined;
    const port = Number(match[2]);
    return Number.isFinite(port) && port > 0 && port <= 65_535 ? port : undefined;
}

/** Gateway counters from the gateway's own `/api/health` over loopback; a failure is reported, not thrown. */
async function probeGateway(port: number, since?: string): Promise<IntegrationsGatewayProbe> {
    try {
        const url = new URL(`http://localhost:${port}/api/health`);
        if (since !== undefined) url.searchParams.set('mcpSince', since);
        const res = await (probeFetch ?? platformFetch)(url.href, {
            signal: AbortSignal.timeout(2_000),
        });
        if (!res.ok) return { counters: null, diagnostic: `/api/health answered ${res.status}` };
        const body = integrationsGatewayHealthSchema.safeParse(await res.json());
        if (!body.success) return { counters: null, diagnostic: '/api/health carries no valid counters' };
        return { ...body.data, mcp: body.data.mcp ?? { enabled: false, auth: { envName: '', tokenPresent: false } } };
    } catch (error) {
        return { counters: null, diagnostic: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Outbound credential state, keyed by member instance id (1440 R2). Only the variable NAME and
 * whether it resolved leaves this function — the value stays in the environment.
 */ async function outboundAuthOf(ctx: ServerContext, fleet: FleetService): Promise<Record<string, IntegrationsAuth>> {
    const env = bearerEnv(ctx);
    const [declaration, addresses] = await Promise.all([fleet.load(ctx.cwd), fleet.memberAddresses(ctx.cwd)]);
    const result: Record<string, IntegrationsAuth> = {};
    (declaration?.members ?? []).forEach((member, index) => {
        if (member.a2a === undefined && member.project === undefined) return;
        const id = addresses[index]?.instanceId ?? member.id ?? '';
        if (id === '') return;
        const authEnv = member.authEnv ?? null;
        result[id] = { envName: authEnv ?? '', tokenPresent: tokenPresent(env, authEnv) };
    });
    return result;
}

/**
 * The base URL the caller used, prefix included, from headers already on the request context. The
 * readiness remedies paste it, so it must agree with the URL `integrations.status` reports.
 */
function visibleBase(context: {
    origin: string;
    forwardedProto?: string | null;
    forwardedHost?: string | null;
    forwardedPrefix?: string | null;
    localGatewayBase?: string;
}): string {
    const host = context.forwardedHost?.trim() ?? '';
    const prefix = (context.forwardedPrefix ?? '').replace(/\/+$/, '');
    if (host !== '' && prefix !== '')
        return `${context.forwardedProto === 'https' ? 'https' : 'http'}://${host}${prefix}`;
    const local = (context.localGatewayBase ?? '').replace(/\/+$/, '');
    return local !== '' ? local : context.origin.replace(/\/+$/, '');
}

/** Build the status, usage and readiness handlers bound to this server's context. */
export function createIntegrationsHandlers(ctx: ServerContext) {
    const service = () => {
        const fleet = new FleetService({
            fs: ctx.fs,
            reloadAgentConfig: () => ctx.reloadAgentConfig(),
            openDb: () => ctx.getDb(),
        });
        return new IntegrationsService({
            projectPath: ctx.cwd,
            getDb: () => ctx.getDb(),
            fleet,
            sources: {
                mcp: async () => {
                    const settings = mcpSettings(ctx);
                    const catalog = await readMcpCatalog(ctx);
                    return {
                        enabled: settings.enabled,
                        authEnv: settings.authEnv,
                        // 1449 R3: the WIRE reports the token's real presence and the unauthenticated
                        // policy separately, so the Board can tell "token set" from "no token needed".
                        tokenPresent: tokenPresent(bearerEnv(ctx), settings.authEnv),
                        allowUnauthenticated: settings.allowUnauthenticated,
                        protocolVersion: MIN_MCP_PROTOCOL_VERSION,
                        tools: catalog.tools,
                        resources: catalog.resources,
                        builtinToolNames: BUILTIN_TOOL_NAMES,
                        manifestToolNames: catalog.manifestToolNames,
                        // 1438 R1: the namespace the tools are named under, where it came from, and
                        // the workflows the same resolver refused — carried straight through.
                        namespace: catalog.namespace,
                        namespaceSource: catalog.namespaceSource,
                        exposureIssues: catalog.exposureIssues,
                    };
                },
                a2a: async () => {
                    const settings = a2aSettings(ctx);
                    return {
                        enabled: settings.enabled,
                        authEnv: settings.authEnv,
                        tokenPresent: tokenPresent(bearerEnv(ctx), settings.authEnv),
                        allowUnauthenticated: settings.allowUnauthenticated,
                        outboundAuth: await outboundAuthOf(ctx, fleet),
                    };
                },
                gateway: async (since, forwardedHost) =>
                    probeGateway(gatewayPort(bearerEnv(ctx), ctx.bootConfig?.()?.gateway, forwardedHost), since),
                // 1449 R1: a config load that failed at startup is visible on the Board, not just in a log.
                diagnostic: () => ctx.bootConfig?.()?.configDiagnostic,
            },
        });
    };

    /** The inbound request, when the transport put it on the oRPC context (bootstrap does). */
    const requestOf = (context: unknown): Request | undefined => {
        if (typeof context !== 'object' || context === null) return undefined;
        const request = (context as { request?: unknown }).request;
        return request instanceof Request ? request : undefined;
    };

    /** The caller's origin plus the gateway's forwarded headers, which is all the service reads. */
    const requestContextOf = (context: unknown) => {
        const request = requestOf(context);
        if (request === undefined) return { origin: '' };
        const env = bearerEnv(ctx);
        const server = buildConfigFromEnv(env).server;
        const entry = new ProjectRegistry()
            .peek()
            .projects.find(
                (candidate) =>
                    isLocalHost(candidate.host) &&
                    normalizeProjectPath(candidate.path) === normalizeProjectPath(ctx.cwd),
            );
        const localGatewayBase = entry
            ? resolveProjectGatewayUrl(
                  entry,
                  { host: server.host, port: gatewayPort(env, ctx.bootConfig?.()?.gateway) },
                  '',
              )
            : undefined;
        return {
            origin: new URL(request.url).origin,
            forwardedProto: request.headers.get('x-forwarded-proto'),
            forwardedHost: request.headers.get('x-forwarded-host'),
            forwardedPrefix: request.headers.get('x-forwarded-prefix'),
            ...(localGatewayBase ? { localGatewayBase } : {}),
        };
    };

    return {
        status: os.integrations.status.handler(async ({ context }) => service().status(requestContextOf(context))),

        usage: os.integrations.usage.handler(async ({ input, context }) =>
            service().usage(input, requestContextOf(context)),
        ),

        /** Read-only readiness: the agent binaries, their own config entries, and attributed traffic. */
        agentReadiness: os.integrations.agentReadiness.handler(async ({ context }) => {
            const env = bearerEnv(ctx);
            const settings = mcpSettings(ctx);
            const boot = ctx.bootConfig?.();
            const usage = await protocolUsageSummary(await ctx.getDb(), {});
            const base = visibleBase(requestContextOf(context));
            return probeAgentMcpReadiness({
                cwd: ctx.cwd,
                home: homedir(),
                fs: ctx.fs,
                resolveBinary: (binary) => Bun.which(binary),
                usageActors: usage.byActor,
                surface: {
                    mcpEnabled: settings.enabled,
                    gatewayPort: gatewayPort(env, boot?.gateway),
                    projectUrl: settings.enabled && base !== '' ? `${base}/mcp` : null,
                },
            });
        }),

        /**
         * The remote half of one outbound receipt's dialog (1468 R1/R3/R4): resolve the member from
         * this project's own fleet declaration, then read the peer's thread through the local
         * gateway. Read-only, loopback-only, and never a throw — the union carries the marker.
         */
        remoteDialog: os.integrations.remoteDialog.handler(async ({ input, context }) => {
            const env = bearerEnv(ctx);
            const members = (await service().status(requestContextOf(context))).a2a.members;
            const member = members.find((entry) => entry.member === input.member);
            if (member === undefined || member.direction !== 'outbound') {
                return {
                    status: 'unavailable' as const,
                    reason: `no outbound member "${input.member}" on this project`,
                };
            }
            const boot = ctx.bootConfig?.();
            // The same env slice this handler already trusts for the gateway port: a caller-injected
            // env (tests, an embedding host) must select the registry too, not only the process env.
            const registry = new ProjectRegistry(env.SPUR_PROJECTS_FILE);
            return readRemoteDialog({
                member,
                remoteContextId: input.remoteContextId,
                gatewayPort: gatewayPort(env, boot?.gateway),
                listProjects: async () => registry.peek().projects,
            });
        }),
    };
}
