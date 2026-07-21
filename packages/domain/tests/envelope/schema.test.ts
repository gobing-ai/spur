/**
 * Tests for envelope-layer schemas and types (feature O, spec 0284 R1, R3).
 */

import { describe, expect, test } from 'bun:test';
import {
    CACHEABILITY_CLASSES,
    type Envelope,
    type EnvelopeLayer,
    envelopeLayerSchema,
    envelopeProvenanceSchema,
    envelopeSchema,
    featureSnapshotSchema,
    projectSnapshotSchema,
    SENSITIVITY_CLASSES,
    STABLE_LAYER_NAMES,
    taskSnapshotSchema,
    VOLATILE_LAYER_NAMES,
} from '../../src';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const ISO = '2026-07-20T12:00:00.000Z';

const baseLayer: EnvelopeLayer = {
    layer: 'harness-policy',
    content: 'authority: test\npolicy: stable',
    size_bytes: 30,
    content_hash: 'a'.repeat(64),
    provenance: {
        owner: 'sp:spur-dev',
        schema_version: '1.0',
        source_revision: 'abc123',
        generated_at: ISO,
    },
    cacheability: 'stable-prefix-eligible',
    sensitivity: 'internal',
};

const volatileLayer: EnvelopeLayer = {
    layer: 'tool-observations',
    content: 'bun run check passed\nall tests green',
    size_bytes: 40,
    content_hash: 'b'.repeat(64),
    provenance: {
        owner: 'sp:code-implementation',
        schema_version: '1.0',
        source_revision: null,
        generated_at: ISO,
    },
    cacheability: 'volatile',
    sensitivity: 'internal',
};

/** Build a fresh copy so tests cannot mutate the shared fixture. */
function copyLayer(overrides: Partial<EnvelopeLayer> = {}): EnvelopeLayer {
    return { ...structuredClone(baseLayer), ...overrides };
}

function validEnvelope(layers?: EnvelopeLayer[]): Envelope {
    return {
        schema_version: '1.0',
        layers: layers ?? [baseLayer],
        stage_id: 'implement',
        run_id: 'run-001',
        assembled_at: ISO,
        total_size_bytes: 30,
    };
}

// ─── R1: Vocabulary exports ────────────────────────────────────────────────

describe('envelope vocabulary exports (R1)', () => {
    test('exposes the canonical cacheability classes', () => {
        expect(CACHEABILITY_CLASSES).toEqual(['stable-prefix-eligible', 'volatile']);
    });

    test('exposes the canonical sensitivity classes', () => {
        expect(SENSITIVITY_CLASSES).toEqual(['public', 'internal', 'confidential']);
    });

    test('exposes stable layer names (1-5)', () => {
        expect(STABLE_LAYER_NAMES).toEqual([
            'harness-policy',
            'project-authority',
            'stage-contract',
            'task-state',
            'indexed-evidence',
        ]);
    });

    test('exposes volatile layer names (6-7)', () => {
        expect(VOLATILE_LAYER_NAMES).toEqual(['run-state', 'tool-observations']);
    });

    test('stable and volatile together cover all 7 canonical layers', () => {
        const all = [...STABLE_LAYER_NAMES, ...VOLATILE_LAYER_NAMES];
        expect(all).toEqual([
            'harness-policy',
            'project-authority',
            'stage-contract',
            'task-state',
            'indexed-evidence',
            'run-state',
            'tool-observations',
        ]);
    });
});

// ─── R1: Envelope provenance schema ───────────────────────────────────────

describe('envelopeProvenanceSchema (R1)', () => {
    test('accepts complete provenance', () => {
        const result = envelopeProvenanceSchema.parse({
            owner: 'sp:spur-dev',
            schema_version: '1.0',
            source_revision: 'abc123',
            generated_at: ISO,
        });
        expect(result.owner).toBe('sp:spur-dev');
        expect(result.source_revision).toBe('abc123');
    });

    test('accepts provenance without source_revision', () => {
        const result = envelopeProvenanceSchema.parse({
            owner: 'sp:code-implementation',
            schema_version: '1.0',
            generated_at: ISO,
        });
        expect(result.source_revision).toBeUndefined();
    });

    test('rejects empty owner', () => {
        const result = envelopeProvenanceSchema.safeParse({
            owner: '',
            schema_version: '1.0',
            generated_at: ISO,
        });
        expect(result.success).toBe(false);
    });

    test('rejects non-datetime generated_at', () => {
        const result = envelopeProvenanceSchema.safeParse({
            owner: 'test',
            schema_version: '1.0',
            generated_at: 'not-a-date',
        });
        expect(result.success).toBe(false);
    });
});

