import { describe, expect, test } from 'bun:test';

import { verifyPackExtract } from './verify-pack';

// The marketplace drift guard moved to `spur builder bump-ver --check` (script-absorption PR-9);
// its coverage lives in apps/cli/tests/release-ops-publish.test.ts.

describe('verifyPackExtract', () => {
    test('rejects an extracted tree missing the marketplace manifest', async () => {
        await expect(verifyPackExtract('definitely-not-a-real-extracted-package-root')).rejects.toThrow();
    });
});
