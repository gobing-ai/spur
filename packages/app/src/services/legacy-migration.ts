import { join, relative, resolve } from 'node:path';
import {
    type FleetDeclaration,
    FleetDeclarationSchema,
    type FleetMember,
    memberLocalId,
    type NormalizedTeamMember,
    normalizeMember,
    type SpurConfig,
    type TeamConfig,
} from '@gobing-ai/spur-config';
import { atomicWriteAsync, type DbAdapter, listAddressedSpecIds } from '@gobing-ai/spur-domain';
import { type AgentSpec, loadAgentSpecs } from '@gobing-ai/ts-ai-runner';
import { type FileSystem, walkDir } from '@gobing-ai/ts-runtime';
import { normalizeProjectPath, ProjectRegistry } from './project-registry';

// ---------------------------------------------------------------------------
// Public types (0846 — frozen names; see docs/tasks4/0846_*.md Design)
// ---------------------------------------------------------------------------

export type LegacyArtifactKind =
    | 'team-config' // one `agent.team.<id>` block
    | 'generated-spec' // .spur/agents/<id>.yaml tagged `team:<id>` + `spur:generated`
    | 'manual-spec' // hand-authored spec (no team tag, or team tag without spur:generated)
    | 'orphan-spec' // `team:<id>` tag whose `agent.team.<id>` block is gone
    | 'legacy-flag-usage'; // a `--agent <spec-id>` occurrence in the project's workflow-config tree, plugins, or docs

/** What migration does with an artifact — the §4 matrix verdicts (`docs/reports/g6-runtime-inventory.md`). */
export type LegacyDisposition = 'convert' | 'preserve' | 'relink' | 'retire';

/** Named, operator-actionable blockers (R4) — 0847 refuses to write while any exists. */
export type LegacyConflictKind =
    | 'two-teams-one-project'
    | 'work-dir-mismatch'
    | 'derived-id-collision'
    | 'orphan-spec-no-config'
    | 'spec-workspace-disagreement'
    // 0847 R2: a preserved roster id that inbox/coordination rows address but that has
    // no spec file on disk — the preview cannot see it (it classifies on-disk specs only),
    // so the conversion itself must look before writing.
    | 'addressed-id-without-spec';

/** A blocker named with concrete sources — never summarized, never auto-resolved (G64 R3). */
export interface LegacyConflict {
    kind: LegacyConflictKind;
    message: string;
    /** ≥2 for a collision, 1 for a mismatch — always concrete paths or config keys. */
    sources: string[];
}

/** One legacy population member — a config block, a spec file, or a shim flag usage. */
export interface LegacyArtifact {
    kind: LegacyArtifactKind;
    /** Team id, spec id, or `<file>:<line>` for legacy-flag-usage. */
    id: string;
    /** Absolute path, or the config key `agent.team.<id>`. */
    source: string;
    disposition: LegacyDisposition;
    /** Preserved spec id / fleet member id; null when retired. */
    targetId: string | null;
    /** This spec id owns inbox or coordination rows. */
    addressed: boolean;
    conflicts: LegacyConflict[];
}

/** Non-blocking observation — a warning never halts 0847; 0848 halts on these. */
export type LegacyWarningKind = 'unmapped-member-override';

/** A roster member key `FleetMember` cannot carry — loss is deferred to 0848's retirement. */
export interface LegacyWarning {
    kind: LegacyWarningKind;
    message: string;
    /** `agent.team.<id>.members[<i>]` */
    source: string;
    /** Member keys with no FleetMember home. */
    fields: string[];
}

/** The full read-only census of one legacy project (R1 + R4). */
export interface MigrationInventory {
    projectPath: string;
    artifacts: LegacyArtifact[];
    /** Union of inbox_messages.to_id and coordination_runs.spec_id. */
    addressedSpecIds: string[];
    /** Deduped union — this is 0847's halt set. */
    conflicts: LegacyConflict[];
    /** Never halts 0847 (which is additive); 0848 halts on these. */
    warnings: LegacyWarning[];
    counts: Readonly<Record<LegacyDisposition, number>>;
}

