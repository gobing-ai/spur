/**
 * stage-registry-adapter — dev-next golden-path adapter over the canonical
 * stage registry (feature O, spec ticket 0282/0283, task 0307).
 *
 * Provides a programmatic bridge between the dev-next status-aware facade and
 * the stage-registry schema. Defines the actual registered stage records,
 * implements the TABLE A/B/C resolution algorithm, and exports a pure-function
 * resolution API that any agent or CLI can call.
 *
 * Self-contained: no @gobing-ai/spur-domain dependency (plugins/sp is outside
 * the workspace). Types are defined inline, mirroring the domain schema.
 *
 * Stage floor tiers read from Layer 1 (`references/roles.md`, 0538 R4 /
 * 0348 Follow-up C): the stage → role → tier table is the single pointer for
 * floor tiers; this file no longer hardcodes a floor value. Regex-parsed
 * (no `yaml` dependency — the plugin installs into foreign repos; same
 * discipline as the parity tests).
 *
 * CLI usage:
 *   bun plugins/sp/scripts/stage-registry-adapter.ts --wbs 0307 [--dry-run]
 *   bun plugins/sp/scripts/stage-registry-adapter.ts --wbs 0307 --auto
 *   bun plugins/sp/scripts/stage-registry-adapter.ts --feature O
 *   bun plugins/sp/scripts/stage-registry-adapter.ts --list-stages
 *   bun plugins/sp/scripts/stage-registry-adapter.ts --help
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Inline type definitions (mirrors packages/domain/src/stage-registry/) ─

export type SchemaVersion = { major: number; minor: number };
export const CURRENT_SCHEMA_VERSION: SchemaVersion = { major: 1, minor: 0 };
export const AUTHORITY_LANES = ['registry', 'workflow', 'skill', 'cli', 'adapter'] as const;
export type AuthorityLane = (typeof AUTHORITY_LANES)[number];
// Mirrors packages/domain/src/stage-registry/schema.ts MUTATION_CLASSES. Pinned by
// tests/stage-registry-parity.test.ts — the plugin cannot import the domain package
// (it installs into foreign repos), so the copy is guarded rather than eliminated.
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
export type MutationClass = (typeof MUTATION_CLASSES)[number];
export const EXECUTION_KINDS = ['inline', 'subprocess', 'deterministic', 'hitl', 'irreversible'] as const;
export type ExecutionKind = (typeof EXECUTION_KINDS)[number];
export const ARTIFACT_DIRECTIONS = ['input', 'output'] as const;
export type ArtifactDirection = (typeof ARTIFACT_DIRECTIONS)[number];
export const CONTEXT_LAYER_NAMES = [
    'harness-policy',
    'project-authority',
    'stage-contract',
    'task-state',
    'indexed-evidence',
    'run-state',
    'tool-observations',
] as const;
export type ContextLayerName = (typeof CONTEXT_LAYER_NAMES)[number];

export interface StageArtifact {
    kind: string;
    direction: ArtifactDirection;
    description?: string;
    required?: boolean;
}

export interface StageGate {
    name: string;
    timing: 'pre' | 'post' | 'transition';
    min_verdict?: 'pass' | 'partial' | 'fail';
    description?: string;
}

export interface StageRetryPolicy {
    max_attempts: number;
    terminal_stop: 'block' | 'escalate' | 'fail';
    timeout_seconds?: number;
}

/** Capability tiers (0343): cheap | standard | capable-1 | capable-2 | capable-3. */
export type AdapterCapabilityTier = 'cheap' | 'standard' | 'capable-1' | 'capable-2' | 'capable-3';

/**
 * Objective escalation triggers (task 0405). Self-contained mirror of the
 * domain `objectiveEscalationTriggerSchema` in
 * `packages/domain/src/stage-registry/schema.ts` — the authority. Update both
 * together; `resource-exhaustion` covers rate-limit / quota / token-budget
 * failures as one class.
 */
export type ObjectiveEscalationTrigger =
    | 'gate-fail'
    | 'timeout'
    | 'insufficient-evidence'
    | 'retry-exhausted'
    | 'resource-exhaustion';

export interface StageModelPolicy {
    min_tier: AdapterCapabilityTier;
    fallback: Array<{
        tier: AdapterCapabilityTier;
        trigger: ObjectiveEscalationTrigger;
    }>;
    override_key?: string;
}

export interface StageContextLayer {
    layer: ContextLayerName;
    required: true;
}

export interface StageEvent {
    name: string;
    description?: string;
}

export interface ExecutionVariantInline {
    kind: 'inline';
    current_agent_allowed: true;
    may_reuse_captured_layers?: boolean;
}

export interface ExecutionVariantSubprocess {
    kind: 'subprocess';
    current_agent_allowed: false;
    via: 'spur-agent-run';
}

export interface ExecutionVariantDeterministic {
    kind: 'deterministic';
    current_agent_allowed: false;
    executor: 'cli' | 'script';
}

export interface ExecutionVariantHitl {
    kind: 'hitl';
    current_agent_allowed: true;
    gate_timing: 'pre' | 'post' | 'both';
}

export interface ExecutionVariantIrreversible {
    kind: 'irreversible';
    requires_operator_intent: true;
    current_agent_allowed: boolean;
    rollback_disclaimer: string;
}

export type ExecutionVariant =
    | ExecutionVariantInline
    | ExecutionVariantSubprocess
    | ExecutionVariantDeterministic
    | ExecutionVariantHitl
    | ExecutionVariantIrreversible;

export interface StageRecord {
    schema_version: SchemaVersion;
    id: string;
    aliases?: string[];
    description: string;
    artifacts: StageArtifact[];
    reasoning_skill: string;
    required_references?: string[];
    gates?: StageGate[];
    mutation_class: MutationClass;
    retry: StageRetryPolicy;
    model_policy: StageModelPolicy;
    context_layers?: StageContextLayer[];
    observability?: StageEvent[];
    execution: ExecutionVariant;
}

export type TaskStatus = 'backlog' | 'todo' | 'wip' | 'testing' | 'blocked' | 'done' | 'cancelled' | string;
export type FeatureStatus = 'backlog' | 'active' | 'verifying' | 'blocked' | 'done' | 'cancelled' | string;
export const TASK_STATUSES = ['backlog', 'todo', 'wip', 'testing', 'blocked', 'done', 'cancelled'] as const;
export const FEATURE_STATUSES = ['backlog', 'active', 'verifying', 'blocked', 'done', 'cancelled'] as const;

