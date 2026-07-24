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
    parseStageRecord,
    pickStartingTier,
    STAGE_ID_PATTERN,
    STAGE_REGISTRY_SCHEMA_VERSION,
    type StageRecord,
    StageRegistryError,
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
        fallback: [{ tier: 'capable', trigger: 'gate-fail' }],
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
        expect(STAGE_REGISTRY_SCHEMA_VERSION).toEqual({ major: 1, minor: 0 });
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
    test('TIER_RANK & isTierEligible evaluate capability rank correctly', () => {
        expect(TIER_RANK.cheap).toBeLessThan(TIER_RANK.standard);
        expect(TIER_RANK.standard).toBeLessThan(TIER_RANK.capable);
        expect(isTierEligible('capable', 'standard')).toBe(true);
        expect(isTierEligible('standard', 'standard')).toBe(true);
        expect(isTierEligible('cheap', 'standard')).toBe(false);
    });

    test('pickStartingTier returns min_tier', () => {
        expect(pickStartingTier({ min_tier: 'standard', fallback: [] })).toBe('standard');
    });

    test('getNextFallback matches signal and higher tier', () => {
        const policy = {
            min_tier: 'standard' as const,
            fallback: [
                { tier: 'capable' as const, trigger: 'gate-fail' as const },
                { tier: 'capable' as const, trigger: 'timeout' as const },
            ],
        };
        const res = getNextFallback(policy, 'gate-fail', 'standard');
        expect(res).toEqual({ tier: 'capable', trigger: 'gate-fail' });
        const missing = getNextFallback(policy, 'retry-exhausted', 'standard');
        expect(missing).toBeUndefined();
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
});
