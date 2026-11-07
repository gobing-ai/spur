// Intentionally outside ordinary discovery: rpc-client-mock registers a process-global module mock.
// rpc-fetch.test.ts runs this proof once in an isolated child and validates its JUnit evidence.
import { expect, test } from 'bun:test';
import * as shared from '../../src/lib/rpc-fetch';
import { buildFullRpcMock } from '../test-helpers/rpc-client-mock';

test('the rpc mock shares the real fetch functions and injection state', async () => {
    const mockSurface = buildFullRpcMock() as unknown as Pick<
        typeof shared,
        | 'DEFAULT_FETCH_TIMEOUT_MS'
        | 'fetchWithTimeout'
        | 'apiFetchWithTimeout'
        | 'setFetchForTesting'
        | 'resetFetchForTesting'
    >;
    expect(mockSurface.DEFAULT_FETCH_TIMEOUT_MS).toBe(shared.DEFAULT_FETCH_TIMEOUT_MS);
    expect(mockSurface.fetchWithTimeout).toBe(shared.fetchWithTimeout);
    expect(mockSurface.apiFetchWithTimeout).toBe(shared.apiFetchWithTimeout);
    expect(mockSurface.setFetchForTesting).toBe(shared.setFetchForTesting);
    expect(mockSurface.resetFetchForTesting).toBe(shared.resetFetchForTesting);
    shared.setFetchForTesting((async () => new Response('shared injection')) as unknown as typeof fetch);
    try {
        expect(await (await mockSurface.fetchWithTimeout(new Request('data:text/plain,wrong'))).text()).toBe(
            'shared injection',
        );
    } finally {
        shared.resetFetchForTesting();
    }
});
