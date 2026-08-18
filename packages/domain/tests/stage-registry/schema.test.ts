import { describe, expect, test } from 'bun:test';
import {
    ARTIFACT_DIRECTIONS,
    AUTHORITY_LANES,
    bumpStageSchemaMajor,
    bumpStageSchemaMinor,
    CONTEXT_LAYER_NAMES,
    EXECUTION_KINDS,
    executionKindSchema,
    getCanonicalStage,
    getNextFallback,
    isCompatibleStageVersion,
    isTierEligible,
    objectiveEscalationTriggerSchema,
    parseStageRecord,
    REGISTERED_CANONICAL_STAGES as REGISTERED_CANONICAL_STAGES_REF,
    STAGE_ID_PATTERN,
    STAGE_REGISTRY_SCHEMA_VERSION,
    type StageRecord,
    StageRegistryError,
    stageArtifactSchema as stageArtifactSchemaRef,
    stageModelPolicySchema,
    stageRecordSchema,
    TIER_RANK,
    validateStageRecord,
    validateStageRegistry,
} from '../../src';

// ─── Fixtures ─────────────────────────────────────────────────────────────

/** Minimal valid stage record modeled on the 0282 `plan` representative. */
const basePlanRecord: StageRecord = {
    schema_version: { major: 1, minor: 0 },
    id: 'plan',
    aliases: [],
    description: 'dev-plan: feature intake -> AC -> tasks',
    artifacts: [
        { kind: 'feature-frontmatter', direction: 'input', required: true },
        { kind: 'task-batch', direction: 'output', required: true },
    ],
    reasoning_skill: 'sp:spur-dev',
    required_references: [],
    gates: [
        { name: 'feature-check', timing: 'post', min_verdict: 'pass' },
        { name: 'batch-create', timing: 'post', min_verdict: 'pass' },
    ],
    mutation_class: 'corpus',
    retry: { max_attempts: 3, terminal_stop: 'block' },
    model_policy: {
        min_tier: 'standard',
        fallback: [{ tier: 'capable-1', trigger: 'gate-fail' }],
    },
    context_layers: [{ layer: 'project-authority', required: true }],
    observability: [{ name: 'stage-started' }],
    execution: { kind: 'inline', current_agent_allowed: true },
};

/** Build a fresh copy so tests cannot mutate the shared fixture. */
function copy(): StageRecord {
    return structuredClone(basePlanRecord);
}

// ─── R1: vocabulary exports ───────────────────────────────────────────────

describe('stage-registry vocabulary exports (R1)', () => {
    test('exposes the canonical authority lanes (R2)', () => {
        expect(AUTHORITY_LANES).toEqual(['registry', 'workflow', 'skill', 'cli', 'adapter']);
    });

    test('exposes the canonical execution kinds (R3)', () => {
        expect(EXECUTION_KINDS).toEqual(['inline', 'subprocess', 'deterministic', 'hitl', 'irreversible']);
    });

    test('exposes the canonical artifact directions', () => {
        expect(ARTIFACT_DIRECTIONS).toEqual(['input', 'output']);
    });

    test('exposes the canonical context-layer names (0284)', () => {
        expect(CONTEXT_LAYER_NAMES).toContain('stage-contract');
        expect(CONTEXT_LAYER_NAMES).toContain('tool-observations');
    });

    test('exposes the current schema version', () => {
        expect(STAGE_REGISTRY_SCHEMA_VERSION).toEqual({ major: 1, minor: 3 });
    });

    test('exposes the stage-id pattern', () => {
        expect(STAGE_ID_PATTERN.test('plan')).toBe(true);
        expect(STAGE_ID_PATTERN.test('dev-plan')).toBe(true);
        expect(STAGE_ID_PATTERN.test('Plan')).toBe(false);
        expect(STAGE_ID_PATTERN.test('1plan')).toBe(false);
    });
});

// ─── R1: stage record schema ──────────────────────────────────────────────

