import { describe, expect, test } from 'bun:test';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import {
    type AgentExecutionEvent,
    AgentExecutionLifecycle,
    configuredSecretValues,
    redactAndBound,
} from '../../src/observability/agent-execution';
import { PidObservingProcessExecutor, RolePropagatingProcessExecutor } from '../../src/services/agent-service';

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

describe('agent execution pid propagation (0421 R5)', () => {
    test('every event emitted after setPid carries the subprocess pid', () => {
        const events: AgentExecutionEvent[] = [];
        const lifecycle = new AgentExecutionLifecycle(
            (event) => events.push(event),
            { runId: 'run-1', executionId: 'execution-1' },
            [],
            0,
        );

        // Spawn order: the dispatch reports its pid before the lifecycle starts,
        // mirroring the executor's onSpawn firing at spawn time.
        lifecycle.setPid(49_281);
        lifecycle.start({ agent: 'pi', invocation: 'pi -p hello' });
        lifecycle.finish({ exitCode: 0, durationMs: 5 });

        expect(events.length).toBeGreaterThanOrEqual(2);
        for (const event of events) {
            expect(event.pid).toBe(49_281);
        }
    });

    test('pid stays absent when the dispatch never reports one', () => {
        const events: AgentExecutionEvent[] = [];
        const lifecycle = new AgentExecutionLifecycle(
            (event) => events.push(event),
            { runId: 'run-1', executionId: 'execution-1' },
            [],
            0,
        );

        lifecycle.start({ agent: 'pi', invocation: 'pi -p hello' });
        lifecycle.finish({ exitCode: 0, durationMs: 5 });

        // `pid` is optional precisely because some dispatches cannot report one;
        // it must be omitted rather than rendered as a placeholder.
        for (const event of events) {
            expect(event.pid).toBeUndefined();
        }
    });

    test('rejects non-pid values so a bad producer cannot poison the line', () => {
        const events: AgentExecutionEvent[] = [];
        const lifecycle = new AgentExecutionLifecycle(
            (event) => events.push(event),
            { runId: 'run-1', executionId: 'execution-1' },
            [],
            0,
        );

        lifecycle.setPid(0);
        lifecycle.setPid(-1);
        lifecycle.setPid(Number.NaN);
        lifecycle.start({ agent: 'pi', invocation: 'pi -p hello' });

        expect(events[0]?.pid).toBeUndefined();
    });
});

describe('process executor pid contract (0421 R5 producer)', () => {
    test('onSpawn reports the real OS pid of the spawned child', async () => {
        const executor = new NodeProcessExecutor({});
        const reported: number[] = [];

        // `echo $$` makes the child print its own pid, so the value the executor
        // reports can be checked against the process itself rather than merely
        // asserted to "look like" a pid. This is what distinguishes a genuine
        // runtime producer from a hard-coded seam.
        const result = await executor.run({
            command: '/bin/sh',
            args: ['-c', 'echo $$'],
            onSpawn: (pid) => reported.push(pid),
        });

        expect(result.exitCode).toBe(0);
        expect(reported.length).toBe(1);
        const pid = reported[0] as number;
        expect(Number.isInteger(pid)).toBe(true);
        expect(pid).toBeGreaterThan(0);
        expect(Number.parseInt(result.stdout.trim(), 10)).toBe(pid);
    });

    test('onSpawn fires before the process exits, so heartbeats can carry the pid', async () => {
        const executor = new NodeProcessExecutor({});
        let pidSeenAt = 0;

        const started = Date.now();
        await executor.run({
            command: '/bin/sh',
            args: ['-c', 'sleep 0.2'],
            onSpawn: () => {
                pidSeenAt = Date.now();
            },
        });
        const finishedAt = Date.now();

        // The pid must be observable while the child is alive — a value only
        // available after exit would be useless for progress output.
        expect(pidSeenAt).toBeGreaterThan(0);
        expect(pidSeenAt).toBeLessThan(started + 200);
        expect(finishedAt - started).toBeGreaterThanOrEqual(150);
    });
});

