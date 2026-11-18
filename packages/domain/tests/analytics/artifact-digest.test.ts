import { describe, expect, test } from 'bun:test';
import {
    ARTIFACT_ARRAY_CLASSIFICATION,
    type ArtifactArrayKey,
    RANKED_ARTIFACT_KEYS,
    semanticArtifactDigest,
} from '../../src/analytics/artifact-digest';

describe('artifact-digest (task 0669)', () => {
    test('classification is non-empty, unique, and every value is ranked or set', () => {
        const keys = Object.keys(ARTIFACT_ARRAY_CLASSIFICATION) as ArtifactArrayKey[];
        expect(keys.length).toBeGreaterThan(0);
        expect(new Set(keys).size).toBe(keys.length);
        for (const [key, kind] of Object.entries(ARTIFACT_ARRAY_CLASSIFICATION) as Array<
            [ArtifactArrayKey, 'ranked' | 'set']
        >) {
            expect(['ranked', 'set'], `${key} must be classified ranked or set`).toContain(kind);
        }
    });

    test('RANKED_ARTIFACT_KEYS is derived from the classification, never retyped', () => {
        const expected = new Set(
            Object.entries(ARTIFACT_ARRAY_CLASSIFICATION)
                .filter(([, kind]) => kind === 'ranked')
                .map(([key]) => key),
        );
        expect(RANKED_ARTIFACT_KEYS.size).toBe(expected.size);
        for (const key of expected) {
            expect(RANKED_ARTIFACT_KEYS.has(key)).toBeTrue();
        }
    });

    test('ranked arrays preserve order; set arrays sort; volatile fields are excluded', () => {
        const ranked = {
            byTool: [{ n: 1 }, { n: 2 }],
            bySession: [{ n: 1 }, { n: 2 }],
            topStepsByTokens: [{ n: 1 }, { n: 2 }],
            topStepsByDuration: [{ n: 1 }, { n: 2 }],
            cacheWaste: { topSteps: [{ n: 1 }, { n: 2 }] },
            derived: { bottlenecks: [{ n: 1 }, { n: 2 }] },
        };
        const reordered = structuredClone(ranked);
        reordered.byTool.reverse();
        reordered.bySession.reverse();
        reordered.topStepsByTokens.reverse();
        reordered.topStepsByDuration.reverse();
        reordered.cacheWaste.topSteps.reverse();
        reordered.derived.bottlenecks.reverse();
        expect(semanticArtifactDigest(reordered)).not.toBe(semanticArtifactDigest(ranked));

        const sets = {
            coverage: [{ id: 'A' }, { id: 'B' }],
            daily: [{ date: 'd1' }, { date: 'd2' }],
            loops: [{ repeats: 1 }, { repeats: 2 }],
            warnings: [{ code: 'a' }, { code: 'b' }],
            selector: { sources: ['b', 'a'], tools: ['y', 'x'], skills: ['z', 'k'], models: ['m2', 'm1'] },
        };
        const shuffled = structuredClone(sets);
        shuffled.coverage.reverse();
        shuffled.daily.reverse();
        shuffled.loops.reverse();
        shuffled.warnings.reverse();
        shuffled.selector = {
            sources: [...shuffled.selector.sources].reverse(),
            tools: [...shuffled.selector.tools].reverse(),
            skills: [...shuffled.selector.skills].reverse(),
            models: [...shuffled.selector.models].reverse(),
        };
        expect(semanticArtifactDigest(shuffled)).toBe(semanticArtifactDigest(sets));

        const withVolatile = {
            totals: { messages: 3 },
            generatedAt: 'X',
            validatedAt: 'Y',
            baselineArtifactDigest: 'Z',
        };
        const otherVolatile = {
            totals: { messages: 3 },
            generatedAt: 'A',
            validatedAt: 'B',
            baselineArtifactDigest: 'C',
        };
        expect(semanticArtifactDigest(withVolatile)).toBe(semanticArtifactDigest(otherVolatile));
    });
});

describe('protocolUsage arrays (1398 R3)', () => {
    test('every protocolUsage array is a set: order does not move the digest', () => {
        const withUsage = {
            protocolUsage: {
                tools: [
                    { tool: 'a', calls: 1 },
                    { tool: 'b', calls: 2 },
                ],
                resources: [
                    { uri: 'spur://a', reads: 1 },
                    { uri: 'spur://b', reads: 2 },
                ],
                byActor: [
                    { actor: 'x', calls: 1 },
                    { actor: 'y', calls: 2 },
                ],
                a2a: [
                    { member: 'm1', received: 1 },
                    { member: 'm2', received: 2 },
                ],
                authDenied: [
                    { surface: 'mcp', reason: 'missing', count: 1 },
                    { surface: 'a2a', reason: 'mismatch', count: 2 },
                ],
            },
        };
        const shuffled = structuredClone(withUsage);
        shuffled.protocolUsage.tools.reverse();
        shuffled.protocolUsage.resources.reverse();
        shuffled.protocolUsage.byActor.reverse();
        shuffled.protocolUsage.a2a.reverse();
        shuffled.protocolUsage.authDenied.reverse();
        expect(semanticArtifactDigest(shuffled)).toBe(semanticArtifactDigest(withUsage));
    });
});
