import { z } from 'zod';

// NOTE: this is the CF-safe CORE entry of @gobing-ai/spur-config.
// It has ZERO runtime deps beyond zod — no `yaml`, no `node:fs`, no `node:path`.
// Node-only concerns (bundled-config, template-renderer, the loader, folder resolution,
// embedded-schema resolution) live in the `./loader` subpath. The Cloudflare Workers
// bundle imports ONLY this core (ADR-027).

/** Spur environment variable names consumed by app-layer packages. */
export const SPUR_ENV_VARS = {
    nodeEnv: 'NODE_ENV',
    port: 'PORT',
    host: 'HOST',
    publicApiUrl: 'PUBLIC_API_URL',
    databaseUrl: 'DATABASE_URL',
} as const;

/** Logging levels accepted by Spur app configuration. */
export const SPUR_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/**
 * Canonical default task folder — the SINGLE source of truth for this literal.
 * Every other surface derives from `.spur/config.yaml` or falls back to this constant.
 * Duplicated only as an explicit CF-safe literal (see planning-folder-hardcode rule).
 */
export const DEFAULT_TASKS_DIR = 'docs/tasks';

/**
 * Canonical default feature folder — the SINGLE source of truth for this literal.
 * Every other surface derives from `.spur/config.yaml` or falls back to this constant.
 * Duplicated only as an explicit CF-safe literal (see planning-folder-hardcode rule).
 */
export const DEFAULT_FEATURES_DIR = 'docs/features';

/** Canonical default SQLite database path for local Spur projects. */
export const DEFAULT_DATABASE_URL = '.spur/spur.db';

/** Explicit in-memory SQLite URL. Intended for tests and caller-injected ephemeral runs only. */
export const IN_MEMORY_DATABASE_URL = ':memory:';

// ---- Shared config sub-schemas ----

/** Zod schema for a single task-folder entry: base counter + optional label. */
export const folderConfigSchema = z.object({
    baseCounter: z.number().int().nonnegative().default(0),
    label: z.string().optional(),
});

/** Inferred type for {@link folderConfigSchema}. */
export type FolderConfig = z.infer<typeof folderConfigSchema>;

/**
 * A required-with-default folder path that tolerates an explicit YAML `null`.
 * An empty YAML key (`active:` with no value) parses to `null`; treat that the same
 * as a missing key — "use the default" — rather than a type error. Without this, a
 * blank `active:`/`dir:` line would throw a ZodError and wedge config loading; the
 * contract is that a malformed/blank folder value degrades to the canonical default.
 */
function folderPathWithDefault(defaultPath: string) {
    return z.preprocess((v) => (v == null ? undefined : v), z.string().default(defaultPath));
}

import { ALL_FINDING_CODES, FINDING_CODES, type FindingCode, isFindingCode } from './finding-codes';

export { ALL_FINDING_CODES, FINDING_CODES, type FindingCode, isFindingCode };

/**
 * Zod schema for the `tasks:` config block (design §9).
 *
 * ```yaml
 * tasks:
 *   folders:
 *     docs/tasks: { baseCounter: 0, label: Core }
 *   active: docs/tasks
 *   severity:
 *     L3.plan-format: off
 * ```
 *
 * `folders` is a map of folder path → {@link folderConfigSchema} (absorbs the
 * legacy `docs/.tasks/config.json` folders + baseCounter); `active` is the
 * default folder for `create`; `severity` overrides rule severities by code.
 */
export const tasksConfigSchema = z
    .object({
        folders: z.record(z.string(), folderConfigSchema).default({}),
        active: folderPathWithDefault(DEFAULT_TASKS_DIR),
        severity: z.record(z.string(), z.enum(['error', 'warning', 'off'])).optional(),
    })
    .superRefine((data, ctx) => {
        if (data.severity) {
            for (const code of Object.keys(data.severity)) {
                if (!isFindingCode(code)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['severity', code],
                        message: `Unknown finding code "${code}" in severity overrides map`,
                    });
                }
            }
        }
    });

/** Inferred type for {@link tasksConfigSchema}. */
export type TasksConfig = z.infer<typeof tasksConfigSchema>;

// ---- Features config ----

/** Zod schema for the `features:` config block (design §9). */
export const featuresConfigSchema = z.object({
    dir: folderPathWithDefault(DEFAULT_FEATURES_DIR),
});

/** Inferred type for {@link featuresConfigSchema}. */
export type FeaturesConfig = z.infer<typeof featuresConfigSchema>;

// ---- Agent config (app section) ----

/**
 * Executor capability tiers (0343). Live vocabulary is five values:
 * `cheap | standard | capable-1 | capable-2 | capable-3`.
 * Bare `capable` is accepted during the deprecation window as a synonym for
 * `capable-1` (must stay in lockstep with domain `capabilityTierSchema`).
 * CF-safe core cannot import domain — the enum + preprocess are mirrored here.
 */
export const EXECUTOR_CAPABILITY_TIERS = ['cheap', 'standard', 'capable-1', 'capable-2', 'capable-3'] as const;

