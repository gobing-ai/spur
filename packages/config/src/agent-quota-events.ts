import { z } from 'zod';

/**
 * Trusted-shape schemas for `agent.quota.exhausted` / `agent.quota.recovered`
 * payloads emitted by `@gobing-ai/ts-ai-runner` (task 0799, ADR-111). The
 * durable `agent_executor_updates` consumer validates every event against
 * these schemas before attribution checks — a malformed payload is a
 * classified rejection, never a YAML write. Mirrors the upstream d.ts
 * contract exactly; lives on its own subpath export (like `./loader`) so
 * Workers-bundled consumers never pull the Node-only root barrel.
 */

/** Attribution identity carried on quota events — optional fields, runner never infers them. */
export const quotaAttributionSchema = z
    .object({
        projectId: z.string().min(1).optional(),
        executor: z.string().min(1).optional(),
        agent: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
    })
    .strict();

/** Run correlation block shared with other agent lifecycle events. */
export const agentRunCorrelationSchema = z
    .object({
        runId: z.string().min(1).optional(),
        executionId: z.string().min(1).optional(),
        actionId: z.string().min(1).optional(),
    })
    .strict();

/** `agent.quota.exhausted` payload — a verified quota-exhaustion observation. */
export const agentQuotaObservationSchema = z
    .object({
        /** Deterministic across redelivery: digest over evidence, reason, attribution identity. */
        observationId: z.string().min(1),
        /** UTC ISO-8601 with millisecond precision. */
        observedAt: z.string().min(1),
        evidenceSource: z.enum(['buffered-error', 'streaming-error', 'health-probe']),
        reason: z.enum([
            'insufficient_quota',
            'insufficient_credit_balance',
            'quota_exceeded',
            'usage_limit_reached',
            'credits_exhausted',
            'billing_hard_limit_reached',
            'provider_quota_exhausted',
        ]),
        detail: z.string().optional(),
        attribution: quotaAttributionSchema.optional(),
        correlation: agentRunCorrelationSchema.optional(),
    })
    .strict();

/** `agent.quota.recovered` payload — explicit recovery, no automatic producer exists. */
export const agentQuotaRecoverySchema = z
    .object({
        /** The observationId whose quota state recovered. */
        observationId: z.string().min(1),
        /** UTC ISO-8601 with millisecond precision. */
        recoveredAt: z.string().min(1),
        attribution: quotaAttributionSchema.optional(),
        correlation: agentRunCorrelationSchema.optional(),
    })
    .strict();

/** Attribution block shared by exhaustion and recovery payloads. */
export type QuotaAttributionInput = z.infer<typeof quotaAttributionSchema>;
/** Validated `agent.quota.exhausted` payload before trust/attribution checks. */
export type AgentQuotaObservationInput = z.infer<typeof agentQuotaObservationSchema>;
/** Validated `agent.quota.recovered` payload before trust/attribution checks. */
export type AgentQuotaRecoveryInput = z.infer<typeof agentQuotaRecoverySchema>;

/**
 * Structural profile binding an executor entry must still carry when a quota
 * event is validated or applied — the subset of `AgentExecutorConfigSchema`
 * output the binding check reads (`agent` required, `model` optional).
 * Declared here so consumers of this subpath need no root-barrel import.
 */
export interface QuotaExecutorProfileBinding {
    name: string;
    agent: string;
    model?: string;
}

/**
 * Exact (case-sensitive) executor lookup for quota-event validation and drain
 * revalidation. Returns undefined when the entry no longer exists — a
 * classified rejection at record time, a no-op ack at drain time.
 */
export function resolveQuotaExecutorBinding(
    executors: readonly QuotaExecutorProfileBinding[] | undefined,
    name: string,
): QuotaExecutorProfileBinding | undefined {
    return executors?.find((candidate) => candidate.name === name);
}

/**
 * Normalize a claimed UTC timestamp to UTC ISO-8601 milliseconds, or return
 * undefined when unparsable (classified rejection downstream). Lexical order
 * of the normalized form is chronological, which the delivery record relies on.
 */
export function normalizeQuotaTimestamp(value: string): string | undefined {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed.toISOString();
}
