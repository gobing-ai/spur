import type { Logger } from '@gobing-ai/ts-infra';
import type { TrustEngine } from '../trust';
import { Registry } from './base';

// ── Rule TImpl ───────────────────────────────────────────────────────

export interface RuleImpl {
    evaluate: (context: Record<string, unknown>) => { pass: boolean; message: string };
}

// ── RuleRegistry ─────────────────────────────────────────────────────

export class RuleRegistry extends Registry<RuleImpl> {
    constructor(trust: TrustEngine, logger: Logger) {
        super('rules', trust, logger);
    }

    /** Expose preRegister for built-in seeding. */
    public seedBuiltin(name: string, impl: RuleImpl): void {
        this.preRegister(name, impl);
    }
}