// ─── R1: Envelope layer schema ─────────────────────────────────────────────

describe('envelopeLayerSchema (R1)', () => {
    test('accepts a valid stable layer', () => {
        const parsed = envelopeLayerSchema.parse(baseLayer);
        expect(parsed.layer).toBe('harness-policy');
        expect(parsed.cacheability).toBe('stable-prefix-eligible');
    });

    test('accepts a valid volatile layer', () => {
        const parsed = envelopeLayerSchema.parse(volatileLayer);
        expect(parsed.layer).toBe('tool-observations');
        expect(parsed.cacheability).toBe('volatile');
    });

    test('accepts all 7 layer names', () => {
        const names: EnvelopeLayer['layer'][] = [
            'harness-policy',
            'project-authority',
            'stage-contract',
            'task-state',
            'indexed-evidence',
            'run-state',
            'tool-observations',
        ];
        for (const layer of names) {
            const parsed = envelopeLayerSchema.parse(copyLayer({ layer }));
            expect(parsed.layer).toBe(layer);
        }
    });

    test('rejects an unknown layer name', () => {
        const result = envelopeLayerSchema.safeParse(copyLayer({ layer: 'unknown-layer' as EnvelopeLayer['layer'] }));
        expect(result.success).toBe(false);
    });

    test('rejects invalid content_hash (not 64 hex chars)', () => {
        const result = envelopeLayerSchema.safeParse(copyLayer({ content_hash: 'too-short' }));
        expect(result.success).toBe(false);
    });

    test('accepts optional size_budget', () => {
        const layer = copyLayer({ size_budget: { max_bytes: 4096 } });
        const parsed = envelopeLayerSchema.parse(layer);
        expect(parsed.size_budget?.max_bytes).toBe(4096);
    });

    test('accepts optional disclosure_handle', () => {
        const layer = copyLayer({ disclosure_handle: 'ref:evidence-001' });
        const parsed = envelopeLayerSchema.parse(layer);
        expect(parsed.disclosure_handle).toBe('ref:evidence-001');
    });

    test('defaults sensitivity to internal', () => {
        const { sensitivity, ...rest } = baseLayer;
        const parsed = envelopeLayerSchema.parse(rest);
        expect(parsed.sensitivity).toBe('internal');
    });

    test('rejects negative size_bytes', () => {
        const result = envelopeLayerSchema.safeParse(copyLayer({ size_bytes: -1 }));
        expect(result.success).toBe(false);
    });
});

// ─── R1: Envelope schema ─────────────────────────────────────────────────

describe('envelopeSchema (R1, R2)', () => {
    test('accepts a valid envelope with one layer', () => {
        const parsed = envelopeSchema.parse(validEnvelope());
        expect(parsed.schema_version).toBe('1.0');
        expect(parsed.layers).toHaveLength(1);
        const layer = parsed.layers[0];
        expect(layer).toBeDefined();
        expect(layer?.layer).toBe('harness-policy');
    });

    test('accepts envelope with stable and volatile layers', () => {
        const env = validEnvelope([baseLayer, volatileLayer]);
        const parsed = envelopeSchema.parse(env);
        expect(parsed.layers).toHaveLength(2);
    });

    test('rejects envelope with empty layers array', () => {
        const result = envelopeSchema.safeParse(validEnvelope([]));
        expect(result.success).toBe(false);
    });

    test('accepts optional stage_id and run_id', () => {
        const env = validEnvelope();
        const parsed = envelopeSchema.parse(env);
        expect(parsed.stage_id).toBe('implement');
        expect(parsed.run_id).toBe('run-001');
    });

    test('defaults schema_version to 1.0 when omitted', () => {
        const { schema_version, ...rest } = validEnvelope();
        const parsed = envelopeSchema.parse(rest);
        expect(parsed.schema_version).toBe('1.0');
    });

    test('rejects negative total_size_bytes', () => {
        const result = envelopeSchema.safeParse({
            ...validEnvelope(),
            total_size_bytes: -1,
        });
        expect(result.success).toBe(false);
    });
});

