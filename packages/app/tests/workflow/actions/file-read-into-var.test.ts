import { describe, expect, test } from 'bun:test';
import type { ActionRunContext } from '@gobing-ai/ts-dual-workflow-engine';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { FileReadIntoVarActionRunner } from '../../../src/workflow/actions/file-read-into-var';

function makeCtx(overrides: Partial<ActionRunContext> = {}): ActionRunContext {
    return {
        runId: 'test-1',
        stateOrNodeId: 's1',
        workdir: '/tmp',
        vars: {},
        env: {},
        ...overrides,
    };
}

describe('FileReadIntoVarActionRunner', () => {
    test('reads file content and projects it into setVars', async () => {
        const fs = {
            stat: async () => ({ size: 5, isFile: () => true, isDirectory: () => false, mtimeMs: 0 }),
            readFile: async () => 'hello',
        } as unknown as FileSystem;
        const runner = new FileReadIntoVarActionRunner(fs);
        const result = await runner.execute({ path: 'f.txt', var: 'featureId' }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({ content: 'hello', var: 'featureId' });
        expect(result.setVars).toEqual({ featureId: 'hello' });
    });

    test('trims trailing whitespace by default', async () => {
        const fs = {
            stat: async () => ({ size: 7, isFile: () => true, isDirectory: () => false, mtimeMs: 0 }),
            readFile: async () => 'hello\n',
        } as unknown as FileSystem;
        const runner = new FileReadIntoVarActionRunner(fs);
        const result = await runner.execute({ path: 'f.txt', var: 'x' }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({ content: 'hello' });
        expect(result.setVars).toEqual({ x: 'hello' });
    });

    test('preserves trailing content when trim is false', async () => {
        const fs = {
            stat: async () => ({ size: 6, isFile: () => true, isDirectory: () => false, mtimeMs: 0 }),
            readFile: async () => 'hello\n',
        } as unknown as FileSystem;
        const runner = new FileReadIntoVarActionRunner(fs);
        const result = await runner.execute({ path: 'f.txt', var: 'x', trim: false }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.setVars).toEqual({ x: 'hello\n' });
    });

    test('returns clear error when file is missing', async () => {
        const fs = { stat: async () => null } as unknown as FileSystem;
        const runner = new FileReadIntoVarActionRunner(fs);
        const result = await runner.execute({ path: 'missing.txt', var: 'x' }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('file not found');
        expect(result.setVars).toBeUndefined();
    });

    test('rejects missing path option', async () => {
        const fs = { stat: async () => null } as unknown as FileSystem;
        const runner = new FileReadIntoVarActionRunner(fs);
        const result = await runner.execute({ var: 'x' }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('path is required');
    });

    test('rejects missing var option', async () => {
        const fs = { stat: async () => null } as unknown as FileSystem;
        const runner = new FileReadIntoVarActionRunner(fs);
        const result = await runner.execute({ path: 'f.txt' }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('var is required');
    });

    test('rejects invalid var names (engine vars schema requires [A-Za-z_][A-Za-z0-9_]*)', async () => {
        const fs = { stat: async () => null } as unknown as FileSystem;
        const runner = new FileReadIntoVarActionRunner(fs);
        for (const bad of ['1feature', 'feature-id', 'feature id', 'feature.id', '']) {
            const result = await runner.execute({ path: 'f.txt', var: bad }, makeCtx());
            expect(result.ok).toBe(false);
            // `''` is caught by the empty-string check; the rest by the regex.
            if (bad === '') {
                expect(result.error).toContain('var is required');
            } else {
                expect(result.error).toContain('var name must match');
            }
        }
    });
});
