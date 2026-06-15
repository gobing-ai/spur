import { afterAll, describe, expect, test } from 'bun:test';
import type { DbAdapter } from '@gobing-ai/ts-db';
import { dbHealthCheck } from '../src/db';

/**
 * Minimal mock that throws on queryFirst to exercise the dbHealthCheck catch path.
 */
function mockDb(shouldThrow: boolean): DbAdapter {
    return {
        queryFirst: async <T>(): Promise<T | undefined> => {
            if (shouldThrow) {
                throw new Error('Connection refused');
            }
            return { one: 1 } as unknown as T;
        },
        queryAll: async () => [],
        exec: async () => {},
        run: async () => {},
        close: () => {},
    } as unknown as DbAdapter;
}

describe('dbHealthCheck', () => {
    test('returns true when the DB responds to a trivial query', async () => {
        const db = mockDb(false);
        const result = await dbHealthCheck(db);
        expect(result).toBe(true);
    });

    test('returns false when the DB throws', async () => {
        const db = mockDb(true);
        const result = await dbHealthCheck(db);
        expect(result).toBe(false);
    });
});
