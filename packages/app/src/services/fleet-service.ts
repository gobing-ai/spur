import { basename, dirname, join } from 'node:path';
import {
    type AgentConfig,
    type AgentRoleName,
    type ExecutionCapabilityState,
    type FleetDeclaration,
    FleetDeclarationSchema,
    memberLocalId,
    type NormalizedTeamMember,
    type SpurConfig,
} from '@gobing-ai/spur-config';
import { type DbAdapter, type ProjectClaim, ProjectClaimDao } from '@gobing-ai/spur-domain';
import {
    deleteAgentSpec as deleteAgentSpecFile,
    loadAgentSpecs,
    saveAgentSpec,
    validateAgentId,
} from '@gobing-ai/ts-ai-runner';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { resolveAgentRoles } from './agent-roles';
import type { AgentRoleDefinition } from './agent-service';
import { normalizeProjectPath, ProjectRegistry } from './project-registry';
import { type MaterializeResult, materializeRoster, resolveMemberExecutor } from './team-service';

// ---------------------------------------------------------------------------
// Public types (0835)
// ---------------------------------------------------------------------------

/** Context injected into FleetService — the config/role slice of TeamServiceContext. */
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
    enabled: boolean;
    /** True iff the resolved executor's `fsWrite` attestation is `enforced`/`available` (R4). */
    writeCapable: boolean;
    /** The resolved executor's `fsWrite` axis state; missing data is `unknown` (never grants). */
    capabilityState: ExecutionCapabilityState;
}

/** A resolved project fleet (0835). `missing` names what a caller must fix (R7 — a value, not an exception). */
export interface ResolvedFleet {
    projectPath: string;
    members: ResolvedFleetMember[];
    /** `'no-declaration'` | `'no-enabled-members'`. */
    missing: string[];
}