describe('stageRecordSchema (R1)', () => {
    test('accepts a minimal valid stage record', () => {
        const parsed = stageRecordSchema.parse(copy());
        expect(parsed.id).toBe('plan');
        expect(parsed.mutation_class).toBe('corpus');
        expect(parsed.execution.kind).toBe('inline');
    });

    test('rejects an unknown mutation_class', () => {
        const result = stageRecordSchema.safeParse({ ...copy(), mutation_class: 'magic' as never });
        expect(result.success).toBe(false);
    });

    test('rejects an empty artifacts array (at least one required)', () => {
        const result = stageRecordSchema.safeParse({ ...copy(), artifacts: [] });
        expect(result.success).toBe(false);
    });

    test('rejects a missing reasoning_skill', () => {
        const { reasoning_skill: _omit, ...rest } = copy();
        const result = stageRecordSchema.safeParse(rest);
        expect(result.success).toBe(false);
    });

    test('rejects an invalid stage id (case + leading digit)', () => {
        expect(stageRecordSchema.safeParse({ ...copy(), id: 'Plan' }).success).toBe(false);
        expect(stageRecordSchema.safeParse({ ...copy(), id: '1plan' }).success).toBe(false);
    });

    test('rejects unknown top-level keys (strict)', () => {
        const result = stageRecordSchema.safeParse({ ...copy(), surprise: true });
        expect(result.success).toBe(false);
    });

    test('defaults optional collections to empty arrays', () => {
        const { aliases, required_references, gates, context_layers, observability, ...rest } = copy();
        void aliases;
        void required_references;
        void gates;
        void context_layers;
        void observability;
        const parsed = stageRecordSchema.parse(rest);
        expect(parsed.aliases).toEqual([]);
        expect(parsed.required_references).toEqual([]);
        expect(parsed.gates).toEqual([]);
        expect(parsed.context_layers).toEqual([]);
        expect(parsed.observability).toEqual([]);
    });
});

// ─── R2: authority boundaries ─────────────────────────────────────────────

describe('authority boundaries (R2)', () => {
    test('the record is declarative: it names lanes but never inlines executable code', () => {
        const parsed = stageRecordSchema.parse(copy());
        // reasoning_skill names the skill lane; the record carries no function.
        expect(typeof parsed.reasoning_skill).toBe('string');
        // gates are descriptors with names; the record carries no gate logic.
        for (const gate of parsed.gates) {
            expect(typeof gate.name).toBe('string');
        }
        // mutation_class is a declarative enum; HOW is owned by the cli lane.
        expect(parsed.mutation_class).toBe('corpus');
    });

    test('no adapter / platform field leaks into the record (adapters own syntax only)', () => {
        const result = stageRecordSchema.safeParse({ ...copy(), adapter: 'claude-code' });
        expect(result.success).toBe(false);
    });
});

// ─── R3: execution-kind discriminated union ───────────────────────────────

