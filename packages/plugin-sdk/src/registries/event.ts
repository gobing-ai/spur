import type { EventBus, Logger } from '@gobing-ai/ts-infra';
import type { TrustEngine } from '../trust';
import { Registry } from './base';

// ── EventRegistry TImpl ───────────────────────────────────────────────

export interface EventImpl {
    subscribe: (bus: EventBus<Record<string, (...args: never[]) => void>>) => void;
}

// ── EventRegistry ─────────────────────────────────────────────────────

export class EventRegistry extends Registry<EventImpl> {
    constructor(trust: TrustEngine, logger: Logger) {
        super('events', trust, logger);
    }
}
