/**
 * Stage-registry schema and types (feature O, spec ticket 0282).
 *
 * A stage record is a typed, versioned, declarative contract describing one
 * lifecycle stage. The registry is the canonical unit of reuse: commands,
 * workflows, `dev-next`, dogfood, and campaign execution all reference the
 * same stage identifiers. Command markdown and workflow YAML remain entry /
 * adaptation surfaces - never competing lifecycle authorities.
 *
 * Authority boundaries (R2, 0282):
 * - Registry describes a stage (this module).
 * - Workflow engine owns sequencing and run state (`spur workflow`).
 * - Skill owns reasoning (named via `reasoning_skill`).
 * - CLI / scripts own deterministic mutation and validation
 *   (`spur task`, `spur feature`, `spur rule`, gates).
 * - Platform adapters own syntax only (slash-command / dollar-skill wrappers);
 *   they carry no lifecycle prose beyond the delegation line.
 *
 * The exported schemas are the parse-validate-serialize SSOT for the
 * stage-registry layer. Records are declarative data: they name gates, skills,
 * and mutation classes but never inline executable code.
 *
 * Compatibility (R4, 0282 extension rule): a consumer at major version N
 * accepts records at N.x. Adding a required field, removing a field, or
 * renaming a field is a new major. Adding an optional field or a new alias is
 * a minor bump within the same major. Aliases are compatibility entries only
 * - never parallel authorities.
 */
import { z } from 'zod';

// ─── Schema version (R4) ──────────────────────────────────────────────────

/**
 * Current schema version of the stage-registry record shape.
 *
 * Bump per the 0282 extension rule:
 * - major: required-field add/remove/rename, or any break to the discriminated
 *   union invariants in {@link executionKindSchema}.
 * - minor: optional-field or alias add; new optional enum value.
 */
export const STAGE_REGISTRY_SCHEMA_VERSION = {
    major: 1,
    minor: 0,
} as const;

/** Schema version shape used by records and consumers. */
export const stageSchemaVersionSchema = z
    .object({
        major: z.number().int().nonnegative(),
        minor: z.number().int().nonnegative(),
    })
    .strict();

/** Inferred TypeScript shape of a stage-registry schema version. */
export type StageSchemaVersion = z.infer<typeof stageSchemaVersionSchema>;

/**
 * Compatibility predicate (R4). A consumer at major N accepts records at N.x.
 * Minor mismatches are accepted; major mismatches are rejected.
 */
export function isCompatibleStageVersion(consumer: StageSchemaVersion, record: StageSchemaVersion): boolean {
    return consumer.major === record.major;
}

/**
 * Return the next major version. Use when adding/removing/rename a required
 * field per the 0282 extension rule.
 */
export function bumpStageSchemaMajor(version: StageSchemaVersion): StageSchemaVersion {
    return { major: version.major + 1, minor: 0 };
}

/**
 * Return the next minor version. Use when adding an optional field or alias
 * within the same major.
 */
export function bumpStageSchemaMinor(version: StageSchemaVersion): StageSchemaVersion {
    return { major: version.major, minor: version.minor + 1 };
}

// ─── Authority boundary primitives (R2) ───────────────────────────────────

/**
 * Authority lanes encoded by the registry. A stage record names a lane per
 * concern but never inlines executable code from another lane; the named
 * lane owns the executable semantics.
 *
 * - `registry`   - declarative stage description (this module).
 * - `workflow`   - sequencing and run state (`spur workflow`).
 * - `skill`      - reasoning (`sp:*` skills named via `reasoning_skill`).
 * - `cli`        - deterministic corpus mutation / validation (`spur *`).
 * - `adapter`    - platform syntax wrappers (slash / dollar-skill).
 */
export const AUTHORITY_LANES = ['registry', 'workflow', 'skill', 'cli', 'adapter'] as const;

/** Type alias for the canonical authority-lane vocabulary. */
export type AuthorityLane = (typeof AUTHORITY_LANES)[number];

// ─── Mutation class (R1) ──────────────────────────────────────────────────

