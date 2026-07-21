/**
 * Tests for per-layer fingerprint-driven invalidation (0284 R1, R3).
 */
import { describe, expect, test } from 'bun:test';
import {
    artifactFingerprintsMatch,
    checkLayerStale,
    computeInvalidationFingerprint,
    identifyStaleLayers,
} from '../../src/envelope/invalidation';
import type { EnvelopeLayer } from '../../src/envelope/schema';

// ─── R1: Invalidation fingerprint computation ───────────────────────────────

describe('computeInvalidationFingerprint (R1)', () => {
    test('corpus-update produces a deterministic 64-char hex digest', () => {
        const fp = computeInvalidationFingerprint({ kind: 'corpus-update', mtime: 1712345678, hash: 'abc123' });
        expect(fp).toHaveLength(64);
        expect(fp).toMatch(/^[0-9a-f]{64}$/);
    });

    test('corpus-update is deterministic for same input', () => {
        const trigger = { kind: 'corpus-update' as const, mtime: 1712345678, hash: 'abc123' };
        expect(computeInvalidationFingerprint(trigger)).toBe(computeInvalidationFingerprint(trigger));
    });

    test('corpus-update differs when mtime changes', () => {
        const base = { kind: 'corpus-update' as const, hash: 'abc123' };
        const fp1 = computeInvalidationFingerprint({ ...base, mtime: 1712345678 });
        const fp2 = computeInvalidationFingerprint({ ...base, mtime: 1712345679 });
        expect(fp1).not.toBe(fp2);
    });

    test('corpus-update differs when hash changes', () => {
        const base = { kind: 'corpus-update' as const, mtime: 1712345678 };
        const fp1 = computeInvalidationFingerprint({ ...base, hash: 'abc' });
        const fp2 = computeInvalidationFingerprint({ ...base, hash: 'def' });
        expect(fp1).not.toBe(fp2);
    });

    test('git-change produces a fingerprint', () => {
        const fp = computeInvalidationFingerprint({ kind: 'git-change', worktreeSha: 'deadbeef' });
        expect(fp).toHaveLength(64);
        expect(fp).toMatch(/^[0-9a-f]{64}$/);
    });

    test('git-change differs on different SHA', () => {
        const fp1 = computeInvalidationFingerprint({ kind: 'git-change', worktreeSha: 'aaa' });
        const fp2 = computeInvalidationFingerprint({ kind: 'git-change', worktreeSha: 'bbb' });
        expect(fp1).not.toBe(fp2);
    });

    test('config-change incorporates both config hash and model id', () => {
        const fp = computeInvalidationFingerprint({ kind: 'config-change', configHash: 'cfg1', modelId: 'claude-4' });
        expect(fp).toHaveLength(64);
    });

    test('config-change differs when model changes', () => {
        const base = { kind: 'config-change' as const, configHash: 'cfg1' };
        const fp1 = computeInvalidationFingerprint({ ...base, modelId: 'claude-4' });
        const fp2 = computeInvalidationFingerprint({ ...base, modelId: 'claude-5' });
        expect(fp1).not.toBe(fp2);
    });

    test('version-change incorporates manifest version and source', () => {
        const fp = computeInvalidationFingerprint({
            kind: 'version-change',
            manifestVersion: '1.2.3',
            source: 'sp-indexed-context',
        });
        expect(fp).toHaveLength(64);
    });

    test('gate-result produces a fingerprint', () => {
        const fp = computeInvalidationFingerprint({ kind: 'gate-result', verdictHash: 'vhash123' });
        expect(fp).toHaveLength(64);
    });

    test('tool-output returns null (never cached)', () => {
        expect(computeInvalidationFingerprint({ kind: 'tool-output' })).toBeNull();
    });
});

// ─── R1, R3: Layer staleness checking ───────────────────────────────────────

describe('checkLayerStale (R1, R3)', () => {
    const stableLayer: EnvelopeLayer = {
        layer: 'harness-policy',
        content: 'authority: AGENTS.md',
        size_bytes: 20,
        content_hash: 'stalehash',
        provenance: {
            owner: 'sp:spur-dev',
            schema_version: '1.0',
            source_revision: null,
            generated_at: '2026-07-20T00:00:00.000Z',
        },
        cacheability: 'stable-prefix-eligible',
        sensitivity: 'internal',
    };

    test('stable layer with matching fingerprint is not stale', () => {
        const result = checkLayerStale(stableLayer, 'stalehash');
        expect(result.stale).toBe(false);
        expect(result.layer).toBe('harness-policy');
    });

    test('stable layer with mismatched fingerprint is stale (fingerprint-mismatch)', () => {
        const result = checkLayerStale(stableLayer, 'differenthash');
        expect(result.stale).toBe(true);
        expect(result.reason).toBe('fingerprint-mismatch');
    });

    test('tool-output (null fingerprint) is always stale', () => {
        const volatile: EnvelopeLayer = { ...stableLayer, layer: 'tool-observations', cacheability: 'volatile' };
        const result = checkLayerStale(volatile, null);
        expect(result.stale).toBe(true);
        expect(result.reason).toBe('never-cached');
    });

    test('volatile layer with a fingerprint is stale by contract', () => {
        const volatile: EnvelopeLayer = { ...stableLayer, layer: 'run-state', cacheability: 'volatile' };
        const result = checkLayerStale(volatile, 'anyfingerprint');
        expect(result.stale).toBe(true);
        expect(result.reason).toBe('volatile-layer');
    });
});

