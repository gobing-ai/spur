import { createHash } from 'node:crypto';
import type { HistoryArtifact } from './artifact';

/**
 * Semantic artifact digest authority (task 0669 / ADR-079 amendment).
 *
 * ADR-079 makes history-anatomy cache validity a *derived* fact: a cached report is reusable only
 * when a freshly derived semantic digest of the analyze artifact matches what the cache recorded.
 * The digest and its canonicalization rules live here, beside the `HistoryArtifact` type they
 * canonicalize — the ranked-versus-set classification below is type-derived, so adding an array
 * field to `HistoryArtifact` without classifying it fails `tsc` naming the key.
 *
 * Consumers: `plugins/sp/scripts/history-anatomy-cache.ts` reaches this module through a generated
 * copy (`plugins/sp/lib/artifact-digest.generated.mjs`) because the plugin script is an ADR-065
 * standard script — no monorepo import may survive into its committed `.mjs` twin. Regenerate with
 * `bun run build:plugin-lib`; do not hand-edit the generated files.
 */

/** JSON-compatible value — the shape of canonicalized artifact material. */
type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

/** Every property path in `HistoryArtifact` whose value is an array, as dotted property names. */
type ArrayKeys<T> = T extends readonly unknown[]
    ? never
    : T extends object
      ? { [K in keyof T]-?: NonNullable<T[K]> extends readonly unknown[] ? K : ArrayKeys<NonNullable<T[K]>> }[keyof T]
      : never;

/** Every array-valued property path in `HistoryArtifact`, as dotted names. */
export type ArtifactArrayKey = Extract<ArrayKeys<HistoryArtifact>, string>;

/**
 * Order-as-evidence classification for every array-valued property in `HistoryArtifact`.
 *
 * - `ranked` — order is evidence (bounded leaderboards); canonicalization preserves it.
 *   Adding one without classifying it would silently sort away real evidence — the exact failure
 *   ADR-079 exists to prevent (`topSteps` and `bottlenecks` were both mis-classified until 2026-08-25).
 * - `set` — plain list; canonicalization sorts so equivalent sets digest identically.
 *
 * Exhaustive over `ArtifactArrayKey`: adding an array field to `HistoryArtifact` without an entry
 * here is a compile error naming the field. Keys absent from this record keep set behaviour
 * (sorted), so digests over arbitrary JSON are unchanged.
 */
export const ARTIFACT_ARRAY_CLASSIFICATION: Readonly<Record<ArtifactArrayKey, 'ranked' | 'set'>> = {
    // Ranked (6): bounded leaderboards whose order IS the finding.
    byTool: 'ranked',
    bySession: 'ranked',
    topStepsByTokens: 'ranked',
    topStepsByDuration: 'ranked',
    // CacheWasteStat.topSteps — "largest offenders", artifact.ts (0581).
    topSteps: 'ranked',
    // DerivedVariables.bottlenecks — "by ms descending", derived.ts (0554).
    bottlenecks: 'ranked',
    // Sets (12): order is incidental; sorted for digest stability.
    coverage: 'set',
    daily: 'set',
    loops: 'set',
    warnings: 'set',
    // PairingStat[] per-(executor, role) aggregation (feature J8).
    pairings: 'set',
    ladderSnapshot: 'set',
    stepSupport: 'set',
    phases: 'set', // DerivedVariables.phases.phases (PhaseResult)
    tools: 'set', // ArtifactSelector.tools
    skills: 'set', // ArtifactSelector.skills
    sources: 'set', // ArtifactSelector.sources
    models: 'set', // ArtifactSelector.models
};

/**
 * Artifact arrays whose ORDER is part of the evidence, so canonicalization must not sort them.
 * **Derived** from `ARTIFACT_ARRAY_CLASSIFICATION`, never hand-maintained.
 */
export const RANKED_ARTIFACT_KEYS: ReadonlySet<string> = new Set(
    Object.entries(ARTIFACT_ARRAY_CLASSIFICATION)
        .filter(([, kind]) => kind === 'ranked')
        .map(([key]) => key),
);

// Compile-time exhaustiveness guard: the record must cover every ArtifactArrayKey.
type ClassificationCoversAllKeys =
    Exclude<ArtifactArrayKey, keyof typeof ARTIFACT_ARRAY_CLASSIFICATION> extends never ? true : never;
const _classificationExhaustive: ClassificationCoversAllKeys = true;
void _classificationExhaustive;

/** Recursively canonicalize so equivalent evidence digests identically (sorted keys, undefined→null). */
function canonicalize(value: unknown, key: string): JsonValue {
    // Exclude only volatile generation fields — never derive validity from them.
    if (key === 'generatedAt' || key === 'validatedAt' || key === 'baselineArtifactDigest') return null;
    if (Array.isArray(value)) {
        const raw = (value as unknown[]).map((v) => JSON.stringify(canonicalize(v, '')));
        // Rankings keep order; plain lists sort.
        return RANKED_ARTIFACT_KEYS.has(key) ? raw : [...raw].sort();
    }
    if (value !== null && typeof value === 'object') {
        const out: { [k: string]: JsonValue } = {};
        for (const k of Object.keys(value as Record<string, unknown>).sort()) {
            out[k] = canonicalize((value as Record<string, unknown>)[k], k);
        }
        return out;
    }
    return value as JsonValue;
}

/**
 * SHA-256 over the canonicalized artifact. `population` is included — a change in true
 * selection count is a change in evidence (0657 / ADR-080).
 */
export function semanticArtifactDigest(artifactJson: unknown): string {
    const material = JSON.stringify(canonicalize(artifactJson, 'root'));
    return createHash('sha256').update(material).digest('hex');
}
