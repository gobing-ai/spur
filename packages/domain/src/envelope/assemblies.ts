/**
 * Representative envelope assemblies for canonical stages (0284 R7).
 *
 * Each assembly function returns the default set of layers for a stage.
 * `getStageLayerSelection` exposes the required vs optional-disclosure split
 * per stage mutation class and gate set; `appendDisclosurePlaceholders` turns
 * the optional half into resolvable disclosure handles.
 *
 * Assembly is deterministic for equal inputs. Stable layers (1–5) are
 * always included before volatile layers (6–7). Optional layers use
 * disclosure handles for progressive disclosure (0284 R4).
 *
 * Stages:
 * - **refine**  — plan/intake: harness + authority + stage-contract + task-state
 * - **implement** — coding: adds indexed-evidence + run-state + tool-observations
 * - **review**   — quality check: same as implement (needs full evidence)
 * - **verify**   — gate check: harness + authority + stage-contract + task-state
 *                  + run-state (lightweight, no tool-observations)
 * - **dogfood**  — end-to-end: full stack with indexed-evidence
 *
 * @see envelopeLayerSchema — the layer shape each assembly returns
 */

import { computeContentHash } from './fingerprint';
import { type EnvelopeLayer, type Sensitivity, STABLE_LAYER_NAMES, VOLATILE_LAYER_NAMES } from './schema';

// ─── Layer name groupings ──────────────────────────────────────────────────

// The stable/volatile tuples are imported from `schema.ts`, which derives the
// vocabulary from the stage-registry's CONTEXT_LAYER_NAMES. A previous revision
// re-declared both lists here, giving the same vocabulary three definitions that
// tsc could not keep in sync.

/** All seven canonical layer names in stable-first order. */
const ALL_LAYER_NAMES: readonly string[] = [...STABLE_LAYER_NAMES, ...VOLATILE_LAYER_NAMES];

/**
 * Canonical sort index for each layer name. Low index = earlier position.
 * Uses a static Record for the fixed vocabulary (rule: Record<K,V> for
 * static lookup tables; Set/Map for runtime collections).
 */
const LAYER_ORDER: Record<string, number> = {};
ALL_LAYER_NAMES.forEach((name, idx) => {
    LAYER_ORDER[name] = idx;
});

/**
 * Sort envelope layers into canonical stable-first order.
 * Within each group, the CONTEXT_LAYER_NAMES order is preserved.
 */
function sortLayers(layers: EnvelopeLayer[]): EnvelopeLayer[] {
    return [...layers].sort((a, b) => (LAYER_ORDER[a.layer] ?? 99) - (LAYER_ORDER[b.layer] ?? 99));
}

/**
 * Check whether a layer name is in the stable-prefix-eligible group.
 * Stable layers (1-5) are deterministic for equal inputs.
 */
function isStableLayerName(name: string): boolean {
    return (STABLE_LAYER_NAMES as readonly string[]).includes(name);
}

/**
 * Compute cacheability for a layer by its position in the ordered stack.
 */
function cacheabilityForLayer(name: string): 'stable-prefix-eligible' | 'volatile' {
    return isStableLayerName(name) ? 'stable-prefix-eligible' : 'volatile';
}

// ─── Stage assemblies (R7) ─────────────────────────────────────────────────

/**
 * Layer selectors for each canonical stage.
 *
 * Each entry maps stage id → array of layer names to include.
 * Stages that need the full 7-layer stack list all layers;
 * lightweight stages (refine, verify) omit volatile layers.
 */
const STAGE_LAYER_SELECTORS: Record<string, readonly string[]> = {
    /** refine: planning/intake — stable layers only, no tool observations. */
    refine: ['harness-policy', 'project-authority', 'stage-contract', 'task-state'],

    /** implement: full coding stack — all layers. */
    implement: [
        'harness-policy',
        'project-authority',
        'stage-contract',
        'task-state',
        'indexed-evidence',
        'run-state',
        'tool-observations',
    ],

    /** review: quality check — full stack for complete context. */
    review: [
        'harness-policy',
        'project-authority',
        'stage-contract',
        'task-state',
        'indexed-evidence',
        'run-state',
        'tool-observations',
    ],

    /** verify: gate check — stable layers + run state, no tool observations. */
    verify: ['harness-policy', 'project-authority', 'stage-contract', 'task-state', 'run-state'],

    /** dogfood: end-to-end — full stack with indexed evidence. */
    dogfood: [
        'harness-policy',
        'project-authority',
        'stage-contract',
        'task-state',
        'indexed-evidence',
        'run-state',
        'tool-observations',
    ],
};

