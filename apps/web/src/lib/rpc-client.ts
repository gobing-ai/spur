import { contract, decodeApiErrorBody } from '@gobing-ai/spur-contracts';
import { createORPCClient, ORPCError } from '@orpc/client';
import type { ContractRouterClient } from '@orpc/contract';
import type { JsonifiedClient } from '@orpc/openapi-client';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { onError } from '@orpc/shared';

import { apiFetchWithTimeout } from './rpc-fetch';

/** Shared request deadline and injectable fetch seam; preserve the existing client import path. */
export {
    apiFetchWithTimeout,
    DEFAULT_FETCH_TIMEOUT_MS,
    fetchWithTimeout,
    resetFetchForTesting,
    setFetchForTesting,
} from './rpc-fetch';

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

/**
 * Decode the transport error envelope the `/api/*` seam emits for typed domain errors
 * (`{ ok: false, error: { code, message, details? } }` — `apps/server/src/bootstrap.ts`).
 *
 * Without this, `OpenAPILink` cannot match the body to `isORPCErrorJson`, so it throws a
 * synthesised `ORPCError('CONFLICT', status, 'Conflict')` and the caller loses both the domain
 * code and the reason — the guard message that says *why* a transition was refused.
 *
 * The HTTP status comes from the response, not a second code→status table: that mapping is owned by
 * the server's domain-error table, and copying it here is how the two paths would drift.
 */
export function decodeApiError(
    deserializedBody: unknown,
    response: { status: number },
): ORPCError<string, unknown> | undefined {
    const decoded = decodeApiErrorBody(deserializedBody);
    if (decoded === undefined) return undefined;
    return new ORPCError(decoded.code, {
        status: response.status,
        message: decoded.message,
        data: decoded.details,
    });
}

/** Singleton typed oRPC client: 30s request timeout + a tracing/error interceptor. */
export const api: ApiClient = createORPCClient(
    new OpenAPILink(contract, {
        url: resolveApiUrl(),
        fetch: apiFetchWithTimeout,
        customErrorResponseBodyDecoder: (body, response) => decodeApiError(body, response),
        adapterInterceptors: [onError(logTransportError)],
    }),
);
