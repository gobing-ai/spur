/**
 * Planning-layer frontmatter schemas and canonical status enums.
 *
 * Authority: `docs/design/rd3-migration-design.md` §2.1 (task field table),
 * §2.2 (feature field table), §2.3 (status enums + lifecycle graphs), plus the
 * binding decisions DD-01 (lowercase canonical statuses with case/alias-tolerant
 * input only), DD-02 (`profile` single key, `preset` collapsed), DD-03
 * (`schema_version` literal `1`), DD-07 (snake_case keys, `feature_id`),
 * DD-10 (no `folder`, no `description == name` default), DD-13 (`verifying`
 * in `FeatureStatus`), DD-14 (feature ID regex `^[A-Z][1-9]*$`, no
 * `parent_id` field).
 *
 * The exported schemas are the parse-validate-serialize SSOT for the
 * planning layer (A18). Storage values are always lowercase canonical;
 * legacy aliases are accepted on input only — never persisted.
 */
import { z } from 'zod';

/** Canonical task statuses (lowercase). Lowercase-only on output. */
export const TASK_STATUSES = ['backlog', 'todo', 'wip', 'testing', 'blocked', 'done', 'cancelled'] as const;

/** Canonical feature statuses (lowercase). Lowercase-only on output. */
export const FEATURE_STATUSES = ['backlog', 'active', 'verifying', 'blocked', 'done', 'cancelled'] as const;

/** Type alias for the canonical task status vocabulary. */
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Type alias for the canonical feature status vocabulary. */
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];
/** Canonical task status→emoji map (presentation-only; never persisted — DD-01). */
export const TASK_STATUS_ICONS: Record<TaskStatus, string> = {
    backlog: '📋',
    todo: '🔲',
    wip: '🚧',
    testing: '🧪',
    blocked: '🚫',
    done: '✅',
    cancelled: '⛔',
};

/** Canonical feature status→emoji map (presentation-only; never persisted — DD-01). */
export const FEATURE_STATUS_ICONS: Record<FeatureStatus, string> = {
    backlog: '📋',
    active: '🔄',
    verifying: '🧪',
    blocked: '🚫',
    done: '✅',
    cancelled: '⛔',
};

/** Get the emoji icon for a task status (presentation-only). Normalizes legacy statuses so old rd3 tasks display correctly. */
export function taskStatusIcon(status: string): string {
    try {
        return (TASK_STATUS_ICONS as Record<string, string>)[normalizeTaskStatus(status)] ?? '';
    } catch {
        return '';
    }
}

/** Get the emoji icon for a feature status (presentation-only). Returns '' for unknown. */
export function featureStatusIcon(status: string): string {
    return (FEATURE_STATUS_ICONS as Record<string, string>)[status] ?? '';
}

/** Priority scale shared by tasks and features. */
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;

/** Type alias for the canonical priority vocabulary. */
export type Priority = (typeof PRIORITIES)[number];

/** Orchestration profile enum (DD-02: `profile` is the single key). */
export const PROFILES = [
    'simple',
    'standard',
    'complex',
    'research',
    'refine',
    'plan',
    'unit',
    'review',
    'docs',
] as const;

/** Type alias for the canonical profile vocabulary. */
export type Profile = (typeof PROFILES)[number];

/**
 * Task `type` enum — the work-item kind. Mirrors the template variants so
 * every template carries a `type` that matches its section layout. `task`
 * is the catch-all default; `brainstorm` is the only non-task kind.
 */
export const TASK_TYPES = ['task', 'issue', 'review', 'meta', 'brainstorm'] as const;

/** Type alias for the canonical task `type` vocabulary. */
export type TaskType = (typeof TASK_TYPES)[number];

/**
 * Canonical task TEMPLATE VARIANT vocabulary — the single axis that selects a
 * task's section layout (the `section-matrix.yaml` variant), its scaffold
 * template file (shipped as `templates/task/<variant>.md`), and its `template:`
 * frontmatter value. `standard` is the workhorse; `brainstorm` is the minimal
 * idea-capture variant. SSOT: every consumer (matrix, template files, batch
 * schema, frontmatter, `--template` CLI) reads from this list.
 */
export const TASK_VARIANTS = ['standard', 'feature-impl', 'issue', 'review', 'meta', 'brainstorm'] as const;

/** Type alias for the canonical template-variant vocabulary. */
export type TaskVariant = (typeof TASK_VARIANTS)[number];

/** The default template variant when none is specified. */
export const DEFAULT_TASK_VARIANT: TaskVariant = 'standard';

/**
 * Feature ID regex per DD-14: position-encoding hierarchical letter+digit.
 * Matches a single letter optionally followed by one or more digits
 * (length encodes depth, ≤9 children per node).
 */
