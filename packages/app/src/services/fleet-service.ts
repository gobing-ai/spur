import { basename, dirname, join } from 'node:path';
import {
    type AgentConfig,
    type AgentFleet,
    type AgentRoleName,
    type ExecutionCapabilityState,
    ExecutorDisabledError,
    legacyMemberLocalId,
    type MemberIdentity,
    memberLocalId,
    normalizeExecutorAvailability,
    type ResolvedExecutor,
    resolveExecutor,
    type SpurConfig,
} from '@gobing-ai/spur-config';
import {
    CoordinationRunDao,
    type DbAdapter,
    isTierEligible,
    type MemberLifecycleObservation,
    type MemberSessionObservation,
    type ProjectClaim,
    ProjectClaimDao,
    readLifecycle,
    readMemberSessions,
} from '@gobing-ai/spur-domain';
import { type AgentSpec, validateAgentId } from '@gobing-ai/ts-ai-runner';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { resolveAgentRoles } from './agent-roles';
import type { AgentRoleDefinition } from './agent-service';
import { cheapestEligibleExecutors, getExecutorTier } from './executor-tier';
import { normalizeProjectPath, ProjectRegistry } from './project-registry';

// ---------------------------------------------------------------------------
// Public types (0835)
// ---------------------------------------------------------------------------

/** Context injected into FleetService — the config/role slice of the coordination service context. */
export interface FleetServiceContext {
    /**
     * Merged global+project config threaded from the composition root (A5 /
     * ADR-082). `null`/absent = load failed/absent; role-only members then fail
     * resolution loudly (no silent bare-binary fallback).
     */
    spurConfig?: SpurConfig | null;
    /** 0799 R3 parity: launch boundaries prefer a fresh merged config. */
    reloadAgentConfig?: () => Promise<SpurConfig | null>;
    /** Layer-1 role → tier map (0543 R1); role-only fleet members resolve through it. */
    roles?: ReadonlyMap<string, AgentRoleDefinition>;
    /** Filesystem port (no-direct-fs-io: declaration reads go through the seam). */
    fs: FileSystem;
    /**
     * Project registry for slug lookup (registry entry `name`). Optional so
     * tests can point one at a temp file; defaults to the machine registry.
     */
    registry?: ProjectRegistry;
    /**
     * 0836: factory for the project's migrated SQLite adapter (the one holding
     * `project_claims`). The caller owns the adapter's lifecycle — FleetService
     * opens through the factory and never closes it, so a caller may hand back
     * a cached/shared handle. Required only by {@link FleetService.resolveOrchestrator}.
     */
    openDb?: (projectPath: string) => Promise<DbAdapter>;
}

/** One fleet member resolved against config (0835). Desired state only — no liveness (R5). */
export interface ResolvedFleetMember {
    /** `<projectSlug>-<memberLocalId>` — the spec id / mailbox identity (R3). */
    instanceId: string;
    role?: AgentRoleName;
    /** Declared executor, or the tier-ladder winner for a role-only member. `''` = not resolved (disabled member). */
    executor: string;
    /**
     * The resolved executor profile's `model`, when it declares one — the SAME
     * value `materializeRoster` writes to the generated spec's `config.model`,
     * so a reader names the model this member will actually run. Omitted when
     * the profile declares none, and for a disabled member (never resolved).
     */
    model?: string;
    enabled: boolean;
    /** True iff the resolved executor's `fsWrite` attestation is `enforced`/`available` (R4). */
    writeCapable: boolean;
    /** The resolved executor's `fsWrite` axis state; missing data is `unknown` (never grants). */
    capabilityState: ExecutionCapabilityState;
    /**
     * The member's current agent session (0897): the newest
     * `fleet.member-session`/`-reset` ledger row for the instance (reset rows
     * clear the resume id). Absent when the member never ran, when no `openDb`
     * seam is provided, or when the ledger is unreadable — observability
     * degrades, it never fails the resolution.
     */
    session?: MemberSessionObservation;
    /**
     * The member's current lifecycle state (G73 R3, task 1080): the newest
     * `agent.lifecycle.changed` ledger row for the instance — reported by the
     * member's own host hooks. Absent when the member never reported, when no
     * `openDb` seam is provided, or when the ledger is unreadable; observability
     * degrades, it never fails the resolution.
     */
    lifecycle?: MemberLifecycleObservation;
}

