/**
 * Canonical-serialization tests (feature O, spec 0284 R1/R2/R3).
 *
 * These assert the property the fingerprint contract depends on: semantically
 * equal input must produce byte-identical output regardless of key order.
 * `JSON.stringify` does not have that property, which is why these exist.
 */
import { describe, expect, test } from 'bun:test';
import {
    buildStageLayers,
    canonicalJson,
    computeContentHash,
    computeSnapshotHash,
    type EnvelopeLayer,
    serializeEnvelope,
    serializeLayer,
    serializeStablePrefix,
    type TaskSnapshot,
    withSnapshotHash,
} from '../../src/envelope';

const ISO = '2026-07-20T00:00:00.000Z';

function layersFor(stage: string, content: Record<string, string>): EnvelopeLayer[] {
    return buildStageLayers(stage, content, 'sp:spur-dev', '1.0', ISO);
}

describe('canonicalJson (R1)', () => {
    test('key order does not change the output', () => {
        const a = canonicalJson({ b: 1, a: 2, c: 3 });
        const z = canonicalJson({ c: 3, a: 2, b: 1 });
        expect(a).toBe(z);
        expect(a).toBe('{"a":2,"b":1,"c":3}');
    });

    test('sorts keys at every depth, not just the top level', () => {
        const a = canonicalJson({ outer: { z: 1, a: { y: 2, b: 3 } } });
        const z = canonicalJson({ outer: { a: { b: 3, y: 2 }, z: 1 } });
        expect(a).toBe(z);
    });

    test('preserves array order — order is semantic, not incidental', () => {
        expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
        expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
    });

    test('omits undefined properties and handles null', () => {
        expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
        expect(canonicalJson(null)).toBe('null');
        expect(canonicalJson({ a: null })).toBe('{"a":null}');
    });

    test('differs from JSON.stringify on reordered keys — the reason this exists', () => {
        const x = { b: 1, a: 2 };
        const y = { a: 2, b: 1 };
        expect(JSON.stringify(x)).not.toBe(JSON.stringify(y));
        expect(canonicalJson(x)).toBe(canonicalJson(y));
    });

    test('imposes a total order over integer-like keys too', () => {
        // ECMA-262 OrdinaryOwnPropertyKeys already emits array-index-like keys
        // in ascending numeric order, so JSON.stringify self-normalizes these.
        // canonicalJson must still be deterministic — it orders lexicographically
        // over the string form, so "10" precedes "2". Different from stringify's
        // numeric order, and that is fine: canonicality needs one total order,
        // not a specific one.
        const a = { 10: 'x', 2: 'y', foo: 'z' };
        const b = { foo: 'z', 2: 'y', 10: 'x' };
        expect(canonicalJson(a)).toBe(canonicalJson(b));
        expect(canonicalJson(a)).toBe('{"10":"x","2":"y","foo":"z"}');
    });
});

describe('serializeLayer / serializeEnvelope (R1)', () => {
    test('layer body is emitted verbatim after a canonical header', () => {
        const [layer] = layersFor('refine', { 'harness-policy': 'policy body' });
        expect(layer).toBeDefined();
        if (!layer) return;
        const out = serializeLayer(layer);
        expect(out.endsWith('\n\npolicy body')).toBe(true);
        // The header is canonical JSON of the metadata, so `content` is not duplicated.
        expect(out.split('\n\n')[0]).toContain('"layer":"harness-policy"');
        expect(out.split('\n\n')[0]).not.toContain('policy body');
    });

    test('serialization is deterministic for equal input', () => {
        const a = layersFor('refine', { 'harness-policy': 'p', 'task-state': 't' });
        const b = layersFor('refine', { 'task-state': 't', 'harness-policy': 'p' });
        expect(serializeStablePrefix(a)).toBe(serializeStablePrefix(b));
    });

    test('stable prefix excludes volatile layers and per-run envelope fields', () => {
        const layers = layersFor('implement', {
            'harness-policy': 'p',
            'run-state': 'attempt: 1',
            'tool-observations': 'ls output',
        });
        const prefix = serializeStablePrefix(layers);
        expect(prefix).toContain('harness-policy');
        expect(prefix).not.toContain('run-state');
        expect(prefix).not.toContain('tool-observations');
    });

    test('the stable prefix is unchanged when only volatile content changes', () => {
        const base = { 'harness-policy': 'p', 'task-state': 't' };
        const run1 = layersFor('implement', { ...base, 'tool-observations': 'first run' });
        const run2 = layersFor('implement', { ...base, 'tool-observations': 'second run' });
        // This is the whole point of stable-first ordering: a changed tool
        // observation must not invalidate the cacheable prefix.
        expect(serializeStablePrefix(run1)).toBe(serializeStablePrefix(run2));
    });

    test('serializeEnvelope emits the envelope head then each layer', () => {
        const layers = layersFor('refine', { 'harness-policy': 'p' });
        const out = serializeEnvelope({
            schema_version: '1.0',
            layers,
            assembled_at: ISO,
            total_size_bytes: layers.reduce((n, l) => n + l.size_bytes, 0),
        });
        expect(out).toContain('"schema_version":"1.0"');
        expect(out).toContain('\n\n---\n\n');
        expect(out.endsWith('p')).toBe(true);
    });
});

describe('computeSnapshotHash (R3)', () => {
    const snapshot: TaskSnapshot = { wbs: '0305', name: 'Envelope', status: 'done' };

    test('hash is stable across key reordering', () => {
        const reordered = { status: 'done', name: 'Envelope', wbs: '0305' } as TaskSnapshot;
        expect(computeSnapshotHash(snapshot)).toBe(computeSnapshotHash(reordered));
    });

    test('hash changes when content changes', () => {
        expect(computeSnapshotHash(snapshot)).not.toBe(computeSnapshotHash({ ...snapshot, status: 'wip' }));
    });

    test('is a 64-char lowercase hex digest', () => {
        expect(computeSnapshotHash(snapshot)).toMatch(/^[0-9a-f]{64}$/);
    });

    test('re-fingerprinting is idempotent — an existing hash is excluded', () => {
        const once = withSnapshotHash(snapshot);
        const twice = withSnapshotHash(once);
        // Without excluding content_hash the second pass would hash the first
        // hash and diverge, making stored snapshots impossible to re-verify.
        expect(twice.content_hash).toBe(once.content_hash);
    });

    test('withSnapshotHash populates the field it computes', () => {
        const hashed = withSnapshotHash(snapshot);
        expect(hashed.content_hash).toBe(computeContentHash(canonicalJson(snapshot)));
    });
});