/**
 * Declarative mutation class. Names WHAT a stage may mutate, never HOW.
 * HOW is owned by the CLI / script lane (R2): corpus writes go through
 * `spur task` / `spur feature`, code edits go through the host agent.
 *
 * - `none`         - read-only stage (diagnostic / inspection).
 * - `corpus`       - task / feature / rule / workflow frontmatter or sections.
 * - `code`         - worktree source edits.
 * - `tests`        - test files + coverage artifacts.
 * - `verdict`      - write-back to `## Testing` / `## Review` + verdict artifact.
 * - `learnings`    - learnings / doc-sync corpus writes.
 * - `driver`       - bounded driver fixes (dogfood harness).
 * - `irreversible` - side effects without rollback; requires operator intent.
 */
export const MUTATION_CLASSES = [
    'none',
    'corpus',
    'code',
    'tests',
    'verdict',
    'learnings',
    'driver',
    'irreversible',
] as const;

/** Type alias for the canonical mutation-class vocabulary. */
export type MutationClass = (typeof MUTATION_CLASSES)[number];

// ─── Execution kinds (R3) ─────────────────────────────────────────────────

/**
 * Discriminator for the execution-kind union (R3, 0282).
 *
 * `inline` and `subprocess` are the two agent-driven kinds. `subprocess`
 * starts a fresh agent process via `spur agent run` and CANNOT claim
 * current-agent execution; the discriminated union enforces this by pinning
 * `current_agent_allowed: false` on the subprocess variant.
 */
export const EXECUTION_KINDS = ['inline', 'subprocess', 'deterministic', 'hitl', 'irreversible'] as const;

/** Type alias for the canonical execution-kind discriminator. */
export type ExecutionKind = (typeof EXECUTION_KINDS)[number];

/**
 * Inline execution: reasoning runs in the invoking agent session. No
 * subprocess boundary. Current-agent execution is expressible.
 */
export const inlineExecutionSchema = z
    .object({
        kind: z.literal('inline'),
        /** Inline stages may reuse captured stable context layers within one dispatch. */
        current_agent_allowed: z.literal(true),
        /** Optional reuse hint for context-envelope consumers (0284). */
        may_reuse_captured_layers: z.boolean().optional(),
    })
    .strict();

/**
 * Subprocess execution: a fresh agent subprocess via `spur agent run`.
 * Current-agent execution is NOT expressible; only fingerprinted on-disk
 * artifacts cross the boundary (0284). The record must not claim otherwise.
 */
export const subprocessExecutionSchema = z
    .object({
        kind: z.literal('subprocess'),
        /** Pinned false - the discriminated union rejects any other value. */
        current_agent_allowed: z.literal(false),
        /** Canonical subprocess entry surface. */
        via: z.literal('spur-agent-run'),
    })
    .strict();

/**
 * Deterministic execution: CLI / script only. No agent invocation.
 * Current-agent execution is not expressible.
 */
export const deterministicExecutionSchema = z
    .object({
        kind: z.literal('deterministic'),
        current_agent_allowed: z.literal(false),
        /** Deterministic executor lane. */
        executor: z.enum(['cli', 'script']),
    })
    .strict();

/**
 * Human-in-the-loop execution: an operator gate is required before and/or
 * after the stage. Current-agent execution is expressible (the agent waits
 * on the operator).
 */
export const hitlExecutionSchema = z
    .object({
        kind: z.literal('hitl'),
        current_agent_allowed: z.literal(true),
        /** When the operator gate fires relative to stage body. */
        gate_timing: z.enum(['pre', 'post', 'both']),
    })
    .strict();

/**
 * Irreversible execution: side effects without rollback. Requires explicit
 * operator intent. `current_agent_allowed` is declared per stage because an
 * irreversible stage may be either agent-driven (inline) or CLI-driven.
 */
export const irreversibleExecutionSchema = z
    .object({
        kind: z.literal('irreversible'),
        /** Operator intent MUST be captured before the side effect fires. */
        requires_operator_intent: z.literal(true),
        /** Whether the invoking agent session may execute the side effect. */
        current_agent_allowed: z.boolean(),
        /** Human-readable rollback disclaimer (no automated rollback). */
        rollback_disclaimer: z.string().min(1),
    })
    .strict();

/**
 * Discriminated union of execution kinds (R3). The union enforces the 0282
 * invariant that subprocess stages cannot claim current-agent execution by
 * pinning `current_agent_allowed: false` on the subprocess variant.
 */