/** A resolved project fleet (0835). `missing` names what a caller must fix (R7 — a value, not an exception). */
export interface ResolvedFleet {
    projectPath: string;
    /**
     * The declared fleet switch (`agent.fleet.enabled`, default `false`).
     * Reported by the read surfaces so a disabled fleet is named as disabled
     * rather than as an empty roster (0858 R3/R5); `false` when no section is
     * declared at all.
     */
    enabled: boolean;
    members: ResolvedFleetMember[];
    /** `'no-declaration'` | `'fleet-disabled'` | `'no-enabled-members'`. */
    missing: string[];
}

/**
 * 0836 R4: orchestrator availability. `missing` (nothing bound — declare one in
 * `agent.fleet`) and `bound-offline` (bound, no live claim — start/heartbeat
 * the instance) are DIFFERENT states with different next actions; never collapse
 * them, never represent either as "0 orchestrators".
 */
export type OrchestratorState = 'bound-online' | 'bound-offline' | 'missing' | 'unresolvable';

/** 0836: the resolved orchestrator binding for a project (a value, not an exception — R5). */
export interface OrchestratorBinding {
    state: OrchestratorState;
    /** Resolved spec id of the bound member (`<slug>-<memberLocalId>`), when the pointer resolves. */
    instanceId?: string;
    /** Current claim holder, when a live claim exists. */
    holderId?: string;
    /** The live claim row, when `bound-online`. */
    claim?: ProjectClaim;
    /**
     * Why: `'no-orchestrator-declared'` (missing), `'no-live-claim'`
     * (bound-offline), or the specific unresolvable reason — an unresolvable
     * pointer is an ERROR state, never a search problem (Q&A: error, never
     * inference).
     */
    reason?: string;
}

// ---------------------------------------------------------------------------
// Shared roster projection (0835) — moved from the retired team service (0860 R3)
// ---------------------------------------------------------------------------

/**
 * The member shape the shared roster projection consumes: the identity fields
 * {@link memberLocalId} derives from, plus the optional per-spec overrides the
 * projection carries onto the generated spec. The project fleet declaration's
 * `FleetMember` (config) is structurally assignable. (0857: the retired team
 * roster union that previously supplied these fields is gone; the fleet
 * declaration is the only member source.)
 */