/** Executor capability tier (canonical post-0343 values only). */
export type ExecutorCapabilityTier = (typeof EXECUTOR_CAPABILITY_TIERS)[number];

/** Normalize legacy bare `capable` → `capable-1` (strings only; callers pass non-strings through). */
function normalizeExecutorTier(value: string): string {
    return value === 'capable' ? 'capable-1' : value;
}

/**
 * Zod schema for an executor `tier` field.
 * Missing/null → undefined (optional). Legacy bare `capable` → `capable-1`.
 */
export const executorCapabilityTierSchema = z.preprocess((value) => {
    if (value === undefined || value === null) return undefined;
    // Non-strings pass through unchanged so the enum rejects them with a hard error.
    return typeof value === 'string' ? normalizeExecutorTier(value) : value;
}, z.enum(EXECUTOR_CAPABILITY_TIERS).optional());

/**
 * Layer-1 role ids (task 0535) — the closed `--agent` role vocabulary (0536).
 * The role table's SSOT is `agent.roles` in `config/config.global.yaml`
 * (0647/ADR-078); `DEFAULT_AGENT_ROLES` and `plugins/sp/references/roles.md`
 * are parity-gated projections (`plugins/sp/tests/roles.test.ts` R9). Kept as a
 * CF-safe literal so the config-load collision guard (0537 R4) can prove the
 * role / executor / spec-id selector namespaces pairwise disjoint.
 */
export const AGENT_ROLE_NAMES = ['scribe', 'coder', 'reviewer', 'planner'] as const;

/** A Layer-1 role id (`--agent` role selector vocabulary). */
export type AgentRoleName = (typeof AGENT_ROLE_NAMES)[number];

/** A role's tier + folded canonical stages — the Layer-1 row shape (0572). */
export interface AgentRoleSpec {
    tier: ExecutorCapabilityTier;
    stages: readonly string[];
}

/**
 * The Layer-1 role table FALLBACK (ADR-078, task 0647 — was the SSOT under
 * ADR-061): role → tier + folded stages. The SSOT is now the config layer's
 * `agent.roles`, shipped in `config/config.global.yaml`; this constant applies
 * only when no config layer supplies a table at all, which the CF-safe core
 * requires since it must resolve roles with no filesystem access. Its values
 * must stay BYTE-IDENTICAL to the shipped table — a fallback that differed
 * would turn a missing config file into a silent behavior change. The markdown
 * table survives as a second parity-gated projection; edit the shipped config
 * SSOT first, then update both projections. `stages` is load-bearing: it is how a role-only dispatch reaches
 * the stage registry's `model_policy` (`AgentService.resolveCanonicalStage`);
 * a role's `tier` must not sit below the highest `min_tier` among its folded
 * stages (enforced against the projection by `plugins/sp/tests/roles.test.ts` R4).
 */
export const DEFAULT_AGENT_ROLES: ReadonlyMap<AgentRoleName, AgentRoleSpec> = new Map([
    ['scribe', { tier: 'cheap', stages: ['changelog'] }],
    ['coder', { tier: 'standard', stages: ['implement', 'test', 'wrap'] }],
    ['reviewer', { tier: 'capable-1', stages: ['verify', 'review', 'dogfood'] }],
    ['planner', { tier: 'capable-2', stages: ['plan', 'refine', 'brainstorm'] }],
]);

/**
 * Per-field override for a role under `agent.roles` (0572): a present field
 * replaces the `DEFAULT_AGENT_ROLES` value for that role; an omitted field
 * keeps the default. A role absent from the override map uses the default
 * wholesale. The vocabulary is closed — re-tier/re-stage only, never invent
 * roles (0536).
 */
export interface AgentRoleOverride {
    tier?: ExecutorCapabilityTier;
    stages?: readonly string[];
}

/**
 * Schema for a single named executor profile under `agent.executors`.
 *
 * An executor pairs a canonical coding-agent (`agent`) with an optional opaque
 * `model` override. `name` is the selector key referenced from `agent.default`
 * and stage-registry model_policy (`default-by-phase` removed in task 0452).
 * `agent`/`model` are validated as non-empty strings here; canonicalization and
 * usability checks happen at resolution time.
 *
 * `tier` (0343): declare `cheap | standard | capable-1 | capable-2 | capable-3`.
 * Never invent capable-2/3 via inference — only declare those explicitly.
 */
// ---- Executor capability attestation (task 0706) ----

/**
 * Closed capability axes (0706 R1): what the native platform enforces around a
 * dispatched child process. Deliberately independent of the model `tier` —
 * tier is a cost/quality signal and must never imply a permission (0706 Q&A).
 */
export const EXECUTION_CAPABILITY_AXES = [
    'fsRead',
    'fsWrite',
    'networkEgress',
    'processSpawn',
    'externalMutationApproval',
] as const;

/** A closed capability axis id. */
export type ExecutionCapabilityAxis = (typeof EXECUTION_CAPABILITY_AXES)[number];

