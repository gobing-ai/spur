/**
 * Fresh-vs-reused attribution instrumentation (0284 R6).
 *
 * Instrumentation attributes fresh vs reused Spur layers by content-hash
 * comparison. Provider cache dimensions are labeled only from verified raw
 * usage (ticket 0281) — never fabricating host cache hits when telemetry is
 * absent.
 *
 * Key invariants:
 *   1. Fresh = computed now, hash differs from capture → counted as fresh.
 *   2. Reused = hash matches captured layer → counted as reused.
 *   3. Provider cache hits are diagnostic evidence governed by 0281, never a
 *      Spur attribution metric.
 *   4. When telemetry is absent, cache hits are NEVER fabricated — the
 *      attribution record uses `null` or `'unavailable'`.
 */

import type { EnvelopeLayer } from './schema';

// ─── Attribution types (R4) ────────────────────────────────────────────────

/**
 * Provenance label for a layer's attribution result.
 *
 * Every derived field records its evidence kind:
 *   - `documented`: from a provider API that documents the field.
 *   - `locally-observed`: from CLI output where mapping is inferred, not
 *     documented.
 *   - `inferred`: computed from other known values.
 *   - `unavailable`: telemetry is absent — the value is NOT synthetic zero.
 */
export type EvidenceKind = 'documented' | 'locally-observed' | 'inferred' | 'unavailable';

/**
 * Attribution result for a single envelope layer.
 *
 * Records whether the layer was fresh (newly computed) or reused (matched a
 * captured fingerprint), along with evidence metadata.
 */
export interface LayerAttribution {
    /** Canonical layer name. */
    readonly layer: string;
    /** Whether this layer was freshly computed. */
    readonly fresh: boolean;
    /** Whether this layer was reused from a previously captured state. */
    readonly reused: boolean;
    /** Hash of the captured layer's content when it was originally stored. */
    readonly capturedHash: string;
    /** Hash of the freshly computed content. */
    readonly freshHash: string;
    /** Evidence kind for the attribution verdict. */
    readonly evidenceKind: EvidenceKind;
    /**
     * Reason for the attribution verdict. Explains why the layer was
     * classified as fresh or reused.
     */
    readonly reason: string;
}

/**
 * Full attribution report for a dispatch.
 *
 * Aggregates per-layer attribution results and provides summary metrics.
 * Provider cache dimensions are NEVER fabricated — `providerCacheHit` is
 * `'unavailable'` when telemetry is absent.
 */
export interface AttributionReport {
    /** Unique dispatch identifier. */
    readonly dispatchId: string;
    /** ISO 8601 timestamp of attribution. */
    readonly attributedAt: string;
    /** Per-layer attribution results in canonical order. */
    readonly layers: readonly LayerAttribution[];
    /** Number of fresh layers. */
    readonly freshCount: number;
    /** Number of reused layers. */
    readonly reusedCount: number;
    /**
     * Total fresh input tokens (when available from provider telemetry).
     * `null` when telemetry is absent — NEVER synthetic zero.
     */
    readonly freshInputTokens: number | null;
    /**
     * Total reused input tokens (when available from provider telemetry).
     * `null` when telemetry is absent — NEVER synthetic zero.
     */
    readonly reusedInputTokens: number | null;
    /**
     * Provider cache hit status.
     * `'unavailable'` when telemetry is absent.
     * `true`/`false` only when verified from raw provider usage (0281).
     */
    readonly providerCacheHit: boolean | 'unavailable';
    /** Evidence kind for the entire report's provider attribution. */
    readonly providerEvidenceKind: EvidenceKind;
}

// ─── Attribution function (R4) ──────────────────────────────────────────────

