import { type AgentConfig, DEFAULT_AGENT_ROLES } from '@gobing-ai/spur-config';
import { getCanonicalStage, TIER_RANK } from '@gobing-ai/spur-domain';
import type { AgentRoleDefinition } from './agent-service';

/**
 * Resolve the Layer-1 role table (ADR-078, superseding ADR-061): the config
 * layer is the SSOT. `agent.roles` — merged global-then-project by the layered
 * loader (task 0640) and validated against the closed vocabulary at config load
 * — wins per-field over `DEFAULT_AGENT_ROLES`, which ADR-078 demotes to a
 * byte-identical fallback used only when NO layer supplies a table (the CF-safe
 * core must resolve roles with no filesystem). The shipped table lives in
 * `config/config.global.yaml`; the roles.md runtime parse stays deleted — the
 * plugin file survives as a parity-gated projection
 * (`plugins/sp/tests/roles.test.ts` R9, three-way since 0647).
 *
 * Override stage ids are validated HERE (0572 R10): the CF-safe config core
 * cannot import the stage registry, and `AgentService.stageForRole` silently
 * skips unknown ids — so an unvalidated typo (`stages: [implment]`) or an
 * empty array (hand-built config bypassing the schema) would quietly cut a
 * role-only dispatch off from `model_policy` and the escalation ladder.
 * Throws naming the role and the offending ids, matching the config-load
 * fail-fast for unknown role keys.
 *
 * The merged row must also keep the role-table floor invariant (roles R4):
 * a role's tier may not sit below the highest `min_tier` among its folded
 * stages. The parity gate enforces it for `DEFAULT_AGENT_ROLES` only — a
 * re-tier or re-stage override could otherwise let a role-only dispatch
 * start cheaper than its stage floor with no clamp downstream.
 */
export function resolveAgentRoles(agentConfig?: AgentConfig): Map<string, AgentRoleDefinition> {
    const overrides = agentConfig?.roles;
    if (overrides === undefined) return new Map(DEFAULT_AGENT_ROLES);
    const resolved = new Map<string, AgentRoleDefinition>();
    for (const [role, spec] of DEFAULT_AGENT_ROLES) {
        const override = overrides[role];
        if (override?.stages !== undefined) {
            const unknown = override.stages.filter((id) => getCanonicalStage(id) === undefined);
            if (override.stages.length === 0 || unknown.length > 0) {
                const detail =
                    unknown.length > 0
                        ? `unknown stage id(s): ${unknown.join(', ')}`
                        : 'empty stages array (omit the field to keep the default)';
                throw new Error(
                    `Invalid agent.roles.${role}.stages — ${detail}. Stage ids must come from the canonical stage registry.`,
                );
            }
        }
        const tier = override?.tier ?? spec.tier;
        const stages = override?.stages ?? spec.stages;
        // Floor invariant (roles R4): merged tier must meet the highest stage min_tier.
        let floorStage: { id: string; minTier: keyof typeof TIER_RANK } | undefined;
        for (const id of stages) {
            const record = getCanonicalStage(id);
            if (record === undefined) continue; // override ids validated above; defaults parity-gated
            if (floorStage === undefined || TIER_RANK[record.model_policy.min_tier] > TIER_RANK[floorStage.minTier]) {
                floorStage = { id, minTier: record.model_policy.min_tier };
            }
        }
        if (floorStage !== undefined && TIER_RANK[tier] < TIER_RANK[floorStage.minTier]) {
            throw new Error(
                `Invalid agent.roles.${role} — tier '${tier}' sits below the role's stage floor: ` +
                    `stage '${floorStage.id}' requires min_tier '${floorStage.minTier}'. ` +
                    `A role-only dispatch may never start cheaper than its stage floor (roles R4 / ADR-061).`,
            );
        }
        resolved.set(role, { tier, stages });
    }
    return resolved;
}