export const executionKindSchema = z.discriminatedUnion('kind', [
    inlineExecutionSchema,
    subprocessExecutionSchema,
    deterministicExecutionSchema,
    hitlExecutionSchema,
    irreversibleExecutionSchema,
]);

/** Inferred TypeScript shape of an execution-kind variant. */
export type ExecutionKindVariant = z.infer<typeof executionKindSchema>;

// ─── Artifact descriptors (R1) ────────────────────────────────────────────

/**
 * Direction of an artifact relative to a stage. `input` artifacts are
 * required to enter the stage; `output` artifacts are produced or mutated.
 */
export const ARTIFACT_DIRECTIONS = ['input', 'output'] as const;

/** Type alias for artifact direction. */
export type ArtifactDirection = (typeof ARTIFACT_DIRECTIONS)[number];

/**
 * A typed artifact descriptor. `kind` names the artifact class
 * (e.g. `feature-frontmatter`, `task-section`, `verdict-artifact`,
 * `worktree-diff`, `coverage-report`); `required` distinguishes mandatory
 * from optional artifacts.
 */
export const stageArtifactSchema = z
    .object({
        /** Artifact class identifier (free-form, stable within a major). */
        kind: z.string().min(1),
        /** Direction relative to the stage. */
        direction: z.enum(ARTIFACT_DIRECTIONS),
        /** Optional human-readable description. */
        description: z.string().optional(),
        /** False marks an optional artifact; defaults to true. */
        required: z.boolean().optional().default(true),
    })
    .strict();

/** Inferred TypeScript shape of a stage artifact descriptor. */
export type StageArtifact = z.infer<typeof stageArtifactSchema>;

// ─── Gates (R1) ───────────────────────────────────────────────────────────

/**
 * Deterministic gate descriptor. `name` identifies the gate (e.g.
 * `feature-check`, `batch-create`, `coverage-floor`, `verdict-artifact`,
 * `strict-core`, `task-check`). Gates are declared here and executed by the
 * CLI lane (R2); the registry never inlines gate logic.
 */
export const stageGateSchema = z
    .object({
        /** Gate identifier (stable within a major). */
        name: z.string().min(1),
        /** When the gate fires relative to the stage body. */
        timing: z.enum(['pre', 'post', 'transition']),
        /**
         * Minimum verdict the gate requires to pass. Gates cannot be weakened
         * by a cheaper-model profile or a convenience command (0282 locked).
         */
        min_verdict: z.enum(['pass', 'partial', 'fail']).optional(),
        /** Human-readable description of what the gate checks. */
        description: z.string().optional(),
    })
    .strict();

/** Inferred TypeScript shape of a stage gate. */
export type StageGate = z.infer<typeof stageGateSchema>;

// ─── Retry / timeout (R1) ─────────────────────────────────────────────────

/**
 * Retry and terminal-stop policy. Bounded fix loops only - never unbounded
 * (0282). `max_attempts` is the hard ceiling; `terminal_stop` names the
 * behavior when attempts are exhausted.
 */
export const stageRetryPolicySchema = z
    .object({
        /** Hard ceiling on attempts (>=1). */
        max_attempts: z.number().int().min(1),
        /** Behavior when attempts are exhausted. */
        terminal_stop: z.enum(['block', 'escalate', 'fail']),
        /** Optional per-attempt timeout in seconds. */
        timeout_seconds: z.number().int().positive().optional(),
    })
    .strict();

/** Inferred TypeScript shape of a stage retry policy. */
export type StageRetryPolicy = z.infer<typeof stageRetryPolicySchema>;

// ─── Model eligibility / fallback (R1) ────────────────────────────────────

// ─── Capability tiers & Model Policy Helpers (0319, 0343) ─────────────────

/**
 * Model capability tier vocabulary (0343).
 * `capable` split into capable-1/2/3 (1 = low output quality, 3 = high).
 * `cheap` and `standard` stay single, unsubdivided.
 */
export const CAPABILITY_TIERS = ['cheap', 'standard', 'capable-1', 'capable-2', 'capable-3'] as const;

/** Model capability tier vocabulary. */
export type CapabilityTier = (typeof CAPABILITY_TIERS)[number];

/**
 * Legacy bare `capable` (pre-0343). Accepted during the deprecation window as a
 * synonym for `capable-1` (floor of the capable band). Not a live enum member.
 */
