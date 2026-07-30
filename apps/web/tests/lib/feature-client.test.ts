import { afterEach, describe, expect, test } from 'bun:test';
import {
    checkFeature,
    createChildFeature,
    createFeatureTask,
    createRootFeature,
    dispatchFeatureAction,
    linkTaskToFeature,
    loadFeatureShow,
    loadFeatures,
    saveFeatureBody,
    syncFeatureStatus,
    transitionFeature,
} from '../../src/lib/feature-client';
import type { CheckResult, FeatureShowData, FeatureSummary } from '../../src/lib/feature-types';
import { resetFetchForTesting, setFetchForTesting } from '../../src/lib/rpc-client';

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function setFetch(handler: () => Response): void {
    setFetchForTesting((() => Promise.resolve(handler())) as unknown as typeof fetch);
}

afterEach(() => {
    resetFetchForTesting();
});

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

describe('saveFeatureBody', () => {
    test('sends patch request and resolves on 200', async () => {
        setFetch(() => jsonResponse(200, { ok: true }));
        await expect(saveFeatureBody({ id: 'A', body: 'new content' })).resolves.toBeUndefined();
    });

    test('throws on error status', async () => {
        setFetch(() => jsonResponse(400, { error: { message: 'invalid body' } }));
        await expect(saveFeatureBody({ id: 'A', body: '' })).rejects.toThrow('invalid body');
    });

    test('throws generic error when payload is empty', async () => {
        setFetch(() => jsonResponse(500, {}));
        await expect(saveFeatureBody({ id: 'A', body: '' })).rejects.toThrow('body update failed: 500');
    });
});

describe('dispatchFeatureAction', () => {
    test('sends post request and returns action response', async () => {
        const responseData = {
            ok: true as const,
            data: { runId: 'job-1', action: 'plan', status: 'queued' as const },
        };
        setFetch(() => jsonResponse(200, responseData));
        const result = await dispatchFeatureAction({ id: 'A', action: 'plan' });
        expect(result).toEqual(responseData);
    });

    test('throws on error status', async () => {
        setFetch(() => jsonResponse(403, { error: { message: 'unauthorized' } }));
        await expect(dispatchFeatureAction({ id: 'A', action: 'plan' })).rejects.toThrow('unauthorized');
    });
});

describe('createChildFeature', () => {
    test('sends post request and returns create child response', async () => {
        const responseData = { ok: true as const, data: { id: 'A1', filePath: '/features/A1.md' } };
        setFetch(() => jsonResponse(200, responseData));
        const result = await createChildFeature({ id: 'A', name: 'Child A1' });
        expect(result).toEqual(responseData);
    });

    test('throws on error status', async () => {
        setFetch(() => jsonResponse(400, { error: { message: 'max depth reached' } }));
        await expect(createChildFeature({ id: 'A', name: 'Child' })).rejects.toThrow('max depth reached');
    });
});

describe('createRootFeature', () => {
    test('sends post request and returns root feature details', async () => {
        const data = { id: 'B', filePath: '/features/B.md' };
        setFetch(() => jsonResponse(200, { ok: true, data }));
        const result = await createRootFeature('Root Feature');
        expect(result).toEqual(data);
    });

    test('throws on error status', async () => {
        setFetch(() => jsonResponse(500, { error: { message: 'db error' } }));
        await expect(createRootFeature('Root Feature')).rejects.toThrow('db error');
    });

    test('throws on invalid shape', async () => {
        setFetch(() => jsonResponse(200, { ok: true }));
        await expect(createRootFeature('Root Feature')).rejects.toThrow('create feature: invalid response shape');
    });
});

describe('createFeatureTask', () => {
    test('sends post request and returns create task response', async () => {
        const responseData = { ok: true as const, data: { wbs: '1.1', filePath: '/tasks/1.1.md' } };
        setFetch(() => jsonResponse(200, responseData));
        const result = await createFeatureTask({ id: 'A', title: 'Task T1' });
        expect(result).toEqual(responseData);
    });

    test('throws on error status', async () => {
        setFetch(() => jsonResponse(400, { error: { message: 'task already exists' } }));
        await expect(createFeatureTask({ id: 'A', title: 'Task T1' })).rejects.toThrow('task already exists');
    });
});

describe('linkTaskToFeature', () => {
    test('sends patch request and returns link response', async () => {
        const responseData = { ok: true as const };
        setFetch(() => jsonResponse(200, responseData));
        const result = await linkTaskToFeature({ id: 'A', wbs: '1.1' });
        expect(result).toEqual(responseData);
    });

    test('throws on error status', async () => {
        setFetch(() => jsonResponse(404, { error: { message: 'task not found' } }));
        await expect(linkTaskToFeature({ id: 'A', wbs: '1.1' })).rejects.toThrow('task not found');
    });
});

describe('syncFeatureStatus', () => {
    test('sends post request and returns sync response', async () => {
        const responseData = {
            ok: true as const,
            data: { direction: 'pull' as const, affectedTasks: 1, applied: true, newStatus: 'executing' },
        };
        setFetch(() => jsonResponse(200, responseData));
        const result = await syncFeatureStatus({ id: 'A', direction: 'pull' });
        expect(result).toEqual(responseData);
    });

    test('throws on error status', async () => {
        setFetch(() => jsonResponse(500, { error: { message: 'sync failed' } }));
        await expect(syncFeatureStatus({ id: 'A', direction: 'pull' })).rejects.toThrow('sync failed');
    });
});