/** One planned action — described, never executed (this task writes nothing; 0847 owns writes). */
export interface MigrationPlanStep {
    action: 'write-fleet' | 'preserve-spec' | 'relink-spec' | 'retire-spec' | 'retire-config-block';
    target: string;
    from: string | null;
    /** The verbatim spec id this step must not change. */
    preservesId: string | null;
    conflicts: LegacyConflict[];
}

/** The dry-run preview (R2): fresh inventory + projected steps + halt flag. */
export interface MigrationPlan {
    inventory: MigrationInventory;
    steps: MigrationPlanStep[];
    /** True iff inventory.conflicts.length > 0. */
    blocked: boolean;
}

/** The write-mode result of one `apply()` run (0847 — frozen names; see docs/tasks4/0847_*.md Design). */
export interface ConversionResult {
    projectPath: string;
    outcome: 'converted' | 'unchanged' | 'blocked' | 'nothing-to-convert';
    /** `<projectPath>/.spur/fleet.json` */
    fleetPath: string;
    /** `<projectPath>/.spur/fleet.json.bak`, null when no prior file existed. */
    backupPath: string | null;
    /** Every spec id carried through verbatim. */
    preservedIds: string[];
    /** Non-empty iff outcome === 'blocked'. */
    conflicts: LegacyConflict[];
    /** Carried forward for 0848; never blocks. */
    warnings: LegacyWarning[];
}

/** The result of one `rollback()` run (0847). */
export interface RollbackResult {
    outcome: 'restored' | 'removed' | 'nothing-to-roll-back';
    fleetPath: string;
}

/** Context injected into LegacyMigrationService — the read-only slice the inventory needs. */
export interface LegacyMigrationServiceContext {
    /**
     * Merged global+project config threaded from the composition root (A5 /
     * ADR-082). `null`/absent = load failed/absent; the inventory then sees no
     * team blocks, so every tagged spec classifies as an orphan.
     */
    spurConfig?: SpurConfig | null;
    /** Filesystem port. The service reads through it only — the zero-write guard (R3). */
    fs: FileSystem;
    /** Migrated SQLite adapter factory. Read-only use: the addressed-spec-id SELECTs. */
    getDb(): Promise<DbAdapter>;
    /**
     * Project registry for the work_dir registration check (R4). Optional so tests
     * can point one at a temp file; defaults to the machine registry.
     */
    registry?: ProjectRegistry;
}

// ---------------------------------------------------------------------------
// LegacyMigrationService (0846)
// ---------------------------------------------------------------------------

/** Keys `FleetMemberSchema` (0835) can carry — member keys outside this set are warnings, not conflicts. */
const FLEET_MEMBER_KEYS: ReadonlySet<string> = new Set(['id', 'role', 'executor', 'purpose', 'enabled']);

/** Scan roots for `--agent <spec-id>` usage — the removal-condition trees of the transition shim. */
const FLAG_SCAN_ROOTS: readonly string[][] = [
    ['config', 'workflows'], // segment form: `sp-runtime-path` bans the joined literal in app source
    ['plugins'],
    ['docs'],
];

/** One team block in resolved form — the per-team facts classification and conflicts share. */
interface TeamSnapshot {
    teamId: string;
    config: TeamConfig;
    /** Roster in normalized (object) form, declaration order — the frozen-index input. */
    members: NormalizedTeamMember[];
    /** `resolve(projectPath, work_dir)` — the resolution TeamService applies against its cwd. */
    resolvedWorkDir: string;
    normalizedWorkDir: string;
}

interface Classified {
    inventory: MigrationInventory;
    /** Team snapshots by id — preview() re-reads rosters to emit the per-member write-fleet steps. */
    teams: Map<string, TeamSnapshot>;
}

/**
 * Key-order-insensitive structural form of a parsed JSON value (0847 R4): the
 * idempotence deep-equal compares this shape, so key order and formatting in an
 * existing `fleet.json` never cause a spurious rewrite.
 */
function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([, v]) => v !== undefined)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => [k, stableValue(v)]),
        );
    }
    return value;
}

/** On-disk spec kinds — every spec file classifies into exactly one of these. */
const SPEC_ARTIFACT_KINDS: ReadonlySet<LegacyArtifactKind> = new Set(['generated-spec', 'manual-spec', 'orphan-spec']);