/**
 * 0836 R4: orchestrator availability. `missing` (nothing bound — declare one in
 * `.spur/fleet.json`) and `bound-offline` (bound, no live claim — start/heartbeat
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
// FleetService
// ---------------------------------------------------------------------------

/**
 * Application-layer read/resolve/materialize for a project's fleet declaration
 * at `<projectPath>/.spur/fleet.json` (0835 R1/R2). The declaration is the ONLY
 * authoring surface for a project fleet; the specs this service writes into
 * `.spur/agents/` are a projection of it, never a second editable roster, and
 * hand-authored specs are never touched. Ids derive through the shared
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
     * Load the project's fleet declaration, or `null` when there is none (R7).
     * Invalid JSON/schema fails loudly naming the file. The path is normalized
     * (`normalizeProjectPath`) first — the storage root this reads is the
     * project's own, canonicalized through symlinks/`~`, which IS the read-side
     * ground-truth check; the write-side cwd check lives in {@link materialize}.
     */
    async load(projectPath: string): Promise<FleetDeclaration | null> {
        const file = this.declarationPath(projectPath);
        let raw: string;
        try {
            raw = await this.fs.readFile(file);
        } catch (error) {
            // R7 resolves a MISSING declaration cleanly — but EACCES/EISDIR are
            // environment failures, not absence; they must not masquerade as
            // `no-declaration` and silently skip the fleet.
            if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return null;
            throw error;
        }
        let json: unknown;
        try {
            json = JSON.parse(raw);
        } catch (error) {
            throw new Error(
                `Invalid fleet declaration at ${file}: not valid JSON — ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        const parsed = FleetDeclarationSchema.safeParse(json);
        if (!parsed.success) {
            const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
            throw new Error(`Invalid fleet declaration at ${file} — ${detail}`);
        }
        return parsed.data;
    }

    /**
     * Resolve the declaration against config: stable instance ids (R3, via the
     * shared `memberLocalId` allocator), executor resolution through the same
     * pinned-or-tier-ladder funnel teams use, and `fsWrite`-attested write
     * capability (R4). A missing declaration or an all-disabled roster resolves
     * cleanly with `missing` naming the fix (R7) — it does not throw. Disabled
     * members keep their derived id (index preservation) but are not resolved
     * against executors.
     */
    async resolve(projectPath: string): Promise<ResolvedFleet> {
        const normalized = normalizeProjectPath(projectPath);
        const declaration = await this.load(normalized);
        if (declaration === null) {
            return { projectPath: normalized, members: [], missing: ['no-declaration'] };
        }

        const config = await this.effectiveConfig();
        const agentConfig: AgentConfig | undefined = config?.agent;
        const members = declaration.members;
        const enabledIndexes = new Set(members.flatMap((m, i) => (m.enabled !== false ? [i] : [])));
        const slug = await this.projectSlug(normalized);

        const resolvedMembers: ResolvedFleetMember[] = [];
        for (const [index, member] of members.entries()) {
            // R3: ids derive over the FULL roster (disabled members preserve
            // their index) via the shared allocator — never re-derived here.
            const instanceId = `${slug}-${memberLocalId(member as NormalizedTeamMember, members as NormalizedTeamMember[], index)}`;
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
            const { executorName } = resolveMemberExecutor({
                roster: declaration.members as NormalizedTeamMember[],
                member: member as NormalizedTeamMember,
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
                enabled: true,
                writeCapable: capabilityState === 'enforced' || capabilityState === 'available',
                capabilityState,
            });
        }

        const missing = members.some((m) => m.enabled !== false) ? [] : ['no-enabled-members'];
        return { projectPath: normalized, members: resolvedMembers, missing };
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
        const localIds = members.map((m, i) =>
            memberLocalId(m as NormalizedTeamMember, members as NormalizedTeamMember[], i),
        );
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
     * Materialize the declaration into `.spur/agents/` specs: one
     * `spur:generated` spec per ENABLED member (ids derived over the full
     * roster so disabled members preserve everyone's index), pruning generated
     * fleet specs that are no longer desired. Hand-authored specs are never
     * touched (R2). When `check` is true, returns the diff and writes nothing.
     *
     * This is the launch boundary, so it validates its own ground truth (R6):
     * `process.cwd()` and the storage root (`.spur/` parent) must both resolve
     * to the project — `SPUR_*` env values are context, not proof.
     */
    async materialize(projectPath: string, opts?: { check?: boolean }): Promise<MaterializeResult> {
        const normalized = normalizeProjectPath(projectPath);
        await this.assertLaunchGroundTruth(normalized);

        const declaration = await this.load(normalized);
        if (declaration === null) {
            throw new Error(
                `No fleet declaration at ${this.declarationPath(normalized)} — nothing to materialize (FleetService.resolve reports this as missing: ['no-declaration'])`,
            );
        }

        const resolved = await this.resolve(normalized);
        const enabled = resolved.members.filter((m) => m.enabled);
        if (enabled.length === 0) {
            throw new Error(
                `Fleet at ${normalized} has no enabled members — set enabled: true on at least one member of ${this.declarationPath(normalized)}`,
            );
        }
        const slug = await this.projectSlug(normalized);

        const config = await this.effectiveConfig();
        const configDir = join(normalized, '.spur', 'agents');
        const specs = await loadAgentSpecs(configDir);

        // Shared roster projection (0835): ids over the FULL roster, then the
        // enabled subset is what gets written/pruned — disabling a member
        // retires its generated spec without freeing its id index.
        const projection = materializeRoster({
            slug,
            label: `Fleet "${slug}"`,
            members: declaration.members as NormalizedTeamMember[],
            defaultWorkspace: normalized,
            agentConfig: config?.agent,
            roles: this.ctx.roles ?? resolveAgentRoles(config?.agent),
            specs,
        });
        // Namespace isolation (0835 review P2): fleet specs carry the
        // `fleet:generated` marker and a `fleet:<slug>` group tag — never the
        // `team:<slug>` group tag — so team materialization's prune
        // (`team:<id>` + `spur:generated`) can never match a fleet spec, even
        // when a registry name equals a config team id.
        for (const spec of projection.toUpsert) {
            spec.tags = [`fleet:${slug}`, 'spur:generated', 'fleet:generated'];
        }
        const enabledIds = new Set(enabled.map((m) => m.instanceId));
        const toUpsert = projection.toUpsert.filter((s) => enabledIds.has(s.id));
        const desiredIds = new Set([...projection.desiredIds].filter((id) => enabledIds.has(id)));
        // The registry display name is the id prefix; a name that cannot form a
        // valid agent id fails here, naming the fix, before anything writes.
        for (const spec of toUpsert) {
            await this.assertLaunchGroundTruth(spec.workspace);
            try {
                validateAgentId(spec.id);
            } catch (error) {
                throw new Error(
                    `Fleet "${slug}" cannot form a valid spec id "${spec.id}" (the registry display name is the id prefix) — rename the registry entry (spur projects add --name): ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }

        // Prune orphaned generated specs: ONLY fleet-generated specs (both
        // `spur:generated` + `fleet:generated`) not in the desired set — the
        // predicate never consults `team:<slug>`, keeping the namespaces
        // disjoint (0835 review P2). Hand-authored specs (no generator tag)
        // are never deleted (R2).
        const orphaned = specs.filter(
            (s) => s.tags?.includes('spur:generated') && s.tags?.includes('fleet:generated') && !desiredIds.has(s.id),
        );

        if (opts?.check) {
            return {
                teamId: slug,
                upserted: toUpsert.map((s) => s.id),
                orphaned: orphaned.map((s) => s.id),
                written: false,
            };
        }

        for (const spec of toUpsert) {
            await saveAgentSpec(spec, configDir);
        }
        for (const spec of orphaned) {
            await deleteAgentSpecFile(spec.id, configDir);
        }

        return {
            teamId: slug,
            upserted: toUpsert.map((s) => s.id),
            orphaned: orphaned.map((s) => s.id),
            written: true,
        };
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    /** Path of the declaration file for a (normalized) project path. */
    private declarationPath(projectPath: string): string {
        return join(normalizeProjectPath(projectPath), '.spur', 'fleet.json');
    }

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
     * `SPUR_TEAM_ID` / `SPUR_RUN_ID` env values are never consulted as proof.
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