describe('PidObservingProcessExecutor wiring (0421 R5 glue)', () => {
    test('publishes the spawned pid to the lifecycle sink', async () => {
        const seen: number[] = [];
        const executor = new PidObservingProcessExecutor({}, (pid) => seen.push(pid));

        const result = await executor.run({ command: '/bin/sh', args: ['-c', 'echo $$'] });

        expect(seen.length).toBe(1);
        expect(Number.parseInt(result.stdout.trim(), 10)).toBe(seen[0] as number);
    });

    test('composes with a caller-supplied onSpawn instead of replacing it', async () => {
        const sink: number[] = [];
        const caller: number[] = [];
        const executor = new PidObservingProcessExecutor({}, (pid) => sink.push(pid));

        // AiRunner does not set onSpawn today, but silently dropping a caller's
        // observer would be a trap for whoever adds one later.
        await executor.run({
            command: '/bin/sh',
            args: ['-c', 'true'],
            onSpawn: (pid) => caller.push(pid),
        });

        expect(sink.length).toBe(1);
        expect(caller).toEqual(sink);
    });
});

// ---------------------------------------------------------------------------
// Tests: 0551 — role propagation into the dispatched subprocess env
// ---------------------------------------------------------------------------

describe('RolePropagatingProcessExecutor (0551)', () => {
    test('stamps the set role into the spawned subprocess env as SPUR_ROLE', async () => {
        const executor = new RolePropagatingProcessExecutor({}, () => {});
        executor.setRoleEnv('reviewer');

        const result = await executor.run({ command: '/bin/sh', args: ['-c', 'echo $SPUR_ROLE'] });

        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('reviewer');
    });

    test('strips a parent role when none is set — a child must not inherit stale env', async () => {
        const executor = new RolePropagatingProcessExecutor({}, () => {});

        const result = await executor.run({ command: '/bin/sh', args: ['-c', 'echo "[$SPUR_ROLE]"'] });

        expect(result.exitCode).toBe(0);
        // Empty string overrides any parent value: the child sees no role.
        expect(result.stdout.trim()).toBe('[]');
    });
    test('setRoleEnv(undefined) reverts to stripping', async () => {
        const executor = new RolePropagatingProcessExecutor({}, () => {});
        executor.setRoleEnv('coder');
        executor.setRoleEnv(undefined);

        const result = await executor.run({ command: '/bin/sh', args: ['-c', 'echo "[$SPUR_ROLE]"'] });

        expect(result.stdout.trim()).toBe('[]');
    });

    test('preserves caller-supplied env keys — SPUR_ROLE is the only key overridden', async () => {
        const executor = new RolePropagatingProcessExecutor({}, () => {});
        executor.setRoleEnv('scribe');

        const result = await executor.run({
            command: '/bin/sh',
            args: ['-c', 'echo "$SPUR_ROLE $SPUR_RUN_ID"'],
            env: { SPUR_RUN_ID: 'run-42' },
        });

        expect(result.stdout.trim()).toBe('scribe run-42');
    });

    test('composes with the pid sink — role stamping does not break pid observation', async () => {
        const seen: number[] = [];
        const executor = new RolePropagatingProcessExecutor({}, (pid: number) => seen.push(pid));
        executor.setRoleEnv('reviewer');

        await executor.run({ command: '/bin/sh', args: ['-c', 'echo $SPUR_ROLE'] });

        expect(seen.length).toBe(1);
    });

    test('stamps SPUR_ROLE into a child spur agent run env under a parent SPUR_ROLE', async () => {
        const executor = new RolePropagatingProcessExecutor({}, () => {});
        executor.setRoleEnv('coder');

        // Simulates the actual fan-out: a parent run holds SPUR_ROLE in its own
        // env; the executor must override it, not pass it through untouched.
        const result = await executor.run({
            command: '/bin/sh',
            args: ['-c', 'echo $SPUR_ROLE'],
            env: { SPUR_ROLE: 'reviewer' },
        });

        expect(result.stdout.trim()).toBe('coder');
    });
});