// ─── Resolution result types ────────────────────────────────────────────

export interface StageResolution {
    stage: StageRecord | null;
    target: string;
    status: string;
    tableRow: string | null;
    reason: string;
    reasonKind: 'dispatch' | 'blocked' | 'multi-candidate' | 'no-route' | 'error' | 'usage';
    requiresConfirmation: boolean;
    chain: boolean;
    dispatchCommand: string | null;
    blocker?: string;
    nextObservableOutcome?: string;
    candidates?: Array<{ command: string; reason: string }>;
}
export interface TaskSignal {
    wbs: string;
    status: TaskStatus;
    dependencies?: Array<{ wbs: string; status: TaskStatus }>;
    feature_id?: string | null;
    hasCheckpoint?: boolean;
}
export interface FeatureSignal {
    id: string;
    status: FeatureStatus;
    tasks?: TaskSignal[];
}

export interface ResolutionInput {
    target: string;
    wbs?: string;
    feature?: FeatureSignal;
    task?: TaskSignal;
    dryRun?: boolean;
    once?: boolean;
    auto?: boolean;
    fullMode?: boolean;
}

export interface StageLookupEntry {
    stage_id: string;
    command: string;
    skill: string;
}

// ─── Registry of all canonical stage records ────────────────────────────

const inlineInline = (reuse?: boolean): ExecutionVariantInline => ({
    kind: 'inline',
    current_agent_allowed: true,
    may_reuse_captured_layers: reuse,
});

const inlineDeterministic = (executor: 'cli' | 'script' = 'cli'): ExecutionVariantDeterministic => ({
    kind: 'deterministic',
    current_agent_allowed: false,
    executor,
});

const inlineHitl = (timing: 'pre' | 'post' | 'both'): ExecutionVariantHitl => ({
    kind: 'hitl',
    current_agent_allowed: true,
    gate_timing: timing,
});
const defaultRetry: StageRetryPolicy = { max_attempts: 3, terminal_stop: 'block', timeout_seconds: 300 };

export const TIER_ORDER: AdapterCapabilityTier[] = ['cheap', 'standard', 'capable-1', 'capable-2', 'capable-3'];

/**
 * Layer-1 stage → floor tier map (0538 R4 / 0348 Follow-up C): derived from
 * `references/roles.md` (role → tier → stages). This is the single pointer for
 * floor tiers; a stage's `model_policy.min_tier` never hardcodes a value here.
 * Stages Layer 1 does not fold keep the local `standard` floor. A missing or
 * unreadable roles.md degrades every floor to `standard` (the pre-reconcile
 * default) rather than failing the routing adapter.
 */
export const STAGE_FLOOR_TIER: ReadonlyMap<string, AdapterCapabilityTier> = (() => {
    const map = new Map<string, AdapterCapabilityTier>();
    try {
        const source = readFileSync(join(import.meta.dir, '..', 'references', 'roles.md'), 'utf8');
        const roleRe = /id: ([a-z-]+)[\s\S]*?tier: ([a-z0-9-]+)[\s\S]*?stages: \[([^\]]*)\]/g;
        for (const m of source.matchAll(roleRe)) {
            const tier = m[2] as AdapterCapabilityTier;
            for (const stage of (m[3] ?? '').split(',')) {
                const id = stage.trim();
                if (id !== '') map.set(id, tier);
            }
        }
    } catch {
        // roles.md unreachable — every floor falls back to `standard` below.
    }
    return map;
})();

/**
 * Build a stage model policy whose floor reads from Layer 1. A declared fallback
 * at or below the floor (review/refine/brainstorm floors rose with roles.md)
 * escalates to the next tier above the floor instead of degrading.
 */
function policy(stage: string, fallback: AdapterCapabilityTier[] = []): StageModelPolicy {
    const floor = STAGE_FLOOR_TIER.get(stage) ?? 'standard';
    const kept = fallback.filter((t) => TIER_ORDER.indexOf(t) > TIER_ORDER.indexOf(floor));
    if (kept.length > 0) return { min_tier: floor, fallback: kept.map((tier) => ({ tier, trigger: 'gate-fail' })) };
    if (fallback.length === 0) return { min_tier: floor, fallback: [] };
    // Escalate one tier above the floor; a floor already at the top of the
    // vocabulary keeps itself as the bound (no higher tier exists to escalate to).
    const next = TIER_ORDER[TIER_ORDER.indexOf(floor) + 1] ?? floor;
    return { min_tier: floor, fallback: [{ tier: next, trigger: 'gate-fail' }] };
}

const layer = (name: ContextLayerName): StageContextLayer => ({ layer: name, required: true });
const event = (name: string, description?: string): StageEvent => ({ name, description });

/**
 * Complete set of registered canonical stage records.
 * Maps one-to-one with /sp:dev-* operations from dev-operations.md.
 */
