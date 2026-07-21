/**
 * Tests for envelope assembly functions (feature O, spec 0284 R7, R3).
 */

import { describe, expect, test } from 'bun:test';
import {
    buildStageLayers,
    computeContentHash,
    type EnvelopeLayer,
    extractStablePrefix,
    getStableLayerNames,
    getStageLayerNames,
    getVolatileLayerNames,
    stablePrefixesMatch,
} from '../../src';

// ─── Constants ─────────────────────────────────────────────────────────────

const ISO = '2026-07-20T12:00:00.000Z';

const harnessContent = 'authority: AGENTS.md\npolicy: stable\nthreshold: 90%';
const contractContent = 'stage: implement\ngates: [lint, typecheck, tests]';
const taskContent = 'task: 0305\nstatus: wip\nac: stable-first ordering';
const toolContent = 'bun run check passed\nall tests green';

// ─── R7: Layer selection per stage ─────────────────────────────────────────

describe('getStageLayerNames (R7)', () => {
    test('refine stage: harness + authority + contract + task-state', () => {
        const names = getStageLayerNames('refine');
        expect(names).toEqual(['harness-policy', 'project-authority', 'stage-contract', 'task-state']);
    });

    test('implement stage: full 7-layer stack', () => {
        const names = getStageLayerNames('implement');
        expect(names).toHaveLength(7);
        expect(names[0]).toBe('harness-policy');
        expect(names[6]).toBe('tool-observations');
    });

    test('review stage: full 7-layer stack', () => {
        const names = getStageLayerNames('review');
        expect(names).toHaveLength(7);
    });

    test('verify stage: stable layers + run-state, no tool-observations', () => {
        const names = getStageLayerNames('verify');
        expect(names).toContain('run-state');
        expect(names).not.toContain('tool-observations');
        expect(names).toContain('harness-policy');
    });

    test('dogfood stage: full 7-layer stack', () => {
        const names = getStageLayerNames('dogfood');
        expect(names).toHaveLength(7);
    });

    test('unknown stage falls back to full stack', () => {
        const names = getStageLayerNames('unknown-stage');
        expect(names).toHaveLength(7);
    });
});

describe('getStableLayerNames / getVolatileLayerNames (R1)', () => {
    test('refine has only stable layers', () => {
        expect(getVolatileLayerNames('refine')).toHaveLength(0);
        expect(getStableLayerNames('refine')).toHaveLength(4);
    });

    test('verify has run-state but no tool-observations', () => {
        const volatile = getVolatileLayerNames('verify');
        expect(volatile).toEqual(['run-state']);
    });

    test('full-stack stages have correct stable/volatile split', () => {
        expect(getStableLayerNames('implement')).toHaveLength(5);
        expect(getVolatileLayerNames('implement')).toHaveLength(2);
    });
});

// ─── R1: Stable-first ordering ─────────────────────────────────────────────

describe('buildStageLayers (R1) — stable-first ordering', () => {
    test('builds layers in stable-first order for implement stage', () => {
        const layers = buildStageLayers(
            'implement',
            {
                'harness-policy': harnessContent,
                'stage-contract': contractContent,
                'task-state': taskContent,
                'tool-observations': toolContent,
                'project-authority': 'docs/00-05',
                'indexed-evidence': '.spur/context/',
                'run-state': 'attempt: 1',
            },
            'sp:spur-dev',
            '1.0',
            ISO,
        );

        expect(layers).toHaveLength(7);

        // Layers 1-5 should be stable-prefix-eligible
        for (const layer of layers.slice(0, 5)) {
            expect(layer.cacheability).toBe('stable-prefix-eligible');
        }
        // Layers 6-7 should be volatile
        for (const layer of layers.slice(5, 7)) {
            expect(layer.cacheability).toBe('volatile');
        }

        // Verify order
        expect(layers[0]).toBeDefined();
        expect(layers[0]?.layer).toBe('harness-policy');
        expect(layers[4]).toBeDefined();
        expect(layers[4]?.layer).toBe('indexed-evidence');
        expect(layers[5]).toBeDefined();
        expect(layers[5]?.layer).toBe('run-state');
        expect(layers[6]).toBeDefined();
        expect(layers[6]?.layer).toBe('tool-observations');
    });

    test('skips layers with no content', () => {
        const layers = buildStageLayers(
            'implement',
            {
                'harness-policy': harnessContent,
                'run-state': 'attempt: 1',
                'tool-observations': toolContent,
            },
            'sp:spur-dev',
            '1.0',
            ISO,
        );
        expect(layers).toHaveLength(3);
        expect(layers[0]).toBeDefined();
        expect(layers[0]?.layer).toBe('harness-policy');
        expect(layers[1]).toBeDefined();
        expect(layers[1]?.layer).toBe('run-state');
        expect(layers[2]).toBeDefined();
        expect(layers[2]?.layer).toBe('tool-observations');
    });

    test('computes content_hash for each layer', () => {
        const layers = buildStageLayers(
            'implement',
            {
                'harness-policy': harnessContent,
                'stage-contract': contractContent,
                'task-state': taskContent,
                'tool-observations': toolContent,
                'project-authority': 'docs/00-05',
                'indexed-evidence': '.spur/context/',
                'run-state': 'attempt: 1',
            },
            'sp:spur-dev',
            '1.0',
            ISO,
        );

        for (const layer of layers) {
            expect(layer.content_hash).toHaveLength(64);
            expect(layer.content_hash).toBe(computeContentHash(layer.content));
        }
    });

    test('sets provenance correctly', () => {
        const layers = buildStageLayers(
            'refine',
            {
                'harness-policy': harnessContent,
                'stage-contract': contractContent,
                'task-state': taskContent,
                'project-authority': 'docs/00-05',
            },
            'sp:spur-dev',
            '1.0',
            ISO,
            'abc123',
        );

        for (const layer of layers) {
            expect(layer.provenance.owner).toBe('sp:spur-dev');
            expect(layer.provenance.schema_version).toBe('1.0');
            expect(layer.provenance.source_revision).toBe('abc123');
            expect(layer.provenance.generated_at).toBe(ISO);
        }
    });

    test('provenance source_revision is null when omitted', () => {
        const layers = buildStageLayers(
            'refine',
            {
                'harness-policy': harnessContent,
                'project-authority': 'docs',
                'stage-contract': 'contract',
                'task-state': 'task',
            },
            'sp:spur-dev',
            '1.0',
            ISO,
        );

        for (const layer of layers) {
            expect(layer.provenance.source_revision).toBeNull();
        }
    });

    test('computes correct size_bytes', () => {
        const layers = buildStageLayers(
            'refine',
            {
                'harness-policy': harnessContent,
                'project-authority': 'hello',
                'stage-contract': 'world',
                'task-state': 'test',
            },
            'sp:spur-dev',
            '1.0',
            ISO,
        );

        const harnessLayer = layers.find((l) => l.layer === 'harness-policy');
        expect(harnessLayer).toBeDefined();
        expect(harnessLayer?.size_bytes).toBeGreaterThan(0);
    });
});

