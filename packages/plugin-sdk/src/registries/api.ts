import type { Logger } from '@gobing-ai/ts-infra';
import type { TrustEngine } from '../trust';
import { Registry } from './base';

// ── ApiImpl ─────────────────────────────────────────────────────────

/**
 * OpenAPI 3.1 path fragment a plugin contributes for its routes. Plain JSON
 * only — the SDK stays free of Hono/oRPC. The server re-prefixes and merges
 * `paths` into the generated document.
 */
export interface PluginOpenApiFragment {
    paths: Record<string, unknown>;
}

/** Plugin API route handler: receives a Request, returns a Response. */
export interface ApiImpl {
    handler: (req: Request) => Response | Promise<Response>;
    /** Optional OpenAPI 3.1 path fragment surfaced in the generated spec. */
    openapi?: PluginOpenApiFragment;
}

// ── ApiRegistry ─────────────────────────────────────────────────────

/** Registry of plugin-mounted API route handlers. */
export class ApiRegistry extends Registry<ApiImpl> {
    constructor(trust: TrustEngine, logger: Logger) {
        super('api', trust, logger);
    }
}