export const REGISTERED_STAGES: StageRecord[] = [
    {
        schema_version: CURRENT_SCHEMA_VERSION,
        id: 'refine',
        aliases: [],
        description: 'dev-refine: Q&A refinement, section filling, AC tightening',
        artifacts: [
            { kind: 'task-section', direction: 'input', description: 'Background/Requirements sections' },
            { kind: 'task-section', direction: 'output', description: 'Q&A/Design/Plan/AC sections' },
        ],
        reasoning_skill: 'sp:spur-dev',
        required_references: ['references/dev-operations.md', 'spur-dev/references/decision-brief.md'],
        gates: [
            { name: 'refine-skip-gate', timing: 'pre', description: 'Skip sections that already meet L3' },
            { name: 'l4-advisory', timing: 'post', min_verdict: 'pass', description: 'L4 advisory surface' },
        ],
        mutation_class: 'corpus',
        retry: defaultRetry,
        model_policy: policy('refine', ['capable-2']),
        context_layers: [layer('project-authority'), layer('task-state'), layer('stage-contract')],
        observability: [event('stage-started'), event('feature-created'), event('batch-created')],
        execution: inlineInline(true),
    },
    {
        schema_version: CURRENT_SCHEMA_VERSION,
        id: 'plan',
        aliases: ['dev-plan'],
        description: 'dev-plan: feature intake -> AC generation -> decomposition -> batch-create',
        artifacts: [
            { kind: 'feature-frontmatter', direction: 'input', required: true },
            { kind: 'task-batch', direction: 'output', required: true },
        ],
        reasoning_skill: 'sp:spur-dev',
        gates: [
            { name: 'feature-check', timing: 'post', min_verdict: 'pass' },
            { name: 'batch-create', timing: 'post', min_verdict: 'pass' },
        ],
        mutation_class: 'corpus',
        retry: defaultRetry,
        model_policy: policy('plan', ['capable-3']),
        context_layers: [layer('project-authority'), layer('task-state'), layer('stage-contract')],
        observability: [event('stage-started'), event('feature-created'), event('batch-created')],
        execution: inlineInline(true),
    },
    {
        schema_version: CURRENT_SCHEMA_VERSION,
        id: 'implement',
        description: 'dev-run --mode implement: code edits in worktree',
        artifacts: [
            { kind: 'worktree-diff', direction: 'output', required: true },
            { kind: 'task-section', direction: 'input', description: 'Solution section constraints' },
        ],
        reasoning_skill: 'sp:code-implementation',
        gates: [],
        mutation_class: 'code',
        retry: defaultRetry,
        model_policy: policy('implement', ['capable-1']),
        context_layers: [layer('task-state'), layer('run-state')],
        observability: [event('stage-started'), event('code-modified')],
        execution: inlineInline(),
    },
    {
        schema_version: CURRENT_SCHEMA_VERSION,
        // Adaptive-routing stage for *coverage gap-fill* (router C3/C5 → /sp:dev-unit).
        // Distinct from task-pipeline hops `test` / `test-fix` / `test-recheck`, which are
        // the project quality gate (shell qualityGateCmd + bounded /sp:dev-fixall).
        id: 'test',
        description: 'coverage gap-fill via /sp:dev-unit (C3/C5); pipeline quality gate is test/test-fix/test-recheck',
        aliases: ['unit', 'coverage'],
        artifacts: [
            { kind: 'test-file', direction: 'output', required: true },
            { kind: 'coverage-report', direction: 'output', required: false },
        ],
        reasoning_skill: 'sp:code-testing',
        gates: [{ name: 'coverage-floor', timing: 'post', min_verdict: 'pass', description: '≥90% function coverage' }],
        mutation_class: 'tests',
        retry: defaultRetry,
        model_policy: policy('test', ['capable-1']),
        context_layers: [layer('task-state'), layer('run-state')],
        observability: [event('stage-started'), event('gate-passed'), event('coverage-measured')],
        execution: inlineInline(),
    },
    {
        schema_version: CURRENT_SCHEMA_VERSION,
        // Pipeline quality-gate family (task-pipeline test hop). Adaptive routing for
        // red lint/type/suite gates uses fixall (TABLE C2 already points here).
        id: 'quality-gate',
        description: 'task-pipeline quality gate: shell qualityGateCmd + bounded /sp:dev-fixall',
        aliases: ['test-fix', 'test-recheck', 'gate'],
        artifacts: [{ kind: 'coverage-report', direction: 'output', required: false }],
        reasoning_skill: 'sp:spur-dev',
        gates: [
            { name: 'project-quality-gate', timing: 'post', min_verdict: 'pass', description: 'qualityGateCmd exit 0' },
        ],
        mutation_class: 'code',
        retry: { max_attempts: 2, terminal_stop: 'block', timeout_seconds: 600 },
        model_policy: policy('quality-gate', ['capable-1']),
        context_layers: [layer('task-state'), layer('run-state')],
        observability: [event('stage-started'), event('gate-passed')],
        execution: inlineInline(),
    },

    {
        schema_version: CURRENT_SCHEMA_VERSION,
        id: 'verify',
        description: 'dev-verify: SECUA review + requirements traceability',
        artifacts: [
            { kind: 'verdict-artifact', direction: 'output', required: true },
            { kind: 'task-section', direction: 'output', description: 'Testing/Review sections' },
        ],
        reasoning_skill: 'sp:code-verification',
        gates: [
            { name: 'verdict-artifact', timing: 'post', min_verdict: 'pass' },
            { name: 'strict-core', timing: 'post', description: 'L3 core findings must pass' },
        ],
        mutation_class: 'verdict',
        retry: { max_attempts: 2, terminal_stop: 'escalate', timeout_seconds: 600 },
        model_policy: policy('verify'),
        context_layers: [layer('task-state'), layer('run-state'), layer('indexed-evidence')],
        observability: [event('stage-started'), event('verdict-emitted'), event('gate-passed')],
        execution: inlineInline(),
    },
    {
        schema_version: CURRENT_SCHEMA_VERSION,
        id: 'wrap',
        aliases: ['dev-wrap'],
        description: 'dev-wrap: learnings/doc-sync/feature transition',
        artifacts: [
            { kind: 'learning-entry', direction: 'output' },
            { kind: 'task-section', direction: 'output', description: 'Testing/Review updated' },
        ],
        reasoning_skill: 'sp:spur-dev',
        gates: [
            {
                name: 'task-check',
                timing: 'pre',
                min_verdict: 'pass',
                description: 'Task check must PASS before close',
            },
        ],
        mutation_class: 'learnings',
        retry: { max_attempts: 2, terminal_stop: 'block', timeout_seconds: 180 },
        model_policy: policy('wrap', ['capable-1']),
        context_layers: [layer('task-state'), layer('indexed-evidence')],
        observability: [event('stage-started'), event('learnings-written'), event('doc-synced')],
        execution: inlineHitl('both'),
    },
    {
        schema_version: CURRENT_SCHEMA_VERSION,
        id: 'review',
        description: 'dev-review: multi-dimensional code review (functional/SECUA/architecture)',
        artifacts: [{ kind: 'review-findings', direction: 'output', required: true }],
        reasoning_skill: 'sp:code-verification',
        gates: [{ name: 'review-guard', timing: 'post', min_verdict: 'pass', description: 'No P1 findings blocking' }],
        mutation_class: 'verdict',
        retry: { max_attempts: 2, terminal_stop: 'block', timeout_seconds: 300 },
        model_policy: policy('review', ['capable-1']),
        context_layers: [layer('task-state'), layer('run-state')],
        observability: [event('stage-started'), event('findings-produced')],
        execution: inlineInline(),
    },
    {
        schema_version: CURRENT_SCHEMA_VERSION,
        id: 'dogfood',
        description: 'dev-dogfood: end-to-end driver test of a skill/command/CLI',
        artifacts: [
            { kind: 'dogfood-report', direction: 'output', required: true },
            { kind: 'monitor-ledger', direction: 'output' },
        ],
        reasoning_skill: 'sp:dogfood-testing',
        required_references: ['references/monitor-ledger.md', 'references/report-template.md'],
        gates: [
            { name: 'detect-pipeline-driving', timing: 'pre', description: 'Refuse dogfood when driving a pipeline' },
            {
                name: 'report-validate',
                timing: 'post',
                min_verdict: 'pass',
                description: 'Report must pass schema validation',
            },
        ],
        mutation_class: 'driver',
        retry: { max_attempts: 3, terminal_stop: 'block', timeout_seconds: 600 },
        model_policy: policy('dogfood'),
        context_layers: [layer('task-state'), layer('run-state')],
        observability: [event('stage-started'), event('gate-passed'), event('report-emitted')],
        execution: inlineInline(),
    },
    {
        schema_version: CURRENT_SCHEMA_VERSION,
        id: 'handover',
        description: 'dev-handover: structured handover document when blocked',
        artifacts: [{ kind: 'handover-doc', direction: 'output', required: true }],
        reasoning_skill: 'inline',
        gates: [],
        mutation_class: 'corpus',
        retry: { max_attempts: 1, terminal_stop: 'block', timeout_seconds: 120 },
        model_policy: policy('handover', ['capable-1']),
        context_layers: [layer('task-state')],
        observability: [event('stage-started')],
        execution: inlineDeterministic('cli'),
    },
    {
        schema_version: CURRENT_SCHEMA_VERSION,
        id: 'fixall',
        description: 'dev-fixall: lint + type + test fix loop',
        artifacts: [
            { kind: 'lint-report', direction: 'output' },
            { kind: 'test-report', direction: 'output' },
        ],
        reasoning_skill: 'inline',
        gates: [],
        mutation_class: 'code',
        retry: { max_attempts: 1, terminal_stop: 'block', timeout_seconds: 120 },
        model_policy: policy('fixall', ['capable-1']),
        context_layers: [layer('task-state')],
        observability: [event('stage-started')],
        execution: inlineDeterministic('script'),
    },
    {
        schema_version: CURRENT_SCHEMA_VERSION,
        id: 'brainstorm',
        description: 'dev-brainstorm: structured ideation with trade-off analysis',
        artifacts: [{ kind: 'brainstorm-outline', direction: 'output', required: true }],
        reasoning_skill: 'sp:brainstorm',
        gates: [],
        mutation_class: 'corpus',
        retry: { max_attempts: 2, terminal_stop: 'block', timeout_seconds: 300 },
        model_policy: policy('brainstorm'),
        context_layers: [layer('project-authority'), layer('task-state')],
        observability: [event('stage-started')],
        execution: inlineInline(),
    },
    {
        schema_version: CURRENT_SCHEMA_VERSION,
        id: 'changelog',
        description: 'dev-changelog: generate changelog from git commits',
        artifacts: [{ kind: 'changelog-entry', direction: 'output' }],
        reasoning_skill: 'inline',
        gates: [],
        mutation_class: 'none',
        retry: { max_attempts: 1, terminal_stop: 'block', timeout_seconds: 60 },
        model_policy: policy('changelog'),
        context_layers: [],
        observability: [event('stage-started')],
        execution: inlineDeterministic('cli'),
    },
];

