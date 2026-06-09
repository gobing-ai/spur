import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';
import { getRuntime, resetRuntime } from '../src/worker';

// Exercises the lazy-singleton rejection-reset branch in worker.ts: a failed
// bootstrap must NOT be cached — the next call retries instead of replaying the
// stale rejection. The injectable BootstrapFn lets us force a rejection without
// module mocking.

const fakeRuntime = { stop: async () => {} } as unknown as ApplicationRuntime;

// Reset around each test so the module-level singleton can't leak in from other
// test files (app.test.ts / worker.test.ts prime it via real fetch calls).
beforeEach(() => {
    resetRuntime();
});

afterEach(() => {
    resetRuntime();
});

describe('getRuntime lazy singleton', () => {
    test('caches a successful bootstrap across calls (bootstrap runs once)', async () => {
        let calls = 0;
        const bootstrap = async () => {
            calls += 1;
            return fakeRuntime;
        };

        const first = await getRuntime({}, bootstrap);
        const second = await getRuntime({}, bootstrap);

        expect(first).toBe(fakeRuntime);
        expect(second).toBe(fakeRuntime);
        expect(calls).toBe(1);
    });

    test('does not cache a rejected bootstrap — the next call retries and succeeds', async () => {
        let calls = 0;
        const bootstrap = async () => {
            calls += 1;
            if (calls === 1) {
                throw new Error('bootstrap boom');
            }
            return fakeRuntime;
        };

        await expect(getRuntime({}, bootstrap)).rejects.toThrow('bootstrap boom');

        const recovered = await getRuntime({}, bootstrap);
        expect(recovered).toBe(fakeRuntime);
        expect(calls).toBe(2);
    });
});