export interface RosterMember extends MemberIdentity {
    purpose?: string;
    /** Fleet-only (0835): `false` keeps the derived id but leaves the member out of the derived specs. */
    enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Shared roster projection (0835)
// ---------------------------------------------------------------------------

/** Result of the shared roster projection: specs to upsert + the desired id set. */
export interface RosterProjection {
    toUpsert: AgentSpec[];
    desiredIds: Set<string>;
}

/** Parameters for {@link resolveMemberExecutor}. */
export interface ResolveMemberExecutorParams {
    member: MemberIdentity;
    /** Roster position — error messages only. */
    index: number;
    /** Human label for loud errors, e.g. `Team "devops"` or `Fleet "my-project"`. */
    label: string;
    agentConfig: AgentConfig | undefined;
    /** Layer-1 role → tier map; role-only members resolve through it (0543 R1). */
    roles?: ReadonlyMap<string, AgentRoleDefinition>;
    /** Full roster, so error texts name the member by its frozen-index local id. */
    roster?: readonly MemberIdentity[];
}

/**
 * Resolve one roster member's executor — the SAME funnel `--agent <role>` uses
 * (0835, extracted verbatim from the pre-0835 materializeTeam loop). An
 * executor pin is authoritative (0543 R2, 111 R4: a pin to a disabled profile
 * fails loudly here, before spawn); a role-only member resolves the cheapest
 * tier-eligible executor, or fails naming the fix. Returns both the resolved
 * kind/model (for the spec `type`/`config.model`) and the executor NAME (for
 * the spec `executor` binding, 0537 R1).
 */
export function resolveMemberExecutor(params: ResolveMemberExecutorParams): {
    resolved: ResolvedExecutor;
    executorName: string;
} {
    const { member, index, label, agentConfig, roles, roster } = params;
    if (member.executor !== undefined) {
        let resolved: ResolvedExecutor;
        try {
            resolved = resolveExecutor(member.executor, agentConfig);
        } catch (error) {
            if (error instanceof ExecutorDisabledError) {
                // Verbatim pre-0835-extraction wording: the member names itself
                // by its frozen-index local id (0835 review P4).
                const localId =
                    roster !== undefined ? memberLocalId(member, roster, index) : (member.id ?? member.executor);
                throw new Error(
                    `${label} member "${localId}" pins disabled executor "${member.executor}" — ${error.message}; enable the profile or repin the member`,
                );
            }
            throw error;
        }
        return { resolved, executorName: member.executor };
    }
    const role = member.role;
    // R4 validation rejects neither-role-nor-executor at config load; this is a
    // defensive loud error for unvalidated callers.
    if (role === undefined) {
        throw new Error(
            `${label} member at index ${index} declares neither role nor executor — at least one is required`,
        );
    }
    const roleTier = roles?.get(role)?.tier;
    if (roleTier === undefined) {
        throw new Error(
            `${label} member at index ${index} declares role "${role}" but no Layer-1 role table is available (the role table is threaded only at the CLI / serve boundary)`,
        );
    }
    const eligible = cheapestEligibleExecutors(agentConfig?.executors ?? [], roleTier);
    const winner = eligible[0];
    if (winner === undefined) {
        // 111 R3: distinguish "nothing at that tier" from "all tier-eligible
        // profiles are disabled" so the fix is actionable in one read.
        const disabledEligible = (agentConfig?.executors ?? [])
            .filter(
                (e) =>
                    normalizeExecutorAvailability(e.disabled).disabled && isTierEligible(getExecutorTier(e), roleTier),
            )
            .map((e) => e.name);
        if (disabledEligible.length > 0) {
            throw new Error(
                `${label} member at index ${index}: every tier-eligible executor for role "${role}" (tier ${roleTier}) is disabled (${disabledEligible.join(', ')}) — enable one via agent.executors.<name>.disabled: false`,
            );
        }
        throw new Error(
            `${label} member at index ${index}: no executor configured to serve role "${role}" (tier ${roleTier}) — define executors under agent.executors`,
        );
    }
    return { resolved: { agent: winner.agent, model: winner.model }, executorName: winner.name };
}

/** Parameters for {@link materializeRoster}. */
export interface MaterializeRosterParams {
    /** Spec id prefix AND group tag suffix — the generated id is `<slug>-<localId>`. */
    slug: string;
    /** Human label for loud errors, e.g. `Team "devops"` or `Fleet "my-project"`. */
    label: string;
    /** Full roster, in declaration order — ids derive over it (frozen index, 0835 R3). */
    members: readonly RosterMember[];
    /** Default workspace for members without their own `workspace`. */
    defaultWorkspace: string;
    agentConfig: AgentConfig | undefined;
    /** Layer-1 role → tier map; role-only members resolve through it (0543 R1). */
    roles?: ReadonlyMap<string, AgentRoleDefinition>;
    /**
     * The full roster, for error texts that name a member by its frozen-index
     * local id (0835 review P4). Optional: without it, executor-pinned error
     * texts fall back to `member.id ?? member.executor`.
     */
    roster?: readonly RosterMember[];
}

/**
 * Project one roster into the `spur:generated` agent specs the fleet declares — the
 * declaration is the ONLY authoring surface (G72 R2), so the projection is
 * declaration-only and nothing is written. Id derivation delegates to
 * `memberLocalId` (0543 R3 / 0835 R3 — the frozen-index allocator config-load
 * uses, so a converted roster produces byte-identical ids) and executor
 * resolution delegates to {@link resolveMemberExecutor}.
 */
export function materializeRoster(params: MaterializeRosterParams): RosterProjection {
    const { slug, label, members, defaultWorkspace, agentConfig, roles } = params;
    const desiredIds = new Set<string>();
    const toUpsert: AgentSpec[] = [];

    for (const [index, member] of members.entries()) {
        // 0543 R3 / 0835 R3: ids derive over the FULL roster (frozen index) via
        // the shared allocator — never re-derived per consumer.
        const localId = memberLocalId(member, members, index);
        const composedId = `${slug}-${localId}`;
        desiredIds.add(composedId);

        // 0835 review P3: a disabled member (fleet declarations) keeps its id
        // in the desired set but is NOT resolved against executors — an
        // unresolvable executor on a disabled member must not block launch.
        // (G72 R2: nothing is pruned any more — `FleetService.specs` filters the
        // projection to the enabled subset, so the id simply stays undeclared.)
        if (member.enabled === false) continue;

        const { resolved, executorName } = resolveMemberExecutor({
            member,
            index,
            label,
            agentConfig,
            roles,
            roster: members,
        });
        const spec: AgentSpec = {
            id: composedId,
            name: member.purpose ?? composedId,
            type: resolved.agent,
            // Executor binding (0537 R1): carry the configured executor name
            // beside the coding-agent kind so drain can resolve back through
            // `resolveExecutor`'s executor-first lookup. For a role-only member
            // this is the RESOLVED executor entry (0543 R1). `type` stays:
            // AiRunner resolves the runner from it, and pre-existing specs
            // carry only `type` (drain falls back to it).
            executor: executorName,
            // 1078 R3: the roster carries no `workspace` — `FleetMemberSchema` never populated it,
            // so this was always the default. The retired field's dead reads are gone with it.
            workspace: defaultWorkspace,
            purpose: member.purpose && member.purpose.length > 0 ? member.purpose : `${resolved.agent} agent`,
            tags: [`fleet:${slug}`, 'spur:generated'],
            config: {
                ...(resolved.model !== undefined ? { model: resolved.model } : {}),
                // Layer-1 role (0538 R3): carried beside the executor binding so
                // routing reads it off the spec (0543 R1 — the role and the
                // resolved executor name are BOTH recorded).
                ...(member.role !== undefined ? { role: member.role } : {}),
            },
        };
        toUpsert.push(spec);
    }

    return { toUpsert, desiredIds };
}

// ---------------------------------------------------------------------------
// FleetService
// ---------------------------------------------------------------------------

/** Result of merging hand-authored on-disk specs with the declared fleet specs (G72 R2). */
export interface AgentSpecMergeResult {
    /** Hand-authored specs first, then declared fleet specs (declaration wins an id clash). */
    specs: AgentSpec[];
    /** Ids where the declared fleet spec replaced a hand-authored on-disk spec. */
    shadowed: string[];
}

/**
 * Merge the project's addressable agent specs (G72 R2): hand-authored specs on disk
 * plus the declared `agent.fleet` specs, which win on an id clash. A stale
 * fleet-generated file left in `.spur/agents/` from before the derivation change is
 * ignored — the declaration is the source of truth, so a leftover file can never
 * shadow the config. Pure and order-stable; the caller owns the warning.
 */
export function mergeAgentSpecs(
    diskSpecs: readonly AgentSpec[],
    fleetSpecs: readonly AgentSpec[],
): AgentSpecMergeResult {
    const byId = new Map<string, AgentSpec>();
    for (const spec of diskSpecs) {
        if (spec.tags?.includes('fleet:generated')) continue;
        byId.set(spec.id, spec);
    }
    const shadowed: string[] = [];
    for (const spec of fleetSpecs) {
        if (byId.has(spec.id)) shadowed.push(spec.id);
        byId.set(spec.id, spec);
    }
    return { specs: [...byId.values()], shadowed };
}

/**
 * Application-layer read/resolve for a project's fleet (`agent.fleet` in the
 * project's `.spur/config.yaml`, 0835 carrier moved by 0858 R3). The declaration
 * is the ONLY authoring surface for a project fleet: {@link FleetService.specs}
 * derives the member specs from it and nothing is written into `.spur/agents/`
 * (G72 R2 — instances are derived, not stored). Ids derive through the shared
 * `memberLocalId` allocator (R3) and write capability reads the executor's
 * `fsWrite` attestation, never the role name (R4).
 */
export class FleetService {
    private readonly ctx: FleetServiceContext;
    private readonly fs: FileSystem;
    private readonly registry: ProjectRegistry;