/**
 * Read-only migration inventory and dry-run preview over a legacy team project (0846).
 * Reads the four legacy populations — `agent.team.<id>` blocks, generated specs,
 * hand-authored specs, orphan specs — classifies each against the §4 matrix
 * (`docs/reports/g6-runtime-inventory.md`), and emits a conflict-annotated plan.
 *
 * Zero-write by construction (R3): the DB handle is used through
 * {@link listAddressedSpecIds} reads only, the registry through `readRaw()` (never
 * `list()`, which heals/writes), and the fs port through read verbs. The service never
 * calls `materializeTeam`, `teardownTeam`, or `ProjectRegistry.withLock` — all three write.
 */
export class LegacyMigrationService {
    private readonly ctx: LegacyMigrationServiceContext;
    private readonly registry: ProjectRegistry;
    /**
     * Fleet files this instance wrote via `apply()` (0847 rollback provenance).
     * In-memory by design: no marker field is added to `fleet.json` (0835 owns
     * that schema and `version: 1` has no room for one), so a fresh process
     * cannot prove which writer produced a `.bak`-less file and correctly
     * reports `'nothing-to-roll-back'`.
     */
    private readonly appliedFleetPaths = new Set<string>();

    constructor(ctx: LegacyMigrationServiceContext) {
        this.ctx = ctx;
        this.registry = ctx.registry ?? new ProjectRegistry();
    }

    /** Inventory every legacy artifact under `projectPath` (R1). */
    async inventory(projectPath: string): Promise<MigrationInventory> {
        return (await this.classify(projectPath)).inventory;
    }

    /** Build the conflict-annotated dry-run plan (R2). No step is executed. */
    async preview(projectPath: string): Promise<MigrationPlan> {
        const { inventory, teams } = await this.classify(projectPath);
        return { inventory, steps: this.buildSteps(inventory, teams), blocked: inventory.conflicts.length > 0 };
    }

