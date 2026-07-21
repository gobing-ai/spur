/**
 * Per-layer, fingerprint-driven invalidation triggers (0284 R1, R3).
 *
 * Invalidation is per-layer and fingerprint-driven, not time-based (0284 R3):
 *   - Corpus updates: file mtime + SHA-256 content hash
 *   - Git changes: worktree SHA
 *   - Config/model changes: config hash + model id
 *   - Skill/reference version changes: manifest version
 *   - Gate results: verdict-artifact hash
 *   - Tool outputs: never cached across stages
 *
 * Each trigger source produces a deterministic fingerprint string. A layer is
 * stale when its `content_hash` differs from the fresh fingerprint of the same
 * source.
 */

import { createHash } from 'node:crypto';
import type { EnvelopeLayer } from './schema';

// ─── Invalidation trigger types (R1) ────────────────────────────────────────

/**
 * Discriminated union of all invalidation trigger sources (0284 R3).
 *
 * Every trigger produces a fingerprint that is compared against the envelope
 * layer's `content_hash` to determine staleness. Tool outputs have no
 * fingerprint — they are never cached across stages.
 */
export type InvalidationTrigger =
    | { kind: 'corpus-update'; mtime: number; hash: string }
    | { kind: 'git-change'; worktreeSha: string }
    | { kind: 'config-change'; configHash: string; modelId: string }
    | { kind: 'version-change'; manifestVersion: string; source: string }
    | { kind: 'gate-result'; verdictHash: string }
    | { kind: 'tool-output' };

/**
 * Compute the invalidation fingerprint for a trigger (R1).
 *
 * The fingerprint is a SHA-256 hex digest of the trigger's canonical form.
 * Tool outputs return `null` — they are never cached across stages and
 * therefore have no meaningful invalidation fingerprint.
 *
 * @param trigger — Invalidation trigger source.
 * @returns 64-character hex fingerprint, or `null` for tool-output triggers.
 */
export function computeInvalidationFingerprint(trigger: InvalidationTrigger): string | null {
    if (trigger.kind === 'tool-output') return null;

    let raw: string;
    switch (trigger.kind) {
        case 'corpus-update':
            raw = `corpus:${trigger.mtime}:${trigger.hash}`;
            break;
        case 'git-change':
            raw = `git:${trigger.worktreeSha}`;
            break;
        case 'config-change':
            raw = `config:${trigger.configHash}:${trigger.modelId}`;
            break;
        case 'version-change':
            raw = `version:${trigger.manifestVersion}:${trigger.source}`;
            break;
        case 'gate-result':
            raw = `gate:${trigger.verdictHash}`;
            break;
        default:
            return null;
    }

    return createHash('sha256').update(raw, 'utf-8').digest('hex');
}

// ─── Layer staleness detection (R1, R3) ─────────────────────────────────────

/**
 * Result of checking a single layer for staleness.
 *
 * A layer is stale when a fresh fingerprint exists and differs from the layer's
 * stored `content_hash`. A layer is fresh when the fingerprint matches or the
 * layer's cacheability is volatile (volatile layers are rebuilt every run, not
 * compared for staleness).
 */
export interface LayerStalenessResult {
    /** The layer name. */
    layer: string;
    /** Whether the layer is stale. */
    stale: boolean;
    /**
     * Reason for staleness. Present only when `stale` is true.
     * One of: 'fingerprint-mismatch', 'never-cached', 'volatile-layer'.
     */
    reason?: 'fingerprint-mismatch' | 'never-cached' | 'volatile-layer';
    /** The trigger kind that caused the staleness check. Present on stale or validated layers. */
    triggerKind?: string;
}

/**
 * Check whether a single envelope layer is stale given a fresh invalidation
 * fingerprint (R1, R3).
 *
 * @param layer — The envelope layer to check.
 * @param freshFingerprint — Current fingerprint for this layer's source, or
 *   `null` for tool outputs which are never cached.
 * @returns Staleness result with the layer name, stale flag, and reason.
 */
export function checkLayerStale(layer: EnvelopeLayer, freshFingerprint: string | null): LayerStalenessResult {
    // Tool outputs are never cached — always stale.
    if (freshFingerprint === null) {
        return {
            layer: layer.layer,
            stale: true,
            reason: 'never-cached',
            triggerKind: 'tool-output',
        };
    }

    // Volatile layers are rebuilt per-run — stale by contract, not by fingerprint.
    if (layer.cacheability === 'volatile') {
        return {
            layer: layer.layer,
            stale: true,
            reason: 'volatile-layer',
        };
    }

    // Stable layers: compare stored hash against fresh fingerprint.
    const storedHash = layer.content_hash;
    const match = storedHash === freshFingerprint;
    return {
        layer: layer.layer,
        stale: !match,
        reason: match ? undefined : 'fingerprint-mismatch',
        triggerKind: match ? undefined : 'fingerprint-mismatch',
    };
}

/**
 * Identify stale layers in a captured envelope layer list (R1).
 *
 * Given a set of captured layers (e.g. from a prior dispatch) and a map of
 * fresh fingerprints per layer name (from current invalidation triggers),
 * return which layers are stale and why.
 *
 * Layers without a fresh fingerprint entry are conservatively treated as stale
 * (source not available = cannot verify freshness). Volatile layers and tool
 * outputs are always stale.
 *
 * @param layers — Captured envelope layers to check.
 * @param freshFingerprints — Map of layer name → current invalidation
 *   fingerprint (or null for tool-output sources). Only stable layers expected
 *   here, but any layer appearing gets checked.
 * @returns Array of staleness results, one per unique layer checked.
 */
export function identifyStaleLayers(
    layers: EnvelopeLayer[],
    freshFingerprints: Record<string, string | null>,
): LayerStalenessResult[] {
    const results: LayerStalenessResult[] = [];
    const seen = new Set<string>();

    for (const layer of layers) {
        if (seen.has(layer.layer)) continue;
        seen.add(layer.layer);

        const fingerprint = layer.layer in freshFingerprints ? (freshFingerprints[layer.layer] ?? null) : null;

        results.push(checkLayerStale(layer, fingerprint));
    }

    return results;
}

/**
 * Check whether a set of on-disk artifacts are still fresh enough to cross a
 * subprocess boundary (0284 R5).
 *
 * Subprocess (`spur agent run`) stages start fresh. They may only cross the
 * boundary via fingerprinted on-disk artifacts whose invalidation fingerprint
 * still matches. This checks that every required artifact has a fingerprint
 * that matches the current trigger state.
 *
 * @param capturedHashes — Map of layer name → content_hash from the on-disk
 *   artifact.
 * @param freshFingerprints — Map of layer name → current invalidation
 *   fingerprint from the fresh process.
 * @returns True when every layer in `capturedHashes` has a matching fingerprint.
 */
export function artifactFingerprintsMatch(
    capturedHashes: Record<string, string>,
    freshFingerprints: Record<string, string | null>,
): boolean {
    for (const [layerName, capturedHash] of Object.entries(capturedHashes)) {
        const fresh = freshFingerprints[layerName];
        // No fresh fingerprint → cannot verify → reject.
        if (fresh === undefined || fresh === null) return false;
        if (capturedHash !== fresh) return false;
    }
    return true;
}
