/**
 * Agent instance shapes (0685 R2) — the storage contract for materialized agent
 * instances, frozen ahead of the instance→DB cutover. Today instances are the
 * spec files under `.spur/agents/` (ADR-075); after 0026 lands they are DB
 * rows written by the composition root (`team up`), not committed files
 * (ADR-086). These types are the seam both homes must satisfy.
 */

/**
 * An agent instance — one runnable unit with a deterministic spec id.
 *
 * The file-backed reader uses `stopped` plus epoch timestamps as pre-cutover
 * sentinels; the DB-backed reader makes those runtime fields authoritative.
 */
export interface AgentInstance {
    /** Deterministic full spec id: `<teamId>-<memberKey>` (0685 R4 composition). */
    specId: string;
    /** Owning team id parsed from the `team:<id>` tag; null when untethered. */
    teamId: string | null;
    /** Stable roster-local identity; the spec id for an untethered instance. */
    memberKey: string;
    /** Configured Layer-1 role from `config.role`; null when unassigned. */
    role: string | null;
    /** Executor binding name resolved at materialization; null when unset. */
    executor: string | null;
    /** Workspace path the instance runs in. */
    workspace: string;
    /** Identity tags, e.g. `team:<id>`, `spur:generated`. */
    tags: string[];
    /** Spec config carry-through (model, role, systemPrompt, autonomy, …). */
    config: Record<string, unknown>;
    /** Materialized-instance lifecycle status. */
    status: 'stopped' | 'running' | 'exited' | 'errored';
    /** Current process id, when running. */
    pid: number | null;
    /** Current occupant run id, when pinned; null otherwise. */
    runId: string | null;
    /** Occupant generation for pin freshness; null otherwise. */
    generation: number | null;
    /** Creation time as Unix epoch milliseconds. */
    createdAt: number;
    /** Last update time as Unix epoch milliseconds. */
    updatedAt: number;
}

/**
 * Read-side store over agent instances (0685 R2). Narrow and deliberately
 * read-only: writes stay in `team up` (spec files today, DB rows after 0026),
 * so the store never becomes a second write path.
 */
export interface AgentInstanceStore {
    /** The instance whose specId matches exactly, or null. */
    bySpecId(specId: string): Promise<AgentInstance | null>;
    /**
     * Instances with the given configured Layer-1 role
     * (`AGENT_ROLE_NAMES` ∪ executor names is NOT this predicate — see
     * {@link byExecutor}). A spec without a configured role never matches.
     */
    byRole(role: string): Promise<AgentInstance[]>;
    /** Instances bound to the given resolved executor name. */
    byExecutor(executor: string): Promise<AgentInstance[]>;
}

/**
 * The configured Layer-1 role of a spec-shaped input, or null.
 *
 * Structural on purpose: the domain package does not depend on the AgentSpec
 * type (`@gobing-ai/ts-ai-runner`); any `{ config }` shape fits.
 */
export function specRole(input: { config?: { role?: unknown } } | null | undefined): string | null {
    const role = input?.config?.role;
    return typeof role === 'string' && role.length > 0 ? role : null;
}
