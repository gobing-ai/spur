import { describe, expect, test } from 'bun:test';
import { UsageSourceError } from '../../src/services/agent-usage-source';

// 0892 boundary remediation: the pure seam stays in packages/app; the
// spawn-based implementation lives in apps/cli. This pins the seam contract.

describe('UsageSourceError', () => {
    test('is an Error named UsageSourceError (fail-closed catch target)', () => {
        const error = new UsageSourceError('capture unusable');
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('UsageSourceError');
        expect(error.message).toBe('capture unusable');
    });
});