/**
 * Required vs optional-disclosure layer split per stage (0284 R7).
 *
 * `required` layers must be materialized with content. `optional` layers are
 * disclosure-eligible: a stage benefits from them but can proceed without the
 * body inline, so when content is absent they are emitted as a metadata-only
 * layer carrying a `disclosure_handle` for on-demand load (0284 R4).
 *
 * The split follows each stage's mutation class and gate set: stages that only
 * read (refine) need no run-state; stages that mutate code (implement, review,
 * dogfood) need fresh tool-observations; the verify gate needs run-state to see
 * prior verdicts but never needs raw tool output.
 */
const STAGE_LAYER_DISCLOSURE: Record<string, { required: readonly string[]; optional: readonly string[] }> = {
    refine: {
        required: ['harness-policy', 'project-authority', 'stage-contract', 'task-state'],
        optional: [],
    },
    implement: {
        required: ['harness-policy', 'project-authority', 'stage-contract', 'task-state', 'run-state'],
        optional: ['indexed-evidence', 'tool-observations'],
    },
    review: {
        required: ['harness-policy', 'project-authority', 'stage-contract', 'task-state', 'run-state'],
        optional: ['indexed-evidence', 'tool-observations'],
    },
    verify: {
        required: ['harness-policy', 'project-authority', 'stage-contract', 'task-state', 'run-state'],
        optional: [],
    },
    dogfood: {
        required: ['harness-policy', 'project-authority', 'stage-contract', 'task-state', 'run-state'],
        optional: ['indexed-evidence', 'tool-observations'],
    },
};

/**
 * Get the required/optional-disclosure layer split for a stage (0284 R7).
 *
 * Unknown stages fall back to treating the full stack as required — the
 * conservative choice, since omitting a layer a stage actually needs is worse
 * than sending one it does not.
 *
 * @param stageId — Canonical stage identifier.
 * @returns The stage's required and optional-disclosure layer names.
 */
export function getStageLayerSelection(stageId: string): { required: readonly string[]; optional: readonly string[] } {
    return STAGE_LAYER_DISCLOSURE[stageId] ?? { required: ALL_LAYER_NAMES, optional: [] };
}

/**
 * Get the default layer names for a given stage.
 *
 * Unknown stage ids fall back to the full 7-layer stack rather than throwing —
 * an unrecognized stage still gets a usable envelope.
 *
 * @param stageId — Canonical stage identifier (e.g. "refine", "implement").
 * @returns Ordered array of layer names for the stage.
 */
export function getStageLayerNames(stageId: string): readonly string[] {
    return STAGE_LAYER_SELECTORS[stageId] ?? ALL_LAYER_NAMES;
}

/**
 * Get the stable (prefix-eligible) layer names for a stage.
 *
 * @param stageId — Canonical stage identifier.
 * @returns Only the stable layers (1–5) selected for this stage.
 */
export function getStableLayerNames(stageId: string): readonly string[] {
    return getStageLayerNames(stageId).filter((n) => isStableLayerName(n));
}

/**
 * Get the volatile layer names for a stage.
 *
 * @param stageId — Canonical stage identifier.
 * @returns Only the volatile layers (6–7) selected for this stage.
 */
export function getVolatileLayerNames(stageId: string): readonly string[] {
    return getStageLayerNames(stageId).filter((n) => !isStableLayerName(n));
}

/**
 * Build a list of layer descriptors for a stage from raw content.
 *
 * This is the primary assembly function. Each layer is annotated with
 * cacheability and provenance. Callers provide the content map; this
 * function handles ordering, filtering, and metadata assignment.
 *
 * @param stageId — Canonical stage identifier.
 * @param contentMap — Record of layer name → serialized content.
 * @param owner — Owner identifier for provenance.
 * @param schemaVersion — Schema version string.
 * @param generatedAt — ISO 8601 timestamp.
 * @param sourceRevision — Optional git SHA or equivalent.
 * @param sensitivityByLayer — Optional per-layer redaction class. Layers absent
 *        from the map default to `internal`. Without this, no assembly path
 *        could mark a layer `confidential`, so the schema's redaction vocabulary
 *        was unreachable from the only function that builds layers.
 * @returns Ordered array of envelope layers (stable-first).
 */
