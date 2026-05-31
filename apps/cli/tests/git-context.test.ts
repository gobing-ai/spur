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
        expect(ctx.root?.length).toBeGreaterThan(0);
        expect(typeof ctx.branch).toBe('string');
        expect(typeof ctx.dirty).toBe('boolean');
    });

    test('root is an absolute path when present', async () => {
        const ctx = await gitContext(process.cwd());
        if (ctx.root !== null) {
            expect(ctx.root).toStartWith('/');
        }
    });

    test('branch is null or non-empty string', async () => {
        const ctx = await gitContext(process.cwd());
        if (ctx.branch !== null) {
            expect(ctx.branch.length).toBeGreaterThan(0);
        }
    });

    test('dirty is boolean', async () => {
        const ctx = await gitContext(process.cwd());
        expect(typeof ctx.dirty).toBe('boolean');
    });

    test('handles non-existent path gracefully', async () => {
        const ctx = await gitContext('/nonexistent/path/that/does/not/exist');
        expect(ctx.root).toBeNull();
        expect(ctx.branch).toBeNull();
        expect(ctx.dirty).toBeFalse();
    });
});