// ─── Stage lookup ────────────────────────────────────────────────────────

export const STAGE_BY_ID = new Map<string, StageRecord>(REGISTERED_STAGES.map((s) => [s.id, s]));
for (const s of REGISTERED_STAGES) {
    for (const a of s.aliases ?? []) {
        STAGE_BY_ID.set(a, s);
    }
}

export function getStage(id: string): StageRecord | undefined {
    return STAGE_BY_ID.get(id);
}

export function listStages(): StageLookupEntry[] {
    const COMMAND_BY_ID: Record<string, string> = {
        refine: '/sp:dev-refine',
        plan: '/sp:dev-plan',
        implement: '/sp:dev-run --mode implement',
        // Coverage gap-fill competency (not the pipeline quality-gate hops).
        test: '/sp:dev-unit',
        // Pipeline test/test-fix/test-recheck family — shell gate + fixall.
        'quality-gate': '/sp:dev-fixall',
        verify: '/sp:dev-verify',
        wrap: '/sp:dev-wrap',
        review: '/sp:dev-review',
        dogfood: '/sp:dev-dogfood',
        handover: 'inline (dev-handover)',
        fixall: 'inline (dev-fixall)',
        brainstorm: '/sp:dev-brainstorm',
        changelog: 'inline (dev-changelog)',
    };
    return REGISTERED_STAGES.map((s) => ({
        stage_id: s.id,
        command: COMMAND_BY_ID[s.id] ?? `/sp:dev-${s.id}`,
        skill: s.reasoning_skill,
    }));
}

// ─── TABLE A: task status → dispatch (routing-table.md §1) ──────────────

interface TableARow {
    condition: (input: ResolutionInput) => boolean;
    dispatch: string | null;
    rowId: string;
    chain: boolean;
    stop: boolean;
    stopReason?: string;
    probe: boolean;
    requiresConfirmation: boolean;
}

function statusEquals(s: string): (input: ResolutionInput) => boolean {
    return (input) => input.task?.status === s;
}

function statusAndDepsSatisfied(s: string): (input: ResolutionInput) => boolean {
    return (input) => {
        if (input.task?.status !== s) return false;
        const deps = input.task?.dependencies ?? [];
        if (deps.length === 0) return true;
        return deps.every((d) => d.status === 'done');
    };
}

