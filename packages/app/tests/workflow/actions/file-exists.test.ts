import { describe, expect, test } from 'bun:test';
import type { ActionRunContext } from '@gobing-ai/ts-dual-workflow-engine';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { FileExistsActionRunner } from '../../../src/workflow/actions/file-exists';

function makeCtx(): ActionRunContext {
    return { runId: 'test-1', stateOrNodeId: 's1', workdir: '/tmp', vars: {}, env: {} };
}

describe('FileExistsActionRunner', () => {
    test('returns ok:true when file exists', async () => {
        const fs = { exists: async () => true } as unknown as FileSystem;
        const runner = new FileExistsActionRunner(fs);
        const result = await runner.execute({ path: 'foo.txt' }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({ exists: true });
    });

    test('returns ok:false when file missing', async () => {
        const fs = { exists: async () => false } as unknown as FileSystem;
        const runner = new FileExistsActionRunner(fs);
        const result = await runner.execute({ path: 'missing.txt' }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.data).toMatchObject({ exists: false });
    });

    test('negate inverts the result', async () => {
        const fs = { exists: async () => false } as unknown as FileSystem;
        const runner = new FileExistsActionRunner(fs);
        const result = await runner.execute({ path: 'missing.txt', negate: true }, makeCtx());
        expect(result.ok).toBe(true);
    });

    test('rejects missing path', async () => {
        const fs = { exists: async () => true } as unknown as FileSystem;
        const runner = new FileExistsActionRunner(fs);
        const result = await runner.execute({}, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('path is required');
    });
});
