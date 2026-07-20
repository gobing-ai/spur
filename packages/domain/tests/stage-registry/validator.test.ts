import { describe, expect, test } from 'bun:test';
import {
    passAllResolver,
    type RegistryReferenceResolver,
    type StageRecord,
    type StageTransition,
    stageRecordSchema,
    validateStageRegistryGraph,
} from '../../src';

// ─── Fixtures ─────────────────────────────────────────────────────────────

/** Minimal valid stage record modeled on the 0282 `plan` representative. */
const basePlanRecord: StageRecord = {
    schema_version: { major: 1, minor: 0 },
    id: 'plan',
    aliases: ['dev-plan'],
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

/** Build a resolver that resolves everything EXCEPT the given exclusions. */
function resolver(exclude: Partial<Record<keyof RegistryReferenceResolver, string[]>> = {}): RegistryReferenceResolver {
    return {
        hasSkill: (n) => !exclude.hasSkill?.includes(n),
        hasCommand: (n) => !exclude.hasCommand?.includes(n),
        hasGate: (n) => !exclude.hasGate?.includes(n),
        hasWorkflow: (n) => !exclude.hasWorkflow?.includes(n),
        hasAdapter: (n) => !exclude.hasAdapter?.includes(n),
        hasArtifactPath: (n) => !exclude.hasArtifactPath?.includes(n),
    };
}

/** A three-stage registry: plan -> implement -> verify. */
function threeStageRegistry(): StageRecord[] {
    const plan = copy();
    const implement: StageRecord = {
        ...copy(),
        id: 'implement',
        aliases: ['dev-run'],
        description: 'dev-run: drive one task through its pipeline',
        reasoning_skill: 'sp:code-implementation',
        gates: [],
        mutation_class: 'code',
    };
    const verify: StageRecord = {
        ...copy(),
        id: 'verify',
        aliases: ['dev-verify'],
        description: 'dev-verify: requirements traceability + verdict',
        reasoning_skill: 'sp:code-verification',
        gates: [{ name: 'verdict-artifact', timing: 'post', min_verdict: 'pass' }],
        mutation_class: 'verdict',
    };
    return [plan, implement, verify];
}

/** The canonical forward DAG for the three-stage registry. */
const forwardTransitions: StageTransition[] = [
    { from: 'plan', to: 'implement' },
    { from: 'implement', to: 'verify' },
];

// ─── R1: whole-graph load-time validation ─────────────────────────────────

describe('validateStageRegistryGraph (R1: whole-graph load-time validation)', () => {
    test('returns ok with empty diagnostics for a clean registry', () => {
        const result = validateStageRegistryGraph(threeStageRegistry(), {
            resolver: passAllResolver,
            transitions: forwardTransitions,
        });
        expect(result.ok).toBe(true);
        expect(result.diagnostics).toEqual([]);
    });

    test('validates the whole graph in one non-throwing pass', () => {
        const result = validateStageRegistryGraph([], { resolver: passAllResolver });
        expect(result.ok).toBe(true);
        expect(result.stage_ids).toEqual([]);
    });

    test('collects ALL defects instead of throwing on the first', () => {
        // Two independent defects: missing skill (record 1) + missing gate (record 2).
        // No aliases, no inherited gates, so no alias-shadow or extra-gate noise.
        const records = [
            { ...copy(), aliases: [], gates: [], reasoning_skill: 'sp:missing-skill' },
            { ...copy(), id: 'bad-gate', aliases: [], gates: [{ name: 'no-such-gate', timing: 'post' as const }] },
        ];
        const result = validateStageRegistryGraph(records, {
            resolver: resolver({ hasSkill: ['sp:missing-skill'], hasGate: ['no-such-gate'] }),
        });
        expect(result.ok).toBe(false);
        expect(result.diagnostics).toHaveLength(2);
        const codes = result.diagnostics.map((d) => d.code);
        expect(codes).toContain('unknown-dependency');
        expect(codes).toContain('missing-gate');
    });
});

// ─── R2: cross-reference diagnostics ──────────────────────────────────────

describe('validateStageRegistryGraph (R2: actionable cross-reference diagnostics)', () => {
    test('reports a missing skill with kind=skill and the failing ref', () => {
        const records = [{ ...copy(), reasoning_skill: 'sp:ghost' }];
        const result = validateStageRegistryGraph(records, {
            resolver: resolver({ hasSkill: ['sp:ghost'] }),
        });
        expect(result.ok).toBe(false);
        const diag = result.diagnostics.find((d) => d.kind === 'skill');
        expect(diag).toBeDefined();
        expect(diag?.code).toBe('unknown-dependency');
        expect(diag?.ref).toBe('sp:ghost');
        expect(diag?.stageId).toBe('plan');
        expect(diag?.message).toContain('sp:ghost');
    });

    test('reports a missing command alias with kind=command', () => {
        const records = [{ ...copy(), aliases: ['dev-plan', 'ghost-cmd'] }];
        const result = validateStageRegistryGraph(records, {
            resolver: resolver({ hasCommand: ['dev-plan', 'ghost-cmd'] }),
        });
        expect(result.ok).toBe(false);
        const diag = result.diagnostics.find((d) => d.kind === 'command' && d.ref === 'ghost-cmd');
        expect(diag).toBeDefined();
        expect(diag?.code).toBe('unknown-dependency');
        expect(diag?.stageId).toBe('plan');
    });

    test('reports a missing gate with kind=gate and code=missing-gate', () => {
        const records = [{ ...copy(), gates: [{ name: 'ghost-gate', timing: 'post' as const }] }];
        const result = validateStageRegistryGraph(records, {
            resolver: resolver({ hasGate: ['ghost-gate'] }),
        });
        expect(result.ok).toBe(false);
        const diag = result.diagnostics.find((d) => d.kind === 'gate');
        expect(diag).toBeDefined();
        expect(diag?.code).toBe('missing-gate');
        expect(diag?.ref).toBe('ghost-gate');
    });

    test('reports a missing artifact path with kind=artifact-path', () => {
        const records = [{ ...copy(), required_references: ['exists.md', 'ghost.md'] }];
        const result = validateStageRegistryGraph(records, {
            resolver: resolver({ hasArtifactPath: ['ghost.md'] }),
        });
        expect(result.ok).toBe(false);
        const diag = result.diagnostics.find((d) => d.kind === 'artifact-path');
        expect(diag).toBeDefined();
        expect(diag?.ref).toBe('ghost.md');
        expect(diag?.stageId).toBe('plan');
    });

    test('reports a missing workflow on a transition with kind=workflow', () => {
        const result = validateStageRegistryGraph(threeStageRegistry(), {
            resolver: resolver({ hasWorkflow: ['task-pipeline.yaml'] }),
            transitions: [{ from: 'plan', to: 'implement', workflow: 'task-pipeline.yaml' }],
        });
        expect(result.ok).toBe(false);
        const diag = result.diagnostics.find((d) => d.kind === 'workflow');
        expect(diag).toBeDefined();
        expect(diag?.ref).toBe('task-pipeline.yaml');
        expect(diag?.message).toContain('plan -> implement');
    });

    test('reports a missing adapter when adapter_refs opts in', () => {
        const result = validateStageRegistryGraph([copy()], {
            resolver: resolver({ hasAdapter: ['cc-dev-plan'] }),
            adapter_refs: new Map([['plan', 'cc-dev-plan']]),
        });
        expect(result.ok).toBe(false);
        const diag = result.diagnostics.find((d) => d.kind === 'adapter');
        expect(diag).toBeDefined();
        expect(diag?.ref).toBe('cc-dev-plan');
        expect(diag?.stageId).toBe('plan');
    });

    test('does NOT check adapters when adapter_refs is absent', () => {
        const result = validateStageRegistryGraph([copy()], {
            resolver: resolver({ hasAdapter: ['cc-dev-plan'] }),
        });
        expect(result.diagnostics.find((d) => d.kind === 'adapter')).toBeUndefined();
    });

    test('each diagnostic carries an actionable message naming the stage and ref', () => {
        const records = [{ ...copy(), reasoning_skill: 'sp:ghost' }];
        const result = validateStageRegistryGraph(records, {
            resolver: resolver({ hasSkill: ['sp:ghost'] }),
        });
        const diag = result.diagnostics[0];
        expect(diag).toBeDefined();
        if (!diag) return;
        expect(diag.message).toContain('plan');
        expect(diag.message).toContain('sp:ghost');
        expect(diag.message).toContain('resolve');
    });
});

// ─── R3: reject cyclic, unknown-gate, unsupported, incompatible ───────────

describe('validateStageRegistryGraph (R3: reject before execution)', () => {
    test('rejects a cyclic transition graph (A -> B -> A)', () => {
        const transitions: StageTransition[] = [
            { from: 'plan', to: 'implement' },
            { from: 'implement', to: 'plan' },
        ];
        const result = validateStageRegistryGraph(threeStageRegistry(), {
            resolver: passAllResolver,
            transitions,
        });
        expect(result.ok).toBe(false);
        const diag = result.diagnostics.find((d) => d.code === 'cyclic-transition');
        expect(diag).toBeDefined();
        expect(diag?.message).toContain('cycle');
        expect(diag?.message).toContain('plan');
        expect(diag?.message).toContain('implement');
    });

    test('rejects a self-transition (use retry policy instead)', () => {
        const transitions: StageTransition[] = [{ from: 'plan', to: 'plan' }];
        const result = validateStageRegistryGraph([copy()], {
            resolver: passAllResolver,
            transitions,
        });
        expect(result.ok).toBe(false);
        const diag = result.diagnostics.find((d) => d.code === 'cyclic-transition');
        expect(diag).toBeDefined();
        expect(diag?.message).toContain('self-transition');
        expect(diag?.message).toContain('retry');
    });

    test('rejects a dangling transition (target stage does not exist)', () => {
        const transitions: StageTransition[] = [{ from: 'plan', to: 'ghost' }];
        const result = validateStageRegistryGraph([copy()], {
            resolver: passAllResolver,
            transitions,
        });
        expect(result.ok).toBe(false);
        const diag = result.diagnostics.find((d) => d.code === 'dangling-transition');
        expect(diag).toBeDefined();
        expect(diag?.ref).toBe('ghost');
    });

    test('rejects a dangling transition (source stage does not exist)', () => {
        const transitions: StageTransition[] = [{ from: 'ghost', to: 'plan' }];
        const result = validateStageRegistryGraph([copy()], {
            resolver: passAllResolver,
            transitions,
        });
        expect(result.ok).toBe(false);
        const diag = result.diagnostics.find((d) => d.code === 'dangling-transition');
        expect(diag).toBeDefined();
        expect(diag?.ref).toBe('ghost');
    });

    test('rejects an unknown gate on a transition', () => {
        const transitions: StageTransition[] = [{ from: 'plan', to: 'implement', gate: 'ghost-gate' }];
        const result = validateStageRegistryGraph(threeStageRegistry(), {
            resolver: resolver({ hasGate: ['ghost-gate'] }),
            transitions,
        });
        expect(result.ok).toBe(false);
        const diag = result.diagnostics.find((d) => d.code === 'missing-gate' && d.kind === 'gate');
        expect(diag).toBeDefined();
        expect(diag?.ref).toBe('ghost-gate');
        expect(diag?.message).toContain('plan -> implement');
    });

    test('rejects an unsupported transition into an irreversible stage without a gate', () => {
        const irreversible: StageRecord = {
            ...copy(),
            id: 'ship',
            mutation_class: 'irreversible' as const,
            execution: {
                kind: 'irreversible',
                requires_operator_intent: true,
                current_agent_allowed: false,
                rollback_disclaimer: 'no rollback',
            },
        };
        const transitions: StageTransition[] = [{ from: 'plan', to: 'ship' }];
        const result = validateStageRegistryGraph([copy(), irreversible], {
            resolver: passAllResolver,
            transitions,
        });
        expect(result.ok).toBe(false);
        const diag = result.diagnostics.find((d) => d.code === 'incompatible-model-policy');
        expect(diag).toBeDefined();
        expect(diag?.stageId).toBe('ship');
        expect(diag?.message).toContain('irreversible');
        expect(diag?.message).toContain('gate');
    });

    test('accepts a transition into an irreversible stage WITH a gate', () => {
        const irreversible: StageRecord = {
            ...copy(),
            id: 'ship',
            aliases: [],
            mutation_class: 'irreversible' as const,
            execution: {
                kind: 'irreversible',
                requires_operator_intent: true,
                current_agent_allowed: false,
                rollback_disclaimer: 'no rollback',
            },
        };
        const transitions: StageTransition[] = [{ from: 'plan', to: 'ship', gate: 'operator-confirm' }];
        const result = validateStageRegistryGraph([copy(), irreversible], {
            resolver: passAllResolver,
            transitions,
        });
        expect(result.ok).toBe(true);
    });

    test('rejects incompatible model policy from per-record checks (irreversible without exec/gate)', () => {
        const bad: StageRecord = {
            ...copy(),
            id: 'risky',
            mutation_class: 'irreversible' as const,
        };
        const result = validateStageRegistryGraph([bad], { resolver: passAllResolver });
        expect(result.ok).toBe(false);
        const diag = result.diagnostics.find((d) => d.code === 'incompatible-model-policy');
        expect(diag).toBeDefined();
        expect(diag?.stageId).toBe('risky');
    });

    test('accepts a clean forward DAG (plan -> implement -> verify)', () => {
        const result = validateStageRegistryGraph(threeStageRegistry(), {
            resolver: passAllResolver,
            transitions: forwardTransitions,
        });
        expect(result.ok).toBe(true);
        expect(result.diagnostics).toEqual([]);
    });

    test('accepts a DAG with a branch (tree shape, no cycle)', () => {
        const records = [
            copy(), // plan
            {
                ...copy(),
                id: 'implement',
                aliases: [],
                reasoning_skill: 'sp:code-implementation',
                gates: [],
                mutation_class: 'code' as const,
            },
            {
                ...copy(),
                id: 'test',
                aliases: [],
                reasoning_skill: 'sp:code-testing',
                gates: [],
                mutation_class: 'tests' as const,
            },
            {
                ...copy(),
                id: 'verify',
                aliases: [],
                reasoning_skill: 'sp:code-verification',
                gates: [],
                mutation_class: 'verdict' as const,
            },
        ];
        const transitions: StageTransition[] = [
            { from: 'plan', to: 'implement' },
            { from: 'plan', to: 'test' },
            { from: 'implement', to: 'verify' },
            { from: 'test', to: 'verify' },
        ];
        const result = validateStageRegistryGraph(records, {
            resolver: passAllResolver,
            transitions,
        });
        expect(result.ok).toBe(true);
    });
});

// ─── R4: same stage/run identifiers on pass and fail ──────────────────────

describe('validateStageRegistryGraph (R4: same identifiers on pass and fail)', () => {
    test('the result always carries run_id and stage_ids', () => {
        const records = threeStageRegistry();
        const result = validateStageRegistryGraph(records, {
            resolver: passAllResolver,
            transitions: forwardTransitions,
        });
        expect(typeof result.run_id).toBe('string');
        expect(result.run_id.length).toBeGreaterThan(0);
        expect(result.stage_ids).toEqual(['plan', 'implement', 'verify']);
    });

    test('the caller-provided run_id is used on both pass and fail paths', () => {
        const records = threeStageRegistry();
        const runId = 'my-pipeline-run-42';

        const passResult = validateStageRegistryGraph(records, {
            resolver: passAllResolver,
            transitions: forwardTransitions,
            run_id: runId,
        });
        const failResult = validateStageRegistryGraph(records, {
            resolver: resolver({ hasSkill: ['sp:code-implementation'] }),
            transitions: forwardTransitions,
            run_id: runId,
        });

        expect(passResult.run_id).toBe(runId);
        expect(failResult.run_id).toBe(runId);
        // Same stage_ids on both paths.
        expect(passResult.stage_ids).toEqual(failResult.stage_ids);
    });

    test('every diagnostic carries the run_id for observability correlation', () => {
        const records = [{ ...copy(), reasoning_skill: 'sp:ghost' }];
        const runId = 'observability-test';
        const result = validateStageRegistryGraph(records, {
            resolver: resolver({ hasSkill: ['sp:ghost'] }),
            run_id: runId,
        });
        expect(result.ok).toBe(false);
        for (const diag of result.diagnostics) {
            expect(diag.run_id).toBe(runId);
        }
    });

    test('a generated run_id is unique per call', () => {
        const r1 = validateStageRegistryGraph([copy()], { resolver: passAllResolver });
        const r2 = validateStageRegistryGraph([copy()], { resolver: passAllResolver });
        expect(r1.run_id).not.toBe(r2.run_id);
    });
});

// ─── Cross-record identity (duplicate ids / alias shadows) ────────────────

describe('validateStageRegistryGraph (cross-record identity)', () => {
    test('rejects duplicate stage ids', () => {
        const records = [copy(), { ...copy(), description: 'duplicate' }];
        const result = validateStageRegistryGraph(records, { resolver: passAllResolver });
        expect(result.ok).toBe(false);
        const diag = result.diagnostics.find((d) => d.code === 'duplicate-id');
        expect(diag).toBeDefined();
        expect(diag?.stageId).toBe('plan');
    });

    test('rejects an alias that shadows another stage id', () => {
        const records = [copy(), { ...copy(), id: 'plan-v2', aliases: ['plan'] }];
        const result = validateStageRegistryGraph(records, { resolver: passAllResolver });
        expect(result.ok).toBe(false);
        const diag = result.diagnostics.find((d) => d.code === 'duplicate-id');
        expect(diag).toBeDefined();
    });
});

// ─── Integration: representative 0282 stages form a clean graph ───────────

describe('representative 0282 stages (integration)', () => {
    const cases: Array<{ name: string; record: unknown }> = [
        { name: 'plan', record: copy() },
        {
            name: 'implement',
            record: {
                ...copy(),
                id: 'implement',
                aliases: ['dev-run'],
                description: 'dev-run: drive one task through its pipeline',
                reasoning_skill: 'sp:code-implementation',
                gates: [],
                mutation_class: 'code',
            },
        },
        {
            name: 'verify',
            record: {
                ...copy(),
                id: 'verify',
                aliases: ['dev-verify'],
                description: 'dev-verify: requirements traceability + verdict',
                reasoning_skill: 'sp:code-verification',
                gates: [{ name: 'verdict-artifact', timing: 'post', min_verdict: 'pass' }],
                mutation_class: 'verdict',
            },
        },
    ];

    test('all representative stages form a clean graph with a forward DAG', () => {
        const records = cases.map((c) => stageRecordSchema.parse(c.record));
        const transitions: StageTransition[] = [
            { from: 'plan', to: 'implement' },
            { from: 'implement', to: 'verify' },
        ];
        const result = validateStageRegistryGraph(records, {
            resolver: passAllResolver,
            transitions,
        });
        expect(result.ok).toBe(true);
        expect(result.stage_ids).toEqual(['plan', 'implement', 'verify']);
    });
});