export const LEGACY_CAPABLE_ALIAS = 'capable' as const;

/**
 * Normalize a raw tier value: bare `capable` → `capable-1`. Other values pass through
 * for zod to validate against {@link CAPABILITY_TIERS}.
 */
export function normalizeCapabilityTier(value: unknown): unknown {
    return value === LEGACY_CAPABLE_ALIAS ? 'capable-1' : value;
}

/** Zod schema for a capability tier, with legacy `capable` → `capable-1` preprocess. */
export const capabilityTierSchema = z.preprocess(normalizeCapabilityTier, z.enum(CAPABILITY_TIERS));

/**
 * Adaptive model policy: static minima plus an objective-signal fallback
 * chain. Price is not a primary metric; qualification uses outcome
 * equivalence (0285, 0282 locked).
 */
export const stageModelPolicySchema = z
    .object({
        /** Minimum model capability tier required to start the stage. */
        min_tier: capabilityTierSchema,
        /** Ordered fallback chain triggered by objective escalation. */
        fallback: z.array(
            z
                .object({
                    tier: capabilityTierSchema,
                    /** Objective signal that triggers this fallback step. */
                    trigger: z.enum(['gate-fail', 'timeout', 'insufficient-evidence', 'retry-exhausted']),
                })
                .strict(),
        ),
        /** Operator override key; when present, overrides win. */
        override_key: z.string().optional(),
    })
    .strict();

/** Inferred TypeScript shape of a stage model policy. */
export type StageModelPolicy = z.infer<typeof stageModelPolicySchema>;

/**
 * Numerical rank mapping for capability tiers (0343).
 * cheap=1 < standard=2 < capable-1=3 < capable-2=4 < capable-3=5.
 */
export const TIER_RANK: Record<CapabilityTier, number> = {
    cheap: 1,
    standard: 2,
    'capable-1': 3,
    'capable-2': 4,
    'capable-3': 5,
};

/** Returns true if candidateTier meets or exceeds minTier capability. */
export function isTierEligible(candidateTier: CapabilityTier, minTier: CapabilityTier): boolean {
    return TIER_RANK[candidateTier] >= TIER_RANK[minTier];
}

/** Given a StageModelPolicy, returns the minimum starting capability tier. */
export function pickStartingTier(policy: StageModelPolicy): CapabilityTier {
    return policy.min_tier;
}

/** Objective failure or risk signal triggering model policy fallback escalation. */
export type ObjectiveEscalationSignal = 'gate-fail' | 'timeout' | 'insufficient-evidence' | 'retry-exhausted';

/**
 * Given a StageModelPolicy, an objective signal, and optional current tier,
 * returns the next fallback entry if an objective escalation rule matches.
 */
export function getNextFallback(
    policy: StageModelPolicy,
    signal: ObjectiveEscalationSignal,
    currentTier?: CapabilityTier,
): { tier: CapabilityTier; trigger: ObjectiveEscalationSignal } | undefined {
    const currentRank = currentTier ? TIER_RANK[currentTier] : 0;
    const match = policy.fallback.find((f) => f.trigger === signal && TIER_RANK[f.tier] > currentRank);
    if (match) {
        return { tier: match.tier, trigger: match.trigger as ObjectiveEscalationSignal };
    }
    const anyMatch = policy.fallback.find((f) => f.trigger === signal);
    if (anyMatch) {
        return { tier: anyMatch.tier, trigger: anyMatch.trigger as ObjectiveEscalationSignal };
    }
    return undefined;
}

// ─── Context layers (R1) ──────────────────────────────────────────────────

/**
 * Canonical context-envelope layer names (0284). Ordered stable-first then
 * volatile. The registry references these by name; layer assembly is owned
 * by the envelope consumer, not the registry.
 */
export const CONTEXT_LAYER_NAMES = [
    'harness-policy',
    'project-authority',
    'stage-contract',
    'task-state',
    'indexed-evidence',
    'run-state',
    'tool-observations',
] as const;

/** Type alias for the canonical context-layer vocabulary. */
export type ContextLayerName = (typeof CONTEXT_LAYER_NAMES)[number];

/**
 * A required context layer reference. `layer` names the envelope layer;
 * `required` is always true for stages that declare the layer (the registry
 * cannot mark a mandatory layer optional - 0284 progressive-disclosure rule).
 */