    constructor(ctx: FleetServiceContext) {
        this.ctx = ctx;
        this.fs = ctx.fs;
        this.registry = ctx.registry ?? new ProjectRegistry();
    }

    /**
     * Read the project's merged `agent.fleet` section, or `null` when the
     * project declares none (R7).
     *
     * 0858 R3: the section comes from the project's MERGED config through the
     * config seam (`reloadAgentConfig` at launch boundaries, else the threaded
     * `spurConfig`), not from a file — one carrier, one read path. An invalid
     * section never reaches here: `loadSpurConfig` fails the load naming every
     * issue with its `agent.fleet.*` path (R8), so "absent" and "invalid" are
     * different outcomes rather than a silently empty fleet.
     */
    async load(projectPath: string): Promise<AgentFleet | null> {
        // The path is still normalized for callers whose read follows with a
        // project-scoped query; the section itself is config-scoped (one server
        // serves one project, and the CLI resolves the merged config of `cwd`).
        normalizeProjectPath(projectPath);
        const config = await this.effectiveConfig();
        return config?.agent?.fleet ?? null;
    }

    /**
     * Resolve the declaration against config: stable instance ids (R3, via the
     * shared `memberLocalId` allocator), executor resolution through the same
     * pinned-or-tier-ladder funnel teams use, the resolved model that funnel
     * yields (0857 R5), and `fsWrite`-attested write capability (R4). A missing declaration or an all-disabled roster resolves
     * cleanly with `missing` naming the fix (R7) — it does not throw. Disabled
     * members keep their derived id (index preservation) but are not resolved
     * against executors.
     */
    async resolve(projectPath: string): Promise<ResolvedFleet> {
        const normalized = normalizeProjectPath(projectPath);
        const declaration = await this.load(normalized);
        if (declaration === null) {
            return { projectPath: normalized, enabled: false, members: [], missing: ['no-declaration'] };
        }
        const fleetEnabled = declaration.enabled;

        const config = await this.effectiveConfig();
        const agentConfig: AgentConfig | undefined = config?.agent;
        const members = declaration.members;
        const enabledIndexes = new Set(members.flatMap((m, i) => (m.enabled !== false ? [i] : [])));
        const slug = await this.projectSlug(normalized);

        const resolvedMembers: ResolvedFleetMember[] = [];
        // G71 R4 (ADR-126 A4): the id order changed — role now outranks executor — so a role
        // member with a pinned executor is RENAMED, and its instance id IS its inbox address.
        // A member that already has occupancy under its old id must not be silently re-addressed:
        // fail closed, name both ids, and offer the `id:` pin that resolves it. Only a member
        // whose id actually changes AND whose old id has recorded occupancy trips this, so a
        // fresh project (no ledger rows, no runs) adopts the new ids silently.
        if (declaration.members.some((m) => m.id === undefined && m.role !== undefined && m.executor !== undefined)) {
            const db = await this.ctx.openDb?.(normalized);
            if (db !== undefined) {
                for (const [index, member] of members.entries()) {
                    if (member.id !== undefined || member.role === undefined || member.executor === undefined) continue;
                    const legacyLocal = legacyMemberLocalId(member, members, index);
                    const currentLocal = memberLocalId(member, members, index);
                    if (legacyLocal === currentLocal) continue;
                    const legacyId = `${slug}-${legacyLocal}`;
                    const currentId = `${slug}-${currentLocal}`;
                    const observed = await readMemberSessions(db, [legacyId]);
                    const run = await new CoordinationRunDao(db).getLatestBySpecId(legacyId);
                    if (observed.size > 0 || run !== null) {
                        throw new Error(
                            `agent.fleet member #${index} (role ${member.role}, executor ${member.executor}): its id changes from "${legacyId}" to "${currentId}" (ADR-126 A4) and "${legacyId}" has recorded runs. Add \`id: ${legacyLocal}\` to keep the old address, or \`id: ${currentLocal}\` to adopt the new one.`,
                        );
                    }
                }
            }
        }
        for (const [index, member] of members.entries()) {
            // R3: ids derive over the FULL roster (disabled members preserve
            // their index) via the shared allocator — never re-derived here.
            const instanceId = `${slug}-${memberLocalId(member, members, index)}`;
            if (!enabledIndexes.has(index)) {
                resolvedMembers.push({
                    instanceId,
                    ...(member.role !== undefined ? { role: member.role } : {}),
                    executor: member.executor ?? '',
                    enabled: false,
                    writeCapable: false,
                    capabilityState: 'unknown',
                });
                continue;
            }
            const { executorName, resolved: resolvedExecutor } = resolveMemberExecutor({
                roster: declaration.members,
                member,
                index,
                label: `Fleet "${slug}"`,
                agentConfig,
                roles: this.ctx.roles ?? resolveAgentRoles(agentConfig),
            });
            // R4: write capability is read from the RESOLVED executor profile's
            // `fsWrite` attestation (0706 vocabulary as-is). `enforced` or
            // `available` grants; `unavailable`, `unknown`, and an absent
            // axis/profile all yield false — missing data never grants. The
            // role name is never consulted.
            const state = agentConfig?.executors?.find((e) => e.name === executorName)?.executionCapabilities?.axes
                ?.fsWrite?.state;
            const capabilityState: ExecutionCapabilityState = state ?? 'unknown';
            resolvedMembers.push({
                instanceId,
                ...(member.role !== undefined ? { role: member.role } : {}),
                executor: executorName,
                ...(resolvedExecutor.model !== undefined ? { model: resolvedExecutor.model } : {}),
                enabled: true,
                writeCapable: capabilityState === 'enforced' || capabilityState === 'available',
                capabilityState,
            });
        }

        // 0897: join the runtime session state (ledger rows written by the
        // member's own loop) onto the declaration-resolved roster. Best-effort:
        // an unreadable ledger omits `session` rather than failing the snapshot.
        if (this.ctx.openDb !== undefined && resolvedMembers.length > 0) {
            try {
                const sessions = await readMemberSessions(
                    await this.ctx.openDb(normalized),
                    resolvedMembers.map((m) => m.instanceId),
                );
                for (const member of resolvedMembers) {
                    const session = sessions.get(member.instanceId);
                    if (session !== undefined) member.session = session;
                }
            } catch {
                // Degrade: no db, unreadable ledger — members keep no session field.
            }
            // G73 R3 (1080): join the reported lifecycle state the same way. Same
            // degradation contract — a member with no report carries no field.
            try {
                const lifecycles = await readLifecycle(
                    await this.ctx.openDb(normalized),
                    resolvedMembers.map((m) => m.instanceId),
                );
                for (const member of resolvedMembers) {
                    const lifecycle = lifecycles.get(member.instanceId);
                    if (lifecycle !== undefined) member.lifecycle = lifecycle;
                }
            } catch {
                // Degrade: no db, unreadable ledger — members keep no lifecycle field.
            }
        }

        const missing: string[] = [];
        // 0858 R3/R5: a disabled fleet still RESOLVES its roster (the Board must be
        // able to explain why nothing runs) but is named as disabled, which is a
        // different state from an empty roster.
        if (!fleetEnabled) missing.push('fleet-disabled');
        if (!members.some((m) => m.enabled !== false)) missing.push('no-enabled-members');
        return { projectPath: normalized, enabled: fleetEnabled, members: resolvedMembers, missing };
    }

