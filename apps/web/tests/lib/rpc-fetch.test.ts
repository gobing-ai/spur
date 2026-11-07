import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as shared from '../../src/lib/rpc-fetch';

function abortableFetch(input: RequestInfo | URL): Promise<Response> {
    const { signal } = input as Request;
    return new Promise((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
}

const surface = shared;

afterEach(() => {
    surface.resetFetchForTesting();
});

describe('shared fetch', () => {
    test.each(['fetch', 'adapter'])('%s keeps the 30s deadline and TimeoutError reason', async (entry) => {
        const timer = spyOn(globalThis, 'setTimeout');
        surface.setFetchForTesting(abortableFetch as typeof fetch);
        try {
            const request = new Request('http://localhost/timeout');
            const result = entry === 'fetch' ? surface.fetchWithTimeout(request) : surface.apiFetchWithTimeout(request);
            expect(timer.mock.calls[0]?.[1]).toBe(30_000);
            // Drive the registered deadline instead of sleeping for 30 seconds.
            const onTimeout = timer.mock.calls[0]?.[0];
            if (typeof onTimeout !== 'function') throw new Error('missing request deadline');
            onTimeout();
            await expect(result).rejects.toMatchObject({
                name: 'TimeoutError',
                message: 'Request timed out after 30000ms',
            });
        } finally {
            timer.mockRestore();
        }
    });

    test('explicit deadline aborts with its timeout reason', async () => {
        surface.setFetchForTesting(abortableFetch as typeof fetch);
        await expect(surface.fetchWithTimeout(new Request('http://localhost/timeout'), 1)).rejects.toMatchObject({
            name: 'TimeoutError',
            message: 'Request timed out after 1ms',
        });
    });

    test.each(['before', 'during'])('caller cancellation %s fetch preserves the exact reason', async (when) => {
        const caller = new AbortController();
        const reason = new Error('caller navigated away');
        if (when === 'before') caller.abort(reason);
        surface.setFetchForTesting(abortableFetch as typeof fetch);
        const result = surface.fetchWithTimeout(new Request('http://localhost/cancel', { signal: caller.signal }), 20);
        if (when === 'during') caller.abort(reason);
        await expect(result).rejects.toBe(reason);
    });

    test.each(['success', 'failure'])('clears the deadline and caller listener after %s', async (outcome) => {
        const request = new Request('http://localhost/cleanup');
        const add = spyOn(request.signal, 'addEventListener');
        const remove = spyOn(request.signal, 'removeEventListener');
        const schedule = spyOn(globalThis, 'setTimeout');
        const clear = spyOn(globalThis, 'clearTimeout');
        const failure = new Error('network failed');
        surface.setFetchForTesting((async () => {
            if (outcome === 'failure') throw failure;
            return new Response('ok');
        }) as unknown as typeof fetch);
        try {
            const result = surface.fetchWithTimeout(request);
            if (outcome === 'failure') await expect(result).rejects.toBe(failure);
            else expect(await (await result).text()).toBe('ok');
            expect(add).toHaveBeenCalledTimes(1);
            expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1]);
            expect(clear).toHaveBeenCalledWith(schedule.mock.results[0]?.value);
        } finally {
            add.mockRestore();
            remove.mockRestore();
            schedule.mockRestore();
            clear.mockRestore();
        }
    });

    test('preserves request method, headers and body at the fetch boundary', async () => {
        surface.setFetchForTesting((async (input: RequestInfo | URL) => {
            const request = input as Request;
            expect(request.url).toBe('http://localhost/task');
            expect(request.method).toBe('POST');
            expect(request.headers.get('x-request-id')).toBe('1316');
            expect(await request.text()).toBe('task body');
            expect(request.signal.aborted).toBe(false);
            return new Response('created', { status: 201 });
        }) as typeof fetch);
        const response = await surface.fetchWithTimeout(
            new Request('http://localhost/task', {
                method: 'POST',
                headers: { 'x-request-id': '1316' },
                body: 'task body',
            }),
        );
        expect(response.status).toBe(201);
    });

    test('reset restores platform fetch without changing the global fetch', async () => {
        surface.setFetchForTesting((async () => new Response('injected')) as unknown as typeof fetch);
        expect(await (await surface.fetchWithTimeout(new Request('data:text/plain,platform'))).text()).toBe('injected');
        surface.resetFetchForTesting();
        expect(await (await surface.fetchWithTimeout(new Request('data:text/plain,platform'))).text()).toBe('platform');
    });
});

test('the rpc mock shares the real fetch functions and injection state without polluting sibling modules', () => {
    const runDir = fileURLToPath(new URL('../../../../.spur/run/', import.meta.url));
    mkdirSync(runDir, { recursive: true });
    const report = `${runDir}1316-rpc-mock.junit.xml`;
    // The helper auto-registers mock.module; keep that side effect out of the ordinary parent process.
    const child = Bun.spawnSync({
        cmd: [
            'bun',
            'test',
            '--isolate',
            './tests/lib/rpc-fetch-mock.ts',
            '--reporter=junit',
            `--reporter-outfile=${report}`,
        ],
        cwd: fileURLToPath(new URL('../..', import.meta.url)),
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 120_000,
    });
    if (child.exitCode !== 0) console.error(child.stderr.toString().slice(-8192));
    expect(child.exitCode).toBe(0);
    const junit = readFileSync(report, 'utf8');
    expect(junit).toMatch(/<testsuites[^>]*tests="1"/);
    expect(junit).toMatch(/<testsuites[^>]*failures="0"/);
    expect(junit).toMatch(/<testsuites[^>]*assertions="[1-9]\d*"/);
});
