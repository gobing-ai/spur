import { describe, expect, test } from 'bun:test';
import type { ArtifactSelector } from '../../src/analytics/artifact';
import { HISTORY_ARTIFACT_SCHEMA_VERSION, selectorDigest } from '../../src/analytics/artifact';

function selector(overrides: Partial<ArtifactSelector> = {}): ArtifactSelector {
    return {
        since: '2026-08-01T00:00:00Z',
        until: null,
        sources: ['claude', 'codex'],
        sessionId: null,
        runId: null,
        taskWbs: null,
        ...overrides,
    };
}

describe('history artifact', () => {
    test('schema version is 1', () => {
        expect(HISTORY_ARTIFACT_SCHEMA_VERSION).toBe(1);
    });

    test('same selector yields the same digest', () => {
        expect(selectorDigest(selector())).toBe(selectorDigest(selector()));
    });

    test('digest is stable across source-list order (canonicalization)', () => {
        const a = selectorDigest(selector({ sources: ['claude', 'codex'] }));
        const b = selectorDigest(selector({ sources: ['codex', 'claude'] }));
        expect(a).toBe(b);
    });

    test('digest is stable across undefined/null normalization', () => {
        const a = selectorDigest(selector({ since: null }));
        const b = selectorDigest({ ...selector(), since: undefined as unknown as null });
        expect(a).toBe(b);
    });

    test('changing a selector changes the digest', () => {
        const base = selectorDigest(selector());
        expect(selectorDigest(selector({ since: '2026-08-02T00:00:00Z' }))).not.toBe(base);
        expect(selectorDigest(selector({ sessionId: 'sess-1' }))).not.toBe(base);
        expect(selectorDigest(selector({ sources: ['claude'] }))).not.toBe(base);
        expect(selectorDigest(selector({ runId: 'run-1' }))).not.toBe(base);
    });

    test('digest is 8 hex characters', () => {
        expect(selectorDigest(selector())).toMatch(/^[0-9a-f]{8}$/);
    });

    test('all-sources (null) differs from an explicit source list', () => {
        const all = selectorDigest(selector({ sources: null }));
        const one = selectorDigest(selector({ sources: ['claude'] }));
        expect(all).not.toBe(one);
    });
});
