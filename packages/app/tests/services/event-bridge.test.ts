import { describe, expect, test } from 'bun:test';
import type { EventBus } from '@gobing-ai/ts-infra';
import type { AgentRoutingAttribution } from '../../src/observability/agent-execution';
import { bridgeEventBus, withInvokeRouting } from '../../src/services/event-bridge';

/** Event map for bridge tests — concrete payload types (not the open `EventMap` never default). */
type TestEvents = {
    'task.created': (event: { wbs: string }) => void;
};

/** Minimal stub EventBus that records calls for assertion. */
function stubEventBus(): {
    bus: EventBus<Record<string, (event: unknown) => void>>;
    calls: Array<{ method: string; event: string; args: unknown[] }>;
} {
    const calls: Array<{ method: string; event: string; args: unknown[] }> = [];
    const bus = {
        on(event: string, listener: (event: unknown) => void) {
            calls.push({ method: 'on', event, args: [listener] });
        },
        off(event: string, listener: (event: unknown) => void) {
            calls.push({ method: 'off', event, args: [listener] });
        },
        emit(event: string, detail: unknown) {
            calls.push({ method: 'emit', event, args: [detail] });
            return Promise.resolve();
        },
    } as unknown as EventBus<Record<string, (event: unknown) => void>>;
    return { bus, calls };
}

describe('bridgeEventBus', () => {
    test('forwards on() to the server bus', () => {
        const { bus, calls } = stubEventBus();
        const bridged = bridgeEventBus<TestEvents>(bus);

        const listener = (_e: { wbs: string }) => {};
        bridged.on('task.created', listener);

        expect(calls).toHaveLength(1);
        expect(calls[0]?.method).toBe('on');
        expect(calls[0]?.event).toBe('task.created');
        expect(calls[0]?.args[0]).toBe(listener);
    });

    test('forwards off() to the server bus', () => {
        const { bus, calls } = stubEventBus();
        const bridged = bridgeEventBus<TestEvents>(bus);

        const listener = (_e: { wbs: string }) => {};
        bridged.off('task.created', listener);

        expect(calls).toHaveLength(1);
        expect(calls[0]?.method).toBe('off');
        expect(calls[0]?.event).toBe('task.created');
        expect(calls[0]?.args[0]).toBe(listener);
    });

    test('forwards emit() to the server bus and wraps in Promise.resolve', async () => {
        const { bus, calls } = stubEventBus();
        const bridged = bridgeEventBus<TestEvents>(bus);

        const result = bridged.emit('task.created', { wbs: '0042' });

        expect(result).toBeInstanceOf(Promise);
        await result;

        expect(calls).toHaveLength(1);
        expect(calls[0]?.method).toBe('emit');
        expect(calls[0]?.event).toBe('task.created');
        expect(calls[0]?.args[0]).toEqual({ wbs: '0042' });
    });

    test('bridged bus carries the expected type parameter', () => {
        const { bus } = stubEventBus();
        const bridged = bridgeEventBus<TestEvents>(bus);

        // The bridged bus is an object with on/off/emit — structural check.
        expect(typeof bridged.on).toBe('function');
        expect(typeof bridged.off).toBe('function');
        expect(typeof bridged.emit).toBe('function');
    });
});

describe('withInvokeRouting (task 0545 R1)', () => {
    const routing: AgentRoutingAttribution = { role: 'scribe', tier: 'cheap', executor: 'cheap-exec', source: 'role' };
    /** AgentEvents-shaped map so the bridge wrapper sees invoke names. */
    type AgentEvents = {
        'agent.invoke.start': (event: Record<string, unknown>) => void;
        'agent.invoke.exit': (event: Record<string, unknown>) => void;
        'agent.started': (event: Record<string, unknown>) => void;
    };

    test('attaches the routing context to agent.invoke.start payloads', async () => {
        const { bus, calls } = stubEventBus();
        const wrapped = withInvokeRouting<AgentEvents>(bridgeEventBus<AgentEvents>(bus), () => routing);

        await wrapped.emit('agent.invoke.start', { agent: 'pi', operation: 'prompt', label: 'x' });

        const detail = calls[0]?.args[0] as Record<string, unknown>;
        expect(detail.routing).toEqual(routing);
        expect(detail.agent).toBe('pi');
    });

    test('attaches the routing context to agent.invoke.exit payloads', async () => {
        const { bus, calls } = stubEventBus();
        const wrapped = withInvokeRouting<AgentEvents>(bridgeEventBus<AgentEvents>(bus), () => routing);

        await wrapped.emit('agent.invoke.exit', { agent: 'pi', exitCode: 0, durationMs: 5 });

        const detail = calls[0]?.args[0] as Record<string, unknown>;
        expect(detail.routing).toEqual(routing);
    });

    test('re-reads the routing context at emit time (escalation re-stamp)', async () => {
        const { bus, calls } = stubEventBus();
        let current: AgentRoutingAttribution | undefined = routing;
        const wrapped = withInvokeRouting<AgentEvents>(bridgeEventBus<AgentEvents>(bus), () => current);

        await wrapped.emit('agent.invoke.start', { agent: 'pi' });
        const firstArg = calls[0]?.args[0] as Record<string, unknown> | undefined;
        expect(firstArg?.routing).toEqual(routing);

        current = { tier: 'capable-1', executor: 'capable-exec', source: 'stage' };
        await wrapped.emit('agent.invoke.start', { agent: 'claude' });
        const secondArg = calls[1]?.args[0] as Record<string, unknown> | undefined;
        expect(secondArg?.routing).toEqual(current);
    });

    test('passes non-invoke events through untouched', async () => {
        const { bus, calls } = stubEventBus();
        const wrapped = withInvokeRouting<AgentEvents>(bridgeEventBus<AgentEvents>(bus), () => routing);

        await wrapped.emit('agent.started', { agentId: 'a1' });

        expect(calls).toHaveLength(1);
        expect(calls[0]?.args[0]).toEqual({ agentId: 'a1' });
    });

    test('passes invoke payloads through untouched when no routing context is set', async () => {
        const { bus, calls } = stubEventBus();
        const wrapped = withInvokeRouting<AgentEvents>(bridgeEventBus<AgentEvents>(bus), () => undefined);

        await wrapped.emit('agent.invoke.start', { agent: 'pi' });

        expect(calls[0]?.args[0]).toEqual({ agent: 'pi' });
    });

    test('forwards on() and off() to the underlying bridge', () => {
        const { bus, calls } = stubEventBus();
        const wrapped = withInvokeRouting<AgentEvents>(bridgeEventBus<AgentEvents>(bus), () => routing);

        const listener = (_e: Record<string, unknown>) => {};
        wrapped.on('agent.invoke.start', listener);
        wrapped.off('agent.invoke.start', listener);

        expect(calls.map((c) => c.method)).toEqual(['on', 'off']);
    });
});
