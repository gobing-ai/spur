import type { Logger } from '@gobing-ai/ts-infra';
import type { TrustEngine } from '../trust';
import { Registry } from './base';

// ── HarnessRegistry<TImpl> ────────────────────────────────────────────────
//
// Harnesses detect the active AI coding agent and execute prompts through it.
// Built-in harnesses (e.g. codex, claude) are seeded via preRegister().
// Plugins can replace or extend with custom harnesses subjected to trust policy.

/** Harness implementation: environment detection + prompt execution. */
export interface HarnessImpl {
    /** Detect whether this harness applies to the current environment. */
    detect: () => boolean;
    /** Execute a prompt through the detected agent. */
    execute: (prompt: string) => Promise<string>;
}

/** Registry of agent harnesses (detect + execute prompts). */
export class HarnessRegistry extends Registry<HarnessImpl> {
    constructor(trust: TrustEngine, logger: Logger) {
        super('harnesses', trust, logger);
    }

    /** Expose preRegister for built-in seeding. */
    public seedBuiltin(name: string, impl: HarnessImpl): void {
        this.preRegister(name, impl);
    }
}