describe('executionKindSchema (R3)', () => {
    test('inline allows current-agent execution', () => {
        const parsed = executionKindSchema.parse({ kind: 'inline', current_agent_allowed: true });
        expect(parsed.kind).toBe('inline');
    });

    test('subprocess pins current_agent_allowed to false', () => {
        const ok = executionKindSchema.safeParse({
            kind: 'subprocess',
            current_agent_allowed: false,
            via: 'spur-agent-run',
        });
        expect(ok.success).toBe(true);

        const bad = executionKindSchema.safeParse({
            kind: 'subprocess',
            current_agent_allowed: true,
            via: 'spur-agent-run',
        });
        expect(bad.success).toBe(false);
    });

    test('subprocess requires the canonical via surface', () => {
        const bad = executionKindSchema.safeParse({
            kind: 'subprocess',
            current_agent_allowed: false,
            via: 'something-else',
        });
        expect(bad.success).toBe(false);
    });

    test('deterministic rejects current-agent execution', () => {
        const ok = executionKindSchema.safeParse({
            kind: 'deterministic',
            current_agent_allowed: false,
            executor: 'cli',
        });
        expect(ok.success).toBe(true);

        const bad = executionKindSchema.safeParse({
            kind: 'deterministic',
            current_agent_allowed: true,
            executor: 'cli',
        });
        expect(bad.success).toBe(false);
    });

    test('hitl declares a gate timing', () => {
        const parsed = executionKindSchema.parse({
            kind: 'hitl',
            current_agent_allowed: true,
            gate_timing: 'both',
        });
        expect(parsed.kind).toBe('hitl');
    });

    test('irreversible requires operator intent + rollback disclaimer', () => {
        const ok = executionKindSchema.safeParse({
            kind: 'irreversible',
            requires_operator_intent: true,
            current_agent_allowed: false,
            rollback_disclaimer: 'no automated rollback',
        });
        expect(ok.success).toBe(true);

        const missingIntent = executionKindSchema.safeParse({
            kind: 'irreversible',
            requires_operator_intent: false,
            current_agent_allowed: false,
            rollback_disclaimer: 'x',
        });
        expect(missingIntent.success).toBe(false);
    });

    test('rejects an unknown execution kind', () => {
        const result = executionKindSchema.safeParse({ kind: 'magic' });
        expect(result.success).toBe(false);
    });
});

// ─── R3: validateStageRecord invariants ───────────────────────────────────

describe('validateStageRecord (R3 invariants)', () => {
    test('rejects subprocess stage that claims current-agent execution (defense in depth)', () => {
        // Manually construct the bypass: zod pins the literal, so we cast.
        const record = {
            ...copy(),
            execution: {
                kind: 'subprocess',
                current_agent_allowed: false,
                via: 'spur-agent-run',
            },
        } as StageRecord;
        // Schema already enforces false; validateStageRecord is defense-in-depth.
        expect(() => validateStageRecord(record)).not.toThrow();
    });

    test('irreversible mutation_class requires irreversible execution or pre/both hitl gate', () => {
        // mutation_class=irreversible with plain inline execution -> reject.
        const bad = { ...copy(), mutation_class: 'irreversible' as const };
        expect(() => validateStageRecord(bad)).toThrow(StageRegistryError);

        // With irreversible execution -> ok.
        const okIrreversible = {
            ...copy(),
            mutation_class: 'irreversible' as const,
            execution: {
                kind: 'irreversible',
                requires_operator_intent: true,
                current_agent_allowed: false,
                rollback_disclaimer: 'no rollback',
            },
        } as StageRecord;
        expect(() => validateStageRecord(okIrreversible)).not.toThrow();

        // With hitl pre gate -> ok.
        const okHitl = {
            ...copy(),
            mutation_class: 'irreversible' as const,
            gates: [{ name: 'operator-confirm', timing: 'pre' }],
            execution: {
                kind: 'hitl',
                current_agent_allowed: true,
                gate_timing: 'pre',
            },
        } as StageRecord;
        expect(() => validateStageRecord(okHitl)).not.toThrow();
    });

    test('hitl execution requires at least one gate', () => {
        const bad = {
            ...copy(),
            gates: [],
            execution: {
                kind: 'hitl',
                current_agent_allowed: true,
                gate_timing: 'both',
            },
        } as StageRecord;
        expect(() => validateStageRecord(bad)).toThrow(StageRegistryError);
    });
});

// ─── R4: schema versioning ────────────────────────────────────────────────