export function buildStageLayers(
    stageId: string,
    contentMap: Record<string, string>,
    owner: string,
    schemaVersion: string,
    generatedAt: string,
    sourceRevision?: string,
    sensitivityByLayer?: Record<string, Sensitivity>,
): EnvelopeLayer[] {
    const layerNames = getStageLayerNames(stageId);
    const layers: EnvelopeLayer[] = [];

    for (const name of layerNames) {
        const content = contentMap[name];
        if (content === undefined || content === null) continue;

        const encoder = new TextEncoder();
        const sizeBytes = encoder.encode(content).length;
        const hash = computeContentHash(content);

        layers.push({
            layer: name as EnvelopeLayer['layer'],
            content,
            size_bytes: sizeBytes,
            content_hash: hash,
            provenance: {
                owner,
                schema_version: schemaVersion,
                source_revision: sourceRevision ?? null,
                generated_at: generatedAt,
            },
            cacheability: cacheabilityForLayer(name),
            sensitivity: sensitivityByLayer?.[name] ?? 'internal',
        });
    }

    return sortLayers(layers);
}

/**
 * Emit metadata-only placeholders for a stage's optional-disclosure layers that
 * have no inline content (0284 R4, R7).
 *
 * `buildStageLayers` deliberately drops any layer without content. For a
 * stage's *optional* layers that drop is lossy: the consumer cannot tell "this
 * stage never wants indexed-evidence" from "the body was left out to save
 * budget". A placeholder keeps the distinction — zero-length content plus a
 * `disclosure_handle` the consumer can resolve on demand.
 *
 * Composed with, not folded into, `buildStageLayers`, so the plain assembly
 * path keeps its existing skip-missing behavior.
 *
 * @param stageId — Canonical stage identifier.
 * @param layers — Layers already built for this stage.
 * @param provenance — Provenance to stamp on the placeholders.
 * @returns The layers plus any missing optional layers as disclosure placeholders, re-sorted.
 */
export function appendDisclosurePlaceholders(
    stageId: string,
    layers: EnvelopeLayer[],
    provenance: EnvelopeLayer['provenance'],
): EnvelopeLayer[] {
    const present = new Set(layers.map((l) => l.layer));
    const { optional } = getStageLayerSelection(stageId);
    const placeholders: EnvelopeLayer[] = [];

    for (const name of optional) {
        if (present.has(name as EnvelopeLayer['layer'])) continue;
        placeholders.push({
            layer: name as EnvelopeLayer['layer'],
            content: '',
            size_bytes: 0,
            content_hash: computeContentHash(''),
            provenance,
            cacheability: cacheabilityForLayer(name),
            sensitivity: 'internal',
            disclosure_handle: `${stageId}:${name}`,
        });
    }

    return sortLayers([...layers, ...placeholders]);
}

/**
 * Get the stable group prefix for a set of layers.
 *
 * Returns only the stable-prefix-eligible layers in canonical order.
 * This subset is eligible for provider prompt-caching and content-hash
 * comparison for stale detection.
 *
 * @param layers — Full set of envelope layers (will be sorted).
 * @returns Stable layers in canonical order.
 */
export function extractStablePrefix(layers: EnvelopeLayer[]): EnvelopeLayer[] {
    return sortLayers(layers).filter((l) => l.cacheability === 'stable-prefix-eligible');
}

/**
 * Check whether two stable prefixes are byte-identical by comparing
 * content hashes. Used for stale detection (0284 R3).
 *
 * @param a — First set of layers.
 * @param b — Second set of layers.
 * @returns True if every stable layer has the same content hash.
 */
export function stablePrefixesMatch(a: EnvelopeLayer[], b: EnvelopeLayer[]): boolean {
    const stableA = extractStablePrefix(a);
    const stableB = extractStablePrefix(b);
    if (stableA.length !== stableB.length) return false;
    for (let i = 0; i < stableA.length; i++) {
        const left = stableA[i];
        const right = stableB[i];
        if (!left || !right) return false;
        if (left.content_hash !== right.content_hash) return false;
    }
    return true;
}