    /**
     * Convert the single legacy roster resolving to `projectPath` into
     * `<projectPath>/.spur/fleet.json` (0847). Purely additive: one file is
     * written, nothing under `.spur/agents/` or `.spur/config.yaml` is touched,
     * and the DB is never opened for writing — verbatim spec ids mean the
     * on-disk specs are already the correct artifacts.
     *
     * Algorithm (first-match-wins, per the 0847 Design):
     * 1. fresh `preview()` — blocked ⇒ return, nothing written, backed up, or created (R7);
     * 2. select the one team whose `work_dir` normalizes to `projectPath` (zero ⇒ nothing-to-convert);
     * 3. build members with an EXPLICIT `id` from `memberLocalId` — freezing `<role>-<n>` (R3);
     * 4. every preserved id that is addressed must have its spec on disk, else blocked (R2);
     * 5. an existing equal declaration ⇒ 'unchanged', no write, no backup (R4);
     * 6. copy a prior file to `.bak`, then `atomicWriteAsync` the new one (R5).
     */
    async apply(projectPath: string): Promise<ConversionResult> {
        const base = resolve(projectPath);
        const fleetPath = join(base, '.spur', 'fleet.json');

        // 1 (R7): refuse before any side effect — no backup file may outlive a blocked run.
        const plan = await this.preview(base);
        const done = (
            outcome: ConversionResult['outcome'],
            extra?: Partial<Pick<ConversionResult, 'backupPath' | 'preservedIds' | 'conflicts'>>,
        ): ConversionResult => ({
            projectPath: base,
            outcome,
            fleetPath,
            backupPath: null,
            preservedIds: [],
            conflicts: [],
            warnings: plan.inventory.warnings,
            ...extra,
        });
        if (plan.blocked) return done('blocked', { conflicts: plan.inventory.conflicts });

        // 2: the single team resolving here — two or more were blocked in step 1.
        const targetPath = normalizeProjectPath(base);
        const { teams } = await this.classify(base);
        const team = [...teams.values()].find((t) => t.normalizedWorkDir === targetPath);
        if (team === undefined) return done('nothing-to-convert');

        // 3 (R1, R3): explicit id per member — the derivation is called once, here,
        // so a later reorder of fleet.json cannot reallocate a mailbox address.
        const members: FleetMember[] = [];
        const preservedIds: string[] = [];
        for (const [index, member] of team.members.entries()) {
            const localId = memberLocalId(member, team.members, index);
            members.push({
                id: localId,
                ...(member.role !== undefined ? { role: member.role } : {}),
                ...(member.executor !== undefined ? { executor: member.executor } : {}),
                ...(member.purpose !== undefined ? { purpose: member.purpose } : {}),
                enabled: true,
            });
            preservedIds.push(`${team.teamId}-${localId}`);
        }
        const declaration: FleetDeclaration = { version: 1, members };

        // 4 (R2): the no-orphan proof — a preserved id backed by inbox/coordination rows
        // must exist as a spec file, or writing would desync the mailbox identity.
        const addressed = new Set(plan.inventory.addressedSpecIds);
        const onDiskSpecIds = new Set(
            plan.inventory.artifacts.filter((a) => SPEC_ARTIFACT_KINDS.has(a.kind)).map((a) => a.id),
        );
        const missing = preservedIds.filter((id) => !onDiskSpecIds.has(id) && addressed.has(id));
        if (missing.length > 0) {
            const conflict: LegacyConflict = {
                kind: 'addressed-id-without-spec',
                message:
                    `preserved id(s) ${missing.map((id) => `"${id}"`).join(', ')} are addressed by inbox or ` +
                    'coordination rows but have no spec file under .spur/agents/ — restore the spec(s) or ' +
                    'resolve the rows before converting',
                sources: missing.map((id) => join(base, '.spur', 'agents', `${id}.yaml`)),
            };
            return done('blocked', { conflicts: [conflict] });
        }

        // 6 (R4) first half: an equal existing declaration means nothing to do — no
        // rewrite (mtime untouched), no backup, so a re-run reads as "a migration happened".
        let existingRaw: string | null = null;
        if (await this.ctx.fs.exists(fleetPath)) existingRaw = await this.ctx.fs.readFile(fleetPath);
        if (existingRaw !== null) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(existingRaw);
            } catch {
                parsed = undefined; // unreadable prior file — fall through to backup + rewrite
            }
            if (
                parsed !== undefined &&
                JSON.stringify(stableValue(parsed)) === JSON.stringify(stableValue(declaration))
            ) {
                return done('unchanged', { preservedIds });
            }
        }

        // 6 (R5): backup then atomic write. The declaration is schema-asserted before
        // any side effect — FleetService.load() (0835) rejects anything else at read time.
        FleetDeclarationSchema.parse(declaration);
        let backupPath: string | null = null;
        if (existingRaw !== null) {
            backupPath = `${fleetPath}.bak`;
            await this.ctx.fs.copy(fleetPath, backupPath);
        }
        await atomicWriteAsync(fleetPath, `${JSON.stringify(declaration, null, 4)}\n`, 'fleet', this.ctx.fs);
        this.appliedFleetPaths.add(fleetPath);
        return done('converted', { backupPath, preservedIds });
    }

    /**
     * Reverse one `apply()` (0847 R5). A `.bak` sibling is restored over
     * `fleet.json`; a file this instance wrote when no prior file existed is
     * removed; anything else is reported untouched — rollback never guesses.
     */
    async rollback(projectPath: string): Promise<RollbackResult> {
        const fleetPath = join(resolve(projectPath), '.spur', 'fleet.json');
        const backupPath = `${fleetPath}.bak`;
        if (await this.ctx.fs.exists(backupPath)) {
            await this.ctx.fs.copy(backupPath, fleetPath);
            return { outcome: 'restored', fleetPath };
        }
        if ((await this.ctx.fs.exists(fleetPath)) && this.appliedFleetPaths.has(fleetPath)) {
            await this.ctx.fs.deleteFile(fleetPath);
            this.appliedFleetPaths.delete(fleetPath);
            return { outcome: 'removed', fleetPath };
        }
        return { outcome: 'nothing-to-roll-back', fleetPath };
    }

    // -----------------------------------------------------------------------
    // Classification
    // -----------------------------------------------------------------------

    private async classify(projectPath: string): Promise<Classified> {
        const base = resolve(projectPath);
        const config = this.ctx.spurConfig ?? null;
        const configDir = join(base, '.spur', 'agents');
        const specs = await loadAgentSpecs(configDir, this.ctx.fs);
        const specPaths = await this.specFilePaths(configDir, specs);
        const addressed = new Set(await listAddressedSpecIds(await this.ctx.getDb()));
        // readRaw, never list(): list() heals tilde paths and stale ports — both WRITE.
        const registeredPaths = new Set(this.registry.readRaw().projects.map((p) => normalizeProjectPath(p.path)));

        const teams = new Map<string, TeamSnapshot>();
        for (const [teamId, teamConfig] of Object.entries(config?.agent?.team ?? {})) {
            const resolvedWorkDir = resolve(base, teamConfig.work_dir);
            teams.set(teamId, {
                teamId,
                config: teamConfig,
                members: teamConfig.members.map(normalizeMember),
                resolvedWorkDir,
                normalizedWorkDir: normalizeProjectPath(resolvedWorkDir),
            });
        }

        // Conflict set, deduped by kind + sorted sources — this map IS 0847's halt set.
        const conflicts = new Map<string, LegacyConflict>();
        const addConflict = (kind: LegacyConflictKind, message: string, sources: string[]): LegacyConflict => {
            const sorted = [...sources].sort();
            const key = `${kind}::${sorted.join('|')}`;
            const existing = conflicts.get(key);
            if (existing !== undefined) return existing;
            const conflict: LegacyConflict = { kind, message, sources: sorted };
            conflicts.set(key, conflict);
            return conflict;
        };

        // --- Team-level conflicts (R4, independent predicates) ---
        const byPath = new Map<string, TeamSnapshot[]>();
        for (const team of teams.values()) {
            const group = byPath.get(team.normalizedWorkDir) ?? [];
            group.push(team);
            byPath.set(team.normalizedWorkDir, group);
        }
        const teamConflicts = new Map<string, LegacyConflict[]>();
        const attachTeamConflict = (teamId: string, conflict: LegacyConflict): void => {
            const list = teamConflicts.get(teamId) ?? [];
            list.push(conflict);
            teamConflicts.set(teamId, list);
        };
        for (const [normalizedPath, group] of byPath) {
            if (group.length < 2) continue;
            const conflict = addConflict(
                'two-teams-one-project',
                `teams ${group.map((t) => `"${t.teamId}"`).join(' and ')} both resolve to project path ${normalizedPath} — ` +
                    'no merge is proposed; resolve the duplicate before converting',
                group.map((t) => `agent.team.${t.teamId}`),
            );
            for (const team of group) attachTeamConflict(team.teamId, conflict);
        }
        for (const team of teams.values()) {
            if (registeredPaths.has(team.normalizedWorkDir)) continue;
            attachTeamConflict(
                team.teamId,
                addConflict(
                    'work-dir-mismatch',
                    `team "${team.teamId}" work_dir resolves to ${team.normalizedWorkDir}, ` +
                        'which is not a registered project path',
                    [`agent.team.${team.teamId}`],
                ),
            );
        }

        // --- Spec classification: the five-step precedence chain, first match wins ---
        const artifacts: LegacyArtifact[] = [];
        const teamArtifacts = new Map<string, LegacyArtifact>();
        for (const team of teams.values()) {
            const artifact: LegacyArtifact = {
                kind: 'team-config',
                id: team.teamId,
                source: `agent.team.${team.teamId}`,
                disposition: 'convert',
                // The conversion target is the project fleet declaration (0835/0847).
                targetId: join(base, '.spur', 'fleet.json'),
                addressed: false,
                conflicts: teamConflicts.get(team.teamId) ?? [],
            };
            teamArtifacts.set(team.teamId, artifact);
            artifacts.push(artifact);
        }

        const specArtifacts = new Map<string, LegacyArtifact>();
        for (const spec of specs) {
            const tags = spec.tags ?? [];
            const teamTag = tags.find((t) => t.startsWith('team:'));
            const source = specPaths.get(spec.id) ?? join(configDir, `${spec.id}.yaml`);
            const conflictsForSpec: LegacyConflict[] = [];
            let kind: LegacyArtifactKind;
            let disposition: LegacyDisposition;
            let targetId: string | null;

            if (teamTag === undefined) {
                // 1 — hand-authored, no team tag.
                kind = 'manual-spec';
                disposition = 'preserve';
                targetId = spec.id;
            } else if (!tags.includes('spur:generated')) {
                // 2 — team-tagged but never generated: the existing contract at
                // materialize/teardown (only spur:generated specs are ever touched).
                kind = 'manual-spec';
                disposition = 'preserve';
                targetId = spec.id;
            } else {
                const teamId = teamTag.slice('team:'.length);
                const team = teams.get(teamId);
                if (team !== undefined) {
                    // 3 — converts into the fleet; the spec id is preserved verbatim.
                    kind = 'generated-spec';
                    disposition = 'convert';
                    targetId = spec.id;
                    const specWorkspace = normalizeProjectPath(resolve(base, spec.workspace));
                    if (specWorkspace !== team.normalizedWorkDir) {
                        conflictsForSpec.push(
                            addConflict(
                                'spec-workspace-disagreement',
                                `generated spec "${spec.id}" workspace resolves to ${specWorkspace}, ` +
                                    `which disagrees with team "${teamId}" work_dir ${team.normalizedWorkDir}`,
                                [source],
                            ),
                        );
                    }
                } else if (addressed.has(spec.id)) {
                    // 4 — addressed orphan: relink (a spec id that owns rows may never retire).
                    kind = 'orphan-spec';
                    disposition = 'relink';
                    targetId = spec.id;
                    conflictsForSpec.push(this.orphanConflict(addConflict, teamId, source, spec.id));
                } else {
                    // 5 — unaddressed orphan: retire. Still a named conflict (R4 lists orphan
                    // specs as conflicts and the AC reports retirement "with its conflicts");
                    // 0847 must look, and the operator removes the file explicitly.
                    kind = 'orphan-spec';
                    disposition = 'retire';
                    targetId = null;
                    conflictsForSpec.push(this.orphanConflict(addConflict, teamId, source, spec.id));
                }
            }

            const artifact: LegacyArtifact = {
                kind,
                id: spec.id,
                source,
                disposition,
                targetId,
                addressed: addressed.has(spec.id),
                conflicts: conflictsForSpec,
            };
            specArtifacts.set(spec.id, artifact);
            artifacts.push(artifact);
        }

        // --- derived-id-collision: a roster member re-derives an id an on-disk spec
        // already holds under a DIFFERENT team tag. The in-config case is fatal at
        // AgentConfigSchema.superRefine load and is not re-checked here.
        for (const team of teams.values()) {
            for (const [index, member] of team.members.entries()) {
                const localId = memberLocalId(member, team.members, index);
                if (localId === '') continue; // neither role nor executor — rejected at config load
                const composed = `${team.teamId}-${localId}`;
                const holder = specs.find((s) => s.id === composed);
                if (holder === undefined) continue;
                const holderTags = holder.tags ?? [];
                const holderTeamTag = holderTags.find((t) => t.startsWith('team:'));
                if (holderTeamTag === undefined || holderTeamTag === `team:${team.teamId}`) {
                    // Hand-authored under a desired id → the existing preserve contract, not a
                    // collision; this team's own spec is the normal case.
                    continue;
                }
                const holderSource = specPaths.get(holder.id) ?? join(configDir, `${holder.id}.yaml`);
                const conflict = addConflict(
                    'derived-id-collision',
                    `member ${index} of team "${team.teamId}" derives id "${composed}", which on-disk spec ` +
                        `"${holder.id}" already holds under tag "${holderTeamTag}" — a rename would orphan ` +
                        'inbox and coordination rows',
                    [`agent.team.${team.teamId}.members[${index}]`, holderSource],
                );
                const teamArtifact = teamArtifacts.get(team.teamId);
                if (teamArtifact !== undefined) teamArtifact.conflicts.push(conflict);
                const holderArtifact = specArtifacts.get(holder.id);
                if (holderArtifact !== undefined) holderArtifact.conflicts.push(conflict);
            }
        }

        // --- legacy-flag-usage scan (0849's proof input) ---
        artifacts.push(...(await this.scanLegacyFlagUsage(base, new Set(specs.map((s) => s.id)))));

        // --- warnings: member keys with no FleetMember home (never halt 0847; 0848 halts) ---
        const warnings: LegacyWarning[] = [];
        for (const team of teams.values()) {
            for (const [index, member] of team.members.entries()) {
                const unmapped = Object.keys(member).filter((key) => !FLEET_MEMBER_KEYS.has(key));
                if (unmapped.length === 0) continue;
                warnings.push({
                    kind: 'unmapped-member-override',
                    message:
                        `member ${index} of team "${team.teamId}" declares keys with no FleetMember home ` +
                        `(${unmapped.join(', ')}) — the config block stays until the noun retires, so ` +
                        'nothing is lost while both exist; the team retirement task halts on these',
                    source: `agent.team.${team.teamId}.members[${index}]`,
                    fields: unmapped,
                });
            }
        }

        const conflictList = [...conflicts.values()].sort(
            (a, b) => a.kind.localeCompare(b.kind) || a.sources.join('|').localeCompare(b.sources.join('|')),
        );
        const counts: Record<LegacyDisposition, number> = { convert: 0, preserve: 0, relink: 0, retire: 0 };
        for (const artifact of artifacts) counts[artifact.disposition] += 1;

        return {
            inventory: {
                projectPath: base,
                artifacts,
                addressedSpecIds: [...addressed].sort(),
                conflicts: conflictList,
                warnings,
                counts,
            },
            teams,
        };
    }

    private orphanConflict(
        add: (kind: LegacyConflictKind, message: string, sources: string[]) => LegacyConflict,
        teamId: string,
        source: string,
        specId: string,
    ): LegacyConflict {
        return add(
            'orphan-spec-no-config',
            `spec "${specId}" carries tag "team:${teamId}" but agent.team.${teamId} does not exist in the config`,
            [source],
        );
    }

    // -----------------------------------------------------------------------
    // Plan projection
    // -----------------------------------------------------------------------

    /**
     * Map artifacts to plan steps. A team-config artifact emits ONE write-fleet step per
     * roster member: `preservesId` is the composed spec id `<teamId>-<localId>` derived
     * through `memberLocalId` (never re-derived by hand) — exactly the identity 0847's
     * verbatim-preservation proof needs. `retire-config-block` is owned by the noun
     * retirement task; this preview never proposes it.
     */
    private buildSteps(inventory: MigrationInventory, teams: Map<string, TeamSnapshot>): MigrationPlanStep[] {
        const steps: MigrationPlanStep[] = [];
        for (const artifact of inventory.artifacts) {
            if (artifact.kind === 'team-config') {
                const team = teams.get(artifact.id);
                if (team === undefined) continue;
                for (const [index, member] of team.members.entries()) {
                    const localId = memberLocalId(member, team.members, index);
                    steps.push({
                        action: 'write-fleet',
                        target: localId,
                        from: `agent.team.${team.teamId}.members[${index}]`,
                        preservesId: localId === '' ? null : `${team.teamId}-${localId}`,
                        conflicts: artifact.conflicts,
                    });
                }
                continue;
            }
            if (artifact.kind === 'legacy-flag-usage') {
                // Scan evidence for the shim-removal task; no migration action owns a doc or
                // workflow rewrite here.
                continue;
            }
            if (artifact.disposition === 'relink') {
                steps.push({
                    action: 'relink-spec',
                    target: artifact.id,
                    from: artifact.source,
                    preservesId: artifact.id,
                    conflicts: artifact.conflicts,
                });
            } else if (artifact.disposition === 'retire') {
                steps.push({
                    action: 'retire-spec',
                    target: artifact.id,
                    from: artifact.source,
                    preservesId: null,
                    conflicts: artifact.conflicts,
                });
            } else {
                // convert (generated) and preserve (manual) both keep the spec file untouched —
                // verbatim ids mean the on-disk spec already IS the correct artifact.
                steps.push({
                    action: 'preserve-spec',
                    target: artifact.id,
                    from: artifact.source,
                    preservesId: artifact.id,
                    conflicts: artifact.conflicts,
                });
            }
        }
        return steps;
    }

    // -----------------------------------------------------------------------
    // Reads
    // -----------------------------------------------------------------------

    /** Map spec id → spec file path from the agents dir listing (basename match, canonical fallback). */
    private async specFilePaths(configDir: string, specs: readonly AgentSpec[]): Promise<Map<string, string>> {
        const paths = new Map<string, string>();
        let entries: string[] = [];
        try {
            entries = await this.ctx.fs.readDir(configDir);
        } catch {
            return paths; // no agents dir → no spec files on disk
        }
        for (const entry of entries) {
            const match = /^(.+)\.ya?ml$/.exec(entry);
            const stem = match?.[1];
            if (stem !== undefined && !paths.has(stem)) paths.set(stem, join(configDir, entry));
        }
        for (const spec of specs) {
            if (!paths.has(spec.id)) paths.set(spec.id, join(configDir, `${spec.id}.yaml`));
        }
        return paths;
    }

    /**
     * Scan the shim removal-condition trees for `--agent <value>` occurrences whose value
     * equals an on-disk spec id. Role and executor selectors do not count — only real
     * spec identities do. Undecodable files carry no selector usage; the scan is a
     * text-tree read, so a read failure skips one file, never the inventory.
     */
    private async scanLegacyFlagUsage(projectPath: string, specIds: ReadonlySet<string>): Promise<LegacyArtifact[]> {
        const artifacts: LegacyArtifact[] = [];
        for (const root of FLAG_SCAN_ROOTS) {
            const rootPath = join(projectPath, ...root);
            if (!(await this.ctx.fs.exists(rootPath))) continue;
            let files: string[] = [];
            try {
                files = await walkDir(rootPath, this.ctx.fs);
            } catch {
                continue;
            }
            for (const file of files) {
                let content: string;
                try {
                    content = await this.ctx.fs.readFile(file);
                } catch {
                    continue;
                }
                const rel = relative(projectPath, file);
                const lines = content.split(/\r?\n/);
                for (const [index, line] of lines.entries()) {
                    for (const match of line.matchAll(/--agent(?:=|[ \t]+)([A-Za-z0-9][A-Za-z0-9_.-]*)/g)) {
                        const value = match[1];
                        if (value === undefined || !specIds.has(value)) continue;
                        artifacts.push({
                            kind: 'legacy-flag-usage',
                            id: `${rel}:${index + 1}`,
                            source: file,
                            disposition: 'retire',
                            targetId: null,
                            addressed: false,
                            conflicts: [],
                        });
                    }
                }
            }
        }
        return artifacts;
    }
}

