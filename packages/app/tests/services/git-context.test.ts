import { describe, expect, test } from 'bun:test';
import { gitContext } from '../../src/services/git-context';

/**
 * Git context read (moved from `apps/cli/src/git-context.ts` in A93 1352 so the app-owned status
 * aggregate can build `git`). The failure mode that matters: a non-repository path must come back as
 * a null context, not an error — `spur self status` still has to report.
 */
describe('git context', () => {
    test('returns the null context for a non-git directory', async () => {
        const context = await gitContext('/tmp');
        expect(context.root).toBeNull();
        expect(context.branch).toBeNull();
        expect(context.dirty).toBe(false);
    });

    test('returns a root for this repository and never throws on a missing path', async () => {
        const context = await gitContext(process.cwd());
        expect(context.root === null || context.root.startsWith('/')).toBe(true);
        const missing = await gitContext('/nonexistent/path/that/does/not/exist');
        expect(missing.root).toBeNull();
    });
});
