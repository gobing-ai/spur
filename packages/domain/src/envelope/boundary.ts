/**
 * Session/subprocess boundary enforcement (0284 R5).
 *
 * Inline stages share the invoking agent session and may reuse captured stable
 * layers within one dispatch. Subprocess (`spur agent run`) stages start a
 * fresh process and may NOT reuse in-process captured state — only
 * fingerprinted on-disk artifacts cross the boundary, and only when their
 * invalidation fingerprint still matches.
 *
 * This module provides:
 *   - An inline-context holder for captured stable layers within one dispatch
 *   - Subprocess boundary verification: check on-disk artifact fingerprints
 *   - Boundary-context type discriminator
 */

import { artifactFingerprintsMatch } from './invalidation';
import type { EnvelopeLayer } from './schema';

// ─── Boundary descriptors (R5) ─────────────────────────────────────────────

/**
 * Execution kind discriminated for boundary enforcement.
 *
 * `inline` stages share the invoking agent session (may reuse captured state).
 * `subprocess` stages start fresh (must re-validate on-disk artifacts).
 */
export type SessionBoundaryKind = 'inline' | 'subprocess';

/**
 * A boundary context discriminator. Stages declare whether they run inline or
 * subprocess; boundary enforcement logic uses this to decide what state may
 * cross the boundary.
 */
export interface SessionBoundary {
    readonly kind: SessionBoundaryKind;
}

// ─── Inline session context (R5) ────────────────────────────────────────────

/**
 * Captured stable layers within an inline dispatch.
 *
 * Inline stages share the invoking agent session. Stable layers (1-5) that
 * have been captured in this dispatch can be reused without re-fetching their
 * source. The caller is responsible for calling {@link isStableLayerFresh}
 * before reusing a layer across stage attempts within the same dispatch.
 *
 * Within one dispatch, the same in-process context is reused. Across dispatches
 * (different `dispatch_id` values), a new context is created — no state leaks
 * between dispatches.
 */
export class InlineContext {
    private readonly _capturedStable: Map<string, EnvelopeLayer> = new Map();
    private readonly _dispatchId: string;

    constructor(dispatchId: string) {
        this._dispatchId = dispatchId;
    }

    /** Unique dispatch identifier. */
    get dispatchId(): string {
        return this._dispatchId;
    }

    /**
     * Register a stable layer into the inline context.
     *
     * Only stable-prefix-eligible layers should be registered. Volatile layers
     * and tool observations are never captured across stage attempts.
     *
     * @param layer — The envelope layer to capture.
     */
    captureLayer(layer: EnvelopeLayer): void {
        if (layer.cacheability === 'stable-prefix-eligible') {
            this._capturedStable.set(layer.layer, layer);
        }
    }

    /**
     * Retrieve a previously captured layer by name.
     *
     * @param name — Canonical layer name.
     * @returns The captured layer, or `undefined` if not captured.
     */
    getCapturedLayer(name: string): EnvelopeLayer | undefined {
        return this._capturedStable.get(name);
    }

    /**
     * Check whether a stable layer captured in this context is still fresh
     * by comparing its stored content hash against a fresh fingerprint.
     *
     * A layer that was never captured is conservatively treated as stale.
     *
     * @param name — Canonical layer name.
     * @param freshFingerprint — Current invalidation fingerprint for this
     *   layer's source, or `null` for tool outputs.
     * @returns True when the layer was captured and its hash matches the
     *   fresh fingerprint.
     */
    isStableLayerFresh(name: string, freshFingerprint: string | null): boolean {
        const captured = this._capturedStable.get(name);
        if (!captured || freshFingerprint === null) return false;
        return captured.content_hash === freshFingerprint;
    }

    /**
     * Clear all captured layers. Used when a stage transitions to a new
     * attempt within the same dispatch and the stable prefix may have changed.
     */
    reset(): void {
        this._capturedStable.clear();
    }

    /**
     * Number of captured stable layers.
     */
    get size(): number {
        return this._capturedStable.size;
    }
}

// ─── Subprocess boundary (R5) ──────────────────────────────────────────────

/**
 * On-disk artifact descriptor for subprocess boundary crossing (0284 R5).
 *
 * Subprocess stages start fresh. They may only cross the boundary via
 * fingerprinted on-disk artifacts whose invalidation fingerprint still matches.
 * This descriptor records the layer-level hashes that were captured to disk
 * so the fresh subprocess can verify freshness.
 */
export interface SubprocessArtifact {
    /** Path to the on-disk artifact file. */
    readonly path: string;
    /** Map of layer name → content_hash at capture time. */
    readonly capturedHashes: Record<string, string>;
    /** ISO 8601 timestamp of when the artifact was written. */
    readonly capturedAt: string;
}

/**
 * Verify that a subprocess artifact's captured fingerprints still match fresh
 * state (0284 R5).
 *
 * @param artifact — The on-disk artifact to verify.
 * @param freshFingerprints — Current invalidation fingerprints for the fresh
 *   subprocess.
 * @returns True when every captured hash in the artifact matches its
 *   corresponding fresh fingerprint.
 */
export function verifySubprocessArtifact(
    artifact: SubprocessArtifact,
    freshFingerprints: Record<string, string | null>,
): boolean {
    return artifactFingerprintsMatch(artifact.capturedHashes, freshFingerprints);
}

/**
 * Create a boundary context for a given execution kind (R5).
 *
 * `inline` → returns a new `InlineContext` for the dispatch.
 * `subprocess` → returns `null`; subprocess stages must start fresh and use
 *   on-disk artifacts, not an in-process context.
 *
 * @param kind — Execution boundary kind.
 * @param dispatchId — Unique dispatch identifier (used for inline contexts).
 * @returns An `InlineContext` for inline, or `null` for subprocess.
 */
export function createBoundaryContext(kind: SessionBoundaryKind, dispatchId: string): InlineContext | null {
    if (kind === 'inline') return new InlineContext(dispatchId);
    // Subprocess — no in-process context; use on-disk artifacts only.
    return null;
}