// Exported for tests/routing-table-parity.test.ts (C2): the markdown routing table
// and these rows are two live representations of one contract and must be pinned.
export const TABLE_A: TableARow[] = [
    // A1 — backlog → refine
    {
        condition: statusEquals('backlog'),
        dispatch: '/sp:dev-refine {wbs} --auto --next',
        rowId: 'A1',
        chain: true,
        stop: false,
        probe: true,
        requiresConfirmation: false,
    },
    // A2 — todo with unmet deps → STOP
    {
        condition: (input) => {
            if (input.task?.status !== 'todo') return false;
            const deps = input.task?.dependencies ?? [];
            return deps.length > 0 && deps.some((d) => d.status !== 'done');
        },
        dispatch: null,
        rowId: 'A2',
        chain: false,
        stop: true,
        stopReason: 'blocked by open dependencies',
        probe: false,
        requiresConfirmation: false,
    },
    // A3 — todo with satisfied deps → run --mode implement --next.
    // The explicit mode is load-bearing (bug-742, routing-table.md §1 A3): without
    // it the pipeline step can recursively launch full mode, and the dispatch also
    // fails to match the implement pattern in STAGE_BY_DISPATCH, resolving to a null
    // stage record. Pinned against routing-table.md by tests/routing-table-parity.test.ts.
    {
        condition: statusAndDepsSatisfied('todo'),
        dispatch: '/sp:dev-run {wbs} --mode implement --auto --next',
        rowId: 'A3',
        chain: true,
        stop: false,
        probe: true,
        requiresConfirmation: false,
    },
    // A4 — wip with checkpoint → continue
    {
        condition: (input) => input.task?.status === 'wip' && input.task?.hasCheckpoint === true,
        dispatch: '/sp:dev-run {wbs} --continue',
        rowId: 'A4',
        chain: false,
        stop: false,
        probe: false,
        requiresConfirmation: false,
    },
    // A5 — wip no checkpoint → implement --next
    {
        condition: statusEquals('wip'),
        dispatch: '/sp:dev-run {wbs} --mode implement --auto --next',
        rowId: 'A5',
        chain: true,
        stop: false,
        probe: true,
        requiresConfirmation: false,
    },
    // A6 — testing → verify
    {
        condition: statusEquals('testing'),
        dispatch: '/sp:dev-verify {wbs} --auto --next',
        rowId: 'A6',
        chain: true,
        stop: false,
        probe: true,
        requiresConfirmation: false,
    },
    // A7 — blocked → handover
    {
        condition: statusEquals('blocked'),
        dispatch: '/sp:dev-handover <blocker>',
        rowId: 'A7',
        chain: false,
        stop: true,
        stopReason: 'blocked — handover document needed',
        probe: false,
        requiresConfirmation: true,
    },
    // A8 — done → wrap
    {
        condition: statusEquals('done'),
        dispatch: '/sp:dev-wrap {wbs}',
        rowId: 'A8',
        chain: false,
        stop: false,
        probe: false,
        requiresConfirmation: true,
    },
    // A9 — cancelled → STOP
    {
        condition: statusEquals('cancelled'),
        dispatch: null,
        rowId: 'A9',
        chain: false,
        stop: true,
        stopReason: 'cancelled — nothing to advance',
        probe: false,
        requiresConfirmation: false,
    },
];

// ─── TABLE B: feature-level routing (routing-table.md §2) ────────────────

interface TableBRow {
    condition: (input: ResolutionInput) => boolean;
    dispatch: ((input: ResolutionInput) => string | null) | null;
    rowId: string;
    chain: boolean;
    stop: boolean;
    stopReason?: string;
    requiresConfirmation: boolean;
}

/** Exported for tests/routing-table-parity.test.ts (C2). */
export const TABLE_B: TableBRow[] = [
    // B0 — unknown feature
    {
        condition: (input) => input.feature == null,
        dispatch: null,
        rowId: 'B0',
        chain: false,
        stop: true,
        stopReason: 'unknown feature id',
        requiresConfirmation: false,
    },
    // B1 — cancelled
    {
        condition: (input) => input.feature?.status === 'cancelled',
        dispatch: null,
        rowId: 'B1',
        chain: false,
        stop: true,
        stopReason: 'feature cancelled',
        requiresConfirmation: false,
    },
    // B2 — done
    {
        condition: (input) => input.feature?.status === 'done',
        dispatch: null,
        rowId: 'B2',
        chain: false,
        stop: true,
        stopReason: 'feature already done',
        requiresConfirmation: false,
    },
    // B3 — frontier task exists → recurse TABLE A
    {
        condition: (input) => {
            const tasks = input.feature?.tasks ?? [];
            return tasks.some((t) => ['backlog', 'todo', 'wip', 'testing', 'blocked'].includes(t.status));
        },
        dispatch: null, // Handled specially by resolveStage — picks frontier task
        rowId: 'B3',
        chain: false,
        stop: false,
        requiresConfirmation: false,
    },
    // B4 — no frontier, feature backlog, AC invalid
    {
        condition: (input) => {
            if (input.feature?.status !== 'backlog') return false;
            const open = (input.feature?.tasks ?? []).filter((t) =>
                ['backlog', 'todo', 'wip', 'testing', 'blocked'].includes(t.status),
            );
            return open.length === 0;
        },
        dispatch: null, // stop row — resolveFeature returns before invoking dispatch
        rowId: 'B4',
        chain: false,
        stop: true,
        stopReason: 'feature needs description and AC decomposition',
        requiresConfirmation: true,
    },
    // B5 — no frontier, valid AC but zero tasks
    {
        condition: (input) => {
            if (
                input.feature?.status === 'blocked' ||
                input.feature?.status === 'cancelled' ||
                input.feature?.status === 'done'
            )
                return false;
            const tasks = input.feature?.tasks ?? [];
            const open = tasks.filter((t) => !['done', 'cancelled'].includes(t.status));
            return open.length === 0 && tasks.length === 0;
        },
        dispatch: null, // stop row — resolveFeature returns before invoking dispatch
        rowId: 'B5',
        chain: false,
        stop: true,
        stopReason: 'no tasks created yet — run dev-plan to decompose',
        requiresConfirmation: true,
    },
    // B6 — all tasks done, feature active/verifying → wrapall
    {
        condition: (input) => {
            if (!input.feature) return false;
            if (!['active', 'verifying'].includes(input.feature.status)) return false;
            const tasks = input.feature?.tasks ?? [];
            return tasks.length > 0 && tasks.every((t) => ['done', 'cancelled'].includes(t.status));
        },
        dispatch: (input) => `/sp:dev-wrapall --feature ${input.feature?.id ?? ''}`,
        rowId: 'B6',
        chain: false,
        stop: false,
        requiresConfirmation: true,
    },
    // B7 — mixed cancelled/done only
    {
        condition: (input) => {
            if (!input.feature) return false;
            const tasks = input.feature?.tasks ?? [];
            if (tasks.length === 0) return false;
            return tasks.every((t) => ['done', 'cancelled'].includes(t.status));
        },
        dispatch: null,
        rowId: 'B7',
        chain: false,
        stop: true,
        stopReason: 'all tasks are done or cancelled — no action needed',
        requiresConfirmation: false,
    },
    // B8 — blocked
    {
        condition: (input) => input.feature?.status === 'blocked',
        dispatch: null,
        rowId: 'B8',
        chain: false,
        stop: true,
        stopReason: 'feature is blocked — resolve blocker first',
        requiresConfirmation: false,
    },
];

