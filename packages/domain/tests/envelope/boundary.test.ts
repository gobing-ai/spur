/**
 * Tests for session/subprocess boundary enforcement (0284 R5).
 */
import { describe, expect, test } from 'bun:test';
import { createBoundaryContext, InlineContext, verifySubprocessArtifact } from '../../src/envelope/boundary';
import type { EnvelopeLayer } from '../../src/envelope/schema';

// ─── R5: Boundary context creation ─────────────────────────────────────────

describe('createBoundaryContext (R5)', () => {
    test('inline kind returns an InlineContext', () => {
        const ctx = createBoundaryContext('inline', 'dispatch-1');
        expect(ctx).not.toBeNull();
        expect(ctx?.dispatchId).toBe('dispatch-1');
    });

    test('subprocess kind returns null (no in-process context)', () => {
        expect(createBoundaryContext('subprocess', 'dispatch-2')).toBeNull();
    });
});

// ─── R5: InlineContext ──────────────────────────────────────────────────────

describe('InlineContext (R5)', () => {
    const prov: EnvelopeLayer['provenance'] = {
        owner: 'sp:spur-dev',
        schema_version: '1.0',
        source_revision: null,
        generated_at: '2026-07-20T00:00:00.000Z',
    };

    function makeLayer(name: EnvelopeLayer['layer'], hash: string): EnvelopeLayer {
        return {
            layer: name,
            content: `content-${name}`,
            size_bytes: 10,
            content_hash: hash,
            provenance: prov,
            cacheability: 'stable-prefix-eligible',
            sensitivity: 'internal',
        };
    }

    test('captures only stable-prefix-eligible layers', () => {
        const ctx = new InlineContext('d1');
        ctx.captureLayer(makeLayer('harness-policy', 'h1'));
        expect(ctx.size).toBe(1);
        expect(ctx.getCapturedLayer('harness-policy')).toBeDefined();
        expect(ctx.getCapturedLayer('run-state')).toBeUndefined();
    });

    test('getCapturedLayer returns undefined for unknown layer', () => {
        const ctx = new InlineContext('d2');
        expect(ctx.getCapturedLayer('nonexistent')).toBeUndefined();
    });

    test('isStableLayerFresh returns true when fingerprint matches', () => {
        const ctx = new InlineContext('d3');
        ctx.captureLayer(makeLayer('harness-policy', 'matchingHash'));
        expect(ctx.isStableLayerFresh('harness-policy', 'matchingHash')).toBe(true);
    });

    test('isStableLayerFresh returns false when fingerprint differs', () => {
        const ctx = new InlineContext('d4');
        ctx.captureLayer(makeLayer('harness-policy', 'oldHash'));
        expect(ctx.isStableLayerFresh('harness-policy', 'newHash')).toBe(false);
    });

    test('isStableLayerFresh returns false for uncaptured layer', () => {
        const ctx = new InlineContext('d5');
        expect(ctx.isStableLayerFresh('harness-policy', 'somehash')).toBe(false);
    });

    test('isStableLayerFresh returns false when fingerprint is null', () => {
        const ctx = new InlineContext('d6');
        ctx.captureLayer(makeLayer('harness-policy', 'hash'));
        expect(ctx.isStableLayerFresh('harness-policy', null)).toBe(false);
    });

    test('reset clears all captured layers', () => {
        const ctx = new InlineContext('d7');
        ctx.captureLayer(makeLayer('harness-policy', 'h1'));
        expect(ctx.size).toBe(1);
        ctx.reset();
        expect(ctx.size).toBe(0);
    });

    test('dispatchId is stable', () => {
        const ctx = new InlineContext('my-dispatch');
        expect(ctx.dispatchId).toBe('my-dispatch');
    });
});

// ─── R5: Subprocess artifact verification ──────────────────────────────────

describe('verifySubprocessArtifact (R5)', () => {
    test('all matching hashes returns true', () => {
        const artifact = {
            path: '/tmp/artifact.json',
            capturedHashes: { 'harness-policy': 'hashA' },
            capturedAt: '2026-07-20T00:00:00.000Z',
        };
        const fresh = { 'harness-policy': 'hashA' };
        expect(verifySubprocessArtifact(artifact, fresh)).toBe(true);
    });

    test('mismatched hash returns false', () => {
        const artifact = {
            path: '/tmp/artifact.json',
            capturedHashes: { 'harness-policy': 'hashA' },
            capturedAt: '2026-07-20T00:00:00.000Z',
        };
        const fresh = { 'harness-policy': 'WRONG' };
        expect(verifySubprocessArtifact(artifact, fresh)).toBe(false);
    });

    test('missing fresh fingerprint returns false', () => {
        const artifact = {
            path: '/tmp/artifact.json',
            capturedHashes: { 'harness-policy': 'hashA' },
            capturedAt: '2026-07-20T00:00:00.000Z',
        };
        const fresh: Record<string, string | null> = {};
        expect(verifySubprocessArtifact(artifact, fresh)).toBe(false);
    });
});