/**
 * Observed enforcement state of one axis (0706 R2). The ordering that matters
 * is monotonic satisfaction: `enforced` satisfies any requirement, `available`
 * satisfies availability-only requirements, `unavailable`/`unknown` satisfy
 * nothing. Missing data resolves to `unknown` — never a permissive default.
 */
export const EXECUTION_CAPABILITY_STATES = ['enforced', 'available', 'unavailable', 'unknown'] as const;

/** An observed enforcement state. */
export type ExecutionCapabilityState = (typeof EXECUTION_CAPABILITY_STATES)[number];

/** Who asserted a capability fact (0706 R2/R7). `unattested` = no data. */
export const EXECUTION_CAPABILITY_PROVENANCES = ['native-known', 'operator-configured', 'unattested'] as const;

/** A capability provenance id. */
export type ExecutionCapabilityProvenance = (typeof EXECUTION_CAPABILITY_PROVENANCES)[number];

/** One axis attestation: state plus the provenance that asserts it. */
export const ExecutionCapabilityAttestationSchema = z.object({
    state: z.enum(EXECUTION_CAPABILITY_STATES),
    provenance: z.enum(EXECUTION_CAPABILITY_PROVENANCES),
});

/** One axis attestation. */
export type ExecutionCapabilityAttestation = z.infer<typeof ExecutionCapabilityAttestationSchema>;

/**
 * Executor-side attestation block (0706 R1/R3): closed, versioned vocabulary.
 * Partial axis maps are valid — any axis absent here resolves to `unknown`
 * at comparison time (0706 R2).
 */
export const ExecutionCapabilitiesSchema = z.object({
    version: z.literal(1),
    // .partial(): Zod v4 record-with-enum-keys is exhaustive by default; the
    // contract here is explicitly partial — undeclared axes resolve to `unknown`
    // at comparison time (0706 R2).
    axes: z.partialRecord(z.enum(EXECUTION_CAPABILITY_AXES), ExecutionCapabilityAttestationSchema),
});

/** Executor-side attestation block. */
export type ExecutionCapabilities = z.infer<typeof ExecutionCapabilitiesSchema>;

/**
 * Stage-side minimum requirement per axis (0706 R4): the least state that
 * satisfies the stage. `enforced` demands the control be enforced; `available`
 * demands at least availability. `unknown` can never satisfy either.
 */
export const EXECUTION_CAPABILITY_REQUIREMENTS = ['available', 'enforced'] as const;

/** A stage-side capability requirement level. */
export type ExecutionCapabilityRequirement = (typeof EXECUTION_CAPABILITY_REQUIREMENTS)[number];

/** `agent.run` `requiresCapabilities` option shape (0706 R4) — axis → minimum state. Partial: an action declares only the axes it requires. */
export const RequiresCapabilitiesSchema = z.partialRecord(
    z.enum(EXECUTION_CAPABILITY_AXES),
    z.enum(EXECUTION_CAPABILITY_REQUIREMENTS),
);

/** `agent.run` `requiresCapabilities` option. */
export type RequiresCapabilities = z.infer<typeof RequiresCapabilitiesSchema>;

/**
 * Schema for a single named executor profile under `agent.executors`.
 *
 * An executor pairs a canonical coding-agent (`agent`) with an optional opaque
 * `model` override. `name` is the selector key referenced from `agent.default`
 * and stage-registry model_policy (`default-by-phase` removed in task 0452).
 * `agent`/`model` are validated as non-empty strings here; canonicalization and
 * usability checks happen at resolution time.
 *
 * `tier` (0343): declare `cheap | standard | capable-1 | capable-2 | capable-3`.
 * Never invent capable-2/3 via inference — only declare those explicitly.
 * `executionCapabilities` (0706) is orthogonal to `tier`: it attests what the
 * native platform enforces, not model quality.
 */
export const AgentExecutorConfigSchema = z.object({
    name: z.string().min(1),
    agent: z.string().min(1),
    model: z.string().min(1).optional(),
    tier: executorCapabilityTierSchema.optional(),
    executionCapabilities: ExecutionCapabilitiesSchema.optional(),
});

/** A single executor profile entry. */
export type AgentExecutorConfig = z.infer<typeof AgentExecutorConfigSchema>;

/**
 * Schema for one role's override under `agent.roles.<roleId>` (task 0572).
 * Per-field merge over `DEFAULT_AGENT_ROLES` — an omitted field keeps the
 * default. The record key is validated to the closed role vocabulary on the
 * `roles` field of {@link AgentConfigSchema}; unknown role ids fail config
 * load naming the accepted four.
 */
export const AgentRoleConfigSchema = z.object({
    tier: z.enum(EXECUTOR_CAPABILITY_TIERS).optional(),
    // `.min(1)`: an explicit empty array must not un-stage a role — an omitted
    // field keeps the default, so `[]` can only be an authoring error (0572 R10).
    stages: z.array(z.string().min(1)).min(1).optional(),
});

/** Inferred type for one role override — mirrors {@link AgentRoleOverride}. */
export type AgentRoleConfig = z.infer<typeof AgentRoleConfigSchema>;