// ─── TABLE C light-gate short-circuit (routing-table.md §3) ─────────────

// Note: no `condition` field — TABLE C rows encode external runtime checks
// (lint failures, test failures, rule findings) that this pure adapter cannot
// evaluate. Rows are only consumed via C_REDIRECT_TABLE lookup, never matched.
interface TableCRow {
    redirectDispatch: string;
    rowId: string;
    probeRows: string[];
}

const TABLE_C: TableCRow[] = [
    {
        // C1 — spur task check L3 findings: external check, not evaluable here
        redirectDispatch: '/sp:dev-refine {wbs} --auto',
        rowId: 'C1',
        probeRows: ['A1', 'A3', 'A5'],
    },
    {
        // C2 — lint failures: requires runtime check
        redirectDispatch: '/sp:dev-fixall',
        rowId: 'C2',
        probeRows: ['A3', 'A5'],
    },
    {
        // C3 — test failures: requires runtime check
        redirectDispatch: '/sp:dev-unit {wbs} --auto',
        rowId: 'C3',
        probeRows: ['A5', 'A6'],
    },
    {
        // C4 — rule findings: requires spur rule run
        redirectDispatch: null as unknown as string, // HITL stop
        rowId: 'C4',
        probeRows: ['A3', 'A5', 'A6'],
    },
    {
        // C5 — verdict FAIL pointing at coverage
        redirectDispatch: '/sp:dev-unit {wbs}',
        rowId: 'C5',
        probeRows: ['A6'],
    },
];

// ─── Table C helpers ────────────────────────────────────────────────────

const C_REDIRECT_TABLE: Record<string, TableCRow> = {};
for (const row of TABLE_C) {
    for (const pr of row.probeRows) {
        C_REDIRECT_TABLE[pr] = row;
    }
}

export function getTableCRedirect(rowId: string): TableCRow | undefined {
    return C_REDIRECT_TABLE[rowId];
}

// ─── Core resolution ────────────────────────────────────────────────────

/**
 * Pick the best frontier task from a feature's task list (TABLE B3 algorithm).
 */
export function pickFrontierTask(tasks: TaskSignal[]): TaskSignal | null {
    const OPEN_STATUSES: Record<string, number> = {
        todo: 0,
        backlog: 1,
        wip: 2,
        testing: 3,
        blocked: 4,
    };
    const candidates = tasks.filter((t) => {
        const rank = OPEN_STATUSES[t.status];
        if (rank === undefined) return false;
        // Exclude tasks with blocked-by-dep (not all dependencies done)
        const deps = t.dependencies ?? [];
        if (deps.length > 0 && deps.some((d) => d.status !== 'done')) return false;
        return true;
    });
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
        const rankA = OPEN_STATUSES[a.status] ?? 99;
        const rankB = OPEN_STATUSES[b.status] ?? 99;
        if (rankA !== rankB) return rankA - rankB;
        return a.wbs.localeCompare(b.wbs);
    });
    return candidates[0] ?? null;
}

/**
 * Build the unmet dependencies list for the A2 block message.
 */
export function unmetDependencies(task: TaskSignal): string[] {
    return (task.dependencies ?? []).filter((d) => d.status !== 'done').map((d) => d.wbs);
}

/**
 * Resolve a task WBS or feature id to the next canonical stage.
 *
 * Implements the TABLE A/B/C algorithm from routing-table.md.
 * Returns a StageResolution describing the selected stage (or stop reason).
 */
export function resolveStage(input: ResolutionInput): StageResolution {
    // Feature mode
    if (input.feature != null) {
        return resolveFeature(input);
    }

    // Task mode — TABLE A
    if (input.task != null) {
        return resolveTask(input);
    }

    return {
        stage: null,
        target: input.target,
        status: 'unknown',
        tableRow: null,
        reason: 'no target resolved — pass a task WBS or feature id',
        reasonKind: 'usage',
        requiresConfirmation: false,
        chain: false,
        dispatchCommand: null,
    };
}

