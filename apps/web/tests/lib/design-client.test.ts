import { afterEach, describe, expect, test } from 'bun:test';
import {
    type DesignFileDetail,
    type DesignFileSummary,
    loadDesignContent,
    loadDesignFiles,
} from '../../src/lib/design-client';
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

describe('loadDesignFiles', () => {
    test('returns design files array on success', async () => {
        const sample: DesignFileSummary[] = [
            {
                id: 'DESIGN.md',
                path: 'DESIGN.md',
                name: 'DESIGN.md',
                title: 'UI/UX Design System',
                category: 'root',
            },
            {
                id: 'docs/04_DESIGN.md',
                path: 'docs/04_DESIGN.md',
                name: '04_DESIGN.md',
                title: 'Concrete Surfaces & Contracts',
                category: 'architecture',
            },
        ];
        setFetch(() => jsonResponse(200, { files: sample, total: sample.length }));
        const result = await loadDesignFiles();
        expect(result).toEqual(sample);
    });

    test('throws error on non-ok HTTP status', async () => {
        setFetch(() => jsonResponse(500, { error: 'Internal server error' }));
        await expect(loadDesignFiles()).rejects.toThrow('design files fetch failed: 500');
    });

    test('throws error when response files is not an array', async () => {
        setFetch(() => jsonResponse(200, { files: 'invalid' }));
        await expect(loadDesignFiles()).rejects.toThrow('design files: invalid response shape');
    });
});

describe('loadDesignContent', () => {
    test('returns file detail and properly encodes path query param', async () => {
        let requestedUrl = '';
        const sampleDetail: DesignFileDetail = {
            ok: true,
            path: 'docs/design/custom-workflow.md',
            title: 'Custom Workflow',
            content: '# Custom Workflow\n\nContent here.',
        };

        setFetch((req) => {
            requestedUrl = req.url;
            return jsonResponse(200, sampleDetail);
        });

        const result = await loadDesignContent('docs/design/custom-workflow.md');
        expect(result).toEqual(sampleDetail);
        expect(requestedUrl).toContain('path=docs%2Fdesign%2Fcustom-workflow.md');
    });

    test('throws error on 404 or non-ok response', async () => {
        setFetch(() => jsonResponse(404, { ok: false, error: 'File not found' }));
        await expect(loadDesignContent('docs/design/non-existent.md')).rejects.toThrow('design file fetch failed: 404');
    });

    test('throws error on invalid response shape (ok false or content not string)', async () => {
        setFetch(() => jsonResponse(200, { ok: false, path: 'DESIGN.md', title: '', content: 123 }));
        await expect(loadDesignContent('DESIGN.md')).rejects.toThrow('design file: invalid response shape');
    });
});