export const FEATURE_ID_PATTERN = /^[A-Z][1-9]*$/;

/**
 * Legacy alias map preserved as input-only normalization. Lowercase canonical
 * outputs are always the resolved values; aliases never persist.
 */
const TASK_STATUS_ALIASES: Readonly<Record<string, TaskStatus>> = {
    completed: 'done',
    complete: 'done',
    'in-progress': 'wip',
    'in progress': 'wip',
    in_progress: 'wip',
    dropped: 'cancelled',
    cancel: 'cancelled',
    canceled: 'cancelled',
    new: 'backlog',
    pending: 'backlog',
    blocked: 'blocked',
    wip: 'wip',
    testing: 'testing',
    done: 'done',
    cancelled: 'cancelled',
    backlog: 'backlog',
    todo: 'todo',
};

const FEATURE_STATUS_ALIASES: Readonly<Record<string, FeatureStatus>> = {
    completed: 'done',
    complete: 'done',
    'in-progress': 'active',
    'in progress': 'active',
    in_progress: 'active',
    dropped: 'cancelled',
    cancel: 'cancelled',
    canceled: 'cancelled',
    new: 'backlog',
    pending: 'backlog',
    wip: 'active',
    in_review: 'verifying',
    'in-review': 'verifying',
    review: 'verifying',
    blocked: 'blocked',
    done: 'done',
    cancelled: 'cancelled',
    backlog: 'backlog',
    active: 'active',
    verifying: 'verifying',
};

/**
 * Normalize a raw task-status string (case-insensitive, alias-tolerant) to
 * its lowercase canonical form. Throws on values outside the combined alias
 * map so callers can surface the allowed set in the error.
 */
export function normalizeTaskStatus(raw: string): TaskStatus {
    const key = raw.trim().toLowerCase();
    const resolved = TASK_STATUS_ALIASES[key];
    if (resolved === undefined) {
        throw new Error(`Unknown task status: ${JSON.stringify(raw)} (allowed: ${TASK_STATUSES.join(', ')})`);
    }
    return resolved;
}

/**
 * Like {@link normalizeTaskStatus} but never throws — unrecognized statuses
 * fall back to `'todo'` so a single malformed task file cannot break read paths
 * (e.g. the task list endpoint). Use the throwing variant on write paths where
 * the caller needs to reject an invalid status.
 */
export function normalizeTaskStatusSafe(raw: string): TaskStatus {
    const key = raw.trim().toLowerCase();
    return TASK_STATUS_ALIASES[key] ?? 'todo';
}

/**
 * Normalize a raw feature-status string (case-insensitive, alias-tolerant) to
 * its lowercase canonical form. Throws on values outside the combined alias
 * map so callers can surface the allowed set in the error.
 */
export function normalizeFeatureStatus(raw: string): FeatureStatus {
    const key = raw.trim().toLowerCase();
    const resolved = FEATURE_STATUS_ALIASES[key];
    if (resolved === undefined) {
        throw new Error(`Unknown feature status: ${JSON.stringify(raw)} (allowed: ${FEATURE_STATUSES.join(', ')})`);
    }
    return resolved;
}

const isoDateString = z
    .string()
    .min(1)
    .refine((value) => !Number.isNaN(Date.parse(value)), {
        message: 'must be an ISO 8601 timestamp',
    });

const featureId = z
    .string()
    .regex(FEATURE_ID_PATTERN, {
        message: 'feature id must match ^[A-Z][1-9]*$ (DD-14)',
    })
    .nullable()
    .optional();

const wbsString = z
    .string()
    .regex(/^\d{4}$/, { message: 'parent_wbs must be a 4-digit WBS string' })
    .nullable()
    .optional();

/**
 * Frontmatter schema for a task file. Mirrors the design field table in
 * `rd3-migration-design.md` §2.1 exactly. No `impl_progress`/`folder`/`preset`
 * keys (A17 strips them).
 */
