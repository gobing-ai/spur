import { contract } from '@gobing-ai/spur-contracts';
import { createORPCClient } from '@orpc/client';
import type { ContractRouterClient } from '@orpc/contract';
import type { JsonifiedClient } from '@orpc/openapi-client';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { onError } from '@orpc/shared';

/** Resolve the public API URL for browser, SSR, and test contexts. */
export function resolveApiUrl(
    envUrl = import.meta.env.PUBLIC_API_URL,
    origin = globalThis.location?.origin,
    isDev = import.meta.env.DEV,
): string {
    if (envUrl) return envUrl;
    if (isDev) return 'http://localhost:3000/api';
    return origin ? new URL('/api', origin).toString() : 'http://localhost:3000/api';
}

/**
 * Timeout-wrapped fetch — aborts via `AbortController` after `ms` (default 10s).
 */
export function fetchWithTimeout(request: Request, ms = 10_000): Promise<Response> {
    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(), ms);
    const req = new Request(request, { signal: controller.signal });
    return fetch(req).finally(() => clearTimeout(handle));
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
