import { describe, expect, test } from 'bun:test';

describe('domain stubs', () => {
    test('module can be imported', async () => {
        // domain-stubs.ts currently re-exports nothing (export {})
        const mod = await import('../../src/stubs/domain-stubs');
        expect(mod).toBeDefined();
    });
});