// ---- Team config (feature M) ----

/**
 * Agent-id format mirrored from `@gobing-ai/ts-ai-runner` `validateAgentId`
 * (`agent-spec.ts`: `^[a-z][a-z0-9_-]{1,63}$`). Mirrored — not imported — to keep this
 * CF-safe core free of a ts-ai-runner dependency (ADR-027). Keep in sync if the
 * runner's id format ever changes.
 */
const AGENT_ID_REGEX = /^[a-z][a-z0-9_-]{1,63}$/;

/**
 * Schema for a single team member reference under `agent.team.<id>.members`.
 *
 * A bare string (`- claude`) is shorthand for `{ executor: "claude" }`, normalized by
 * {@link normalizeMember}. The object form carries per-member overrides.
 */
export const TeamMemberConfigSchema = z.union([
    z.string().min(1),
    z.object({
        // 0543 R4: executor is optional — at least one of role/executor is
        // required (superRefine on AgentConfigSchema names team id + position).
        executor: z.string().min(1).optional(),
        id: z.string().min(1).optional(),
        // Layer-1 role id (0538 R3): typed routing field; `purpose` stays prose.
        // The role is the primary axis (0543): a role-only member resolves an
        // executor through the tier ladder at materialization.
        // R5 (0543): the error names the offending value AND the accepted set —
        // zod's default enum error ("Invalid option: expected one of …") omits
        // the value, which the requirement explicitly demands.
        role: z
            .enum(AGENT_ROLE_NAMES, {
                error: (issue) =>
                    new Error(`Unknown role "${issue.input}" — expected one of: ${AGENT_ROLE_NAMES.join(', ')}`),
            })
            .optional(),
        purpose: z.string().optional(),
        workspace: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
        autonomy: z.string().optional(),
        systemPrompt: z.string().optional(),
        command: z.array(z.string().min(1)).optional(),
        autostart: z.boolean().optional(),
    }),
]);

/** Inferred type for {@link TeamMemberConfigSchema}. */
export type TeamMemberConfig = z.infer<typeof TeamMemberConfigSchema>;

/**
 * Schema for one team under `agent.team.<teamId>`.
 *
 * `name` is the human label; `work_dir` is the default member workspace (tilde-expanded
 * at load); `members` is the roster (≥ 1). Member-id uniqueness and the composed-id
 * `<teamId>-<localId>` charset/length are validated in {@link AgentConfigSchema}'s
 * `superRefine` — the composed id needs the `teamId` map key (finalized by 0251).
 */
export const TeamConfigSchema = z.object({
    name: z.string().min(1),
    work_dir: z.string().min(1),
    autostart: z.boolean().optional(),
    members: z.array(TeamMemberConfigSchema).min(1),
});

/** Inferred type for {@link TeamConfigSchema}. */
export type TeamConfig = z.infer<typeof TeamConfigSchema>;

/** A team member in its normalized object form (shorthand string expanded). */
export interface NormalizedTeamMember {
    /**
     * Executor name — optional since 0543: a role-only member (no executor)
     * resolves one through the tier ladder at materialization (R1).
     */
    executor?: string;
    id?: string;
    /** Layer-1 role id (scribe | coder | reviewer | planner); typed routing field (0538 R3). */
    role?: AgentRoleName;
    purpose?: string;
    workspace?: string;
    model?: string;
    autonomy?: string;
    systemPrompt?: string;
    command?: string[];
    autostart?: boolean;
}

/**
 * Normalize a team member reference to its object form. A bare string `"claude"`
 * becomes `{ executor: "claude" }`; an object is returned as a shallow copy. The
 * local id is `member.id ?? executor` (0251).
 */
export function normalizeMember(member: TeamMemberConfig): NormalizedTeamMember {
    return typeof member === 'string' ? { executor: member } : { ...member };
}

/**
 * Local member id (0251 + 0543 R3). `id` wins, then `executor`; a role-only
 * member (neither) derives from its role plus a 1-based declaration-order index
 * among role-only members sharing that role: `<role>-<n>`. Derived ids are
 * append-stable; arbitrary roster reordering is intentionally not stable.
 * The neither-role-nor-executor case yields `''` — R4 validation rejects that
 * member before it reaches materialization; callers treat `''` as invalid.
 */