    /**
     * 0836: resolve the project's orchestrator binding (R1, R2, R4, R5). The
     * declaration's `orchestrator` pointer names a member by its `memberLocalId`
     * (the declaration-level id operators author); the binding carrier is that
     * member's existing `role: 'planner'` + `purpose: 'orchestrator'` — no new
     * role value, no new schema field (R2). Both are ASSERTED here: a pointer
     * that does not resolve to an enabled planner-role member carrying
     * `purpose: 'orchestrator'` is `unresolvable` — refusing to guess is the
     * point, a mis-typed pointer must not silently promote "the only planner"
     * (the resulting orchestrator would hold the write slot).
     *
     * Precedence, first match wins: (1) no declaration or pointer → `missing`;
     * (2) unknown / disabled / wrong-role / wrong-purpose pointer →
     * `unresolvable`; (3) member resolves but no live `project_claims` row for
     * `slot='orchestrator'` → `bound-offline`; (4) live claim → `bound-online`.
     * Returns a value, never throws, for every declarative state (R5) — the
     * only throw is a missing `openDb` seam, which is a wiring error.
     */
    async resolveOrchestrator(projectPath: string): Promise<OrchestratorBinding> {
        const normalized = normalizeProjectPath(projectPath);
        const declaration = await this.load(normalized);
        const pointer = declaration?.orchestrator;
        if (declaration === null || pointer === undefined) {
            return { state: 'missing', reason: 'no-orchestrator-declared' };
        }
        const members = declaration.members;
        const localIds = members.map((m, i) => memberLocalId(m, members, i));
        const index = localIds.indexOf(pointer);
        if (index === -1) {
            return {
                state: 'unresolvable',
                reason: `unknown-member:${pointer} (declared member ids: ${localIds.join(', ') || 'none'})`,
            };
        }
        const member = members[index];
        const instanceId = `${await this.projectSlug(normalized)}-${pointer}`;
        if (member === undefined) {
            return { state: 'unresolvable', instanceId, reason: `unknown-member:${pointer}` };
        }
        if (member.enabled === false) {
            return { state: 'unresolvable', instanceId, reason: `member-disabled:${pointer}` };
        }
        if (member.role !== 'planner') {
            return {
                state: 'unresolvable',
                instanceId,
                reason: `wrong-role:${pointer} (role=${member.role ?? 'none'} — the orchestrator binding carrier is a planner-role member)`,
            };
        }
        if (member.purpose !== 'orchestrator') {
            return {
                state: 'unresolvable',
                instanceId,
                reason: `missing-purpose:${pointer} (purpose=${member.purpose ?? 'unset'} — expected 'orchestrator')`,
            };
        }
        if (this.ctx.openDb === undefined) {
            throw new Error(
                `FleetService.resolveOrchestrator cannot read project_claims without FleetServiceContext.openDb — provide a per-project db adapter factory (project: ${normalized})`,
            );
        }
        const db = await this.ctx.openDb(normalized);
        const claim = await new ProjectClaimDao(db).get(normalized, 'orchestrator');
        if (claim === null || claim.expiresAt <= Date.now()) {
            return { state: 'bound-offline', instanceId, reason: 'no-live-claim' };
        }
        if (claim.holderId !== instanceId) {
            return { state: 'bound-offline', instanceId, reason: `claim-holder-mismatch:${claim.holderId}` };
        }
        return { state: 'bound-online', instanceId, holderId: claim.holderId, claim };
    }

