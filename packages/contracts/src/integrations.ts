import { oc } from '@orpc/contract';
import { z } from 'zod';

// ─── Integrations Board module wire shapes (feature A82, task 1423) ───
// The read-only status/usage pair the Board's Integrations module renders
// (`docs/design/integrations-module.md` §2). Names and booleans only: the bearer
// token VALUE never crosses this boundary, only the variable name and whether it is set.

/** MCP behaviour hints, mirrored from the descriptor the server advertises (task 1421 R2). */
export const integrationsAnnotationsSchema = z.object({
    readOnlyHint: z.boolean(),
    destructiveHint: z.boolean(),
    idempotentHint: z.boolean(),
});
/** Inferred type for {@link integrationsAnnotationsSchema}. */
export type IntegrationsAnnotations = z.infer<typeof integrationsAnnotationsSchema>;

/** One advertised MCP tool, with the origin the Board badges. */
export const integrationsMcpToolSchema = z.object({
    name: z.string(),
    origin: z.enum(['built-in', 'workflow']),
    description: z.string(),
    annotations: integrationsAnnotationsSchema,
    inputSchema: z.unknown(),
});
/** Inferred type for {@link integrationsMcpToolSchema}. */
export type IntegrationsMcpTool = z.infer<typeof integrationsMcpToolSchema>;

/** One `spur://` resource template the MCP surface advertises. */
export const integrationsMcpResourceSchema = z.object({
    uriTemplate: z.string(),
    description: z.string(),
});
/** Inferred type for {@link integrationsMcpResourceSchema}. */
export type IntegrationsMcpResource = z.infer<typeof integrationsMcpResourceSchema>;

/** A surface's credential state: the variable NAME and whether it resolved — never its value. */
export const integrationsAuthSchema = z.object({
    envName: z.string(),
    tokenPresent: z.boolean(),
});
/** Inferred type for {@link integrationsAuthSchema}. */
export type IntegrationsAuth = z.infer<typeof integrationsAuthSchema>;

/** One inbound A2A member as the fleet declaration publishes it. */
export const integrationsInboundMemberSchema = z.object({
    member: z.string(),
    role: z.string().nullable(),
    cardUrl: z.string(),
    /** True when the member's resolved executor attests write capability (the card's fencing extension). */
    writeFenced: z.boolean(),
});
/** Inferred type for {@link integrationsInboundMemberSchema}. */
export type IntegrationsInboundMember = z.infer<typeof integrationsInboundMemberSchema>;

/** One outbound member: an A2A peer card or a registered project's member. */
export const integrationsOutboundMemberSchema = z.object({
    member: z.string(),
    kind: z.enum(['a2a', 'project']),
    target: z.string(),
});
/** Inferred type for {@link integrationsOutboundMemberSchema}. */
export type IntegrationsOutboundMember = z.infer<typeof integrationsOutboundMemberSchema>;

/** The gateway's since-creation counters, exactly as `/api/health` reports them (task 1385). */
export const integrationsGatewayCountersSchema = z.object({
    since: z.string(),
    requests: z.number(),
    status4xx: z.number(),
    status5xx: z.number(),
    upstreamRestarts: z.record(z.string(), z.number()),
});
/** Inferred type for {@link integrationsGatewayCountersSchema}. */
export type IntegrationsGatewayCounters = z.infer<typeof integrationsGatewayCountersSchema>;

/** The MCP surface block. */
export const integrationsMcpSurfaceSchema = z.object({
    enabled: z.boolean(),
    path: z.literal('/mcp'),
    /** Absolute endpoint the caller can use, or null when the surface is off. */
    url: z.string().nullable(),
    auth: integrationsAuthSchema,
    protocolVersion: z.string(),
    tools: z.array(integrationsMcpToolSchema),
    resources: z.array(integrationsMcpResourceSchema),
});
/** Inferred type for {@link integrationsMcpSurfaceSchema}. */
export type IntegrationsMcpSurface = z.infer<typeof integrationsMcpSurfaceSchema>;

/** The A2A surface block. */
export const integrationsA2aSurfaceSchema = z.object({
    enabled: z.boolean(),
    basePath: z.literal('/a2a'),
    url: z.string().nullable().optional(),
    auth: integrationsAuthSchema,
    inbound: z.array(integrationsInboundMemberSchema),
    outbound: z.array(integrationsOutboundMemberSchema),
});
/** Inferred type for {@link integrationsA2aSurfaceSchema}. */
export type IntegrationsA2aSurface = z.infer<typeof integrationsA2aSurfaceSchema>;

/**
 * The gateway block: `served: false` standalone, and under a gateway the namespace it is mounted
 * on plus its counters. `counters: null` + `diagnostic` means the probe failed — the response
 * still succeeds, because "unreadable" is an answer the Board must render.
 */