export function memberLocalId(
    member: NormalizedTeamMember,
    roster: readonly NormalizedTeamMember[],
    index: number,
): string {
    if (member.id !== undefined) return member.id;
    // 0685 R4: one allocator covers every shape. Duplicate-executor members
    // disambiguate deterministically — first occurrence keeps the bare executor
    // name, later ones append `-<position>` (2, 3, …); a derived id never
    // collides with an explicit id or another executor base. Role-only members
    // derive `<role>-<n>` over their role-only peers exactly as in 0543 R3.
    // Rosters without duplicates are byte-identical to the pre-0685 derivation.
    // ponytail: prefix scan keeps append stability without persisted ids;
    // index allocations only if team rosters ever become large.
    const used = new Set<string>();
    const executorSeen = new Map<string, number>();
    const roleSeen = new Map<string, number>();
    for (let i = 0; i <= index; i++) {
        const current = i === index ? member : roster[i];
        if (current === undefined) continue;
        let localId: string;
        if (current.id !== undefined) {
            localId = current.id;
        } else if (current.executor !== undefined) {
            const base = current.executor;
            let suffix = (executorSeen.get(base) ?? 0) + 1;
            executorSeen.set(base, suffix);
            localId = suffix === 1 ? base : `${base}-${suffix}`;
            while (used.has(localId)) {
                suffix += 1;
                localId = `${base}-${suffix}`;
            }
        } else if (current.role !== undefined) {
            const n = (roleSeen.get(current.role) ?? 0) + 1;
            roleSeen.set(current.role, n);
            localId = `${current.role}-${n}`;
        } else {
            localId = '';
        }
        if (i === index) return localId;
        used.add(localId);
    }
    return '';
}

/** A resolved executor: a canonical agent plus an optional model override. */
export interface ResolvedExecutor {
    agent: string;
    model?: string;
}

/** Options for {@link resolveExecutor}. */
export interface ResolveExecutorOptions {
    /**
     * Predicate recognizing a raw canonical agent type (e.g. `claude`, `codex`).
     * Injected rather than hardcoded: the Spur monorepo deliberately keeps a single
     * canonical-agent list in `@gobing-ai/ts-ai-runner` and consumes it from there, so
     * the CF-safe config core stays free of any duplicate list.
     *
     * When omitted, any non-empty name is accepted as a raw agent and no "unknown
     * reference" error is raised — canonical validation is the caller's job (the
     * materialization layer in 0258 injects `isAgentName` from ts-ai-runner). Inject
     * the predicate to fail unknown references at the config boundary.
     */
    isCanonicalAgent?: (name: string) => boolean;
}

/**
 * Resolve a member's `executor` to `{ agent, model? }` (0250 R5).
 *
 * Executors-first: a name matching `agent.executors[].name` returns that entry's
 * `{ agent, model? }`. Otherwise the name is treated as a raw canonical agent type and
 * returned as `{ agent: name }` (model omitted). When `isCanonicalAgent` is provided
 * and returns `false` for an unmatched name, this throws — the name is neither a
 * configured executor nor a known agent.
 */
export function resolveExecutor(
    name: string,
    agentConfig: AgentConfig | undefined,
    opts?: ResolveExecutorOptions,
): ResolvedExecutor {
    const exec = agentConfig?.executors?.find((entry) => entry.name === name);
    if (exec !== undefined) return { agent: exec.agent, model: exec.model };
    if (opts?.isCanonicalAgent === undefined || opts.isCanonicalAgent(name)) {
        return { agent: name };
    }
    throw new Error(`Unknown executor or agent reference: "${name}"`);
}

/** Schema for the agent output-capture section (per-run live log sink, task 0414). */
export const AgentOutputConfigSchema = z.object({
    /** Hard cap on captured bytes for the per-run output artifact (default 1 MiB). */
    'max-bytes': z.number().int().positive().optional(),
    /** Hard cap on captured lines for the per-run output artifact (default unbounded). */
    'max-lines': z.number().int().positive().optional(),
});

/**
 * Schema for the `agent` section.
 *
 * Vocabulary decision (task 0405, R1): the operator surface says **agent**
 * (the CLI `--agent` flag, this `agent:` config key, the `agent` field inside
 * each executor naming the canonical coding-agent tool — omp, claude, codex);
 * the domain surface says **executor** (the named profile that fills a stage
 * role at a capability tier — `AgentExecutorConfig`, `resolveExecutor`,
 * `getExecutorTier`, `NormalizedTeamMember.executor`). This split is
 * deliberate layering, not drift: the operator picks *an agent* (a concrete
 * tool); the registry reasons about *an executor* (a role filled by whichever
 * agent meets the tier). The two vocabularies meet here — an `agent:`
 * section whose `executors[]` each carry an `agent` field — and the boundary
 * is stated explicitly so it does not decay back into looking like drift. No
 * alias is retained and no migration is required: both spellings are
 * authoritative within their own layer.
 *
 * - `default` — executor selector first, legacy direct agent name second.
 * - `executors` — named `{ name, agent, model? }` profiles; names must be unique.
 * - `roles` — optional per-role tier/stage values (0647/ADR-078); keys are the
 *   closed role vocabulary, values merge per-field over the fallback.
 * - `team` — a `Record<teamId, TeamConfig>` map of declarative agent teams (feature M).
 * - `output` — per-run output-capture bounds for pipeline agent runs (task 0414).
 */
