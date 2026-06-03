import type { Logger } from '@gobing-ai/ts-infra';
import type { TrustEngine } from '../trust';
import { Registry } from './base';

export interface Provider {
    provide: <T>(key: string) => T;
}

export class ProviderRegistry extends Registry<Provider> {
    constructor(trust: TrustEngine, logger: Logger) {
        super('providers', trust, logger);
    }
}