// ─── R2: Project snapshot schema ───────────────────────────────────────────

describe('projectSnapshotSchema (R2)', () => {
    const validProject = {
        name: 'test-project',
        version: '1.0',
        task_counts: {
            backlog: 5,
            todo: 3,
            wip: 2,
            testing: 1,
            done: 10,
            blocked: 0,
            cancelled: 0,
        },
        feature_counts: {
            backlog: 2,
            active: 1,
            verifying: 0,
            done: 3,
            blocked: 0,
            cancelled: 0,
        },
        active_features: ['A', 'B'],
    };

    test('accepts a valid project snapshot', () => {
        const parsed = projectSnapshotSchema.parse(validProject);
        expect(parsed.name).toBe('test-project');
        expect(parsed.task_counts.done).toBe(10);
    });

    test('accepts optional content_hash', () => {
        const parsed = projectSnapshotSchema.parse({
            ...validProject,
            content_hash: 'c'.repeat(64),
        });
        expect(parsed.content_hash).toHaveLength(64);
    });

    test('rejects missing required task_counts fields', () => {
        const { task_counts, ...rest } = validProject;
        const result = projectSnapshotSchema.safeParse(rest);
        expect(result.success).toBe(false);
    });

    test('rejects negative task count', () => {
        const result = projectSnapshotSchema.safeParse({
            ...validProject,
            task_counts: { ...validProject.task_counts, done: -1 },
        });
        expect(result.success).toBe(false);
    });
});

// ─── R2: Task snapshot schema ──────────────────────────────────────────────

describe('taskSnapshotSchema (R2)', () => {
    test('accepts a minimal task snapshot', () => {
        const parsed = taskSnapshotSchema.parse({
            wbs: '0305',
            name: 'Test task',
            status: 'todo',
        });
        expect(parsed.wbs).toBe('0305');
        expect(parsed.status).toBe('todo');
    });

    test('accepts a full task snapshot with all optional fields', () => {
        const parsed = taskSnapshotSchema.parse({
            wbs: '0305',
            name: 'Test task',
            status: 'wip',
            priority: 'P1',
            feature_id: 'O',
            acceptance_criteria: 'Scenarios pass',
            locked_qa: ['Stable first then volatile'],
            solution: 'Implemented in envelope/',
            content_hash: 'c'.repeat(64),
        });
        expect(parsed.feature_id).toBe('O');
        expect(parsed.acceptance_criteria).toBe('Scenarios pass');
    });

    test('rejects invalid WBS format', () => {
        const result = taskSnapshotSchema.safeParse({
            wbs: '305',
            name: 'Test',
            status: 'todo',
        });
        expect(result.success).toBe(false);
    });

    test('rejects missing required fields', () => {
        const result = taskSnapshotSchema.safeParse({});
        expect(result.success).toBe(false);
    });
});

// ─── R2: Feature snapshot schema ───────────────────────────────────────────

describe('featureSnapshotSchema (R2)', () => {
    test('accepts a minimal feature snapshot', () => {
        const parsed = featureSnapshotSchema.parse({
            id: 'O',
            name: 'Feature O',
            status: 'active',
        });
        expect(parsed.id).toBe('O');
    });

    test('accepts a full feature snapshot', () => {
        const parsed = featureSnapshotSchema.parse({
            id: 'O',
            name: 'Feature O',
            status: 'active',
            priority: 'P1',
            scenarios: ['R1', 'R2', 'R3'],
            content_hash: 'd'.repeat(64),
        });
        expect(parsed.scenarios).toHaveLength(3);
    });

    test('rejects missing required fields', () => {
        const result = featureSnapshotSchema.safeParse({ id: 'O' });
        expect(result.success).toBe(false);
    });
});
