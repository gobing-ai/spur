import type { Logger } from '@gobing-ai/ts-infra';
import type { TrustEngine } from '../trust';
import { Registry } from './base';

export interface UiImpl {
    /** Mount the UI into the given container element. */
    mount: (container: unknown) => void;
}
export class UiRegistry extends Registry<UiImpl> {
    constructor(trust: TrustEngine, logger: Logger) {
        super('ui', trust, logger);
    }

    /** Pre-register a built-in UI component. */
    public registerBuiltin(name: string, impl: UiImpl): void {
        this.preRegister(name, impl);
    }
}
