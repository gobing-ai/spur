import type { EventBus, Logger } from '@gobing-ai/ts-infra';
import type { TrustEngine } from '../trust';
import { Registry } from './base';

// ── EventRegistry TImpl ───────────────────────────────────────────────

/** Plugin event subscriber — wires into the EventBus at registration time. */
export interface EventImpl {
    subscribe: (bus: EventBus<Record<string, (...args: never[]) => void>>) => void;
}

// ── EventRegistry ─────────────────────────────────────────────────────

/** Registry of plugin event subscribers. */
export class EventRegistry extends Registry<EventImpl> {
    constructor(trust: TrustEngine, logger: Logger) {
        super('events', trust, logger);
    }
}
