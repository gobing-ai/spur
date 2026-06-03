import type { Logger } from '@gobing-ai/ts-infra';
import type { TrustEngine } from '../trust';
import { Registry } from './base';

// ── ApiImpl ─────────────────────────────────────────────────────────

export interface ApiImpl {
    handler: (req: Request) => Response | Promise<Response>;
}

// ── ApiRegistry ─────────────────────────────────────────────────────

export class ApiRegistry extends Registry<ApiImpl> {
    constructor(trust: TrustEngine, logger: Logger) {
        super('api', trust, logger);
    }
}