export const AgentConfigSchema = z
    .object({
        default: z.string().optional(),
        executors: z.array(AgentExecutorConfigSchema).optional(),
        // default-by-phase removed (0452 / ADR-033 retirement) — use stage model_policy
        // `roles` keys are validated to the closed vocabulary in the superRefine
        // below (naming the offending value + accepted four — the record schema
        // itself only shapes values, so the key diagnostic stays actionable).
        roles: z.record(z.string(), AgentRoleConfigSchema).optional(),
        team: z.record(z.string(), TeamConfigSchema).optional(),
        output: AgentOutputConfigSchema.optional(),
        sessionAffinity: z.boolean().optional(),
    })
    .superRefine((value, ctx) => {
        // agent.roles key closure (0572): the vocabulary is closed (0536) — an
        // override may re-tier/re-stage a known role but never invent one.
        // Message names the offending key and the accepted four (0543 R5 shape).
        for (const key of Object.keys(value.roles ?? {})) {
            if (!(AGENT_ROLE_NAMES as readonly string[]).includes(key)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['roles', key],
                    message: `Unknown role "${key}" — expected one of: ${AGENT_ROLE_NAMES.join(', ')}`,
                });
            }
        }
        const executors = value.executors;
        const executorNames = new Set<string>();
        if (executors !== undefined) {
            const seen = new Set<string>();
            for (const [index, executor] of executors.entries()) {
                if (seen.has(executor.name)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Duplicate executor name: ${executor.name}`,
                        path: ['executors', index, 'name'],
                    });
                }
                // R4 (task 0413): `inline` and `auto` are reserved selector
                // values — `inline` = current session, `auto` = tier-resolved
                // subprocess. An executor claiming either silently shadows the
                // selector semantics the command surface promises, so reject
                // at config-load with a diagnostic naming both the reserved
                // value and the offending entry.
                if (executor.name === 'inline' || executor.name === 'auto') {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Executor name "${executor.name}" is reserved (the --agent selector value '${executor.name}' has fixed semantics); rename executor at index ${index}.`,
                        path: ['executors', index, 'name'],
                    });
                }
                // Selector namespace disjointness (0537 R4): `--agent` accepts
                // role names, executor names, and spec ids in one flag. An
                // executor claiming a role id (scribe/coder/reviewer/planner)
                // shadows the role branch (0536) — reject at config-load naming
                // both the role and the offending entry.
                if ((AGENT_ROLE_NAMES as readonly string[]).includes(executor.name)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Executor name "${executor.name}" collides with the role selector namespace ("${executor.name}"); rename executor at index ${index}.`,
                        path: ['executors', index, 'name'],
                    });
                }
                seen.add(executor.name);
                executorNames.add(executor.name);
            }
        }

        // Team validation (feature M). The composed agent id `<teamId>-<localId>`
        // (finalized by 0251 — always prefixed) needs the `teamId` map key, so the
        // dup-localId + composed-id charset/length checks live here on the agent
        // schema rather than on TeamConfigSchema (which has no access to the key).
        const team = value.team;
        if (team === undefined) return;
        // Composed ids must be globally unique. The `<teamId>-<localId>` join uses `-`,
        // which BOTH parts may contain, so it is not injective: team `web-01` member
        // `claude` and team `web` member `01-claude` both yield `web-01-claude`. 0251
        // assumed cross-team uniqueness "by construction"; enforce it here so a collision
        // fails at config-load with a clear message, not later at `spur team up` (where
        // loadAgentSpecs throws a duplicate-id error far from the config).
        const seenComposed = new Set<string>();
        for (const [teamId, teamConfig] of Object.entries(team)) {
            const seenLocal = new Set<string>();
            const members = teamConfig.members.map(normalizeMember);
            members.forEach((ref, index) => {
                // R4 (0543): a member must declare at least one of role or
                // executor — the message names the team id and the member
                // position, and states the at-least-one rule. The bare-string
                // shorthand always carries `executor` (normalizeMember), so
                // this only fires on the object arm.
                if (ref.executor === undefined && ref.role === undefined) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Team member at index ${index} in team "${teamId}" declares neither role nor executor — at least one of role or executor is required.`,
                        path: ['team', teamId, 'members', index],
                    });
                    return;
                }
                const localId = memberLocalId(ref, members, index);
                if (seenLocal.has(localId)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Duplicate team member id: ${localId} in team "${teamId}"`,
                        path: ['team', teamId, 'members', index],
                    });
                }
                seenLocal.add(localId);
                const composedId = `${teamId}-${localId}`;
                if (!AGENT_ID_REGEX.test(composedId)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Invalid composed agent id "${composedId}": team key "${teamId}" + member "${localId}" must match ^[a-z][a-z0-9_-]{1,63}$ (2-64 chars, lowercase).`,
                        path: ['team', teamId, 'members', index],
                    });
                }
                if (seenComposed.has(composedId)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Composed agent id "${composedId}" collides across teams — every <teamId>-<localId> must be globally unique (a hyphenated team key can overlap another team's member id).`,
                        path: ['team', teamId, 'members', index],
                    });
                }
                seenComposed.add(composedId);

                // Selector namespace disjointness (0537 R4), continued: spec ids
                // must be disjoint from role names and executor names so one
                // `--agent` value cannot mean two things. The composed id is what
                // drain/occupant addressing matches; an explicit member id is
                // checked too so an operator cannot shadow a role or an executor
                // with a member name (the AC scenario "member id equal to a name
                // in agent.executors").
                if (ref.id !== undefined && (AGENT_ROLE_NAMES as readonly string[]).includes(ref.id)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Team member id "${ref.id}" collides with the role selector namespace ("${ref.id}") in team "${teamId}"; rename the member id.`,
                        path: ['team', teamId, 'members', index],
                    });
                }
                if (ref.id !== undefined && executorNames.has(ref.id)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Team member id "${ref.id}" collides with executor name "${ref.id}" in team "${teamId}"; the --agent selector namespace must be pairwise disjoint.`,
                        path: ['team', teamId, 'members', index],
                    });
                }
                if (executorNames.has(composedId)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Composed agent id "${composedId}" collides with executor name "${composedId}"; the --agent selector namespace must be pairwise disjoint.`,
                        path: ['team', teamId, 'members', index],
                    });
                }
                if ((AGENT_ROLE_NAMES as readonly string[]).includes(composedId)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Composed agent id "${composedId}" collides with the role selector namespace ("${composedId}"); the --agent selector namespace must be pairwise disjoint.`,
                        path: ['team', teamId, 'members', index],
                    });
                }
            });
        }
    });