// ─── R1: identifyStaleLayers ────────────────────────────────────────────────

describe('identifyStaleLayers (R1)', () => {
    const ISO = '2026-07-20T00:00:00.000Z';
    const prov = { owner: 'sp:spur-dev', schema_version: '1.0', source_revision: null, generated_at: ISO };

    const layers: EnvelopeLayer[] = [
        {
            layer: 'harness-policy',
            content: 'policy',
            size_bytes: 6,
            content_hash: 'hashA',
            provenance: prov,
            cacheability: 'stable-prefix-eligible',
            sensitivity: 'internal',
        },
        {
            layer: 'project-authority',
            content: 'docs',
            size_bytes: 4,
            content_hash: 'hashB',
            provenance: prov,
            cacheability: 'stable-prefix-eligible',
            sensitivity: 'internal',
        },
        {
            layer: 'stage-contract',
            content: 'contract',
            size_bytes: 8,
            content_hash: 'hashC',
            provenance: prov,
            cacheability: 'stable-prefix-eligible',
            sensitivity: 'internal',
        },
    ];

    test('all layers fresh when fingerprints match', () => {
        const fps: Record<string, string> = {
            'harness-policy': 'hashA',
            'project-authority': 'hashB',
            'stage-contract': 'hashC',
        };
        const results = identifyStaleLayers(layers, fps);
        expect(results.every((r) => !r.stale)).toBe(true);
    });

    test('detects a single stale layer', () => {
        const fps: Record<string, string> = {
            'harness-policy': 'hashA',
            'project-authority': 'WRONG',
            'stage-contract': 'hashC',
        };
        const results = identifyStaleLayers(layers, fps);
        const stale = results.filter((r) => r.stale);
        expect(stale).toHaveLength(1);
        expect(stale[0]?.layer).toBe('project-authority');
        expect(stale[0]?.reason).toBe('fingerprint-mismatch');
    });

    test('layer without a fingerprint entry is treated as stale', () => {
        const fps: Record<string, string> = { 'harness-policy': 'hashA' };
        const results = identifyStaleLayers(layers, fps);
        expect(results.filter((r) => r.stale).length).toBeGreaterThanOrEqual(2);
    });

    test('deduplicates by layer name', () => {
        const dupe = [...layers, { ...layers[0] } as EnvelopeLayer];
        const fps: Record<string, string> = {
            'harness-policy': 'hashA',
            'project-authority': 'hashB',
            'stage-contract': 'hashC',
        };
        expect(identifyStaleLayers(dupe, fps)).toHaveLength(3);
    });
});

// ─── R3: artifact fingerprint matching (subprocess boundary) ─────────────────

describe('artifactFingerprintsMatch (R3)', () => {
    test('all matching hashes returns true', () => {
        const captured = { 'harness-policy': 'hashA', 'stage-contract': 'hashB' };
        const fresh = { 'harness-policy': 'hashA', 'stage-contract': 'hashB' };
        expect(artifactFingerprintsMatch(captured, fresh)).toBe(true);
    });

    test('mismatched hash returns false', () => {
        const captured = { 'harness-policy': 'hashA' };
        const fresh = { 'harness-policy': 'WRONG' };
        expect(artifactFingerprintsMatch(captured, fresh)).toBe(false);
    });

    test('missing fresh fingerprint for a captured layer returns false', () => {
        const captured = { 'harness-policy': 'hashA' };
        const fresh: Record<string, string | null> = {};
        expect(artifactFingerprintsMatch(captured, fresh)).toBe(false);
    });

    test('null fresh fingerprint returns false (tool output / unavailable)', () => {
        const captured = { 'harness-policy': 'hashA' };
        const fresh = { 'harness-policy': null };
        expect(artifactFingerprintsMatch(captured, fresh)).toBe(false);
    });

    test('empty captured hashes returns true', () => {
        expect(artifactFingerprintsMatch({}, { 'harness-policy': 'hashA' })).toBe(true);
    });
});
