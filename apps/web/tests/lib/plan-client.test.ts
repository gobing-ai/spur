import { afterEach, describe, expect, test } from 'bun:test';
import { loadPlanContent, loadPlanFiles, type PlanFileDetail, type PlanFileSummary } from '../../src/lib/plan-client';
import { resetFetchForTesting, setFetchForTesting } from '../../src/lib/rpc-client';

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function setFetch(handler: (req: Request) => Response): void {
    setFetchForTesting(((req: Request) => Promise.resolve(handler(req))) as unknown as typeof fetch);
}

afterEach(() => {
    resetFetchForTesting();
});

describe('loadPlanFiles', () => {
    test('returns plan files array on success', async () => {
        const sample: PlanFileSummary[] = [
            {
                id: 'docs/02_ROADMAP.md',
                path: 'docs/02_ROADMAP.md',
                name: '02_ROADMAP.md',
                title: '02 Roadmap — Spur',
                category: 'roadmap',
            },
            {
                id: 'docs/plans/2026-09-21-next-gen.md',
                path: 'docs/plans/2026-09-21-next-gen.md',
                name: '2026-09-21-next-gen.md',
                title: 'Next Gen Plan',
                category: 'plan',
            },
        ];
        setFetch(() => jsonResponse(200, { files: sample, total: sample.length }));
        const result = await loadPlanFiles();
        expect(result).toEqual(sample);
    });

    test('throws error on non-ok HTTP status', async () => {
        setFetch(() => jsonResponse(500, { error: 'Internal server error' }));
        await expect(loadPlanFiles()).rejects.toThrow('plan files fetch failed: 500');
    });

    test('throws error when response files is not an array', async () => {
        setFetch(() => jsonResponse(200, { files: 'invalid' }));
        await expect(loadPlanFiles()).rejects.toThrow('plan files: invalid response shape');
    });
});

describe('loadPlanContent', () => {
    test('returns file detail and properly encodes path query param', async () => {
        const sample: PlanFileDetail = {
            ok: true,
            path: 'docs/plans/2026-09-21-next-gen.md',
            title: 'Next Gen Plan',
            content: '# Next Gen Plan\n\nBody content.',
        };
        let capturedUrl = '';
        setFetch((req) => {
            capturedUrl = req.url;
            return jsonResponse(200, sample);
        });

        const result = await loadPlanContent('docs/plans/2026-09-21-next-gen.md');
        expect(result).toEqual(sample);
        expect(capturedUrl).toContain('/project/plans/file?path=docs%2Fplans%2F2026-09-21-next-gen.md');
    });

    test('throws error on non-ok HTTP status', async () => {
        setFetch(() => jsonResponse(404, { ok: false, error: 'File not found' }));
        await expect(loadPlanContent('docs/plans/missing.md')).rejects.toThrow('plan file fetch failed: 404');
    });

    test('throws error when response content is invalid', async () => {
        setFetch(() => jsonResponse(200, { ok: false }));
        await expect(loadPlanContent('docs/02_ROADMAP.md')).rejects.toThrow('plan file: invalid response shape');
    });
});
