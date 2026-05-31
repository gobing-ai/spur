import { describe, expect, test } from 'bun:test';
import { gitContext } from '../src/git-context';

describe('git context', () => {
    test('returns null git context for non-git directory', async () => {
        const ctx = await gitContext('/tmp');
        expect(ctx.root).toBeNull();
        expect(ctx.branch).toBeNull();
        expect(ctx.dirty).toBeFalse();
    });

    test('returns git context for current repo', async () => {
        const ctx = await gitContext(process.cwd());
        expect(ctx.root).toBeString();
        expect(typeof ctx.branch).toBe('string');
        expect(typeof ctx.dirty).toBe('boolean');
    });
});
