/**
 * Tests for fresh-vs-reused attribution instrumentation (0284 R6).
 */
import { describe, expect, test } from 'bun:test';
import { attributeFreshVsReused, attributeWithoutTelemetry } from '../../src/envelope/attribution';
import { computeContentHash } from '../../src/envelope/fingerprint';
import type { EnvelopeLayer } from '../../src/envelope/schema';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ISO = '2026-07-20T00:00:00.000Z';
const PROV: EnvelopeLayer['provenance'] = {
    owner: 'sp:spur-dev',
    schema_version: '1.0',
    source_revision: null,
    generated_at: ISO,
};

function stableLayer(name: EnvelopeLayer['layer'], content: string): EnvelopeLayer {
    return {
        layer: name,
        content,
        size_bytes: content.length,
        content_hash: computeContentHash(content),
        provenance: PROV,
        cacheability: 'stable-prefix-eligible',
        sensitivity: 'internal',
    };
}

function volatileLayer(name: EnvelopeLayer['layer'], content: string): EnvelopeLayer {
    return {
        layer: name,
        content,
        size_bytes: content.length,
        content_hash: computeContentHash(content),
        provenance: PROV,
        cacheability: 'volatile',
        sensitivity: 'internal',
    };
}

// ─── R6: Basic attribution ──────────────────────────────────────────────────

describe('attributeFreshVsReused (R6)', () => {
    const layers = [
        stableLayer('harness-policy', 'policy content'),
        stableLayer('stage-contract', 'contract content'),
        volatileLayer('run-state', 'run state content'),
    ] as const;

    test('all layers are fresh when there is no prior capture', () => {
        const report = attributeFreshVsReused(layers, []);
        expect(report.freshCount).toBe(3);
        expect(report.reusedCount).toBe(0);
        expect(report.layers.every((l) => l.fresh && !l.reused)).toBe(true);
    });

    test('layers with matching hash are reused', () => {
        const captured = [stableLayer('harness-policy', 'policy content')];
        const report = attributeFreshVsReused(layers, captured);
        expect(report.reusedCount).toBeGreaterThanOrEqual(1);
        const harnessResult = report.layers.find((l) => l.layer === 'harness-policy');
        expect(harnessResult?.reused).toBe(true);
    });

    test('layers with changed hash are fresh', () => {
        const oldHarness = stableLayer('harness-policy', 'old policy');
        const freshHarness = stableLayer('harness-policy', 'new policy');
        const report = attributeFreshVsReused([freshHarness], [oldHarness]);
        expect(report.freshCount).toBe(1);
        expect(report.reusedCount).toBe(0);
    });

    test('reused layer has documented evidence kind, fresh has inferred', () => {
        const captured = [stableLayer('harness-policy', 'same content')];
        const report = attributeFreshVsReused([stableLayer('harness-policy', 'same content')], captured);
        const layerResult = report.layers[0];
        expect(layerResult?.reused).toBe(true);
        expect(layerResult?.evidenceKind).toBe('documented');
    });

    test('fresh layer with no capture gets inferred evidence kind', () => {
        const report = attributeFreshVsReused([stableLayer('harness-policy', 'content')], []);
        expect(report.layers[0]?.evidenceKind).toBe('inferred');
    });
});

// ─── R6: Provider telemetry handling ────────────────────────────────────────

describe('provider telemetry (R6)', () => {
    const layers = [stableLayer('harness-policy', 'content')];

    test('provider cache hit is unavailable by default', () => {
        const report = attributeFreshVsReused(layers, []);
        expect(report.providerCacheHit).toBe('unavailable');
        expect(report.providerEvidenceKind).toBe('unavailable');
    });

    test('provider cache hit can be explicitly set from verified usage', () => {
        const report = attributeFreshVsReused(layers, [], null, null, true);
        expect(report.providerCacheHit).toBe(true);
        expect(report.providerEvidenceKind).toBe('documented');
    });

    test('fresh input tokens are null by default (no fabrication)', () => {
        const report = attributeFreshVsReused(layers, []);
        expect(report.freshInputTokens).toBeNull();
        expect(report.reusedInputTokens).toBeNull();
    });

    test('fresh input tokens can be set from provider telemetry', () => {
        const report = attributeFreshVsReused(layers, [], 150, 75, true);
        expect(report.freshInputTokens).toBe(150);
        expect(report.reusedInputTokens).toBe(75);
    });

    test('provider evidence kind is documented when tokens are provided', () => {
        const report = attributeFreshVsReused(layers, [], 200, null);
        expect(report.providerEvidenceKind).toBe('documented');
    });
});

// ─── R6: attributeWithoutTelemetry safety wrapper ───────────────────────────

describe('attributeWithoutTelemetry (R6)', () => {
    const layers = [stableLayer('harness-policy', 'content')];

    test('always sets provider fields to unavailable', () => {
        const report = attributeWithoutTelemetry(layers, []);
        expect(report.providerCacheHit).toBe('unavailable');
        expect(report.freshInputTokens).toBeNull();
        expect(report.reusedInputTokens).toBeNull();
        expect(report.providerEvidenceKind).toBe('unavailable');
    });

    test('still correctly attributes fresh vs reused', () => {
        const captured = [stableLayer('harness-policy', 'content')];
        const fresh = [stableLayer('harness-policy', 'different content')];
        const report = attributeWithoutTelemetry(fresh, captured);
        expect(report.freshCount).toBe(1);
        expect(report.reusedCount).toBe(0);
    });

    test('captured matching layer is reused even without telemetry', () => {
        const captured = [stableLayer('harness-policy', 'same')];
        const report = attributeWithoutTelemetry([stableLayer('harness-policy', 'same')], captured);
        expect(report.reusedCount).toBe(1);
        expect(report.layers[0]?.reused).toBe(true);
    });
});

// ─── R6: Per-layer attribution details ──────────────────────────────────────

describe('per-layer attribution details (R6)', () => {
    test('each layer result has captured and fresh hashes', () => {
        const captured = [stableLayer('harness-policy', 'old content')];
        const fresh = [stableLayer('harness-policy', 'new content')];
        const report = attributeFreshVsReused(fresh, captured);
        expect(report.layers[0]?.capturedHash).toBe(computeContentHash('old content'));
        expect(report.layers[0]?.freshHash).toBe(computeContentHash('new content'));
        expect(report.layers[0]?.capturedHash).not.toBe(report.layers[0]?.freshHash);
    });

    test('reuse reason explains content hash match', () => {
        const captured = [stableLayer('stage-contract', 'contract')];
        const fresh = [stableLayer('stage-contract', 'contract')];
        const report = attributeFreshVsReused(fresh, captured);
        expect(report.layers[0]?.reason).toContain('content hash matches');
        expect(report.layers[0]?.reason).toContain('stage-contract');
    });

    test('fresh reason explains no prior capture', () => {
        const fresh = [stableLayer('harness-policy', 'content')];
        const report = attributeFreshVsReused(fresh, []);
        expect(report.layers[0]?.reason).toContain('no prior capture');
    });

    test('fresh reason explains hash difference', () => {
        const captured = [stableLayer('harness-policy', 'old')];
        const fresh = [stableLayer('harness-policy', 'new')];
        const report = attributeFreshVsReused(fresh, captured);
        expect(report.layers[0]?.reason).toContain('content hash differs');
    });

    test('report contains dispatch and timestamp metadata', () => {
        const report = attributeFreshVsReused([stableLayer('harness-policy', 'x')], [], 100, 50, true);
        expect(report.dispatchId).toBeDefined();
        expect(report.attributedAt).toBeDefined();
        expect(report.attributedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});