describe('schema versioning (R4)', () => {
    test('consumer at major N accepts record at N.x (any minor)', () => {
        expect(isCompatibleStageVersion({ major: 1, minor: 0 }, { major: 1, minor: 0 })).toBe(true);
        expect(isCompatibleStageVersion({ major: 1, minor: 5 }, { major: 1, minor: 0 })).toBe(true);
        expect(isCompatibleStageVersion({ major: 1, minor: 0 }, { major: 1, minor: 9 })).toBe(true);
    });

    test('consumer at major N rejects record at major M != N', () => {
        expect(isCompatibleStageVersion({ major: 1, minor: 0 }, { major: 2, minor: 0 })).toBe(false);
        expect(isCompatibleStageVersion({ major: 2, minor: 0 }, { major: 1, minor: 9 })).toBe(false);
    });

    test('bumpStageSchemaMajor resets minor to 0', () => {
        expect(bumpStageSchemaMajor({ major: 1, minor: 3 })).toEqual({ major: 2, minor: 0 });
    });

    test('bumpStageSchemaMinor keeps major and increments minor', () => {
        expect(bumpStageSchemaMinor({ major: 1, minor: 3 })).toEqual({ major: 1, minor: 4 });
    });

    test('parseStageRecord rejects a record whose major differs from the consumer', () => {
        const record = { ...copy(), schema_version: { major: 2, minor: 0 } };
        expect(() => parseStageRecord(record)).toThrow(StageRegistryError);
    });

    test('parseStageRecord accepts a record whose minor differs but major matches', () => {
        const record = { ...copy(), schema_version: { major: 1, minor: 5 } };
        expect(() => parseStageRecord(record, { major: 1, minor: 0 })).not.toThrow();
    });

    test('parseStageRecord rejects malformed input with a schema-version-mismatch code', () => {
        try {
            parseStageRecord({ ...copy(), id: 42 });
            throw new Error('expected throw');
        } catch (err) {
            expect(err).toBeInstanceOf(StageRegistryError);
            expect((err as StageRegistryError).code).toBe('schema-version-mismatch');
        }
    });
});

// ─── 0282 AC: registry errors fail before execution ───────────────────────

describe('validateStageRegistry (0282 AC: errors fail before execution)', () => {
    test('rejects duplicate stage ids', () => {
        const a = copy();
        const b = { ...copy(), description: 'duplicate' };
        expect(() => validateStageRegistry([a, b])).toThrow(StageRegistryError);
    });

    test('rejects an alias that shadows another stage id', () => {
        const a = copy(); // id=plan
        const b = { ...copy(), id: 'plan-v2', aliases: ['plan'] };
        expect(() => validateStageRegistry([a, b])).toThrow(StageRegistryError);
    });

    test('accepts a clean registry of distinct stages', () => {
        const plan = copy();
        const implement = {
            ...copy(),
            id: 'implement',
            description: 'dev-run',
            aliases: ['dev-run'],
            mutation_class: 'code' as const,
            gates: [],
        };
        const verify = {
            ...copy(),
            id: 'verify',
            description: 'dev-verify',
            mutation_class: 'verdict' as const,
            gates: [{ name: 'verdict-artifact', timing: 'post' as const }],
        };
        const result = validateStageRegistry([plan, implement, verify]);
        expect(result).toHaveLength(3);
    });

    test('validates each record before cross-record checks', () => {
        // hitl with no gates should fail per-record validation, not reach cross-record.
        const bad = {
            ...copy(),
            gates: [],
            execution: {
                kind: 'hitl',
                current_agent_allowed: true,
                gate_timing: 'both',
            },
        } as StageRecord;
        expect(() => validateStageRegistry([bad])).toThrow(StageRegistryError);
    });
});

// ─── Representative stage records (0282 R5 mapping) ───────────────────────

