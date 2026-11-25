import type {
    IntegrationsActivity,
    IntegrationsAuth,
    IntegrationsGateway,
    IntegrationsGatewayCounters,
    IntegrationsInboundMember,
    IntegrationsMcpExposureIssue,
    IntegrationsMcpSurface,
    IntegrationsMcpTool,
    IntegrationsOutboundMember,
    IntegrationsStatus,
    IntegrationsUsage,
} from '@gobing-ai/spur-contracts';
import { type DbAdapter, InboxDao, protocolUsageSummary } from '@gobing-ai/spur-domain';
import type { FleetService } from './fleet-service';

/**
 * The Integrations module's read-only assembly (feature A82, task 1423; design
 * `docs/design/integrations-module.md` §2).
 *
 * Three sources, one projection. The MCP catalog and the A2A settings live in `apps/server`, which
 * `packages/app` may not import, so both arrive through the {@link IntegrationsSources} port; the
 * fleet declaration and the ledger stay here. Only NAMES and booleans cross into this service — a
 * bearer token value never does, so it cannot reach a serialized response.
 */

/** The MCP settings + catalog the server owns (the same `listTools()` / resource list `tools/list` serves). */
export interface IntegrationsMcpSource {
    enabled: boolean;
    /** The token variable NAME (`server.mcp.authEnv`), never its value. */
    authEnv: string | null;
    /** True when local callers are admitted without a bearer token (1449 R3). */
    allowUnauthenticated?: boolean;
    tokenPresent: boolean;
    protocolVersion: string;
    tools: Array<{
        name: string;
        description?: string;
        inputSchema?: unknown;
        annotations?: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean };
    }>;
    resources: Array<{ uri: string; description?: string }>;
    /** Which advertised names are built-ins; everything else is manifest or workflow. */
    builtinToolNames: readonly string[];
    /** Which advertised names come from `plugins/<namespace>/mcp-tools.yaml` (task 1447 R5). */
    manifestToolNames?: readonly string[];
    /** The effective workflow tool namespace, where it came from, and the refused exposures (1438). */
    namespace?: string | null;
    namespaceSource?: 'config' | 'plugin-manifest' | 'none';
    exposureIssues?: IntegrationsMcpExposureIssue[];
}

/** The A2A settings the server owns. */
export interface IntegrationsA2aSource {
    enabled: boolean;
    authEnv: string | null;
    /** True when local callers are admitted without a bearer token (1449 R3). */
    allowUnauthenticated?: boolean;
    tokenPresent: boolean;
    /**
     * Outbound credential state keyed by member instance id (1440 R2). Only the variable NAME and its
     * presence cross this port — the server reads the environment, the service never does.
     */
    outboundAuth?: Record<string, IntegrationsAuth>;
}

/** What the gateway probe answered: its counters, or why they could not be read. */
export interface IntegrationsGatewayProbe {
    counters: IntegrationsGatewayCounters | null;
    mcp?: { enabled: boolean; auth: IntegrationsAuth };
    mcpActivity?: IntegrationsActivity;
    diagnostic?: string;
}

/** The server-owned half of the status read. */
export interface IntegrationsSources {
    mcp(): Promise<IntegrationsMcpSource>;
    a2a(): Promise<IntegrationsA2aSource>;
    /**
     * Called only when the request came through a gateway. `forwardedHost` is the caller's
     * `x-forwarded-host`, which the probe needs to resolve a gateway that was started on a port
     * nobody configured (1449 R1).
     */
    gateway(since?: string, forwardedHost?: string | null): Promise<IntegrationsGatewayProbe>;
    /** Why the project config failed to load at startup, if it did (1449 R1). */
    diagnostic?(): string | undefined;
}

/** Where the caller reached the server: what absolute URLs in the response must be built from. */
export interface IntegrationsRequestContext {
    /** Scheme + authority the caller used when no gateway headers are present (`https://host[:port]`). */
    origin: string;
    /** Forwarded scheme (`x-forwarded-proto`), so URLs behind TLS-terminating proxies keep `https://`. */
    forwardedProto?: string | null;
    /** The gateway's forwarded authority; with the prefix it builds the caller-visible base. */
    forwardedHost?: string | null;
    /** The gateway's mount prefix. A non-empty value is what marks a gateway request. */
    forwardedPrefix?: string | null;
    /** Canonical local gateway base for a direct-root request; unregistered/remote contexts omit it. */
    localGatewayBase?: string;
}

/** Dependencies for {@link IntegrationsService}. */
export interface IntegrationsServiceDeps {
    sources: IntegrationsSources;
    fleet: Pick<FleetService, 'load' | 'memberAddresses' | 'resolve'>;
    getDb: () => Promise<DbAdapter>;
    /** The project whose declaration, workflows and ledger the status describes. */
    projectPath: string;
}

/** A mount prefix without its trailing slash (`/tslibs/` → `/tslibs`). */
function mountPrefix(prefix: string | null | undefined): string {
    return (prefix ?? '').replace(/\/+$/, '');
}