function resolveTask(input: ResolutionInput): StageResolution {
    if (input.task == null) throw new Error('resolveTask called without task');
    const task = input.task;
    const wbs = task.wbs;

    // Apply TABLE A rows in order (A4 fires before A5 for wip+checkpoint;
    // A5 catches wip without checkpoint since A4's condition is narrower)
    for (const row of TABLE_A) {
        if (!row.condition(input)) continue;

        // Build the dispatch command
        let dispatchCmd: string | null = row.dispatch;
        if (dispatchCmd) {
            dispatchCmd = dispatchCmd.replace(/\{wbs\}/g, wbs);
        }

        // Apply flag forwarding
        if (input.once && dispatchCmd) {
            dispatchCmd = dispatchCmd.replace(/ --next/g, '');
        }
        if (input.auto && dispatchCmd && !dispatchCmd.includes('--auto')) {
            dispatchCmd += ' --auto';
        }
        if (input.fullMode && dispatchCmd) {
            if (dispatchCmd.includes('--mode implement') || dispatchCmd.includes('--next')) {
                dispatchCmd = `/sp:dev-run ${wbs} --mode full`;
            }
        }

        // Map dispatch command → canonical stage id, first match wins.
        //
        // Patterns, not substrings: the run routes carry the WBS between the verb
        // and the flag (`/sp:dev-run 0104 --mode implement`), so the old
        // `'run --mode'` substring key could never match and every A3/A4/A5
        // dispatch resolved to a null stage record — silently dropping the
        // implement stage's gates, retry and model policy from the resolution.
        const STAGE_BY_DISPATCH: Array<{ pattern: RegExp; stage: string }> = [
            { pattern: /dev-refine/, stage: 'refine' },
            { pattern: /dev-verify/, stage: 'verify' },
            { pattern: /dev-wrap/, stage: 'wrap' },
            { pattern: /dev-handover/, stage: 'handover' },
            { pattern: /dev-run\b[^\n]*--mode/, stage: 'implement' },
            { pattern: /dev-run\b[^\n]*--continue/, stage: 'implement' },
            { pattern: /dev-unit/, stage: 'test' },
            { pattern: /dev-fixall/, stage: 'fixall' },
            // Pipeline quality-gate hops share the fixall repair surface.
            { pattern: /test-fix|test-recheck|quality-gate/, stage: 'quality-gate' },
        ];
        let stageId: string | undefined;
        if (dispatchCmd) {
            for (const { pattern, stage: sid } of STAGE_BY_DISPATCH) {
                if (pattern.test(dispatchCmd)) {
                    stageId = sid;
                    break;
                }
            }
        }
        const stage = stageId ? (getStage(stageId) ?? null) : null;

        if (row.stop) {
            const stopReason = row.stopReason ?? 'no route';
            return {
                stage: null,
                target: wbs,
                status: task.status,
                tableRow: row.rowId,
                reason: stopReason,
                reasonKind: row.rowId === 'A2' ? 'blocked' : 'no-route',
                requiresConfirmation: row.requiresConfirmation,
                chain: row.chain,
                dispatchCommand: null,
                blocker: row.rowId === 'A2' ? `unmet deps: ${unmetDependencies(task).join(', ')}` : undefined,
                nextObservableOutcome:
                    row.rowId === 'A2'
                        ? 'resolve open dependencies'
                        : row.rowId === 'A7'
                          ? 'handover document created'
                          : row.rowId === 'A9'
                            ? 'no action needed'
                            : undefined,
            };
        }

        const OUTCOME_BY_ROW: Record<string, string> = {
            A1: 'refined task with filled sections',
            A3: 'code changes implemented',
            A4: 'implementation resumed from checkpoint',
            A5: 'implementation continued',
            A6: 'verification verdict (PASS/PARTIAL/FAIL)',
            A8: 'learnings recorded, doc synced',
        };

        const REASON_BY_ROW: Record<string, string> = {
            A1: 'backlog — needs refinement',
            A3: 'todo — ready to implement',
            A4: 'wip — resume from checkpoint',
            A5: 'wip — continue implementing',
            A6: 'testing — verify results',
            A8: 'done — wrap up',
        };

        return {
            stage,
            target: wbs,
            status: task.status,
            tableRow: row.rowId,
            reason: REASON_BY_ROW[row.rowId] ?? 'dispatch',
            reasonKind: 'dispatch',
            requiresConfirmation: row.requiresConfirmation,
            chain: row.chain,
            dispatchCommand: dispatchCmd,
            nextObservableOutcome: OUTCOME_BY_ROW[row.rowId],
        };
    }

    // No row matched
    return {
        stage: null,
        target: wbs,
        status: task.status,
        tableRow: null,
        reason: `no route for ${wbs} (status=${task.status})`,
        reasonKind: 'no-route',
        requiresConfirmation: false,
        chain: false,
        dispatchCommand: null,
    };
}
function resolveFeature(input: ResolutionInput): StageResolution {
    if (input.feature == null) throw new Error('resolveFeature called without feature');
    const feature = input.feature;

    for (const row of TABLE_B) {
        if (!row.condition(input)) continue;

        // B3: frontier task → recurse TABLE A on the picked task
        if (row.rowId === 'B3') {
            const frontier = pickFrontierTask(feature.tasks ?? []);
            if (!frontier) {
                return {
                    stage: null,
                    target: feature.id,
                    status: feature.status,
                    tableRow: 'B3',
                    reason: 'no frontier task found after condition matched — inconsistency',
                    reasonKind: 'error',
                    requiresConfirmation: false,
                    chain: false,
                    dispatchCommand: null,
                };
            }
            const taskInput: ResolutionInput = {
                target: frontier.wbs,
                task: frontier,
                feature: input.feature,
                dryRun: input.dryRun,
                once: input.once,
                auto: input.auto,
                fullMode: input.fullMode,
            };
            return resolveTask(taskInput);
        }

        if (row.stop) {
            return {
                stage: null,
                target: feature.id,
                status: feature.status,
                tableRow: row.rowId,
                reason: row.stopReason ?? 'stop',
                reasonKind: 'blocked',
                requiresConfirmation: row.requiresConfirmation,
                chain: false,
                dispatchCommand: null,
                blocker: row.stopReason,
            };
        }

        const dispatchCmd = row.dispatch?.(input);
        const stage = dispatchCmd?.includes('wrapall') ? getStage('wrap') : null;

        return {
            stage: stage ?? null,
            target: feature.id,
            status: feature.status,
            tableRow: row.rowId,
            reason: row.rowId === 'B6' ? 'all tasks done — wrap up feature' : 'feature route',
            reasonKind: 'dispatch',
            requiresConfirmation: row.requiresConfirmation,
            chain: false,
            dispatchCommand: dispatchCmd,
            nextObservableOutcome: row.rowId === 'B6' ? 'feature transition or wrap' : undefined,
        };
    }

    return {
        stage: null,
        target: feature.id,
        status: feature.status,
        tableRow: null,
        reason: `no route for feature ${feature.id}`,
        reasonKind: 'no-route',
        requiresConfirmation: false,
        chain: false,
        dispatchCommand: null,
    };
}

// ─── Utility: display stage help ────────────────────────────────────────

