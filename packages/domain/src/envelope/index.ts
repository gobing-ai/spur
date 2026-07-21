/**
 * Context-envelope layers and canonical serialization (feature O, spec 0284).
 *
 * The canonical envelope is an ordered stack of typed layers, serialized
 * stable-first then volatile: (1) harness policy, (2) project authority,
 * (3) stage contract, (4) feature/task state, (5) indexed reusable evidence,
 * (6) current run state, (7) volatile tool observations (0284 R1).
 *
 * Each layer carries a content hash, provenance, size budget, and cacheability
 * classification. Stable layers are serialized before volatile layers;
 * optional detail is referenced through disclosure handles.
 *
 * Project/task snapshots are obtained via targeted --json verbs, fingerprinted
 * by content hash — never a full-file reread (0284 R2).
 *
 * Assembly is deterministic for equal inputs. Assembly order is:
 * stable-prefix-eligible (layers 1–5) → volatile (layers 6–7).
 * Within each group, the canonical CONTEXT_LAYER_NAMES order is preserved.
 */

export * from './assemblies';
export * from './attribution';
export * from './boundary';
export * from './fingerprint';
export * from './invalidation';
export * from './schema';
export * from './serialization';