/** Schema for the `rules` section. */
export const RulesConfigSchema = z.object({
    paths: z.array(z.string()).optional(),
});

/** Schema for the `workflows` section. */
export const WorkflowsConfigSchema = z.object({
    paths: z.array(z.string()).optional(),
});

/**
 * Schema for the `workflow` section (feature D2 / task 0429).
 *
 * - `logRetentionDays` — how old a retained `.spur/run/<RUNID>.log` must be
 *   (mtime) before `spur workflow clean` reclaims it. Default 30. Config
 *   units are days here because retention is a policy; the stale-run
 *   `--older-than` flag stays minutes and is never reused for log age.
 */
export const WorkflowConfigSchema = z.object({
    logRetentionDays: z.number().int().positive().default(30),
});

/** Schema for the `redaction` section. */
export const RedactionConfigSchema = z.object({
    enabled: z.boolean().optional(),
});

/**
 * Schema for the `history.refresh` section (task 0549 — completion-triggered refresh).
 *
 * - `on_completion` — opt-in trigger: enqueue a coalesced history refresh when work
 *   completes (task → done, workflow run reaching terminal status). Default `false`:
 *   the constitution rules out hidden automation, and task 0550's watermark is the
 *   gate for enabling it by default.
 * - `debounce_ms` — coalescing window. Default 600000 (10 min) is not a guess: it
 *   follows task 0548's measured figures (`docs/tasks4/0548-import-cost-measurement.md`),
 *   where the steady-state all-fanout import is ~20.6 s and scan-bound — a 10-minute
 *   window bounds import duty to ≈3.4 % of wall clock with ≤10 min staleness.
 */
export const HistoryRefreshConfigSchema = z.object({
    on_completion: z.boolean().default(false),
    debounce_ms: z.number().int().min(1000).default(600_000),
    /** Interval-based trigger: enqueue one history.refresh every N minutes while the
     * server scheduler runs. Unset = off (hidden automation stays opt-in, T-rules). */
    schedule_minutes: z.number().int().min(1).optional(),
});

/** Schema for the `history` section. */
export const HistoryConfigSchema = z.object({
    refresh: HistoryRefreshConfigSchema.optional(),
});

/** Effective history-refresh trigger configuration after schema defaults apply. */
export interface HistoryRefreshTriggerConfig {
    onCompletion: boolean;
    debounceMs: number;
    /** Server-scheduler interval in minutes; `null` = scheduled trigger off. */
    scheduleMinutes: number | null;
}

/**
 * Resolve the effective `history.refresh` trigger config from a (possibly absent or
 * partial) config. The zod defaults above are the single source; a missing `history`
 * section parses to `on_completion: false`, `debounce_ms: 600000`.
 */
export function resolveHistoryRefreshTrigger(
    config: Pick<SpurConfig, 'history'> | null | undefined,
): HistoryRefreshTriggerConfig {
    const parsed = HistoryRefreshConfigSchema.parse(config?.history?.refresh ?? {});
    return {
        onCompletion: parsed.on_completion,
        debounceMs: parsed.debounce_ms,
        ...(parsed.schedule_minutes !== undefined
            ? { scheduleMinutes: parsed.schedule_minutes }
            : { scheduleMinutes: null }),
    };
}

// ---- Unified Spur project config (top-level) ----

/**
 * Zod schema shared by the global and project config layers (design §9). Merges BOTH
 * the planning section (`tasks`/`features`) and the
 * app section (`agent`/`rules`/`workflows`/`workflow`/`redaction`) into one validated shape.
 *
 * All fields are optional — a missing key means "use the default" rather than "error",
 * preserving partial-config tolerance and forward-compatible additions. YAML keys are
 * preserved verbatim (R3 — no drift from the existing `.spur/config.yaml`).
 *
 * `version` is a **string** label (recommended `"1.2"`; older strings remain accepted). There is
 * no hard migrator keyed on this field yet — unquoted YAML numbers fail validation.
 */