export function renderHelp(): string {
    const lines: string[] = [
        'stage-registry-adapter — dev-next golden-path adapter',
        '',
        'Usage:',
        '  bun plugins/sp/scripts/stage-registry-adapter.ts \\',
        '    --wbs <wbs> [--dry-run] [--auto] [--once] [--full]',
        '  bun plugins/sp/scripts/stage-registry-adapter.ts \\',
        '    --feature <id> [--dry-run] [--auto]',
        '  bun plugins/sp/scripts/stage-registry-adapter.ts --list-stages',
        '  bun plugins/sp/scripts/stage-registry-adapter.ts --help',
        '',
        'Options:',
        '  --wbs <wbs>            Task WBS to resolve (digits)',
        '  --feature <id>         Feature id to resolve (e.g. O)',
        '  --dry-run              Print plan without dispatching',
        '  --auto                 Forward --auto to dispatched commands',
        '  --once                 Suppress --next chain',
        '  --full                 Use --mode full for implement',
        '  --list-stages          List all registered stages',
        '  --help                 Show this message',
        '',
        'Registered stages:',
    ];
    for (const s of REGISTERED_STAGES) {
        const aliases = s.aliases?.length ? ` (${s.aliases.join(', ')})` : '';
        lines.push(`  ${s.id}${aliases} — ${s.description}`);
    }
    return lines.join('\n');
}

// ─── CLI entry point ────────────────────────────────────────────────────

export interface CliArgs {
    wbs?: string;
    feature?: string;
    taskStatus?: string;
    dryRun: boolean;
    auto: boolean;
    once: boolean;
    full: boolean;
    listStages: boolean;
    help: boolean;
}

/** Result of a CLI invocation. */
export interface CliResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export function parseCliArgs(argv: string[]): CliArgs {
    const args = argv;
    let wbs: string | undefined;
    let feature: string | undefined;
    let taskStatus: string | undefined;
    let dryRun = false;
    let auto = false;
    let once = false;
    let full = false;
    let listStages = false;
    let help = false;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg == null) continue;
        if (arg === '--wbs') {
            wbs = args[++i];
        } else if (arg === '--feature') {
            feature = args[++i];
        } else if (arg === '--task-status') {
            taskStatus = args[++i];
        } else if (arg === '--dry-run') {
            dryRun = true;
        } else if (arg === '--auto') {
            auto = true;
        } else if (arg === '--once') {
            once = true;
        } else if (arg === '--full') {
            full = true;
        } else if (arg === '--list-stages') {
            listStages = true;
        } else if (arg === '--help') {
            help = true;
        }
    }

    return { wbs, feature, taskStatus, dryRun, auto, once, full, listStages, help };
}

/**
 * Format a resolved stage result as human-readable output lines.
 * Exported for testing — separates presentation from I/O.
 */
export function formatStageResult(result: StageResolution): string[] {
    const lines = [
        `dev-next: ${result.reasonKind === 'dispatch' ? 'dispatch' : result.reasonKind}`,
        `  target: ${result.target}  status=${result.status}  table=${result.tableRow ?? '\u2014'}`,
        `  reason: ${result.reason}`,
    ];
    if (result.blocker) {
        lines.push(`  blocker: ${result.blocker}`);
    }
    if (result.dispatchCommand) {
        lines.push(`  dispatch: ${result.dispatchCommand}`);
    }
    if (result.chain) {
        lines.push('  chain: yes');
    }
    if (result.requiresConfirmation) {
        lines.push('  confirmation: required');
    }
    if (result.nextObservableOutcome) {
        lines.push(`  next outcome: ${result.nextObservableOutcome}`);
    }
    return lines;
}

export function runCli(argv: string[], opts?: { resolve?: (input: ResolutionInput) => StageResolution }): CliResult {
    const parsed = parseCliArgs(argv);
    const resolve = opts?.resolve ?? resolveStage;

    if (parsed.help) {
        return { exitCode: 0, stdout: renderHelp(), stderr: '' };
    }

    if (parsed.listStages) {
        const stagesList = listStages();
        const stageLines = stagesList.map((s) => `${s.stage_id}\t${s.command}\t${s.skill}`);
        return { exitCode: 0, stdout: `${stageLines.join('\n')}\n`, stderr: '' };
    }

    if (!parsed.wbs && !parsed.feature) {
        return {
            exitCode: 1,
            stdout: '',
            stderr: `error: specify --wbs <wbs> or --feature <id>\n\n${renderHelp()}`,
        };
    }

    // Build resolution input from CLI args (note: no live corpus access in CLI mode)
    const input: ResolutionInput = {
        target: parsed.wbs ?? parsed.feature ?? '',
        wbs: parsed.wbs,
        dryRun: parsed.dryRun,
        once: parsed.once,
        auto: parsed.auto,
        fullMode: parsed.full,
        task: parsed.wbs ? { wbs: parsed.wbs, status: parsed.taskStatus ?? 'unknown', dependencies: [] } : undefined,
        feature: parsed.feature ? { id: parsed.feature, status: 'active', tasks: [] } : undefined,
    };

    try {
        const result = resolve(input);
        const lines = formatStageResult(result);
        return { exitCode: result.reasonKind === 'dispatch' ? 0 : 2, stdout: `${lines.join('\n')}\n`, stderr: '' };
    } catch (e) {
        return { exitCode: 1, stdout: '', stderr: `error: ${(e as Error).message}` };
    }
}

/**
 * Entry-point boot — runs the CLI using process.argv. Extracted so tests can
 * call it directly without spawning a subprocess (which would not contribute
 * to the test isolate's V8 coverage counters).
 *
 * No `import.meta.main` guard here; the test calls this directly with
 * `process.exit` swapped for a spy. Production entry point is
 * `plugins/sp/scripts/main.ts` which calls this when `import.meta.main`.
 */
export function bootMain(
    argv: string[] = process.argv,
    opts?: {
        run?: (a: string[]) => CliResult;
        exit?: (code: number) => void;
        stdout?: { write: (data: string) => void };
        stderr?: { write: (data: string) => void };
    },
): void {
    const cliRunner = opts?.run ?? runCli;
    const doExit = opts?.exit ?? process.exit;
    const stdout = opts?.stdout ?? process.stdout;
    const stderr = opts?.stderr ?? process.stderr;
    const result = cliRunner(argv);
    if (result.stdout) stdout.write(result.stdout);
    if (result.stderr) stderr.write(result.stderr);
    doExit(result.exitCode);
}

if (import.meta.main) {
    bootMain();
}
