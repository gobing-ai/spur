import { AGENT_ROLE_NAMES } from '@gobing-ai/spur-config';
import type { ResolvedFleetMember } from './fleet-service';

/** Minimal read seam over a project's resolved fleet members (G72 R1). */
export type FleetMemberLister = () => Promise<ResolvedFleetMember[]>;

/** Result of role/executor addressee resolution. */
export type RoleTargetResolution =
    | { ok: true; specId: string; count: number; candidates: string[] }
    | {
          ok: false;
          /** `unknown_selector` → usage (exit 2); `selector_unmatched` / `selector_ambiguous` → exit 1. */
          code: 'unknown_selector' | 'selector_unmatched' | 'selector_ambiguous';
          message: string;
      };

/**
 * One-call selector resolution for CLI commands: resolve `selector` against
 * AGENT_ROLE_NAMES ∪ configured executor names over the project's resolved fleet
 * members.
 *
 * Members come from `agent.fleet` (G72 R1) — the declaration is the roster, so a
 * stale spec file can never become addressable.
 */
export async function resolveAgentSelector(
    listMembers: FleetMemberLister,
    agentConfig: { executors?: Array<{ name: string }> } | null | undefined,
    selector: string,
): Promise<RoleTargetResolution> {
    return resolveRoleTarget(
        await listMembers(),
        selector,
        AGENT_ROLE_NAMES,
        agentConfig?.executors?.map((e) => e.name) ?? [],
    );
}

/**
 * Resolve a role-addressed selector to exactly one declared fleet member id.
 *
 * Vocabulary is `AGENT_ROLE_NAMES` ∪ configured executor names; membership
 * decides the lookup kind (byRole vs byExecutor). Disabled members are not
 * addressable — they are not running members. Zero matches and multi matches are
 * hard errors naming the selector, the count, and candidates — never fan-out and
 * never first-match-wins.
 */
export async function resolveRoleTarget(
    members: readonly ResolvedFleetMember[],
    selector: string,
    roles: readonly string[],
    executorNames: readonly string[],
): Promise<RoleTargetResolution> {
    const vocabulary = [...roles, ...executorNames];
    if (!vocabulary.includes(selector)) {
        return {
            ok: false,
            code: 'unknown_selector',
            message: `--role "${selector}" is neither a known Layer-1 role nor an executor name (accepted: ${vocabulary.join(', ')})`,
        };
    }
    const declared = members.filter((m) => m.enabled);
    // Prefer role matching when a name is in both vocabularies: the configured
    // role is the narrower intent, and a role equal to an executor name means
    // the operator chose that name as a role in agent config.
    const matchedAsRole = roles.includes(selector);
    const matches = declared.filter((m) => (matchedAsRole ? m.role === selector : m.executor === selector));
    const candidates = matches.map((m) => m.instanceId);
    if (matches.length === 0) {
        return {
            ok: false,
            code: 'selector_unmatched',
            message: `"${selector}" resolves to count=0 instances (looked up as ${matchedAsRole ? 'role' : 'executor'}; candidates: none)`,
        };
    }
    if (matches.length > 1) {
        return {
            ok: false,
            code: 'selector_ambiguous',
            message: `"${selector}" resolves to count=${matches.length} instances (candidates: ${candidates.join(', ')}) — address one by its full spec id`,
        };
    }
    return { ok: true, specId: candidates[0] ?? '', count: 1, candidates };
}