export const stageContextLayerSchema = z
    .object({
        layer: z.enum(CONTEXT_LAYER_NAMES),
        /** Always true for declared layers; optional layers are omitted entirely. */
        required: z.literal(true),
    })
    .strict();

/** Inferred TypeScript shape of a stage context-layer reference. */
export type StageContextLayer = z.infer<typeof stageContextLayerSchema>;

// ─── Observability (R1) ───────────────────────────────────────────────────

/**
 * Emitted lifecycle event descriptor. `name` is the event identifier used
 * for telemetry attribution (0281); consumers emit the same stage/run
 * identifiers for observability.
 */
export const stageEventSchema = z
    .object({
        /** Event identifier (e.g. `stage-started`, `gate-passed`, `verdict-emitted`). */
        name: z.string().min(1),
        /** Human-readable description. */
        description: z.string().optional(),
    })
    .strict();

/** Inferred TypeScript shape of a stage event descriptor. */
export type StageEvent = z.infer<typeof stageEventSchema>;

// ─── Stage record (R1) ────────────────────────────────────────────────────

/** Stage identifier regex: lowercase kebab-case, stable within a major. */
export const STAGE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * A canonical stage record (R1). Declarative contract describing one
 * lifecycle stage. All executable semantics are owned by the named lane
 * (R2): `reasoning_skill` (skill lane), `gates` (cli lane), `mutation_class`
 * (cli lane), `execution` (workflow lane for sequencing).
 */
export const stageRecordSchema = z
    .object({
        /** Schema version of this record shape (R4). */
        schema_version: stageSchemaVersionSchema,
        /** Stable stage identifier (lowercase kebab-case). */
        id: z.string().regex(STAGE_ID_PATTERN, {
            message: 'stage id must be lowercase kebab-case',
        }),
        /**
         * Compatibility aliases (R4). Input-only entries that map legacy
         * identifiers to this stage; never parallel authorities. Aliases do
         * not override `id`.
         */
        aliases: z.array(z.string().min(1)).optional().default([]),
        /** Human-readable purpose. */
        description: z.string().min(1),
        /** Typed input/output artifact descriptors. */
        artifacts: z.array(stageArtifactSchema).min(1),
        /** Owner skill reference (e.g. `sp:spur-dev`). Owns reasoning (R2). */
        reasoning_skill: z.string().min(1),
        /** References the stage must load (e.g. `report-template.md`). */
        required_references: z.array(z.string().min(1)).optional().default([]),
        /** Deterministic gates; executed by the CLI lane (R2). */
        gates: z.array(stageGateSchema).optional().default([]),
        /** Declarative mutation class; HOW is owned by the CLI lane (R2). */
        mutation_class: z.enum(MUTATION_CLASSES),
        /** Retry / timeout / terminal-stop policy. Bounded only. */
        retry: stageRetryPolicySchema,
        /** Adaptive model policy (static minima + fallback chain). */
        model_policy: stageModelPolicySchema,
        /** Required context-envelope layers (0284). */
        context_layers: z.array(stageContextLayerSchema).optional().default([]),
        /** Emitted lifecycle events for observability (0281). */
        observability: z.array(stageEventSchema).optional().default([]),
        /** Execution kind (R3). Discriminated union. */
        execution: executionKindSchema,
    })
    .strict();

/** Inferred TypeScript shape of a canonical stage record. */
export type StageRecord = z.infer<typeof stageRecordSchema>;

// ─── Registry validation (R1, 0282 AC) ────────────────────────────────────

/**
 * Registry error: a stage record failed load-time validation. Execution is
 * rejected before any corpus mutation or agent invocation (0282 AC).
 */
export class StageRegistryError extends Error {
    constructor(
        message: string,
        readonly code:
            | 'unknown-dependency'
            | 'missing-gate'
            | 'invalid-context-layer'
            | 'cyclic-transition'
            | 'incompatible-model-policy'
            | 'duplicate-id'
            | 'subprocess-current-agent'
            | 'schema-version-mismatch',
        readonly stageId?: string,
    ) {
        super(message);
        this.name = 'StageRegistryError';
    }
}