// ---------------------------------------------------------------------------
// Config-block removal halt guard (0848 plan step 12)
// ---------------------------------------------------------------------------

/**
 * Raised by {@link assertConfigBlockRemovalSafe} when the `agent.team.<id>` block
 * cannot be removed without losing member overrides that have no `FleetMember` home.
 */
export class ConfigBlockRemovalBlockedError extends Error {
    /** The `unmapped-member-override` warnings that halt the removal. */
    readonly blockers: readonly LegacyWarning[];

    constructor(blockers: readonly LegacyWarning[]) {
        super(
            'refusing to remove the agent.team.<id> config block — unmapped member overrides would be lost:\n' +
                blockers
                    .map((w) => `  - ${w.source}: keys with no FleetMember home (${w.fields.join(', ')})`)
                    .join('\n') +
                '\nConvert each member to a FleetMember key, or record Robin\u2019s written acceptance of the ' +
                'named losses, before removing the block (G64 cutover; 0848 plan step 12).',
        );
        this.name = 'ConfigBlockRemovalBlockedError';
        this.blockers = blockers;
    }
}

/**
 * Cutover gate for the second half of the team retirement (0848): whoever removes
 * `agent.team.<id>` from `TeamConfigSchema` must first run the migration inventory
 * and refuse when any `unmapped-member-override` warning stands — those member keys
 * (`workspace`, `model`, `autonomy`, `systemPrompt`, `command`, `autostart`) have no
 * `FleetMember` home and would be lost with the block. This task ships the guard,
 * not the removal; the removal commit calls this before deleting the schema block.
 */
export function assertConfigBlockRemovalSafe(inventory: MigrationInventory): void {
    const blockers = inventory.warnings.filter((w) => w.kind === 'unmapped-member-override');
    if (blockers.length > 0) throw new ConfigBlockRemovalBlockedError(blockers);
}
