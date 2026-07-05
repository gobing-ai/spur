import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { checkFeature, loadFeatureShow, loadFeatures, transitionFeature } from '../../src/lib/feature-client';
import type { CheckResult, FeatureShowData, FeatureSummary } from '../../src/lib/feature-types';

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
    originalFetch = globalThis.fetch;
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function setFetch(handler: () => Response): void {
    globalThis.fetch = (() => Promise.resolve(handler())) as unknown as typeof globalThis.fetch;
}

describe('loadFeatures', () => {
    test('returns data array on success', async () => {
        const sample: FeatureSummary = { id: 'A', name: 'Feature A', status: 'backlog' };
        setFetch(() => jsonResponse(200, { ok: true, data: [sample] }));
        const result = await loadFeatures(new AbortController().signal);
        expect(result).toEqual([sample]);
    });

    test('throws on HTTP error status', async () => {
        setFetch(() => jsonResponse(500, { ok: false }));
        await expect(loadFeatures(new AbortController().signal)).rejects.toThrow('feature list fetch failed: 500');
    });

    test('throws when ok flag is missing', async () => {
        setFetch(() => jsonResponse(200, { data: [] }));
        await expect(loadFeatures(new AbortController().signal)).rejects.toThrow('invalid response shape');
    });

    test('throws when data is not an array', async () => {
        setFetch(() => jsonResponse(200, { ok: true, data: { not: 'array' } }));
        await expect(loadFeatures(new AbortController().signal)).rejects.toThrow('invalid response shape');
    });
});

describe('loadFeatureShow', () => {
    test('returns feature detail on success', async () => {
        const sample: FeatureShowData = {
            id: 'A',
            name: 'Feature A',
            status: 'backlog',
            frontmatter: { key: 'val' },
            content: 'body',
            filePath: '/features/A.md',
        };
        setFetch(() => jsonResponse(200, { ok: true, data: sample }));
        const result = await loadFeatureShow('A', new AbortController().signal);
        expect(result).toEqual(sample);
    });

    test('throws on HTTP error', async () => {
        setFetch(() => jsonResponse(404, {}));
        await expect(loadFeatureShow('A', new AbortController().signal)).rejects.toThrow(
            'feature show fetch failed: 404',
        );
    });

    test('throws when data is missing', async () => {
        setFetch(() => jsonResponse(200, { ok: true }));
        await expect(loadFeatureShow('A', new AbortController().signal)).rejects.toThrow('invalid response shape');
    });
});

describe('transitionFeature', () => {
    test('returns new status on success', async () => {
        setFetch(() => jsonResponse(200, { ok: true, data: { status: 'executing' } }));
        const result = await transitionFeature('A', 'executing', new AbortController().signal);
        expect(result).toBe('executing');
    });

    test('falls back to toStatus when data.status is missing', async () => {
        setFetch(() => jsonResponse(200, { ok: true }));
        const result = await transitionFeature('A', 'wip', new AbortController().signal);
        expect(result).toBe('wip');
    });

    test('throws with server error message on failure', async () => {
        setFetch(() => jsonResponse(400, { error: { message: 'bad transition' } }));
        await expect(transitionFeature('A', 'invalid', new AbortController().signal)).rejects.toThrow('bad transition');
    });

    test('falls back to generic message when error body is missing', async () => {
        setFetch(() => jsonResponse(500, {}));
        await expect(transitionFeature('A', 'x', new AbortController().signal)).rejects.toThrow(
            'transition failed: 500',
        );
    });
});

describe('checkFeature', () => {
    test('returns check result on success', async () => {
        const sample: CheckResult = {
            id: 'A',
            status: 'pass',
            pass: true,
            findings: [],
            requiredSections: ['Requirements'],
            missingSections: [],
        };
        setFetch(() => jsonResponse(200, { ok: true, data: sample }));
        const result = await checkFeature('A', new AbortController().signal);
        expect(result).toEqual(sample);
    });

    test('throws on HTTP error', async () => {
        setFetch(() => jsonResponse(500, {}));
        await expect(checkFeature('A', new AbortController().signal)).rejects.toThrow(
            'feature check fetch failed: 500',
        );
    });

    test('throws on invalid shape', async () => {
        setFetch(() => jsonResponse(200, { ok: true }));
        await expect(checkFeature('A', new AbortController().signal)).rejects.toThrow('invalid response shape');
    });
});
