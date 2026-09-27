/**
 * Executor-tier policy leaf (task 0965, feature B21): pure capability-tier
 * policy extracted from the agent service god-module. This module is a leaf —
 * it must import nothing from that module; consumers (`fleet-service`,
 * `history-service`, and the agent service itself) read policy from here.
 */
import { type ExecutorDisabledValue, normalizeExecutorAvailability } from '@gobing-ai/spur-config';
import { type CapabilityTier, isTierEligible, TIER_RANK } from '@gobing-ai/spur-domain';

/**
 * A named executor profile: a canonical coding-agent plus an optional opaque
 * model override. Mirrors the CLI's `AgentExecutorConfig` zod shape structurally
 * (the app layer must not import from `apps/cli`, R3).
 *
 * Vocabulary (task 0405, R1): "executor" is the domain-layer term for the role
 * a stage dispatches (reasoned about by `getExecutorTier`, `isTierEligible`,
 * the eligible-executor list). The operator surface says "agent" (CLI `--agent`,
 * the `agent:` config key, this struct's `agent` field naming the canonical
 * tool). The split is deliberate; the boundary is recorded at
 * `AgentConfigSchema` in `@gobing-ai/spur-config`. No alias, no migration.
 */
export interface AgentExecutorConfig {
    name: string;
    agent: string;
    model?: string;
    tier?: CapabilityTier;
    /** 111: routing kill-switch; validated/merged at the config boundary. */
    disabled: ExecutorDisabledValue;
}

/**
 * Single classified reader for executor availability (0890 review remediation):
 * every eligibility/probe/inventory site branches on this instead of comparing
 * the raw `disabled` field, so the 0890 object form (`{owner,since,reason}`)
 * and the legacy boolean are classified identically.
 */
export function executorDisabled(executor?: AgentExecutorConfig): boolean {
    return executor !== undefined && normalizeExecutorAvailability(executor.disabled).disabled;
}

/**
 * Resolve an executor's capability tier (0343).
 * Declared `tier` wins. Inference may only yield `cheap`, `standard`, or
 * `capable-1` — never invent `capable-2`/`capable-3` from a regex.
 * Legacy bare `capable` (if still present on a raw config object) maps to
 * `capable-1`.
 */
export function getExecutorTier(executor: AgentExecutorConfig): CapabilityTier {
    if (executor.tier) {
        // Structural compat: configs that skip zod may still carry legacy `capable`.
        const declared = executor.tier as CapabilityTier | 'capable';
        return declared === 'capable' ? 'capable-1' : declared;
    }
    const combined = `${executor.name} ${executor.model ?? ''} ${executor.agent}`.toLowerCase();
    if (/\b(cheap|haiku|flash|lite|mini|fast)\b/.test(combined)) return 'cheap';
    if (/\b(capable|opus|pro|sonnet|r1|o1|o3|expert)\b/.test(combined)) return 'capable-1';
    return 'standard';
}

/**
 * The shared role → executor funnel (0543 R1): eligible executors (tier at or
 * above `minTier`) sorted by tier ascending — cheapest eligible first. One
 * selector, never two: `resolveRole` (`--agent <role>`) and the fleet roster
 * materialization in `FleetService` (role-only members) both route through this, so
 * the two can never disagree. `resolveRole` doctor-walks the result; roster
 * materialization takes the first entry (config-time, no liveness probe).
 */
export function cheapestEligibleExecutors(
    executors: readonly AgentExecutorConfig[],
    minTier: CapabilityTier,
): AgentExecutorConfig[] {
    return executors
        .filter((e) => !executorDisabled(e))
        .filter((e) => isTierEligible(getExecutorTier(e), minTier))
        .sort((a, b) => TIER_RANK[getExecutorTier(a)] - TIER_RANK[getExecutorTier(b)]);
}
