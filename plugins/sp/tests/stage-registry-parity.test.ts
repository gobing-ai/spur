/**
 * stage-registry-parity — pins the plugin's inline type mirror against the
 * canonical domain schema (review finding C1).
 *
 * `plugins/sp/scripts/stage-registry-adapter.ts` re-declares the stage-registry
 * vocabularies inline because the plugin installs into foreign repos and cannot
 * import `@gobing-ai/spur-domain`. The mirror is deliberate; what was missing is
 * a guard. Without one the two copies drift silently and the plugin misroutes
 * lifecycle decisions instead of failing loudly — which is exactly what had
 * happened: `MUTATION_CLASSES` had diverged to a stale 4-value list and six
 * stage records carried mutation classes the domain no longer defines.
 *
 * These tests read the domain schema as TEXT rather than importing it, so the
 * gate keeps working from inside a plugin tree that has no workspace resolution.
 * Same real-tree discipline as `flag-contract-parity.test.ts`: the assertion runs
 * against the shipped files, in the sp suite, so it cannot be forgotten.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    ARTIFACT_DIRECTIONS,
    AUTHORITY_LANES,
    CONTEXT_LAYER_NAMES,
    EXECUTION_KINDS,
    MUTATION_CLASSES,
    REGISTERED_STAGES,
} from '../scripts/stage-registry-adapter';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const DOMAIN_SCHEMA = join(REPO_ROOT, 'packages', 'domain', 'src', 'stage-registry', 'schema.ts');

/**
 * Extract a `export const NAME = [...] as const;` string-literal array from the
 * domain schema source. Returns null when the constant is absent so a rename
 * upstream fails loudly here rather than silently skipping the comparison.
 */
export function extractStringConst(source: string, name: string): string[] | null {
    const re = new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`, 'm');
    const m = source.match(re);
    if (!m?.[1]) return null;
    return [...m[1].matchAll(/'([^']+)'/g)].map((q) => q[1] as string);
}

const domainSource = readFileSync(DOMAIN_SCHEMA, 'utf8');

describe('sp plugin — stage-registry mirror parity with packages/domain (C1)', () => {
    const cases: Array<{ name: string; plugin: readonly string[] }> = [
        { name: 'AUTHORITY_LANES', plugin: AUTHORITY_LANES },
        { name: 'MUTATION_CLASSES', plugin: MUTATION_CLASSES },
        { name: 'EXECUTION_KINDS', plugin: EXECUTION_KINDS },
        { name: 'ARTIFACT_DIRECTIONS', plugin: ARTIFACT_DIRECTIONS },
        { name: 'CONTEXT_LAYER_NAMES', plugin: CONTEXT_LAYER_NAMES },
    ];

    for (const { name, plugin } of cases) {
        test(`${name} matches the domain schema exactly (order included)`, () => {
            const domain = extractStringConst(domainSource, name);
            expect(
                domain,
                `${name} not found in ${DOMAIN_SCHEMA} — was it renamed? Update the plugin mirror and this gate together.`,
            ).not.toBeNull();
            expect(
                [...plugin],
                `${name} drifted between plugins/sp/scripts/stage-registry-adapter.ts and packages/domain/src/stage-registry/schema.ts. ` +
                    'The plugin cannot import the domain package, so the copies must be edited together.',
            ).toEqual(domain as string[]);
        });
    }

    test('loud failure: a missing domain constant is reported, never skipped', () => {
        // Guards the gate itself — a typo'd/renamed constant must return null
        // (→ failing assertion above), not an empty array that trivially passes.
        expect(extractStringConst(domainSource, 'NOT_A_REAL_CONSTANT')).toBeNull();
        expect(extractStringConst(domainSource, 'AUTHORITY_LANES')).not.toBeNull();
    });
});

describe('sp plugin — stage mutation_class values are drawn from the shared vocabulary', () => {
    test('every registered stage declares a mutation_class the domain defines', () => {
        const allowed = new Set<string>(MUTATION_CLASSES);
        for (const stage of REGISTERED_STAGES) {
            expect(
                allowed.has(stage.mutation_class),
                `stage "${stage.id}" declares mutation_class "${stage.mutation_class}", which is not in MUTATION_CLASSES`,
            ).toBe(true);
        }
    });

    test('stages shared with the domain registry agree on mutation_class', () => {
        // Parse `id: 'x' ... mutation_class: 'y'` pairs out of the domain registry
        // and compare only the stages both sides define. Adapter-only stages
        // (handover, fixall) are intentionally absent upstream.
        const domainPairs = new Map<string, string>();
        const re = /id:\s*'([a-z-]+)'[\s\S]*?mutation_class:\s*'([a-z]+)'/g;
        for (const m of domainSource.matchAll(re)) {
            if (m[1] && m[2] && !domainPairs.has(m[1])) domainPairs.set(m[1], m[2]);
        }
        expect(domainPairs.size, 'no id→mutation_class pairs parsed from the domain registry').toBeGreaterThan(0);

        const shared = REGISTERED_STAGES.filter((s) => domainPairs.has(s.id));
        expect(shared.length, 'expected the adapter to share stages with the domain registry').toBeGreaterThan(0);
        for (const stage of shared) {
            expect(
                stage.mutation_class,
                `stage "${stage.id}" mutation_class disagrees with packages/domain/src/stage-registry/schema.ts`,
            ).toBe(domainPairs.get(stage.id) as string);
        }
    });
});
