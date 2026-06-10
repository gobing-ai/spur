import { describe, expect, test } from 'bun:test';
import type { ActionRunContext } from '@gobing-ai/ts-dual-workflow-engine';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { FileReadActionRunner } from '../../../src/workflow/actions/file-read';

function makeCtx(): ActionRunContext {
    return { runId: 'test-1', stateOrNodeId: 's1', workdir: '/tmp', vars: {}, env: {} };
}

describe('FileReadActionRunner', () => {
    test('reads file content', async () => {
        const fs = {
            stat: async () => ({ size: 5, isFile: () => true, isDirectory: () => false, mtimeMs: 0 }),
            readFile: async () => 'hello',
        } as unknown as FileSystem;
        const runner = new FileReadActionRunner(fs);
        const result = await runner.execute({ path: 'f.txt' }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({ content: 'hello', size: 5 });
    });

    test('returns error when file not found', async () => {
        const fs = { stat: async () => null } as unknown as FileSystem;
        const runner = new FileReadActionRunner(fs);
        const result = await runner.execute({ path: 'missing.txt' }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('file not found');
    });

    test('rejects file exceeding maxSize', async () => {
        const fs = {
            stat: async () => ({ size: 100, isFile: () => true, isDirectory: () => false, mtimeMs: 0 }),
        } as unknown as FileSystem;
        const runner = new FileReadActionRunner(fs);
        const result = await runner.execute({ path: 'big.txt', maxSize: 50 }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('file too large');
    });

    test('rejects missing path', async () => {
        const fs = { stat: async () => null } as unknown as FileSystem;
        const runner = new FileReadActionRunner(fs);
        const result = await runner.execute({}, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('path is required');
    });
});
