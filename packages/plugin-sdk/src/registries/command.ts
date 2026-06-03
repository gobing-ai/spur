import type { Logger } from '@gobing-ai/ts-infra';
import type { TrustEngine } from '../trust';
import { Registry } from './base';

// ── Command TImpl ────────────────────────────────────────────────────

/** Plugin slash-command implementation with name and execute function. */
export interface CommandImpl {
    name: string;
    execute: (args: string[]) => void | Promise<void>;
}

// ── CommandRegistry ──────────────────────────────────────────────────

/** Registry of plugin slash commands with built-in seeding. */
export class CommandRegistry extends Registry<CommandImpl> {
    constructor(trust: TrustEngine, logger: Logger) {
        super('commands', trust, logger);
    }

    /** Expose preRegister for built-in command seeding. */
    seedBuiltin(name: string, impl: CommandImpl): void {
        this.preRegister(name, impl);
    }
}
