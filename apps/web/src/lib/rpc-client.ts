import { contract } from '@gobing-ai/spur-contracts';
import { createORPCClient } from '@orpc/client';
import type { ContractRouterClient } from '@orpc/contract';
import type { JsonifiedClient } from '@orpc/openapi-client';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { onError } from '@orpc/shared';

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
/**
 * Resolve the public API URL for browser, SSR, and test contexts.
 *
 * In both dev and production the API is served same-origin: the unified dev
 * server (W5/0081) serves the Hono API in-process via @hono/vite-dev-server
 * on the same port as the board (4321); production serves it from the same
 * origin via Hono serveStatic or Cloudflare Workers. Set PUBLIC_API_URL to
 * override (e.g. when running the standalone server on a separate port).
 */
export function resolveApiUrl(
    envUrl = import.meta.env.PUBLIC_API_URL,
    origin = globalThis.location?.origin,
    _isDev = import.meta.env.DEV,
): string {
    if (envUrl) return envUrl;
    return origin && origin !== 'null' ? new URL('/api', origin).toString() : 'http://localhost:3000/api';
}

/**
 * Timeout-wrapped fetch — aborts via `AbortController` after `ms` (default 10s).
 */
export function fetchWithTimeout(request: Request, ms = 10_000): Promise<Response> {
    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(), ms);
    // Race: if the original request has an abort signal (e.g. useEffect cleanup),
    // forward it to our controller so the fetch is aborted on either signal.
    const origSignal = request.signal;
    if (origSignal) {
        origSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    const req = new Request(request, { signal: controller.signal });
    const fetcher = _testFetch ?? fetch;
    return fetcher(req).finally(() => clearTimeout(handle));
}

/**
 * Adapter: matches OpenAPILink's fetch signature and delegates to fetchWithTimeout.
 */
export function apiFetchWithTimeout(request: Request): Promise<Response> {
    return fetchWithTimeout(request);
}

/** Typed oRPC OpenAPI client — derived from the contract so contract↔client drift fails at compile time. */
export type ApiClient = JsonifiedClient<ContractRouterClient<typeof contract>>;

/**
 * `onError` adapter-interceptor callback: surfaces transport failures (network reject / timeout abort)
 * for the error boundary / telemetry. Adapter interceptors fire on a rejected fetch, not on HTTP error
 * statuses (those throw an `ORPCError` at the client layer).
 */
export function logTransportError(error: unknown): void {
    if (typeof globalThis !== 'undefined' && globalThis.dispatchEvent) {
        globalThis.dispatchEvent(
            new CustomEvent('api-error', {
                detail: { message: error instanceof Error ? error.message : String(error) },
            }),
        );
    }
}

/** Singleton typed oRPC client: 10s request timeout + a tracing/error interceptor. */
export const api: ApiClient = createORPCClient(
    new OpenAPILink(contract, {
        url: resolveApiUrl(),
        fetch: apiFetchWithTimeout,
        adapterInterceptors: [onError(logTransportError)],
    }),
);
