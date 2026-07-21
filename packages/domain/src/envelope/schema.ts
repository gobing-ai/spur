/**
 * Envelope-layer schemas and types (feature O, spec 0284 R1, R3).
 *
 * Each layer is a typed record with canonical serialization/order (stable-first
 * then volatile), size budget, content hash, provenance, and cacheability
 * classification (0284 R1).
 *
 * Project/task snapshot schemas defined here are obtained via targeted --json
 * verbs, fingerprinted by content hash — never a full-file reread (0284 R2).
 *
 * @see CONTEXT_LAYER_NAMES — the canonical ordered vocabulary from the
 *      stage-registry schema (layers 1-7 stable-first then volatile).
 */

import { z } from 'zod';
import { CONTEXT_LAYER_NAMES, type ContextLayerName } from '../stage-registry/schema';

// ─── Cacheability (R1) ─────────────────────────────────────────────────────

/**
 * Cacheability classification for an envelope layer.
 *
 * - `stable-prefix-eligible`: content that is deterministic given its inputs
 *   (policy, contract, evidence). Eligible for provider prompt-caching prefix.
 * - `volatile`: content that changes per-run (run state, tool observations).
 *   Never eligible for stable prefix caching.
 */
export const CACHEABILITY_CLASSES = ['stable-prefix-eligible', 'volatile'] as const;

/** Type alias for the canonical cacheability vocabulary. */
export type Cacheability = (typeof CACHEABILITY_CLASSES)[number];

// ─── Sensitivity ───────────────────────────────────────────────────────────

/**
 * Sensitivity/redaction classification for an envelope layer.
 *
 * - `public`: no restrictions; suitable for all disclosure.
 * - `internal`: project-internal; safe for all team agents.
 * - `confidential`: secrets, credentials, or private data; must be redacted or
 *   gated behind explicit disclosure triggers (0284 R4).
 */
export const SENSITIVITY_CLASSES = ['public', 'internal', 'confidential'] as const;

/** Type alias for the canonical sensitivity vocabulary. */
export type Sensitivity = (typeof SENSITIVITY_CLASSES)[number];

// ─── Provenance (R1) ───────────────────────────────────────────────────────

/**
 * Provenance metadata for an envelope layer. Records who owns the layer,
 * the schema version used for serialization, the source revision that produced
 * it, and when it was generated.
 *
 * Every layer carries provenance. Missing optional fields (`source_revision`)
 * are serialized as absent — never synthetic defaults.
 */
export const envelopeProvenanceSchema = z
    .object({
        /** Owner skill/module identifier (e.g. "sp:spur-dev", "cli:spur"). */
        owner: z.string().min(1),
        /** Semver-ish schema version of this layer's serialization shape. */
        schema_version: z.string().min(1),
        /** Source revision (git SHA or equivalent). Null when unavailable. */
        source_revision: z.string().nullable().optional(),
        /** ISO 8601 timestamp of when this layer was generated. */
        generated_at: z.string().datetime(),
    })
    .strict();

/** Inferred TypeScript shape of an envelope layer's provenance. */
export type EnvelopeProvenance = z.infer<typeof envelopeProvenanceSchema>;

// ─── Envelope layer (R1) ───────────────────────────────────────────────────

/**
 * Size budget constraint for an envelope layer.
 *
 * `max_bytes` is the hard ceiling. When serialized content exceeds this,
 * the consumer must truncate or omit the layer (falling back to a disclosure
 * handle or metadata-only reference).
 */
export const envelopeSizeBudgetSchema = z
    .object({
        /** Hard maximum serialized size in bytes. */
        max_bytes: z.number().int().positive(),
    })
    .strict();

/** Inferred TypeScript shape of an envelope size budget. */
export type EnvelopeSizeBudget = z.infer<typeof envelopeSizeBudgetSchema>;

/**
 * A single typed envelope layer (0284 R1).
 *
 * Each layer carries:
 * - `layer`: canonical name from CONTEXT_LAYER_NAMES
 * - `content`: serialized text
 * - `size_bytes`: actual serialized size
 * - `content_hash`: SHA-256 hex digest of `content`
 * - `provenance`: owner, schema version, source revision, generated-at
 * - `cacheability`: stable-prefix-eligible vs volatile
 * - `sensitivity`: public/internal/confidential
 * - `size_budget`: optional hard ceiling
 * - `disclosure_handle`: optional reference for progressive disclosure
 */