/**
 * Validate a single stage record beyond the zod parse. Catches the semantic
 * invariants the schema cannot express statically:
 * - `subprocess` execution must not claim `current_agent_allowed: true`
 *   (defense-in-depth; the discriminated union already pins this false).
 * - `irreversible` mutation class must pair with `irreversible` execution or
 *   an explicit operator-intent gate.
 * - `hitl` execution must declare at least one gate.
 *
 * Returns the record on success; throws {@link StageRegistryError} on failure.
 */
export function validateStageRecord(record: StageRecord): StageRecord {
    // R3 invariant: subprocess stages cannot claim current-agent execution.
    if (record.execution.kind === 'subprocess' && record.execution.current_agent_allowed) {
        throw new StageRegistryError(
            `stage ${record.id}: subprocess execution cannot claim current-agent execution`,
            'subprocess-current-agent',
            record.id,
        );
    }

    // Irreversible mutation class requires irreversible execution OR an
    // operator-intent gate (hitl with pre/both timing).
    if (record.mutation_class === 'irreversible') {
        const hasIrreversibleExec = record.execution.kind === 'irreversible';
        const hasHitlGate =
            record.execution.kind === 'hitl' &&
            (record.execution.gate_timing === 'pre' || record.execution.gate_timing === 'both');
        if (!hasIrreversibleExec && !hasHitlGate) {
            throw new StageRegistryError(
                `stage ${record.id}: irreversible mutation_class requires irreversible execution or a pre/both hitl gate`,
                'incompatible-model-policy',
                record.id,
            );
        }
    }

    // hitl execution must declare at least one gate to be meaningful.
    if (record.execution.kind === 'hitl' && record.gates.length === 0) {
        throw new StageRegistryError(
            `stage ${record.id}: hitl execution requires at least one gate`,
            'missing-gate',
            record.id,
        );
    }

    return record;
}

/**
 * Validate a set of stage records for cross-record invariants:
 * - No duplicate ids.
 * - No duplicate aliases that shadow another record's id.
 *
 * Returns the input array on success; throws {@link StageRegistryError}.
 */
export function validateStageRegistry(records: ReadonlyArray<StageRecord>): StageRecord[] {
    const seenIds = new Map<string, number>();
    const seenAliases = new Map<string, string>(); // alias -> owning stage id

    for (const record of records) {
        // Per-record semantic validation first.
        validateStageRecord(record);

        // Duplicate id check.
        const prior = seenIds.get(record.id);
        if (prior !== undefined) {
            throw new StageRegistryError(
                `duplicate stage id ${record.id} (first at index ${prior})`,
                'duplicate-id',
                record.id,
            );
        }
        seenIds.set(record.id, records.indexOf(record));

        // Alias-shadow check: an alias must not equal another record's id.
        for (const alias of record.aliases) {
            const owner = seenAliases.get(alias);
            if (owner !== undefined && owner !== record.id) {
                throw new StageRegistryError(
                    `alias ${alias} of stage ${record.id} shadows stage ${owner}`,
                    'duplicate-id',
                    record.id,
                );
            }
            if (seenIds.has(alias) && seenIds.get(alias) !== records.indexOf(record)) {
                throw new StageRegistryError(
                    `alias ${alias} of stage ${record.id} shadows another stage id`,
                    'duplicate-id',
                    record.id,
                );
            }
            seenAliases.set(alias, record.id);
        }
    }

    return [...records];
}

// ─── Registry consumer compatibility (R4) ─────────────────────────────────

/**
 * Parse and validate a stage record against the current consumer schema.
 * Rejects records whose schema major version differs from the consumer's
 * (R4: consumer at major N accepts N.x only).
 *
 * @param raw - unknown input (e.g. parsed JSON / YAML frontmatter).
 * @param consumerVersion - defaults to {@link STAGE_REGISTRY_SCHEMA_VERSION}.
 */
export function parseStageRecord(
    raw: unknown,
    consumerVersion: StageSchemaVersion = STAGE_REGISTRY_SCHEMA_VERSION,
): StageRecord {
    const parsed = stageRecordSchema.safeParse(raw);
    if (!parsed.success) {
        throw new StageRegistryError(
            `stage record failed schema validation: ${parsed.error.message}`,
            'schema-version-mismatch',
        );
    }
    const record = parsed.data;
    if (!isCompatibleStageVersion(consumerVersion, record.schema_version)) {
        throw new StageRegistryError(
            `stage ${record.id}: schema major ${record.schema_version.major} is incompatible with consumer major ${consumerVersion.major}`,
            'schema-version-mismatch',
            record.id,
        );
    }
    return validateStageRecord(record);
}