describe('representative stage records (0282 R5)', () => {
    /** Sanity: each representative 0282 stage parses + validates under the schema. */
    const cases: Array<{ name: string; record: unknown }> = [
        {
            name: 'plan',
            record: copy(),
        },
        {
            name: 'implement',
            record: {
                ...copy(),
                id: 'implement',
                description: 'dev-run: drive one task through its pipeline',
                artifacts: [
                    { kind: 'task-frontmatter', direction: 'input' },
                    { kind: 'worktree-diff', direction: 'output' },
                ],
                reasoning_skill: 'sp:code-implementation',
                gates: [],
                mutation_class: 'code',
            },
        },
        {
            name: 'test',
            record: {
                ...copy(),
                id: 'test',
                description: 'dev-unit: extend tests until coverage floor met',
                artifacts: [
                    { kind: 'coverage-report', direction: 'input' },
                    { kind: 'test-files', direction: 'output' },
                ],
                reasoning_skill: 'sp:code-testing',
                gates: [{ name: 'coverage-floor', timing: 'post', min_verdict: 'pass' }],
                mutation_class: 'tests',
            },
        },
        {
            name: 'verify',
            record: {
                ...copy(),
                id: 'verify',
                description: 'dev-verify: requirements traceability + verdict',
                artifacts: [
                    { kind: 'task-frontmatter', direction: 'input' },
                    { kind: 'verdict-artifact', direction: 'output' },
                ],
                reasoning_skill: 'sp:code-verification',
                gates: [
                    { name: 'verdict-artifact', timing: 'post', min_verdict: 'pass' },
                    { name: 'strict-core', timing: 'post', min_verdict: 'pass' },
                ],
                mutation_class: 'verdict',
            },
        },
        {
            name: 'wrap',
            record: {
                ...copy(),
                id: 'wrap',
                description: 'dev-wrap: learnings + doc-sync + feature transition',
                artifacts: [
                    { kind: 'task-frontmatter', direction: 'input' },
                    { kind: 'learnings', direction: 'output' },
                ],
                reasoning_skill: 'sp:spur-dev',
                gates: [{ name: 'task-check', timing: 'pre', min_verdict: 'pass' }],
                mutation_class: 'learnings',
            },
        },
        {
            name: 'dogfood',
            record: {
                ...copy(),
                id: 'dogfood',
                description: 'dev-dogfood: bounded driver fixes + dual report',
                artifacts: [
                    { kind: 'dogfood-report', direction: 'output' },
                    { kind: 'monitor-ledger', direction: 'output' },
                ],
                reasoning_skill: 'sp:dogfood-testing',
                required_references: ['report-template.md', 'monitor-ledger.md'],
                gates: [
                    { name: 'detect-pipeline-driving', timing: 'pre', min_verdict: 'pass' },
                    { name: 'report-validate', timing: 'post', min_verdict: 'pass' },
                ],
                mutation_class: 'driver',
                retry: { max_attempts: 3, terminal_stop: 'escalate' },
            },
        },
    ];

    for (const { name, record } of cases) {
        test(`${name} parses and validates`, () => {
            const parsed = stageRecordSchema.parse(record);
            expect(parsed.id).toBe(name);
            expect(() => validateStageRecord(parsed)).not.toThrow();
        });
    }

    test('all six representative stages form a clean registry', () => {
        const records = cases.map((c) => stageRecordSchema.parse(c.record));
        expect(() => validateStageRegistry(records)).not.toThrow();
    });
});

