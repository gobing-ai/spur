import type { EventBus, EventMap } from '@gobing-ai/ts-infra';

// ── Spur event map (R8.2) ────────────────────────────────────────────

/** Typed map of Spur domain events extending the platform EventMap. */
export interface SpurEventMap extends EventMap {
    'agent.run.start': (detail: { agent: string; prompt: string; cwd?: string }) => void;
    'agent.run.complete': (detail: { agent: string; exitCode: number; durationMs: number }) => void;
    'agent.run.error': (detail: { agent: string; error: string }) => void;
    'workflow.transition': (detail: { workflowId: string; from: string; to: string }) => void;
    'rule.evaluate': (detail: { ruleId: string; result: string }) => void;
    'usage.record': (detail: { tokens: number; model: string; timestamp: number }) => void;
    'history.import.start': (detail: { source: string }) => void;
    'history.import.complete': (detail: { source: string; count: number }) => void;
    'plugin.load': (detail: { name: string; version: string }) => void;
    'plugin.unload': (detail: { name: string }) => void;
    'plugin.error': (detail: { name: string; error: string }) => void;
}

/** Known Spur event keys — used by EventRegistry for glob matching. */
export const SPUR_EVENT_KEYS: string[] = [
    'agent.run.start',
    'agent.run.complete',
    'agent.run.error',
    'workflow.transition',
    'rule.evaluate',
    'usage.record',
    'history.import.start',
    'history.import.complete',
    'plugin.load',
    'plugin.unload',
    'plugin.error',
];

// ── Glob matching ────────────────────────────────────────────────────

function globToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
}

// ── EventRegistry (glob adapter over EventBus) ───────────────────────

/**
 * Wraps an EventBus<SpurEventMap> with glob-pattern subscription support.
 *
 * subscribe('agent.*', handler) fans out to 'agent.run.start',
 * 'agent.run.complete', and 'agent.run.error'.
 *
 * subscribe('*', handler) subscribes to ALL events.
 *
 * High-churn events (usage.record) get a token bucket to prevent flooding.
 */
export class EventRegistry {
    private readonly patternSubscriptions = new Map<
        string,
        Array<{ handler: SpurEventMap[keyof SpurEventMap]; eventKey: string }>
    >();

    private readonly tokenBuckets = new Map<string, { tokens: number; lastRefill: number }>();
    private readonly maxBurst: number;
    private readonly refillRate: number;
    private readonly eventKeys: string[];

    constructor(
        private readonly bus: EventBus<SpurEventMap>,
        eventKeys: string[],
        opts?: { maxBurst?: number; refillRatePerSecond?: number },
    ) {
        this.eventKeys = eventKeys;
        this.maxBurst = opts?.maxBurst ?? 100;
        this.refillRate = (opts?.refillRatePerSecond ?? 1000) / 1000;
    }

    /**
     * Subscribe a handler via glob pattern.
     */
    subscribe(pattern: string, handler: SpurEventMap[keyof SpurEventMap]): void {
        const allKeys = this.eventKeys as Array<keyof SpurEventMap>;
        const matchedKeys = pattern === '*' ? allKeys : allKeys.filter((k) => globToRegex(pattern).test(k as string));

        const subs: Array<{ handler: SpurEventMap[keyof SpurEventMap]; eventKey: string }> = [];

        for (const key of matchedKeys) {
            const wrappedHandler = this.wrapHandler(key as string, handler);
            this.bus.on(key, wrappedHandler as SpurEventMap[typeof key]);
            subs.push({ handler: wrappedHandler, eventKey: key as string });
        }

        this.patternSubscriptions.set(pattern, subs);
    }

    /**
     * Unsubscribe all handlers registered under a pattern.
     */
    unsubscribe(pattern: string): void {
        const subs = this.patternSubscriptions.get(pattern);
        if (!subs) return;

        for (const { handler, eventKey } of subs) {
            this.bus.off(eventKey as keyof SpurEventMap, handler as SpurEventMap[keyof SpurEventMap]);
        }

        this.patternSubscriptions.delete(pattern);
    }

    /**
     * Remove all pattern subscriptions.
     */
    unsubscribeAll(): void {
        for (const pattern of this.patternSubscriptions.keys()) {
            this.unsubscribe(pattern);
        }
    }

    // ── Private ──────────────────────────────────────────────────

    private isHighChurn(eventKey: string): boolean {
        return eventKey === 'usage.record';
    }

    private wrapHandler(eventKey: string, handler: SpurEventMap[keyof SpurEventMap]): SpurEventMap[keyof SpurEventMap] {
        if (!this.isHighChurn(eventKey)) return handler;

        const bucketKey = eventKey;

        return ((...args: unknown[]) => {
            const now = Date.now();
            let bucket = this.tokenBuckets.get(bucketKey);
            if (!bucket) {
                bucket = { tokens: this.maxBurst, lastRefill: now };
                this.tokenBuckets.set(bucketKey, bucket);
            }

            const elapsed = now - bucket.lastRefill;
            bucket.tokens = Math.min(this.maxBurst, bucket.tokens + elapsed * this.refillRate);
            bucket.lastRefill = now;

            if (bucket.tokens >= 1) {
                bucket.tokens -= 1;
                (handler as (...args: unknown[]) => void)(...args);
            }
        }) as SpurEventMap[keyof SpurEventMap];
    }
}
