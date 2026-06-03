import type { Logger } from '@gobing-ai/ts-infra';
import type { TrustEngine } from '../trust';
import { Registry } from './base';

/** Plugin dependency-injection provider: resolves typed values by key. */
export interface Provider {
    provide: <T>(key: string) => T;
}

/** Registry of plugin DI providers. */
export class ProviderRegistry extends Registry<Provider> {
    constructor(trust: TrustEngine, logger: Logger) {
        super('providers', trust, logger);
    }
}