export const envelopeLayerSchema = z
    .object({
        /**
         * Canonical layer name — derived from the stage-registry vocabulary so
         * the two cannot drift. A previous revision inlined a duplicate literal
         * here, which tsc could not have caught if CONTEXT_LAYER_NAMES changed.
         */
        layer: z.enum(CONTEXT_LAYER_NAMES),
        /** Serialized text content. */
        content: z.string(),
        /** Byte size of the serialized content (UTF-8). */
        size_bytes: z.number().int().nonnegative(),
        /** SHA-256 hex digest of content (64 hex chars). */
        content_hash: z.string().length(64),
        /** Provenance metadata. */
        provenance: envelopeProvenanceSchema,
        /** Cacheability classification. */
        cacheability: z.enum(CACHEABILITY_CLASSES),
        /** Sensitivity/redaction classification. */
        sensitivity: z.enum(SENSITIVITY_CLASSES).default('internal'),
        /** Optional size budget constraint. */
        size_budget: envelopeSizeBudgetSchema.optional(),
        /**
         * Optional disclosure handle for progressive disclosure (0284 R4).
         * When present, the layer content may be deferred and loaded on
         * demand. The handle value is opaque — resolved by the consumer.
         */
        disclosure_handle: z.string().optional(),
    })
    .strict();

/** Inferred TypeScript shape of a single envelope layer. */
export type EnvelopeLayer = z.infer<typeof envelopeLayerSchema>;

// ─── Typed layer helpers (R1) ──────────────────────────────────────────────

/**
 * Typed schema for the stable-prefix-eligible layers (1–5).
 *
 * Layers 1-5 are deterministic for equal inputs and eligible for provider
 * prompt-caching prefix:
 *   1. harness-policy     — AGENTS.md authority, harness routing, gate contracts
 *   2. project-authority  — docs/00-05, 99_PROJECT_CONSTITUTION.md, ADRs
 *   3. stage-contract     — registry record (0282)
 *   4. task-state         — AC scenarios, locked Q&A, active task state
 *   5. indexed-evidence   — .spur/context/ anatomy/learnings/pitfalls/buglog
 */
export const STABLE_LAYER_NAMES = [
    'harness-policy',
    'project-authority',
    'stage-contract',
    'task-state',
    'indexed-evidence',
] as const;

/**
 * Typed schema for the volatile layers (6–7).
 *
 * Layers 6-7 change per-run and are never eligible for stable prefix caching:
 *   6. run-state           — stage attempt, prior verdicts, operator overrides
 *   7. tool-observations   — fresh command output, file reads, search results
 */
export const VOLATILE_LAYER_NAMES = ['run-state', 'tool-observations'] as const;

/** Type alias for stable layer names. */
export type StableLayerName = (typeof STABLE_LAYER_NAMES)[number];

/** Type alias for volatile layer names. */
export type VolatileLayerName = (typeof VOLATILE_LAYER_NAMES)[number];

/**
 * Compile-time partition guard: every name in CONTEXT_LAYER_NAMES must be
 * classified as either stable or volatile. Adding a layer to the canonical
 * vocabulary without classifying it here fails `tsc` rather than silently
 * defaulting to volatile at runtime (which is what the `?? 99` sort fallback
 * and `isStableLayerName` would otherwise do).
 */
type UnclassifiedLayer = Exclude<ContextLayerName, StableLayerName | VolatileLayerName>;
const _layerPartitionIsExhaustive: UnclassifiedLayer extends never ? true : never = true;
void _layerPartitionIsExhaustive;

// ─── Envelope (R1, R2) ─────────────────────────────────────────────────────

/**
 * The canonical context envelope: an ordered stack of typed layers.
 *
 * Stable layers (1–5) precede volatile layers (6–7). Within each group the
 * canonical CONTEXT_LAYER_NAMES order is preserved so stable content always
 * prefixes volatile content in serialized form (0284 R1).
 *
 * Assembly is deterministic for equal inputs. Each layer is independently
 * fingerprinted; invalidation is per-layer and fingerprint-driven, not
 * time-based (0284 R3).
 */