// ─── Registered Canonical Stages (0319) ───────────────────────────────────

export const REGISTERED_CANONICAL_STAGES: StageRecord[] = [
    {
        schema_version: STAGE_REGISTRY_SCHEMA_VERSION,
        id: 'refine',
        aliases: ['dev-refine'],
        description: 'dev-refine: Q&A refinement, section filling, AC tightening',
        artifacts: [{ kind: 'task-section', direction: 'output', required: true }],
        reasoning_skill: 'sp:spur-dev',
        required_references: [],
        gates: [],
        mutation_class: 'corpus',
        retry: { max_attempts: 3, terminal_stop: 'block' },
        model_policy: {
            // Default: Design is authored at plan/create (capable models). Refine is the
            // cheap fallback for blank/missing Design — standard floor; escalate to capable-2
            // only when the pre-synthesis SKIP gate fails on target sections.
            min_tier: 'standard',
            fallback: [{ tier: 'capable-2', trigger: 'gate-fail' }],
        },
        context_layers: [],
        observability: [],
        execution: { kind: 'inline', current_agent_allowed: true },
    },
    {
        schema_version: STAGE_REGISTRY_SCHEMA_VERSION,
        id: 'plan',
        aliases: ['dev-plan'],
        description: 'dev-plan: feature intake -> AC generation -> decomposition',
        artifacts: [{ kind: 'task-batch', direction: 'output', required: true }],
        reasoning_skill: 'sp:spur-dev',
        required_references: [],
        gates: [],
        mutation_class: 'corpus',
        retry: { max_attempts: 3, terminal_stop: 'block' },
        model_policy: {
            // Planning/create is the capable-first path (author Design in batch by default).
            min_tier: 'capable-2',
            fallback: [{ tier: 'capable-3', trigger: 'gate-fail' }],
        },
        context_layers: [],
        observability: [],
        execution: { kind: 'inline', current_agent_allowed: true },
    },
    {
        schema_version: STAGE_REGISTRY_SCHEMA_VERSION,
        id: 'implement',
        aliases: ['dev-run'],
        description: 'dev-run --mode implement: code edits in worktree',
        artifacts: [{ kind: 'worktree-diff', direction: 'output', required: true }],
        reasoning_skill: 'sp:code-implementation',
        required_references: [],
        gates: [],
        mutation_class: 'code',
        retry: { max_attempts: 3, terminal_stop: 'block' },
        model_policy: {
            min_tier: 'standard',
            fallback: [
                { tier: 'capable-1', trigger: 'gate-fail' },
                { tier: 'capable-1', trigger: 'timeout' },
            ],
        },
        context_layers: [],
        observability: [],
        execution: { kind: 'inline', current_agent_allowed: true },
    },
    {
        schema_version: STAGE_REGISTRY_SCHEMA_VERSION,
        id: 'test',
        aliases: ['dev-unit'],
        description: 'dev-unit: generate/extend tests to coverage target',
        artifacts: [{ kind: 'test-file', direction: 'output', required: true }],
        reasoning_skill: 'sp:code-testing',
        required_references: [],
        gates: [],
        mutation_class: 'tests',
        retry: { max_attempts: 3, terminal_stop: 'block' },
        model_policy: {
            min_tier: 'standard',
            fallback: [{ tier: 'capable-1', trigger: 'gate-fail' }],
        },
        context_layers: [],
        observability: [],
        execution: { kind: 'inline', current_agent_allowed: true },
    },
    {
        schema_version: STAGE_REGISTRY_SCHEMA_VERSION,
        id: 'verify',
        aliases: ['dev-verify'],
        description: 'dev-verify: SECUA review + requirements traceability',
        artifacts: [{ kind: 'verdict-artifact', direction: 'output', required: true }],
        reasoning_skill: 'sp:code-verification',
        required_references: [],
        gates: [],
        mutation_class: 'verdict',
        retry: { max_attempts: 2, terminal_stop: 'escalate' },
        model_policy: {
            min_tier: 'capable-1',
            fallback: [],
        },
        context_layers: [],
        observability: [],
        execution: { kind: 'inline', current_agent_allowed: true },
    },
    {
        schema_version: STAGE_REGISTRY_SCHEMA_VERSION,
        id: 'wrap',
        aliases: ['dev-wrap'],
        description: 'dev-wrap: learnings/doc-sync/feature transition',
        artifacts: [{ kind: 'learning-entry', direction: 'output', required: true }],
        reasoning_skill: 'sp:spur-dev',
        required_references: [],
        gates: [],
        mutation_class: 'learnings',
        retry: { max_attempts: 2, terminal_stop: 'block' },
        model_policy: {
            min_tier: 'standard',
            fallback: [{ tier: 'capable-1', trigger: 'gate-fail' }],
        },
        context_layers: [],
        observability: [],
        execution: { kind: 'inline', current_agent_allowed: true },
    },
    {
        schema_version: STAGE_REGISTRY_SCHEMA_VERSION,
        id: 'review',
        aliases: ['dev-review'],
        description: 'dev-review: multi-dimensional code review',
        artifacts: [{ kind: 'review-findings', direction: 'output', required: true }],
        reasoning_skill: 'sp:code-verification',
        required_references: [],
        gates: [],
        mutation_class: 'verdict',
        retry: { max_attempts: 2, terminal_stop: 'block' },
        model_policy: {
            min_tier: 'standard',
            fallback: [{ tier: 'capable-1', trigger: 'gate-fail' }],
        },
        context_layers: [],
        observability: [],
        execution: { kind: 'inline', current_agent_allowed: true },
    },
    {
        schema_version: STAGE_REGISTRY_SCHEMA_VERSION,
        id: 'dogfood',
        aliases: ['dev-dogfood'],
        description: 'dev-dogfood: end-to-end driver test',
        artifacts: [{ kind: 'dogfood-report', direction: 'output', required: true }],
        reasoning_skill: 'sp:dogfood-testing',
        required_references: [],
        gates: [],
        mutation_class: 'driver',
        retry: { max_attempts: 3, terminal_stop: 'block' },
        model_policy: {
            min_tier: 'capable-1',
            fallback: [],
        },
        context_layers: [],
        observability: [],
        execution: { kind: 'inline', current_agent_allowed: true },
    },
    {
        schema_version: STAGE_REGISTRY_SCHEMA_VERSION,
        id: 'brainstorm',
        aliases: ['dev-brainstorm'],
        description: 'dev-brainstorm: structured ideation',
        artifacts: [{ kind: 'brainstorm-outline', direction: 'output', required: true }],
        reasoning_skill: 'sp:brainstorm',
        required_references: [],
        gates: [],
        mutation_class: 'corpus',
        retry: { max_attempts: 2, terminal_stop: 'block' },
        model_policy: {
            min_tier: 'standard',
            fallback: [],
        },
        context_layers: [],
        observability: [],
        execution: { kind: 'inline', current_agent_allowed: true },
    },
    {
        schema_version: STAGE_REGISTRY_SCHEMA_VERSION,
        id: 'changelog',
        aliases: ['dev-changelog'],
        description: 'dev-changelog: generate changelog from git commits',
        artifacts: [{ kind: 'changelog-entry', direction: 'output', required: true }],
        reasoning_skill: 'inline',
        required_references: [],
        gates: [],
        mutation_class: 'none',
        retry: { max_attempts: 1, terminal_stop: 'block' },
        model_policy: {
            min_tier: 'cheap',
            fallback: [],
        },
        context_layers: [],
        observability: [],
        execution: { kind: 'deterministic', current_agent_allowed: false, executor: 'cli' },
    },
];

const CANONICAL_STAGE_BY_KEY = new Map<string, StageRecord>();
for (const s of REGISTERED_CANONICAL_STAGES) {
    CANONICAL_STAGE_BY_KEY.set(s.id, s);
    for (const a of s.aliases ?? []) {
        CANONICAL_STAGE_BY_KEY.set(a, s);
    }
}

/**
 * Look up a registered canonical stage record by its stage id or alias.
 * Returns undefined if no matching stage is registered.
 */
export function getCanonicalStage(idOrAlias: string): StageRecord | undefined {
    return CANONICAL_STAGE_BY_KEY.get(idOrAlias);
}
