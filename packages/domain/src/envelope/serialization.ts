/**
 * Canonical serialization for envelope layers, envelopes, and snapshots
 * (feature O, spec 0284 R1, R2, R3).
 *
 * "Canonical" means byte-identical output for semantically equal input,
 * independent of key insertion order. This is what makes the content-hash
 * fingerprint meaningful: a stable prefix can only be cached, compared, or
 * invalidated if the same logical content always serializes the same way.
 *
 * `JSON.stringify` is NOT canonical. Its key order is [[OwnPropertyKeys]] order
 * (ECMA-262 §10.1.11 OrdinaryOwnPropertyKeys): array-index-like keys first in
 * ascending numeric order, then remaining string keys in *insertion* order. So
 * it self-normalizes integer-like keys but not ordinary ones — two equal
 * snapshots built by different code paths hash differently whenever a
 * non-integer key was inserted in a different order. Every hash in this module
 * therefore goes through {@link canonicalJson}, which imposes one total order
 * (lexicographic over the string form) on every key at every depth.
 */

import { computeContentHash } from './fingerprint';
import type { Envelope, EnvelopeLayer, FeatureSnapshot, ProjectSnapshot, TaskSnapshot } from './schema';

/**
 * Serialize a value to canonical JSON: object keys sorted lexicographically at
 * every depth, no insignificant whitespace. Arrays keep their order (it is
 * semantic). `undefined` object properties are omitted, matching
 * `JSON.stringify`; `undefined` inside an array becomes `null`, also matching it.
 *
 * @param value — Any JSON-serializable value.
 * @returns Deterministic JSON text for equal input.
 */
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * Serialize a single envelope layer to its canonical text form.
 *
 * The layer's own `content` is emitted verbatim after a canonical metadata
 * header, so the expensive body is never re-encoded and a reader can split
 * header from body on the first blank line.
 *
 * @param layer — The layer to serialize.
 * @returns Canonical text: `<canonical-json-header>\n\n<content>`.
 */
export function serializeLayer(layer: EnvelopeLayer): string {
    const { content, ...meta } = layer;
    return `${canonicalJson(meta)}\n\n${content}`;
}

/**
 * Serialize a full envelope, stable layers first then volatile, each layer
 * separated by a stable delimiter.
 *
 * Layers are emitted in the order given — callers assemble via
 * `buildStageLayers`, which already sorts stable-first. This function does not
 * re-sort, so a caller can serialize a deliberately partial or reordered stack
 * (for example a stable prefix alone) and get exactly what it passed.
 *
 * @param envelope — The envelope to serialize.
 * @returns Canonical text form of the whole envelope.
 */
export function serializeEnvelope(envelope: Envelope): string {
    const { layers, ...meta } = envelope;
    const head = canonicalJson(meta);
    return [head, ...layers.map(serializeLayer)].join('\n\n---\n\n');
}

/**
 * Serialize only the stable-prefix-eligible layers of a layer list.
 *
 * This is the exact byte sequence eligible for provider prompt-caching, so it
 * must not include any volatile layer or any envelope-level field that changes
 * per run (`run_id`, `assembled_at`).
 *
 * @param layers — Layers to filter and serialize (order preserved).
 * @returns Canonical text of the stable prefix only.
 */
export function serializeStablePrefix(layers: EnvelopeLayer[]): string {
    return layers
        .filter((l) => l.cacheability === 'stable-prefix-eligible')
        .map(serializeLayer)
        .join('\n\n---\n\n');
}

/**
 * Fingerprint a project/task/feature snapshot by canonical-JSON content hash
 * (0284 R3).
 *
 * Any existing `content_hash` on the input is excluded before hashing —
 * otherwise the hash would depend on whatever hash was already stored, so
 * re-fingerprinting the same snapshot would not be idempotent.
 *
 * @param snapshot — The snapshot to fingerprint.
 * @returns 64-character lowercase hex SHA-256 digest of the canonical form.
 */
export function computeSnapshotHash(snapshot: ProjectSnapshot | TaskSnapshot | FeatureSnapshot): string {
    const { content_hash: _ignored, ...rest } = snapshot;
    return computeContentHash(canonicalJson(rest));
}

/**
 * Return a copy of a snapshot with its `content_hash` set to the canonical
 * fingerprint of its own content — the shape consumers store and compare.
 *
 * @param snapshot — The snapshot to fingerprint.
 * @returns The snapshot with a populated `content_hash`.
 */
export function withSnapshotHash<T extends ProjectSnapshot | TaskSnapshot | FeatureSnapshot>(snapshot: T): T {
    return { ...snapshot, content_hash: computeSnapshotHash(snapshot) };
}
