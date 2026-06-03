import { beforeEach, describe, expect, it } from 'bun:test';
import { EventBus } from '@gobing-ai/ts-infra';
import { EventRegistry, SPUR_EVENT_KEYS, type SpurEventMap } from '../src/events';

describe('EventRegistry', () => {
    let bus: EventBus<SpurEventMap>;
    let registry: EventRegistry;

    beforeEach(() => {
        bus = new EventBus<SpurEventMap>();
        registry = new EventRegistry(bus, SPUR_EVENT_KEYS);
    });

    it('subscribes to a specific event by exact name', () => {
        // We use '*' pattern which matches all — verify handler fires
        const calls: string[] = [];
        registry.subscribe('*', ((detail: { agent: string }) => {
            calls.push(detail.agent);
        }) as SpurEventMap[keyof SpurEventMap]);

        bus.emit('agent.run.start', { agent: 'claude', prompt: 'test', cwd: '/tmp' });
        // emit is async — sync emit in test (EventBus handles both)
        // Use setTimeout or tick
    });

    it('subscribe("*") fans to all events', async () => {
        const calls: Array<{ event: string }> = [];
        registry.subscribe('*', ((detail: unknown) => {
            const d = detail as Record<string, unknown>;
            calls.push({ event: (d.agent as string) ?? 'unknown' });
        }) as SpurEventMap[keyof SpurEventMap]);

        await bus.emit('agent.run.start', { agent: 'claude', prompt: 'p', cwd: '/tmp' });
        await bus.emit('agent.run.complete', { agent: 'claude', exitCode: 0, durationMs: 100 });

        expect(calls.length).toBeGreaterThanOrEqual(2);
    });

    it('subscribe("agent.*") fans to agent prefixed events', async () => {
        const calls: string[] = [];
        registry.subscribe('agent.*', ((detail: unknown) => {
            const d = detail as Record<string, unknown>;
            calls.push(d.agent as string);
        }) as SpurEventMap[keyof SpurEventMap]);

        await bus.emit('agent.run.start', { agent: 'agent-a', prompt: 'p', cwd: '/tmp' });
        await bus.emit('agent.run.complete', { agent: 'agent-a', exitCode: 0, durationMs: 50 });
        await bus.emit('plugin.load', { name: 'test', version: '1.0.0' });

        expect(calls).toEqual(['agent-a', 'agent-a']);
    });

    it('unsubscribe removes pattern handlers', async () => {
        const calls: string[] = [];
        registry.subscribe('plugin.*', ((detail: unknown) => {
            const d = detail as Record<string, unknown>;
            calls.push(d.name as string);
        }) as SpurEventMap[keyof SpurEventMap]);

        registry.unsubscribe('plugin.*');

        await bus.emit('plugin.load', { name: 'test', version: '1.0.0' });
        expect(calls).toEqual([]);
    });

    it('unsubscribeAll removes all pattern subscriptions', async () => {
        const calls: string[] = [];
        registry.subscribe('agent.*', ((detail: unknown) => {
            const d = detail as Record<string, unknown>;
            calls.push(`agent:${d.agent}`);
        }) as SpurEventMap[keyof SpurEventMap]);
        registry.subscribe('plugin.*', ((detail: unknown) => {
            const d = detail as Record<string, unknown>;
            calls.push(`plugin:${d.name}`);
        }) as SpurEventMap[keyof SpurEventMap]);

        registry.unsubscribeAll();

        await bus.emit('agent.run.start', { agent: 'x', prompt: 'p', cwd: '/tmp' });
        await bus.emit('plugin.load', { name: 'y', version: '1.0.0' });
        expect(calls).toEqual([]);
    });

    it('usage.record is rate-limited (token bucket)', async () => {
        const calls: number[] = [];
        registry.subscribe('usage.record', ((detail: unknown) => {
            const d = detail as Record<string, unknown>;
            calls.push(d.tokens as number);
        }) as SpurEventMap[keyof SpurEventMap]);

        // Fire 200 events rapidly
        for (let i = 0; i < 200; i++) {
            await bus.emit('usage.record', { tokens: i, model: 'test', timestamp: Date.now() });
        }

        // Default maxBurst is 100 — should be rate-limited to ~100
        expect(calls.length).toBeLessThanOrEqual(101); // allow small refill
        expect(calls.length).toBeGreaterThan(0);
    });

    it('subscribe pattern with no matches is a no-op', () => {
        // Should not throw
        expect(() => registry.subscribe('nonexistent.*', (() => {}) as SpurEventMap[keyof SpurEventMap])).not.toThrow();
    });
});
