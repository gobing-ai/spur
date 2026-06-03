import type { Logger } from '@gobing-ai/ts-infra';
import type { TrustEngine } from '../trust';
import { Registry } from './base';

// ── WorkerImpl ─────────────────────────────────────────────────────────
//
// A plugin-provided worker exposes a `process` entry point that receives
// an arbitrary payload and returns an async result.

/** Plugin worker: async process entry point receiving an arbitrary payload. */
export interface WorkerImpl {
    process(payload: unknown): Promise<unknown>;
}

// ── WorkerRegistry ─────────────────────────────────────────────────────

/** Registry of plugin workers. */
export class WorkerRegistry extends Registry<WorkerImpl> {
    constructor(trust: TrustEngine, logger: Logger) {
        super('workers', trust, logger);
    }

    /** Pre-register a built-in worker (no trust check). */
    public seedBuiltin(name: string, impl: WorkerImpl): void {
        this.preRegister(name, impl);
    }
}
