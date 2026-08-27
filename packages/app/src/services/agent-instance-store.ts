import { AGENT_ROLE_NAMES } from '@gobing-ai/spur-config';
import type { AgentInstance, AgentInstanceStore } from '@gobing-ai/spur-domain';
import { specRole } from '@gobing-ai/spur-domain';
import type { AgentSpec } from '@gobing-ai/ts-ai-runner';

/** Minimal read seam — satisfied by {@link TeamService.listAgentSpecs}. */
export type AgentSpecLister = () => Promise<AgentSpec[]>;

/** Parse the `team:<id>` identity tag off a spec, or null. */
function teamTagOf(spec: Pick<AgentSpec, 'tags'>): string | null {
    for (const tag of spec.tags ?? []) {
        if (tag.startsWith('team:')) return tag.slice('team:'.length);
    }
    return null;
}

/** Recover the roster-local member key from its exact `team:<id>` prefix. */
function memberKeyOf(specId: string, teamId: string | null): string {
    const prefix = teamId === null ? null : `${teamId}-`;
    return prefix !== null && specId.startsWith(prefix) ? specId.slice(prefix.length) : specId;
}

/**
 * File-backed instance reader (0685 R2): projects spec files (via
 * `TeamService.listAgentSpecs()`) onto the frozen {@link AgentInstance} shape.
 * Runtime fields use stopped/epoch sentinels here — occupancy lives with the
 * agent service until the DB cutover (`0026_spur_cli_agent_instances`, ADR-086).
 */
export function createFileAgentInstanceStore(listAgentSpecs: AgentSpecLister): AgentInstanceStore {
    async function all(): Promise<AgentInstance[]> {
        const specs = await listAgentSpecs();
        return specs.map((spec) => {
            const teamId = teamTagOf(spec);
            return {
                specId: spec.id,
                teamId,
                memberKey: memberKeyOf(spec.id, teamId),
                role: specRole(spec),
                executor: spec.executor ?? null,
                workspace: spec.workspace,
                tags: spec.tags,
                config: spec.config,
                status: 'stopped',
                pid: null,
                runId: null,
                generation: null,
                createdAt: 0,
                updatedAt: 0,
            };
        });
    }
    return {
        bySpecId: async (specId) => (await all()).find((i) => i.specId === specId) ?? null,
        byRole: async (role) => (await all()).filter((i) => i.role === role),
        byExecutor: async (executor) => (await all()).filter((i) => i.executor === executor),
    };
}

/**
 * One-call selector resolution for CLI commands (0685 R6): build the store from
 * the project's spec lister and resolve `selector` against
 * AGENT_ROLE_NAMES ∪ configured executor names.
 */
export async function resolveAgentSelector(
    listAgentSpecs: AgentSpecLister,
    agentConfig: { executors?: Array<{ name: string }> } | null | undefined,
    selector: string,
): Promise<RoleTargetResolution> {
    const store = createFileAgentInstanceStore(listAgentSpecs);
    return resolveRoleTarget(store, selector, AGENT_ROLE_NAMES, agentConfig?.executors?.map((e) => e.name) ?? []);
}

/** Result of role/executor addressee resolution (0685 R6). */
export type RoleTargetResolution =
    | { ok: true; specId: string; count: number; candidates: string[] }
    | {
          ok: false;
          /** `unknown_selector` → usage (exit 2); `selector_unmatched` / `selector_ambiguous` → exit 1. */
          code: 'unknown_selector' | 'selector_unmatched' | 'selector_ambiguous';
          message: string;
      };

/**
 * Resolve a role-addressed selector to exactly one instance spec id.
 *
 * Vocabulary is `AGENT_ROLE_NAMES` ∪ configured executor names; membership
 * decides the lookup kind (byRole vs byExecutor). Zero matches and multi
 * matches are hard errors naming the selector, the count, and candidates —
 * never fan-out and never first-match-wins.
 */
export async function resolveRoleTarget(
    store: AgentInstanceStore,
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
    // Prefer role matching when a name is in both vocabularies: the configured
    // role is the narrower intent, and a role equal to an executor name means
    // the operator chose that name as a role in agent config.
    const matches = roles.includes(selector) ? await store.byRole(selector) : await store.byExecutor(selector);
    const candidates = matches.map((m) => m.specId);
    if (matches.length === 0) {
        return {
            ok: false,
            code: 'selector_unmatched',
            message: `"${selector}" resolves to count=0 instances (looked up as ${roles.includes(selector) ? 'role' : 'executor'}; candidates: none)`,
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
