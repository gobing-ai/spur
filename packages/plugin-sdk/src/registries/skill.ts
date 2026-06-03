import type { Logger } from '@gobing-ai/ts-infra';
import type { TrustEngine } from '../trust';
import { Registry } from './base';

// ── SkillImpl ──────────────────────────────────────────────────────────
//
// A plugin-provided skill exposes an `invoke` entry point that receives
// string arguments and returns a string result asynchronously.

export interface SkillImpl {
    invoke(args: string[]): Promise<string>;
}

// ── SkillRegistry ──────────────────────────────────────────────────────

export class SkillRegistry extends Registry<SkillImpl> {
    constructor(trust: TrustEngine, logger: Logger) {
        super('skills', trust, logger);
    }

    /** Pre-register a built-in skill (no trust check). */
    public seedBuiltin(name: string, impl: SkillImpl): void {
        this.preRegister(name, impl);
    }
}