/** Extract the first valid forwarded scheme (`http` or `https`), falling back to `http`. */
function forwardedScheme(proto: string | null | undefined): 'http' | 'https' {
    const first = proto?.split(',')[0]?.trim().toLowerCase();
    return first === 'https' ? 'https' : 'http';
}

/**
 * The base URL the caller used, prefix included. The gateway rewrites `host` to the upstream
 * loopback authority, so the forwarded pair is the caller's real base when both parts are present
 * — the same rule `cardOrigin()` applies on the A2A card (1395 R4).
 */
function callerBase(request: IntegrationsRequestContext): string {
    const host = request.forwardedHost?.trim() ?? '';
    const prefix = mountPrefix(request.forwardedPrefix);
    if (host === '' || prefix === '') {
        const local = request.localGatewayBase?.trim() ?? '';
        return local !== '' ? local.replace(/\/+$/, '') : request.origin.replace(/\/+$/, '');
    }
    return `${forwardedScheme(request.forwardedProto)}://${host}${prefix}`;
}

/** The gateway root: the caller's base with its mount prefix stripped. */
function gatewayRoot(base: string, prefix: string): string {
    const mounted = mountPrefix(prefix);
    return mounted !== '' && base.endsWith(mounted) ? base.slice(0, -mounted.length) : base;
}

