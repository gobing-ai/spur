import { describe, expect, test } from 'bun:test';

describe('stubs command', () => {
    test('module can be imported', async () => {
        const mod = await import('../../src/commands/stubs');
        expect(mod).toBeDefined();
    });
});