/**
 * Attribute fresh vs reused for a set of layers by comparing content hashes
 * against previously captured state (0284 R6).
 *
 * @param layers — Currently assembled envelope layers (the "fresh" set).
 * @param capturedLayers — Previously captured layers from a prior assembly
 *   (the "reused" comparison set). Pass an empty array when there is no
 *   prior capture (all layers are fresh).
 * @param freshInputTokens — Fresh input tokens from provider telemetry, or
 *   `null` when unavailable.
 * @param reusedInputTokens — Reused input tokens (cache read) from provider
 *   telemetry, or `null` when unavailable.
 * @param providerCacheHit — Provider-reported cache hit status, or
 *   `'unavailable'` when telemetry is absent. Defaults to `'unavailable'`
 *   so callers cannot accidentally fabricate a hit.
 * @returns An attribution report with per-layer and aggregate metrics.
 */
export function attributeFreshVsReused(
    layers: readonly EnvelopeLayer[],
    capturedLayers: readonly EnvelopeLayer[],
    freshInputTokens: number | null = null,
    reusedInputTokens: number | null = null,
    providerCacheHit: boolean | 'unavailable' = 'unavailable',
): AttributionReport {
    // Build lookup from captured layers.
    const capturedByLayer = new Map<string, EnvelopeLayer>();
    for (const cl of capturedLayers) {
        capturedByLayer.set(cl.layer, cl);
    }

    const layerResults: LayerAttribution[] = [];
    let freshCount = 0;
    let reusedCount = 0;

    for (const layer of layers) {
        const captured = capturedByLayer.get(layer.layer);
        const capturedHash = captured?.content_hash ?? '';

        // A layer is fresh if no captured version exists or hashes differ.
        // Volatile layers are always fresh by contract. An empty content hash
        // can never be treated as reused — a real layer hash is a 64-char
        // digest, so an empty string means "no usable capture" and must not
        // false-positive as a match.
        const isFresh = !captured || layer.content_hash === '' || captured.content_hash !== layer.content_hash;
        const isReused = !isFresh;

        if (isFresh) freshCount++;
        if (isReused) reusedCount++;

        const evidenceKind: EvidenceKind = isReused ? 'documented' : 'inferred';
        const reason = isReused
            ? `content hash matches captured layer (${layer.layer})`
            : !captured
              ? `no prior capture for layer ${layer.layer}`
              : `content hash differs: captured ${capturedHash} vs fresh ${layer.content_hash}`;

        layerResults.push({
            layer: layer.layer,
            fresh: isFresh,
            reused: isReused,
            capturedHash,
            freshHash: layer.content_hash,
            evidenceKind,
            reason,
        });
    }

    // Determine provider-level evidence kind.
    let providerEvidenceKind: EvidenceKind;
    if (providerCacheHit !== 'unavailable') {
        providerEvidenceKind = 'documented';
    } else if (freshInputTokens !== null || reusedInputTokens !== null) {
        providerEvidenceKind = 'documented';
    } else {
        providerEvidenceKind = 'unavailable';
    }

    return {
        // dispatchId is not derivable here; callers that track a dispatch id
        // stamp it on the returned report (see attributeWithoutTelemetry).
        dispatchId: '',
        attributedAt: new Date().toISOString(),
        layers: layerResults,
        freshCount,
        reusedCount,
        freshInputTokens,
        reusedInputTokens,
        providerCacheHit,
        providerEvidenceKind,
    };
}

/**
 * Create an attribution report with all provider telemetry marked unavailable
 * (0284 R6 invariant — never fabricate host cache hits).
 *
 * Safety wrapper for callers that have no access to provider telemetry.
 * Ensures that the report cannot accidentally claim a cache hit.
 *
 * @param layers — Currently assembled envelope layers.
 * @param capturedLayers — Previously captured layers (empty = all fresh).
 * @returns Attribution report with all provider fields set to
 *   `null`/`'unavailable'`.
 */
export function attributeWithoutTelemetry(
    layers: readonly EnvelopeLayer[],
    capturedLayers: readonly EnvelopeLayer[],
): AttributionReport {
    return {
        ...attributeFreshVsReused(layers, capturedLayers),
        freshInputTokens: null,
        reusedInputTokens: null,
        providerCacheHit: 'unavailable',
        providerEvidenceKind: 'unavailable' as const,
    };
}