export const integrationsGatewaySchema = z.discriminatedUnion('served', [
    z.object({ served: z.literal(false) }),
    z.object({
        served: z.literal(true),
        namespace: z.string(),
        rootMcpUrl: z.string(),
        counters: integrationsGatewayCountersSchema.nullable(),
        mcp: z.object({ enabled: z.boolean(), auth: integrationsAuthSchema }).optional(),
        diagnostic: z.string().optional(),
    }),
]);
/** Inferred type for {@link integrationsGatewaySchema}. */
export type IntegrationsGateway = z.infer<typeof integrationsGatewaySchema>;

/** The whole read-only status contract. */
export const integrationsStatusSchema = z.object({
    generatedAt: z.string(),
    mcp: integrationsMcpSurfaceSchema,
    a2a: integrationsA2aSurfaceSchema,
    gateway: integrationsGatewaySchema,
});
/** Inferred type for {@link integrationsStatusSchema}. */
export type IntegrationsStatus = z.infer<typeof integrationsStatusSchema>;

/** One MCP tool's windowed statistics (`protocolUsageSummary`). */
export const integrationsToolUsageSchema = z.object({
    tool: z.string(),
    calls: z.number(),
    failures: z.number(),
    failureRate: z.number(),
    p50Ms: z.number().nullable(),
    p95Ms: z.number().nullable(),
    durationUnmeasured: z.number(),
});

/** One resource template's windowed reads. */
export const integrationsResourceUsageSchema = z.object({
    uri: z.string(),
    reads: z.number(),
    failures: z.number(),
});

/** Per-actor call attribution. */
export const integrationsActorUsageSchema = z.object({
    actor: z.string(),
    calls: z.number(),
    failures: z.number(),
});

/** Per-member A2A intake and cancellation counts. */
export const integrationsA2aUsageSchema = z.object({
    member: z.string(),
    received: z.number(),
    replayed: z.number(),
    conflict: z.number(),
    cancelled: z.number(),
});

/** Bearer refusals per surface and reason. */
export const integrationsAuthDeniedUsageSchema = z.object({
    surface: z.string(),
    reason: z.string(),
    count: z.number(),
});

/** A repeated `(tool, errorCode)` failure pair. */
export const integrationsFailureClusterSchema = z.object({
    tool: z.string(),
    errorCode: z.string(),
    count: z.number(),
    firstAt: z.string(),
    lastAt: z.string(),
    sampleEventIds: z.array(z.string()),
});

/** The windowed protocol-usage aggregate (I61 `protocolUsageSummary`). */
export const integrationsActivitySchema = z.object({
    calls: z.number(),
    failures: z.number(),
    lastCall: z.string().nullable(),
    authDenials: z.number(),
});
/** Inferred type for {@link integrationsActivitySchema}. */
export type IntegrationsActivity = z.infer<typeof integrationsActivitySchema>;

/** Gateway routing counters and optional MCP enablement and activity. */
export const integrationsGatewayHealthSchema = z.object({
    counters: integrationsGatewayCountersSchema,
    mcp: z.object({ enabled: z.boolean(), auth: integrationsAuthSchema }).optional(),
    mcpActivity: integrationsActivitySchema.optional(),
});

/** Windowed usage, attribution and failures across the integration surfaces. */
export const integrationsUsageSchema = z.object({
    tools: z.array(integrationsToolUsageSchema),
    resources: z.array(integrationsResourceUsageSchema),
    byActor: z.array(integrationsActorUsageSchema),
    a2a: z.array(integrationsA2aUsageSchema),
    authDenied: z.array(integrationsAuthDeniedUsageSchema),
    failureClusters: z.array(integrationsFailureClusterSchema),
    gatewayMcpActivity: integrationsActivitySchema.nullable().optional(),
    outboundActivity: integrationsActivitySchema.optional(),
});
/** Inferred type for {@link integrationsUsageSchema}. */
export type IntegrationsUsage = z.infer<typeof integrationsUsageSchema>;

/** Window for {@link integrationsUsageSchema}; absent `since` is unbounded. */
export const integrationsUsageInputSchema = z.object({ since: z.string().optional() }).strict();
/** Inferred type for {@link integrationsUsageInputSchema}. */
export type IntegrationsUsageInput = z.infer<typeof integrationsUsageInputSchema>;

/** The Integrations procedures: one status read and one windowed usage read. */
export const integrationsContract = {
    status: oc
        .route({
            method: 'GET',
            path: '/integrations/status',
            summary: 'Read which agent-protocol surfaces this project exposes, and how they are secured',
            tags: ['integrations'],
        })
        .output(integrationsStatusSchema),
    usage: oc
        .route({
            method: 'GET',
            path: '/integrations/usage',
            summary: 'Read windowed MCP and A2A usage from the project event ledger',
            tags: ['integrations'],
        })
        .input(integrationsUsageInputSchema)
        .output(integrationsUsageSchema),
};