export const spurConfigSchema = z.object({
    version: z.string().optional(),
    name: z.string().optional(),
    agent: AgentConfigSchema.optional(),
    rules: RulesConfigSchema.optional(),
    workflows: WorkflowsConfigSchema.optional(),
    workflow: WorkflowConfigSchema.optional(),
    redaction: RedactionConfigSchema.optional(),
    history: HistoryConfigSchema.optional(),
    tasks: tasksConfigSchema.optional(),
    features: featuresConfigSchema.optional(),
});

/** Inferred type for the unified {@link spurConfigSchema}. */
export type SpurConfig = z.infer<typeof spurConfigSchema>;

/**
 * Top-level keys that belong at the project layer, never the global layer, per the
 * 0641 project/global split (task 0649 R4). These resolve against a project's own
 * folder structure and have no meaning as a machine-wide default.
 */
const PROJECT_SHAPED_GLOBAL_KEYS = ['name', 'bootstrap', 'rules', 'redaction', 'tasks', 'features'] as const;

/**
 * Classify a parsed global config's top-level keys against the 0641 project/global
 * split and return every project-shaped key present at the global layer.
 *
 * Pure over parsed YAML so it is unit-testable without a filesystem (task 0649 R4).
 * Detection reports, it never auto-fixes — R2 forbids writing the global config
 * without the operator's opt-in.
 *
 * Global-shaped keys are `agent.default`, `agent.executors`, `agent.roles` and
 * `workflows`. `agent` itself is global-shaped unless it carries the project-shaped
 * `agent.team` sub-key, which is reported as `agent.team`.
 */
export function misplacedGlobalKeys(parsed: Record<string, unknown>): string[] {
    const misplaced: string[] = [];
    for (const key of PROJECT_SHAPED_GLOBAL_KEYS) {
        if (key in parsed) misplaced.push(key);
    }
    const agent = parsed.agent;
    if (typeof agent === 'object' && agent !== null && 'team' in agent) {
        misplaced.push('agent.team');
    }
    return misplaced;
}

/** Inferred type for the `agent` config section. */
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/** Inferred type for the `agent.output` config section (per-run output capture bounds). */
export type AgentOutputConfig = z.infer<typeof AgentOutputConfigSchema>;

/** Inferred type for the `workflow` config section (run-log retention policy, task 0429). */
export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;

/** Inferred type for the `history` config section (task 0549). */
export type HistoryConfig = z.infer<typeof HistoryConfigSchema>;

/** Inferred type for the `history.refresh` config section (task 0549). */
export type HistoryRefreshConfig = z.infer<typeof HistoryRefreshConfigSchema>;

/**
 * Back-compat type for the app-layer (non-planning) section of the config.
 * Kept so existing consumers that operate on `SpurAppConfig` continue to type-check.
 */
export type SpurAppConfig = Pick<
    SpurConfig,
    'version' | 'name' | 'agent' | 'rules' | 'workflows' | 'workflow' | 'redaction'
>;

// ---- App-layer (runtime) config ----

/** Zod schema for app-layer runtime configuration that remains local to Spur. */
export const configSchema = z.object({
    database: z
        .object({
            url: z.string().default(DEFAULT_DATABASE_URL),
        })
        .default({ url: DEFAULT_DATABASE_URL }),
    server: z
        .object({
            port: z.coerce.number().int().positive().default(3000),
            host: z.string().default('localhost'),
            openBrowser: z.boolean().default(true),
            webDistPath: z.string().nullable().default(null),
        })
        .default({ port: 3000, host: 'localhost', openBrowser: true, webDistPath: null }),
    telemetry: z
        .object({
            enabled: z.boolean().default(false),
            endpoint: z.string().optional(),
        })
        .default({ enabled: false }),
    logging: z
        .object({
            level: z.enum(SPUR_LOG_LEVELS).default('info'),
        })
        .default({ level: 'info' }),
});

/** App-layer configuration inferred from the validated config schema. */
export type Config = z.infer<typeof configSchema>;

/** Parse boolean-like environment values without treating "false" as truthy. */
export function parseEnvBoolean(value: string | undefined): boolean | undefined {
    if (value === undefined || value === '') return undefined;

    const normalized = value.toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

    throw new Error(`Invalid boolean environment value: expected true/false, received ${value}`);
}

/** Read process-like bindings without coupling config parsing to Node globals. */
export function buildConfigFromEnv(env: Record<string, string | undefined> = process.env): Config {
    return configSchema.parse({
        database: {
            url: env[SPUR_ENV_VARS.databaseUrl],
        },
        server: {
            port: env[SPUR_ENV_VARS.port],
            host: env[SPUR_ENV_VARS.host],
        },
        telemetry: {
            enabled: parseEnvBoolean(env.SPUR_TELEMETRY_ENABLED),
            endpoint: env.SPUR_TELEMETRY_ENDPOINT,
        },
        logging: {
            level: env.SPUR_LOG_LEVEL,
        },
    });
}

export * from './projects';
