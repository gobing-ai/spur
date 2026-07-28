import { describe, expect, test } from 'bun:test';
import {
    type AgentExecutionEvent,
    AgentExecutionLifecycle,
    configuredSecretValues,
    redactAndBound,
} from '../../src/observability/agent-execution';

describe('AgentExecutionLifecycle', () => {
    test('emits one correlated lifecycle and retains redacted bounded output', () => {
        const events: AgentExecutionEvent[] = [];
        const lifecycle = new AgentExecutionLifecycle(
            (event) => events.push(event),
            { runId: 'run-1', actionId: 'action-1', executionId: 'execution-1' },
            ['known-secret'],
            0,
        );

        lifecycle.start({
            agent: 'pi',
            model: 'zai',
            invocation: 'pi -p api_key=hidden known-secret',
            timeoutMs: 5000,
        });
        lifecycle.observe({
            stream: 'stdout',
            chunk: `partial known-secret ${'x'.repeat(5000)}`,
            timestamp: new Date().toISOString(),
        });
        lifecycle.finish({ exitCode: 0, durationMs: 12 });

        expect(events.map((event) => event.kind)).toEqual(['started', 'output', 'finished']);
        expect(events.every((event) => event.runId === 'run-1' && event.actionId === 'action-1')).toBe(true);
        expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
        expect(JSON.stringify(events)).not.toContain('known-secret');
        const output = events.find((event) => event.kind === 'output');
        expect(output?.kind === 'output' ? output.chunk.length : 0).toBeLessThanOrEqual(4097);
        expect(events.at(-1)).toMatchObject({ outcome: 'done', usage: 'unavailable' });
    });

    test('bounds the pending queue and reports dropped chunks without blocking the producer', () => {
        const events: AgentExecutionEvent[] = [];
        const lifecycle = new AgentExecutionLifecycle(
            (event) => events.push(event),
            { runId: 'run-2', executionId: 'execution-2' },
            [],
            0,
        );
        lifecycle.start({ agent: 'pi', invocation: 'pi' });
        for (let index = 0; index < 100; index += 1) {
            lifecycle.observe({ stream: 'stdout', chunk: String(index), timestamp: new Date().toISOString() });
        }
        lifecycle.finish({ exitCode: 0, durationMs: 1 });

        const output = events.filter((event) => event.kind === 'output');
        const dropped = events.find((event) => event.kind === 'dropped');
        expect(output).toHaveLength(64);
        expect(dropped).toMatchObject({ kind: 'dropped', chunks: 36 });
    });

    test('redacts a configured secret split across process chunks before either chunk reaches a sink', () => {
        const events: AgentExecutionEvent[] = [];
        const lifecycle = new AgentExecutionLifecycle(
            (event) => events.push(event),
            { runId: 'run-split', executionId: 'execution-split' },
            ['configured-secret'],
            0,
        );
        lifecycle.start({ agent: 'pi', invocation: 'pi' });

        lifecycle.observe({ stream: 'stdout', chunk: 'prefix configured-', timestamp: new Date().toISOString() });
        lifecycle.observe({ stream: 'stdout', chunk: 'secret suffix', timestamp: new Date().toISOString() });
        lifecycle.finish({ exitCode: 0, durationMs: 1 });

        const output = events
            .filter((event): event is Extract<AgentExecutionEvent, { kind: 'output' }> => event.kind === 'output')
            .map((event) => event.chunk)
            .join('');
        expect(output).toBe('prefix [REDACTED] suffix');
        expect(output).not.toContain('configured-secret');
    });

    test('emits heartbeat and isolates throwing observers', async () => {
        let heartbeats = 0;
        const lifecycle = new AgentExecutionLifecycle(
            (event) => {
                if (event.kind === 'heartbeat') heartbeats += 1;
                if (event.kind === 'output') throw new Error('sink failed');
            },
            { runId: 'run-3', executionId: 'execution-3' },
            [],
            5,
        );
        lifecycle.start({ agent: 'pi', invocation: 'pi' });
        lifecycle.observe({ stream: 'stdout', chunk: 'safe', timestamp: new Date().toISOString() });
        await Bun.sleep(14);
        lifecycle.finish({ exitCode: null, durationMs: 14, signal: 'SIGTERM' });

        expect(heartbeats).toBeGreaterThanOrEqual(1);
    });
});

describe('agent observability redaction', () => {
    test('collects configured secret values and redacts before truncation', () => {
        const secrets = configuredSecretValues({
            PUBLIC_VALUE: 'visible',
            API_TOKEN: 'configured-secret',
            PASSWORD: 'tiny',
        });
        const value = redactAndBound(`prefix configured-secret suffix ${'z'.repeat(30)}`, secrets, 24);

        expect(secrets).toContain('configured-secret');
        expect(value).not.toContain('configured-secret');
        expect(value.length).toBeLessThanOrEqual(25);
    });
});