/** An MCP tool's annotations, defaulted to the write pair only when a descriptor omits them. */
function annotationsOf(tool: {
    annotations?: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean };
}): { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean } {
    return tool.annotations ?? { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
}

/** The credentials block: the variable NAME always, its presence as a boolean, and the unauthenticated policy. */
function authOf(authEnv: string | null, tokenPresent: boolean, allowUnauthenticated?: boolean): IntegrationsAuth {
    return {
        envName: authEnv ?? '',
        tokenPresent,
        ...(allowUnauthenticated === true ? { allowUnauthenticated: true } : {}),
    };
}

/** Read-only projection over the project's agent-protocol surfaces (task 1423). */
export class IntegrationsService {
    constructor(private readonly deps: IntegrationsServiceDeps) {}

    /**
     * The status read. Always answers: a surface that is off reports `enabled: false`, and a failed
     * gateway probe reports `counters: null` with a diagnostic instead of failing the call.
     */
    async status(request: IntegrationsRequestContext): Promise<IntegrationsStatus> {
        const [mcpSource, a2aSource] = await Promise.all([this.deps.sources.mcp(), this.deps.sources.a2a()]);
        const prefix = request.forwardedPrefix ?? '';
        const underGateway = mountPrefix(prefix) !== '';
        const base = callerBase(request);
        const diagnostic = this.deps.sources.diagnostic?.();
        return {
            generatedAt: new Date().toISOString(),
            mcp: this.mcpSurface(mcpSource, base),
            a2a: await this.a2aSurface(a2aSource, base),
            gateway: underGateway ? await this.gateway(base, prefix, request.forwardedHost) : { served: false },
            ...(diagnostic === undefined ? {} : { configDiagnostic: diagnostic }),
        };
    }

    /** The windowed usage aggregate: the SAME fold the history artifact renders (I61). */
    async usage(input: { since?: string }, request?: IntegrationsRequestContext): Promise<IntegrationsUsage> {
        const db = await this.deps.getDb();
        const underGateway = mountPrefix(request?.forwardedPrefix) !== '';
        const [usage, outboundActivity, gateway] = await Promise.all([
            protocolUsageSummary(db, input.since === undefined ? {} : { since: input.since }),
            this.outboundActivity(db, input.since),
            underGateway ? this.deps.sources.gateway(input.since, request?.forwardedHost) : null,
        ]);
        return { ...usage, outboundActivity, gatewayMcpActivity: gateway?.mcpActivity ?? null };
    }

    private async outboundActivity(db: DbAdapter, since?: string): Promise<IntegrationsActivity> {
        const project = this.deps.projectPath;
        const members = (await this.deps.fleet.load(project))?.members ?? [];
        const activity: IntegrationsActivity = { calls: 0, failures: 0, lastCall: null, authDenials: 0 };
        if (!members.some((member) => member.a2a !== undefined || member.project !== undefined)) return activity;
        const addresses = await this.deps.fleet.memberAddresses(project);
        const targets = addresses.flatMap(({ instanceId }, index) => {
            const member = members[index];
            return member?.a2a !== undefined || member?.project !== undefined ? [instanceId] : [];
        });
        const cutoff = Date.parse(since ?? '');
        const rows = await new InboxDao(db).requests(targets, undefined, Number.isFinite(cutoff) ? cutoff : undefined);
        let lastCall = 0;
        for (const row of rows) {
            if (row.attempts === 0) continue;
            const denied = /\b(?:HTTP\s+401|UNAUTHENTICATED|needs-auth)\b/i.test(row.error ?? '');
            activity.calls += 1;
            if (row.status === 'failed' || row.runStatus === 'errored' || denied) activity.failures += 1;
            if (denied) activity.authDenials += 1;
            lastCall = Math.max(lastCall, row.claimedAt ?? row.deliveredAt ?? row.updatedAt);
        }
        activity.lastCall = activity.calls === 0 ? null : new Date(lastCall).toISOString();
        return activity;
    }

    private mcpSurface(source: IntegrationsMcpSource, base: string): IntegrationsMcpSurface {
        const tools: IntegrationsMcpTool[] = source.tools.map((tool) => ({
            name: tool.name,
            origin: source.builtinToolNames.includes(tool.name)
                ? 'built-in'
                : source.manifestToolNames?.includes(tool.name)
                  ? 'manifest'
                  : 'workflow',
            description: tool.description ?? '',
            annotations: annotationsOf(tool),
            inputSchema: tool.inputSchema ?? null,
        }));
        return {
            enabled: source.enabled,
            path: '/mcp',
            // The catalog is still listed when the surface is off — "off" is an answer, and the Board
            // shows what would be exposed — but there is no endpoint to copy.
            url: source.enabled ? `${base}/mcp` : null,
            auth: authOf(source.authEnv, source.tokenPresent, source.allowUnauthenticated),
            protocolVersion: source.protocolVersion,
            tools,
            resources: source.resources.map((resource) => ({
                uriTemplate: resource.uri,
                description: resource.description ?? '',
            })),
            // A server that does not report exposure omits the fields entirely, so an older status
            // response stays readable rather than reading as "no namespace" (1438).
            ...(source.namespace === undefined && source.exposureIssues === undefined
                ? {}
                : {
                      namespace: source.namespace ?? null,
                      namespaceSource: source.namespaceSource ?? ('none' as const),
                      exposureIssues: source.exposureIssues ?? [],
                  }),
        };
    }

    private async a2aSurface(source: IntegrationsA2aSource, base: string): Promise<IntegrationsStatus['a2a']> {
        const declaration = await this.deps.fleet.load(this.deps.projectPath);
        const addresses = await this.deps.fleet.memberAddresses(this.deps.projectPath);
        const writeCapable = await this.writeCapability();
        const members = declaration?.members ?? [];
        const inbound = addresses.flatMap((address, index): IntegrationsInboundMember[] => {
            const declared = members[index];
            // A member addressed by `a2a`/`project` is an outbound peer, not a receiver; disabled
            // members are refused with 404 by the A2A listener, so omit them here too.
            if (declared === undefined) return [];
            if (declared.enabled === false || !address.enabled) return [];
            if (declared.a2a !== undefined || declared.project !== undefined) return [];
            return [
                {
                    member: address.instanceId,
                    direction: 'inbound' as const,
                    role: address.role ?? null,
                    cardUrl: `${base}/a2a/members/${encodeURIComponent(address.instanceId)}/.well-known/agent-card.json`,
                    writeFenced: writeCapable.get(address.instanceId) ?? false,
                },
            ];
        });
        const outbound = members.flatMap((member, index): IntegrationsOutboundMember[] => {
            const instanceId = addresses[index]?.instanceId ?? member.id ?? '';
            const auth = source.outboundAuth?.[instanceId];
            if (member.a2a !== undefined)
                return [
                    {
                        member: instanceId,
                        direction: 'outbound' as const,
                        kind: 'a2a' as const,
                        target: member.a2a,
                        ...(auth === undefined ? {} : { auth }),
                    },
                ];
            if (member.project !== undefined) {
                return [
                    {
                        member: instanceId,
                        direction: 'outbound' as const,
                        kind: 'project' as const,
                        target: member.member === undefined ? member.project : `${member.project}/${member.member}`,
                        ...(auth === undefined ? {} : { auth }),
                    },
                ];
            }
            return [];
        });
        return {
            enabled: source.enabled,
            basePath: '/a2a',
            url: source.enabled ? `${base}/a2a` : null,
            auth: authOf(source.authEnv, source.tokenPresent, source.allowUnauthenticated),
            members: [...inbound, ...outbound],
        };
    }

    /**
     * Write fencing is an attestation of the member's RESOLVED executor, so it costs a resolve. A
     * declaration that cannot resolve (a pinned executor disabled) still has addresses, so this
     * degrades to `false` rather than failing the status read.
     */
    private async writeCapability(): Promise<Map<string, boolean>> {
        try {
            const resolved = await this.deps.fleet.resolve(this.deps.projectPath);
            return new Map(resolved.members.map((member) => [member.instanceId, member.writeCapable]));
        } catch {
            return new Map();
        }
    }

    private async gateway(base: string, prefix: string, forwardedHost?: string | null): Promise<IntegrationsGateway> {
        const probe = await this.deps.sources.gateway(undefined, forwardedHost);
        return {
            served: true,
            namespace: mountPrefix(prefix),
            rootMcpUrl: `${gatewayRoot(base, prefix)}/mcp`,
            counters: probe.counters,
            ...(probe.mcp === undefined ? {} : { mcp: probe.mcp }),
            ...(probe.diagnostic === undefined ? {} : { diagnostic: probe.diagnostic }),
        };
    }
}