export const envelopeSchema = z
    .object({
        /** Schema version of the envelope shape itself. */
        schema_version: z.string().default('1.0'),
        /** Ordered layers — stable first, then volatile. */
        layers: z.array(envelopeLayerSchema).min(1),
        /**
         * Stage identifier this envelope was assembled for.
         * Null when assembled outside a stage context.
         */
        stage_id: z.string().optional(),
        /**
         * Run identifier this envelope is associated with.
         * Null when assembled outside a run context.
         */
        run_id: z.string().optional(),
        /** ISO 8601 timestamp of envelope assembly. */
        assembled_at: z.string().datetime(),
        /**
         * Total serialized size in bytes across all layers.
         * Computed as sum of layer size_bytes.
         */
        total_size_bytes: z.number().int().nonnegative(),
    })
    .strict();

/** Inferred TypeScript shape of a complete context envelope. */
export type Envelope = z.infer<typeof envelopeSchema>;

// ─── Project / task snapshots (R2) ─────────────────────────────────────────

/**
 * A minimal project snapshot schema obtained via `spur status --json`
 * (0284 R2). Never a full-file reread — the snapshot is the projected
 * CLI output, fingerprinted by content hash.
 */
export const projectSnapshotSchema = z
    .object({
        /** Project name from config. */
        name: z.string(),
        /** Spur config version. */
        version: z.string(),
        /** Number of tasks by status. */
        task_counts: z
            .object({
                backlog: z.number().int().nonnegative(),
                todo: z.number().int().nonnegative(),
                wip: z.number().int().nonnegative(),
                testing: z.number().int().nonnegative(),
                done: z.number().int().nonnegative(),
                blocked: z.number().int().nonnegative(),
                cancelled: z.number().int().nonnegative(),
            })
            .strict(),
        /** Number of features by status. */
        feature_counts: z
            .object({
                backlog: z.number().int().nonnegative(),
                active: z.number().int().nonnegative(),
                verifying: z.number().int().nonnegative(),
                done: z.number().int().nonnegative(),
                blocked: z.number().int().nonnegative(),
                cancelled: z.number().int().nonnegative(),
            })
            .strict(),
        /** Active feature IDs. */
        active_features: z.array(z.string()),
        /** Content hash of this snapshot (SHA-256 of canonical JSON). */
        content_hash: z.string().length(64).optional(),
    })
    .strict();

/** Inferred TypeScript shape of a project snapshot. */
export type ProjectSnapshot = z.infer<typeof projectSnapshotSchema>;

/**
 * A minimal task snapshot schema obtained via `spur task show <wbs> --json`
 * (0284 R2). Projects frontmatter plus active section bodies. Never a
 * full-file reread — the snapshot is the projected CLI output, fingerprinted
 * by content hash.
 */
export const taskSnapshotSchema = z
    .object({
        /** WBS identifier (4-digit string). */
        wbs: z.string().regex(/^\d{4}$/),
        /** Task name/title. */
        name: z.string(),
        /** Current status. */
        status: z.string(),
        /** Priority. */
        priority: z.string().optional(),
        /** Feature ID this task belongs to. */
        feature_id: z.string().optional(),
        /** Acceptance Criteria text from the task file. */
        acceptance_criteria: z.string().optional(),
        /** Active design decisions from the Q&A section. */
        locked_qa: z.array(z.string()).optional(),
        /** Solution section body (captures implementation decisions). */
        solution: z.string().optional(),
        /** Content hash of this snapshot (SHA-256 of canonical JSON). */
        content_hash: z.string().length(64).optional(),
    })
    .strict();

/** Inferred TypeScript shape of a task snapshot. */
export type TaskSnapshot = z.infer<typeof taskSnapshotSchema>;

/**
 * A minimal feature snapshot schema obtained via `spur feature show <id> --json`
 * (0284 R2). Never a full-file reread.
 */
export const featureSnapshotSchema = z
    .object({
        /** Feature ID (e.g. "O", "A1"). */
        id: z.string(),
        /** Feature name/title. */
        name: z.string(),
        /** Current status. */
        status: z.string(),
        /** Priority. */
        priority: z.string().optional(),
        /** Associated scenario IDs. */
        scenarios: z.array(z.string()).optional(),
        /** Content hash of this snapshot (SHA-256 of canonical JSON). */
        content_hash: z.string().length(64).optional(),
    })
    .strict();

/** Inferred TypeScript shape of a feature snapshot. */
export type FeatureSnapshot = z.infer<typeof featureSnapshotSchema>;