    /**
     * The fleet's declared specs: one `spur:generated` spec per ENABLED member (ids
     * derived over the full roster so disabled members preserve everyone's index).
     *
     * Derived, never written (G72 R2 / ADR-086 A3): `.spur/agents/` holds
     * hand-authored specs only, and a member's runtime instance comes from
     * `agent.fleet` plus occupancy. Ids are validated here so a registry display
     * name that cannot form an agent id fails loudly at the read boundary.
     *
     * Returns `[]` — never an exception — when the project declares no
     * `agent.fleet`, the fleet is disabled, or no member is enabled: this is a read
     * projection consumed by role/addressee resolution on projects that may have no
     * fleet at all. A launch boundary asserts its own ground truth
     * ({@link FleetService.assertLaunchGroundTruth}, R6) before starting anything.
     */
    async specs(projectPath: string): Promise<AgentSpec[]> {
        const normalized = normalizeProjectPath(projectPath);
        const declaration = await this.load(normalized);
        if (declaration === null) return [];

        const resolved = await this.resolve(normalized);
        const enabled = resolved.members.filter((m) => m.enabled);
        if (!resolved.enabled || enabled.length === 0) return [];

        const slug = await this.projectSlug(normalized);
        const config = await this.effectiveConfig();

        // Shared roster projection (0835): ids over the FULL roster — disabling a
        // member retires its spec without freeing its id index.
        const projection = materializeRoster({
            slug,
            label: `Fleet "${slug}"`,
            members: declaration.members,
            defaultWorkspace: normalized,
            agentConfig: config?.agent,
            roles: this.ctx.roles ?? resolveAgentRoles(config?.agent),
        });
        // Generated-spec namespace (0835 review P2; 0860 R3): fleet specs carry
        // the `fleet:generated` marker plus a `fleet:<slug>` group tag, so a stale
        // generated file left on disk stays identifiable and never shadows config
        // (G72 R2).
        for (const spec of projection.toUpsert) {
            spec.tags = [`fleet:${slug}`, 'spur:generated', 'fleet:generated'];
        }
        const enabledIds = new Set(enabled.map((m) => m.instanceId));
        const specs = projection.toUpsert.filter((s) => enabledIds.has(s.id));
        // The registry display name is the id prefix; a name that cannot form a
        // valid agent id fails here, naming the fix, before anything resolves it.
        for (const spec of specs) {
            try {
                validateAgentId(spec.id);
            } catch (error) {
                throw new Error(
                    `Fleet "${slug}" cannot form a valid spec id "${spec.id}" (the registry display name is the id prefix) — rename the registry entry (spur projects add --name): ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
        return specs;
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    /** Effective merged config — fresh reload at launch boundaries (0799 R3 parity). */
    private async effectiveConfig(): Promise<SpurConfig | null> {
        return this.ctx.reloadAgentConfig !== undefined
            ? await this.ctx.reloadAgentConfig()
            : (this.ctx.spurConfig ?? null);
    }

    /**
     * The spec-id prefix: the registry entry `name` for a registered project,
     * else the path basename (0835 Design — the existing team id for a
     * converted project; G64/0847 owns the conversion mapping).
     */
    private async projectSlug(normalized: string): Promise<string> {
        const entry = await this.registry.getByPath(normalized);
        return entry?.name ?? basename(normalized);
    }

    /**
     * R6 ground truth: the process cwd AND the storage root (the `.spur/`
     * parent the process resolves) must both normalize to the project. A
     * mismatch is a loud error naming both paths; `SPUR_SPEC_ID` /
     * `SPUR_RUN_ID` env values are never consulted as proof.
     */
    async assertLaunchGroundTruth(projectPath: string): Promise<void> {
        const expected = normalizeProjectPath(projectPath);
        const expectedStorageRoot = join(expected, '.spur');
        const cwd = normalizeProjectPath(process.cwd());
        const storageRoot = normalizeProjectPath(this.fs.resolve('.spur'));
        const databasePath = this.ctx.openDb
            ? await new ProjectClaimDao(await this.ctx.openDb(expected)).databasePath()
            : '';
        const databaseRoot = databasePath === '' ? expectedStorageRoot : normalizeProjectPath(dirname(databasePath));
        if (cwd !== expected || storageRoot !== expectedStorageRoot || databaseRoot !== expectedStorageRoot) {
            throw new Error(
                `Ground-truth mismatch for fleet at ${expected}: process cwd resolves to ${cwd}, storage root (.spur) resolves to ${storageRoot}, database root resolves to ${databaseRoot} — materialization only launches for the project it runs in; SPUR_* environment values are context, not proof (0835 R6)`,
            );
        }
    }
}
