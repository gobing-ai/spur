/**
 * Agent instance shapes (0685 R2) — the storage contract for materialized agent
 * instances, frozen ahead of the instance→DB cutover. Today instances are the
 * spec files under `.spur/agents/` (ADR-075); after 0026 lands they are DB
 * rows written by the composition root (`team up`), not committed files
 * (ADR-085). These types are the seam both homes must satisfy.
 */

/**
 * An agent instance — one runnable unit with a deterministic spec id.
 *
 * Runtime-only fields (`status`, `runId`, `generation`, `pid`) are null when the
 * backing store cannot see occupancy (the file-backed reader has no DB access);
 * they become authoritative once `0026_spur_cli_agent_instances` registers.
 */
export interface AgentInstance {
    /** Deterministic full spec id: `<teamId>-<memberKey>` (0685 R4 composition). */
    specId: string;
    /** Owning team id parsed from the `team:<id>` tag; null when untethered. */
    teamId: string | null;
    /** Configured Layer-1 role from `config.role`; null when unassigned. */
    role: string | null;
    /** Executor binding name resolved at materialization; null when unset. */
    executor: string | null;
    /** Workspace path the instance runs in. */
    workspace: string | null;
    /** Identity tags, e.g. `team:<id>`, `spur:generated`. */
    tags: string[];
    /** Spec config carry-through (model, role, systemPrompt, autonomy, …). */
    config: Record<string, unknown>;
    /** Occupancy status; null = unknown to this store. */
    status: 'stopped' | 'running' | 'exited' | 'error' | null;
    /** Current occupant run id, when pinned; null otherwise. */
    runId: string | null;
    /** Occupant generation for pin freshness; null otherwise. */
    generation: number | null;
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
    /** Every visible instance, unordered. */
    all(): Promise<AgentInstance[]>;
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

/**
 * RESERVED migration draft (0685 R2) — documented, **not registered**.
 *
 * When the instance→DB cutover task runs, it seeds
 * `drizzle/0026_spur_cli_agent_instances.sql` (with the `_spur_cli_` marker)
 * added AFTER registration in `packages/domain/src/migrations.ts`. It must not
 * ship as a live migration before the writer side exists, so only the column
 * plan lives here until then:
 *
 * - `spec_id` TEXT primary key — `<teamId>-<memberKey>` (0685 R4 composition)
 * - `team_id` / `role` / `executor` / `workspace` — nullable TEXT projections
 *   of {@link AgentInstance}; `role` = configured Layer-1 role or NULL
 * - `tags` / `config` — JSON TEXT, defaulting to `'[]'` / `'{}'`
 * - `status` TEXT check ('stopped'|'running'|'exited'|'error'), `run_id` TEXT,
 *   `generation` INTEGER — occupancy triple; NULL in file-backed mode
 * - `updated_at` TEXT NOT NULL
 * - indexes on (`role`) and (`executor`) for byRole/byExecutor reads
 */
export const AGENT_INSTANCES_DDL_DRAFT = '0026_spur_cli_agent_instances';
