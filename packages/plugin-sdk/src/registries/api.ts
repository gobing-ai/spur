import type { Logger } from '@gobing-ai/ts-infra';
import type { TrustEngine } from '../trust';
import { Registry } from './base';

// ── ApiImpl ─────────────────────────────────────────────────────────

/** Plugin API route handler: receives a Request, returns a Response. */
export interface ApiImpl {
    handler: (req: Request) => Response | Promise<Response>;
}

// ── ApiRegistry ─────────────────────────────────────────────────────

/** Registry of plugin-mounted API route handlers. */
export class ApiRegistry extends Registry<ApiImpl> {
    constructor(trust: TrustEngine, logger: Logger) {
        super('api', trust, logger);
    }
}
