// ── Injectable fetch seam for tests ───────────────────────────────────
// Tests inject a mock fetch via setFetchForTesting instead of mutating
// globalThis.fetch. This keeps the no-globalthis-fetch-mutation rule
// enforceable (http-boundaries.yaml strict preset). ADR-005 §4 Type Seam.
let _testFetch: typeof fetch | undefined;

/** Replace the fetch implementation for the current test. Call resetFetchForTesting in afterEach. */
export function setFetchForTesting(fn: typeof fetch): void {
    _testFetch = fn;
}

/** Restore the platform fetch after a test. */
export function resetFetchForTesting(): void {
    _testFetch = undefined;
}

/** Default abort deadline for board API calls, in milliseconds. */
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/**
 * Timeout-wrapped fetch — aborts via `AbortController` after `ms` (default 30s).
 */
export function fetchWithTimeout(request: Request, ms = DEFAULT_FETCH_TIMEOUT_MS): Promise<Response> {
    const controller = new AbortController();
    const handle = setTimeout(
        () => controller.abort(new DOMException(`Request timed out after ${ms}ms`, 'TimeoutError')),
        ms,
    );
    const origSignal = request.signal;
    const onAbort = () => controller.abort(origSignal.reason);
    if (origSignal.aborted) onAbort();
    else origSignal.addEventListener('abort', onAbort, { once: true });
    const req = new Request(request, { signal: controller.signal });
    const fetcher = _testFetch ?? fetch;
    return fetcher(req).finally(() => {
        clearTimeout(handle);
        origSignal.removeEventListener('abort', onAbort);
    });
}

/**
 * Adapter: matches OpenAPILink's fetch signature and delegates to fetchWithTimeout.
 */
export function apiFetchWithTimeout(request: Request): Promise<Response> {
    return fetchWithTimeout(request, DEFAULT_FETCH_TIMEOUT_MS);
}