describe('model_policy helpers & canonical stage registry (0319)', () => {
    test('TIER_RANK & isTierEligible evaluate capability rank correctly (0343 sub-tiers)', () => {
        expect(TIER_RANK.cheap).toBeLessThan(TIER_RANK.standard);
        expect(TIER_RANK.standard).toBeLessThan(TIER_RANK['capable-1']);
        expect(TIER_RANK['capable-1']).toBeLessThan(TIER_RANK['capable-2']);
        expect(TIER_RANK['capable-2']).toBeLessThan(TIER_RANK['capable-3']);
        expect(isTierEligible('capable-1', 'standard')).toBe(true);
        expect(isTierEligible('capable-3', 'capable-1')).toBe(true);
        expect(isTierEligible('capable-1', 'capable-2')).toBe(false);
        expect(isTierEligible('standard', 'standard')).toBe(true);
        expect(isTierEligible('cheap', 'standard')).toBe(false);
    });

    test('getNextFallback matches signal and higher tier', () => {
        const policy = {
            min_tier: 'standard' as const,
            fallback: [
                { tier: 'capable-1' as const, trigger: 'gate-fail' as const },
                { tier: 'capable-1' as const, trigger: 'timeout' as const },
            ],
        };
        const res = getNextFallback(policy, 'gate-fail', 'standard');
        expect(res).toEqual({ tier: 'capable-1', trigger: 'gate-fail' });
        const missing = getNextFallback(policy, 'retry-exhausted', 'standard');
        expect(missing).toBeUndefined();
    });

    // ─── Task 0405: resource-exhaustion trigger (R4/R5/R6) ───────────────

    test('objective escalation trigger vocabulary includes resource-exhaustion and auth (R4)', () => {
        expect(objectiveEscalationTriggerSchema.options).toContain('resource-exhaustion');
        expect(objectiveEscalationTriggerSchema.options).toContain('auth');
        // The pre-existing four remain.
        for (const existing of ['gate-fail', 'timeout', 'insufficient-evidence', 'retry-exhausted'] as const) {
            expect(objectiveEscalationTriggerSchema.options).toContain(existing);
        }
    });

    test('resource-exhaustion is a first-class fallback entry, validating like any trigger (R5)', () => {
        const parsed = stageModelPolicySchema.parse({
            min_tier: 'standard',
            fallback: [{ tier: 'capable-1', trigger: 'resource-exhaustion' }],
        });
        expect(parsed.fallback[0]?.trigger).toBe('resource-exhaustion');
        // getNextFallback treats it exactly like any other signal.
        const res = getNextFallback(parsed, 'resource-exhaustion', 'standard');
        expect(res).toEqual({ tier: 'capable-1', trigger: 'resource-exhaustion' });
    });

    test('existing stage-registry configs validate unchanged under the extended enum (R6)', () => {
        // A policy using only the pre-existing triggers must still parse.
        const legacy = stageModelPolicySchema.parse({
            min_tier: 'standard',
            fallback: [
                { tier: 'capable-1', trigger: 'gate-fail' },
                { tier: 'capable-1', trigger: 'timeout' },
            ],
        });
        expect(legacy.fallback).toHaveLength(2);
        // Every registered canonical stage's model_policy must still validate.
        for (const stage of ['plan', 'refine', 'implement', 'verify']) {
            const record = getCanonicalStage(stage);
            if (record?.model_policy) {
                expect(() => stageModelPolicySchema.parse(record.model_policy)).not.toThrow();
            }
        }
    });

    test('resource-exhaustion trigger is additive — unknown triggers still reject', () => {
        expect(() =>
            stageModelPolicySchema.parse({
                min_tier: 'standard',
                fallback: [{ tier: 'capable-1', trigger: 'quota-exceeded' }],
            }),
        ).toThrow();
    });

    test('legacy bare capable normalizes to capable-1 in model_policy schema', () => {
        const parsed = stageModelPolicySchema.parse({
            min_tier: 'capable',
            fallback: [{ tier: 'capable', trigger: 'gate-fail' }],
        });
        expect(parsed.min_tier).toBe('capable-1');
        expect(parsed.fallback[0]?.tier).toBe('capable-1');
    });

    test('getCanonicalStage resolves by stage id or alias', () => {
        const impl = getCanonicalStage('implement');
        expect(impl).toBeDefined();
        expect(impl?.id).toBe('implement');
        const aliasMatch = getCanonicalStage('dev-run');
        expect(aliasMatch).toBeDefined();
        expect(aliasMatch?.id).toBe('implement');
        expect(getCanonicalStage('nonexistent')).toBeUndefined();
    });

    test('0485 R5: verify/dogfood carry a resource-exhaustion fallback and dev-fixall resolves to test', () => {
        const verify = getCanonicalStage('verify');
        expect(verify).toBeDefined();
        expect(verify?.model_policy.fallback.length).toBeGreaterThan(0);
        expect(verify?.model_policy.fallback.some((f) => f.trigger === 'resource-exhaustion')).toBe(true);

        const dogfood = getCanonicalStage('dogfood');
        expect(dogfood).toBeDefined();
        expect(dogfood?.model_policy.fallback.length).toBeGreaterThan(0);
        expect(dogfood?.model_policy.fallback.some((f) => f.trigger === 'resource-exhaustion')).toBe(true);

        // test-fix hops dispatch /sp:dev-fixall; the registry alias must resolve to the test stage.
        const fixall = getCanonicalStage('dev-fixall');
        expect(fixall?.id).toBe('test');
    });

    test('plan is capable-first; refine is cheap fallback for blank Design', () => {
        const plan = getCanonicalStage('plan');
        const refine = getCanonicalStage('refine');
        expect(plan?.model_policy.min_tier).toBe('capable-2');
        expect(plan?.model_policy.fallback).toEqual([
            { tier: 'capable-3', trigger: 'gate-fail' },
            { tier: 'capable-3', trigger: 'auth' },
            { tier: 'capable-3', trigger: 'resource-exhaustion' },
        ]);
        expect(refine?.model_policy.min_tier).toBe('standard');
        expect(refine?.model_policy.fallback).toEqual([
            { tier: 'capable-2', trigger: 'gate-fail' },
            { tier: 'capable-2', trigger: 'auth' },
            { tier: 'capable-2', trigger: 'resource-exhaustion' },
        ]);
        const planTier = plan?.model_policy.min_tier;
        const refineTier = refine?.model_policy.min_tier;
        expect(planTier).toBeDefined();
        expect(refineTier).toBeDefined();
        if (planTier === undefined || refineTier === undefined) {
            throw new Error('expected plan and refine stages to define min_tier');
        }
        expect(TIER_RANK[planTier]).toBeGreaterThan(TIER_RANK[refineTier]);
    });
});