export const taskFrontmatterSchema = z.object({
    schema_version: z.literal(1),
    name: z.string().min(1),
    description: z.string().optional(),
    status: z.preprocess(
        (val) => {
            // Normalize legacy PascalCase & alias statuses (old rd3 tasks) to
            // canonical lowercase so existing task files remain readable.
            if (typeof val === 'string') {
                try {
                    return normalizeTaskStatus(val);
                } catch {
                    // Unrecognized — pass through so Zod emits a clear error
                }
            }
            return val;
        },
        z.enum(TASK_STATUSES as unknown as [TaskStatus, ...TaskStatus[]]),
    ),
    type: z
        .enum(TASK_TYPES as unknown as [TaskType, ...TaskType[]])
        .optional()
        .default('task'),
    /** Template variant — selects the section layout / matrix variant (§3.2). */
    template: z.enum(TASK_VARIANTS as unknown as [TaskVariant, ...TaskVariant[]]).optional(),
    profile: z.enum(PROFILES as unknown as [Profile, ...Profile[]]).optional(),
    feature_id: featureId,
    parent_wbs: wbsString,
    priority: z.enum(PRIORITIES as unknown as [Priority, ...Priority[]]).optional(),
    tags: z.array(z.string()).optional(),
    dependencies: z.array(z.string()).optional(),
    /**
     * Operator override of the verdict gate (R3, task 0292). `done_forced=true`
     * records that a non-PASS verdict was advanced to `done` deliberately;
     * `done_reason` carries the operator rationale. Accepts the YAML boolean
     * OR the string form emitted by `TaskService.updateField` (which writes
     * scalars as strings — `done_forced: "true"`), normalizing to a boolean.
     */
    done_forced: z.preprocess((v) => (typeof v === 'string' ? v === 'true' : v), z.boolean().optional()),
    done_reason: z.string().optional(),
    /**
     * Operator declined feature linkage (task 0328). `feature_link_declined=true`
     * records that the operator explicitly chose to leave a task unlinked to any feature.
     */
    feature_link_declined: z.preprocess((v) => (typeof v === 'string' ? v === 'true' : v), z.boolean().optional()),
    created_at: isoDateString,
    updated_at: isoDateString,
});

/**
 * Frontmatter schema for a feature file. Mirrors the design field table in
 * `rd3-migration-design.md` §2.2 exactly. No `parent_id` field (DD-14).
 */
export const featureFrontmatterSchema = z.object({
    schema_version: z.literal(1),
    id: z.string().regex(FEATURE_ID_PATTERN, {
        message: 'feature id must match ^[A-Z][1-9]*$ (DD-14)',
    }),
    name: z.string().min(1),
    status: z.enum(FEATURE_STATUSES as unknown as [FeatureStatus, ...FeatureStatus[]]),
    // Optional for parity with tasks (consumers already default a missing
    // priority to P2); a feature without a priority is valid, not corrupt.
    priority: z.enum(PRIORITIES as unknown as [Priority, ...Priority[]]).optional(),
    tags: z.array(z.string()).optional(),
    created_at: isoDateString,
    updated_at: isoDateString,
});

/** Inferred TypeScript shape of a parsed task frontmatter. */
export type TaskFrontmatter = z.infer<typeof taskFrontmatterSchema>;

/** Inferred TypeScript shape of a parsed feature frontmatter. */
export type FeatureFrontmatter = z.infer<typeof featureFrontmatterSchema>;

// ─── Task batch input ────────────────────────────────────────────────────

/**
 * Template variant names for task batch creation.
 *
 * @deprecated Use {@link TASK_VARIANTS} — the unified template-variant axis. This
 * alias is retained for import compatibility and is now the same canonical set.
 */
export const TASK_TEMPLATES = TASK_VARIANTS;

/** Type alias for the canonical template vocabulary. */
export type TaskTemplate = TaskVariant;

/**
 * A single task item in a batch-create payload.
 *
 * `.strict()` rejects unknown keys so a malformed LLM payload fails the gate
 * rather than having stray fields silently dropped — matching the
 * `additionalProperties: false` contract in `apps/cli/schemas/task-batch.schema.json`.
 * This Zod schema is the runtime source of truth; the JSON schema is an editor aid.
 */
export const taskBatchItemSchema = z
    .object({
        name: z.string().min(1, 'name is required'),
        background: z.string().optional(),
        requirements: z.string().optional(),
        /**
         * Pre-filled `### Design` body (WHAT/WHY decision record).
         * Default planning path should author this unless the operator passed
         * `--skip-design` (then leave empty; refine fills as fallback).
         */
        design: z.string().optional(),
        /** Pre-filled `### Plan` body (ordered checklist). */
        plan: z.string().optional(),
        /** Pre-filled `### Acceptance Criteria` body (Gherkin or checklist). */
        acceptance_criteria: z.string().optional(),
        feature_id: featureId,
        parent_wbs: wbsString,
        priority: z.enum(PRIORITIES).optional(),
        tags: z.array(z.string()).optional(),
        template: z.enum(TASK_VARIANTS).optional(),
    })
    .strict();

/** Inferred TypeScript shape of a single batch item. */
export type TaskBatchItem = z.infer<typeof taskBatchItemSchema>;

/**
 * Batch create payload — the LLM→CLI decomposition gate.
 *
 * Validated as an array of taskBatchItemSchema objects. All-or-nothing:
 * any validation failure means nothing is written (design §12.2).
 */
export const taskBatchSchema = z.array(taskBatchItemSchema).min(1, 'batch must contain at least one task');