// ─── R2: Build with minimal content ────────────────────────────────────────

describe('buildStageLayers — edge cases (R2)', () => {
    test('builds with empty content map', () => {
        const layers = buildStageLayers('refine', {}, 'test', '1.0', ISO);
        expect(layers).toHaveLength(0);
    });

    test('refine stage produces only stable layers', () => {
        const layers = buildStageLayers(
            'refine',
            {
                'harness-policy': harnessContent,
                'project-authority': 'docs',
                'stage-contract': contractContent,
                'task-state': taskContent,
            },
            'sp:spur-dev',
            '1.0',
            ISO,
        );
        expect(layers).toHaveLength(4);
        for (const layer of layers) {
            expect(layer.cacheability).toBe('stable-prefix-eligible');
        }
    });
});

// ─── R3: Stable prefix / stale detection ───────────────────────────────────

describe('extractStablePrefix (R3)', () => {
    const stableA: EnvelopeLayer = {
        layer: 'harness-policy',
        content: 'version: 1',
        size_bytes: 10,
        content_hash: 'a'.repeat(64),
        provenance: { owner: 't', schema_version: '1.0', source_revision: null, generated_at: ISO },
        cacheability: 'stable-prefix-eligible',
        sensitivity: 'internal',
    };
    const stableB: EnvelopeLayer = {
        layer: 'stage-contract',
        content: 'gates: [lint]',
        size_bytes: 14,
        content_hash: 'b'.repeat(64),
        provenance: { owner: 't', schema_version: '1.0', source_revision: null, generated_at: ISO },
        cacheability: 'stable-prefix-eligible',
        sensitivity: 'internal',
    };
    const volatile: EnvelopeLayer = {
        layer: 'tool-observations',
        content: 'output',
        size_bytes: 6,
        content_hash: 'c'.repeat(64),
        provenance: { owner: 't', schema_version: '1.0', source_revision: null, generated_at: ISO },
        cacheability: 'volatile',
        sensitivity: 'internal',
    };

    test('extracts only stable layers from mixed set', () => {
        const prefix = extractStablePrefix([volatile, stableA, stableB]);
        expect(prefix).toHaveLength(2);
        expect(prefix[0]).toBeDefined();
        expect(prefix[0]?.layer).toBe('harness-policy');
        expect(prefix[1]).toBeDefined();
        expect(prefix[1]?.layer).toBe('stage-contract');
    });

    test('stable prefixes match when identical', () => {
        const a = [stableA, stableB];
        const b = [stableA, stableB];
        expect(stablePrefixesMatch(a, b)).toBe(true);
    });

    test('stable prefixes do not match when hashes differ', () => {
        const modified = { ...stableB, content_hash: 'd'.repeat(64) };
        expect(stablePrefixesMatch([stableA, stableB], [stableA, modified])).toBe(false);
    });

    test('volatile layers are excluded from prefix match', () => {
        expect(stablePrefixesMatch([stableA, volatile], [stableA])).toBe(true);
    });

    test('returns false when layer counts differ', () => {
        expect(stablePrefixesMatch([stableA], [stableA, stableB])).toBe(false);
    });
});