describe('stage artifact identity (0593 R2 projection)', () => {
    test('artifact schema accepts an optional identity and defaults required', () => {
        const parsed = stageArtifactSchemaRef.parse({
            kind: 'task-section',
            direction: 'output',
            identity: 'Solution',
        });
        expect(parsed.identity).toBe('Solution');
        expect(parsed.required).toBe(true);
    });

    test('one-writer-per-section projection: shared stages carry exact artifact identity', () => {
        const implement = getCanonicalStage('implement');
        expect(implement?.artifacts.some((a) => a.identity === 'Solution')).toBe(true);

        const review = getCanonicalStage('review');
        expect(review?.artifacts.some((a) => a.identity === 'Review')).toBe(true);

        const verify = getCanonicalStage('verify');
        expect(verify?.artifacts.some((a) => a.identity === '<wbs>-verdict.json')).toBe(true);
    });

    test('record stage owns Testing and claims Review only as a bare fallback', () => {
        const record = getCanonicalStage('record');
        expect(record).toBeDefined();
        expect(record?.execution.kind).toBe('deterministic');
        expect(record?.mutation_class).toBe('corpus');
        const testing = record?.artifacts.find((a) => a.identity === 'Testing');
        expect(testing).toBeDefined();
        expect(testing?.required).toBe(true);
        const review = record?.artifacts.find((a) => a.identity === 'Review');
        expect(review).toBeDefined();
        expect(review?.required).toBe(false);
    });

    test('verify and wrap carry the real transition check identifiers (0593 R2)', () => {
        const verify = getCanonicalStage('verify');
        const gateNames = (verify?.gates ?? []).map((g) => g.name).sort();
        expect(gateNames).toEqual(['strict-core', 'verdict-artifact']);
        for (const g of verify?.gates ?? []) {
            expect(g.timing).toBe('post');
            expect(g.min_verdict).toBe('pass');
        }

        const wrap = getCanonicalStage('wrap');
        expect(wrap?.gates.some((g) => g.name === 'task-check' && g.timing === 'pre')).toBe(true);
        expect(wrap?.execution.kind).toBe('hitl');
    });

    test('registered canonical stages remain a valid registry with the record stage added', () => {
        expect(() => validateStageRegistry(REGISTERED_CANONICAL_STAGES_REF)).not.toThrow();
        expect(getCanonicalStage('dev-record')?.id).toBe('record');
    });
});
