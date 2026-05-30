import { contract } from '@gobing-ai/spur-contracts';
import { createORPCClient } from '@orpc/client';
import type { ContractRouterClient } from '@orpc/contract';
import type { JsonifiedClient } from '@orpc/openapi-client';
import { OpenAPILink } from '@orpc/openapi-client/fetch';

/** Resolve the public API URL for browser, SSR, and test contexts. */
export function resolveApiUrl(envUrl = import.meta.env.PUBLIC_API_URL): string {
    if (envUrl) return envUrl;
    if (import.meta.env.DEV) return 'http://localhost:3000/api';
    return '/api';
}

/** Create the typed oRPC OpenAPI client used by the web tier. */
export function createApiClient(baseUrl = resolveApiUrl()): JsonifiedClient<ContractRouterClient<typeof contract>> {
    const link = new OpenAPILink(contract, {
        url: baseUrl,
    });

    return createORPCClient(link);
}

/** Default typed client for application code. */
export const api = createApiClient();
