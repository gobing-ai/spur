import { describe, expect, test, vi } from 'bun:test';
import type { AgentSpec } from '@gobing-ai/ts-ai-runner';
import type { PipeProcess, PipeProcessOptions, ProcessExecutor } from '@gobing-ai/ts-runtime';
import {
    type ProcessEventBus,
    type ProcessEventPayload,
    SupervisorService,
} from '../../src/services/supervisor-service';

// ── Mocks ──

interface MockPipeHandle {
    process: PipeProcess;
    killCalls: string[];
    resolveExit: (code: number | null) => void;
}

function createMockPipeProcess(pid: number): MockPipeHandle {
    const killCalls: string[] = [];
    let resolveExit!: (code: number | null) => void;
    const exited = new Promise<number | null>((resolve) => {
        resolveExit = resolve;
    });
    // Structural mock — only the fields SupervisorService touches are populated.
    // `as unknown as` is safe: we control the callers and know only runStreaming is invoked.
    const process = {
        pid,
        stdout: null,
        stderr: null,
        exited,
        writeStdin: () => {},
        endStdin: () => {},
        kill: (signal?: string) => {
            killCalls.push(signal ?? 'default');
            resolveExit(0);
        },
    } as unknown as PipeProcess;
    return { process, killCalls, resolveExit };
}

interface MockExecutor {
    executor: ProcessExecutor;
    calls: PipeProcessOptions[];
    pipes: MockPipeHandle[];
}

function createMockExecutor(): MockExecutor {
    const calls: PipeProcessOptions[] = [];
    const pipes: MockPipeHandle[] = [];
    const executor = {
        runStreaming: (opts: PipeProcessOptions): PipeProcess => {
            calls.push(opts);
            const handle = createMockPipeProcess(10000 + pipes.length);
            pipes.push(handle);
            return handle.process;
        },
    } as unknown as ProcessExecutor;
    return { executor, calls, pipes };
}

interface MockBus {
    bus: ProcessEventBus;
    emits: Array<{ event: string; payload: ProcessEventPayload }>;
}

function createMockBus(): MockBus {
    const emits: Array<{ event: string; payload: ProcessEventPayload }> = [];
    const bus = {
        emit: (event: string, payload: ProcessEventPayload): void => {
            emits.push({ event, payload });
        },
    } as unknown as ProcessEventBus;
    return { bus, emits };
}

type SpecWithCommand = AgentSpec & { command?: string[] };

function makeSpec(overrides: Partial<SpecWithCommand> = {}): SpecWithCommand {
    return {
        id: 'test-agent',
        name: 'Test Agent',
        type: 'pi',
        workspace: '/tmp',
        purpose: 'testing',
        tags: [],
        config: {},
        ...overrides,
    };
}

// ── Tests ──

describe('SupervisorService', () => {
    describe('start', () => {
        test('spawns a process, emits process.spawned, and records entry', async () => {
            const { executor, calls } = createMockExecutor();
            const { bus, emits } = createMockBus();
            const svc = new SupervisorService({
                processExecutor: executor,
                eventBus: bus,
                configDir: '/tmp',
                agentSpecs: [makeSpec({ id: 'alpha', command: ['echo', 'hi'] })],
            });

            const entry = await svc.start('alpha');

            expect(calls).toHaveLength(1);
            expect(calls[0]?.command).toBe('echo');
            expect(calls[0]?.args).toEqual(['hi']);
            expect(calls[0]?.label).toBe('agent:alpha');
            expect(entry.agentId).toBe('alpha');
            expect(entry.status).toBe('running');
            expect(entry.pid).toBe(10000);

            const spawned = emits.find((e) => e.event === 'process.spawned');
            expect(spawned).toBeDefined();
            expect(spawned?.payload.agentId).toBe('alpha');
        });

        test('returns existing entry when already running', async () => {
            const { executor } = createMockExecutor();
            const { bus } = createMockBus();
            const svc = new SupervisorService({
                processExecutor: executor,
                eventBus: bus,
                configDir: '/tmp',
                agentSpecs: [makeSpec({ id: 'alpha', command: ['echo'] })],
            });

            const first = await svc.start('alpha');
            const second = await svc.start('alpha');
            expect(second).toBe(first);
        });

        test('throws when agent spec is not found', async () => {
            const { executor } = createMockExecutor();
            const { bus } = createMockBus();
            const svc = new SupervisorService({
                processExecutor: executor,
                eventBus: bus,
                configDir: '/tmp',
                agentSpecs: [makeSpec({ id: 'alpha' })],
            });

            await expect(svc.start('nonexistent')).rejects.toThrow('No agent spec found for "nonexistent"');
        });

        test('uses default wrapper argv when spec has no command', async () => {
            const { executor, calls } = createMockExecutor();
            const { bus } = createMockBus();
            const svc = new SupervisorService({
                processExecutor: executor,
                eventBus: bus,
                configDir: '/tmp',
                agentSpecs: [makeSpec({ id: 'alpha' })],
            });

            await svc.start('alpha');

            expect(calls[0]?.command).toBe(process.execPath);
            expect(calls[0]?.args).toContain('agent');
            expect(calls[0]?.args).toContain('alpha');
            expect(calls[0]?.args).toContain('--drain');
            expect(calls[0]?.args).toContain('--continue');
        });
    });

    describe('stop', () => {
        test('sends SIGTERM and marks entry as stopped', async () => {
            const { executor, pipes } = createMockExecutor();
            const { bus, emits } = createMockBus();
            const svc = new SupervisorService({
                processExecutor: executor,
                eventBus: bus,
                configDir: '/tmp',
                agentSpecs: [makeSpec({ id: 'alpha', command: ['echo'] })],
            });

            await svc.start('alpha');
            await svc.stop('alpha');

            expect(pipes[0]?.killCalls).toContain('SIGTERM');
            const entry = svc.get('alpha');
            expect(entry?.status).toBe('stopped');

            const stopped = emits.find((e) => e.event === 'process.stopped');
            expect(stopped).toBeDefined();
            expect(stopped?.payload.agentId).toBe('alpha');
        });

        test('is a no-op when process is not running', async () => {
            const { executor } = createMockExecutor();
            const { bus, emits } = createMockBus();
            const svc = new SupervisorService({
                processExecutor: executor,
                eventBus: bus,
                configDir: '/tmp',
                agentSpecs: [makeSpec({ id: 'alpha', command: ['echo'] })],
            });

            await svc.stop('alpha');
            expect(emits).toHaveLength(0);
        });
    });

    describe('startAutostart', () => {
        test('starts multiple agents and returns entries', async () => {
            const { executor } = createMockExecutor();
            const { bus } = createMockBus();
            const svc = new SupervisorService({
                processExecutor: executor,
                eventBus: bus,
                configDir: '/tmp',
                agentSpecs: [makeSpec({ id: 'alpha', command: ['echo'] }), makeSpec({ id: 'beta', command: ['echo'] })],
            });

            const entries = await svc.startAutostart(['alpha', 'beta']);
            expect(entries).toHaveLength(2);
            expect(entries[0]?.agentId).toBe('alpha');
            expect(entries[1]?.agentId).toBe('beta');
            expect(svc.list()).toHaveLength(2);
        });

        test('throws when an autostart id is not found', async () => {
            const { executor } = createMockExecutor();
            const { bus } = createMockBus();
            const svc = new SupervisorService({
                processExecutor: executor,
                eventBus: bus,
                configDir: '/tmp',
                agentSpecs: [makeSpec({ id: 'alpha', command: ['echo'] })],
            });

            await expect(svc.startAutostart(['alpha', 'gamma'])).rejects.toThrow('Autostart agent "gamma" not found');
        });
    });

    describe('stopAll', () => {
        test('stops all running processes', async () => {
            const { executor } = createMockExecutor();
            const { bus, emits } = createMockBus();
            const svc = new SupervisorService({
                processExecutor: executor,
                eventBus: bus,
                configDir: '/tmp',
                agentSpecs: [makeSpec({ id: 'alpha', command: ['echo'] }), makeSpec({ id: 'beta', command: ['echo'] })],
            });

            await svc.startAutostart(['alpha', 'beta']);
            await svc.stopAll();

            const stoppedEvents = emits.filter((e) => e.event === 'process.stopped');
            expect(stoppedEvents).toHaveLength(2);
            for (const entry of svc.list()) {
                expect(entry.status).toBe('stopped');
            }
        });

        test('is a no-op when nothing is running', async () => {
            const { executor } = createMockExecutor();
            const { bus, emits } = createMockBus();
            const svc = new SupervisorService({
                processExecutor: executor,
                eventBus: bus,
                configDir: '/tmp',
                agentSpecs: [makeSpec({ id: 'alpha', command: ['echo'] })],
            });

            await svc.stopAll();
            expect(emits).toHaveLength(0);
        });
    });

    describe('list and get', () => {
        test('list returns empty array and get returns undefined before any start', () => {
            const { executor } = createMockExecutor();
            const { bus } = createMockBus();
            const svc = new SupervisorService({
                processExecutor: executor,
                eventBus: bus,
                configDir: '/tmp',
                agentSpecs: [],
            });

            expect(svc.list()).toEqual([]);
            expect(svc.get('alpha')).toBeUndefined();
        });

        test('getRingBuffer returns empty array for unknown agent', () => {
            const { executor } = createMockExecutor();
            const { bus } = createMockBus();
            const svc = new SupervisorService({
                processExecutor: executor,
                eventBus: bus,
                configDir: '/tmp',
                agentSpecs: [],
            });

            expect(svc.getRingBuffer('alpha')).toEqual([]);
        });
    });

    describe('pipeStream and ring buffer', () => {
        test('captures stdout and stderr frames into ring buffer', async () => {
            const stdout = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('hello\nworld\n'));
                    controller.close();
                },
            });
            const stderr = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('warn\n'));
                    controller.close();
                },
            });

            const { promise: exited, resolve: resolveExit } = Promise.withResolvers<number | null>();
            const proc = {
                pid: 20000,
                stdout,
                stderr,
                exited,
                writeStdin: () => {},
                endStdin: () => {},
                kill: () => {
                    resolveExit(0);
                },
            } as unknown as PipeProcess;
            const executor = { runStreaming: (): PipeProcess => proc } as unknown as ProcessExecutor;
            const { bus } = createMockBus();
            const svc = new SupervisorService({
                processExecutor: executor,
                eventBus: bus,
                configDir: '/tmp',
                agentSpecs: [makeSpec({ id: 'alpha', command: ['echo'] })],
            });

            await svc.start('alpha');

            // Flush microtasks until the async stream pump drains.
            for (let i = 0; i < 30; i++) {
                if (svc.getRingBuffer('alpha').length >= 3) break;
                await Promise.resolve();
            }

            const buffer = svc.getRingBuffer('alpha');
            expect(buffer.some((f) => f.stream === 'stdout' && f.line === 'hello')).toBe(true);
            expect(buffer.some((f) => f.stream === 'stdout' && f.line === 'world')).toBe(true);
            expect(buffer.some((f) => f.stream === 'stderr' && f.line === 'warn')).toBe(true);
        });

        test('trims ring buffer to configured size (pushFrame eviction)', async () => {
            const stdout = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('l0\nl1\nl2\nl3\nl4\n'));
                    controller.close();
                },
            });

            const { promise: exited, resolve: resolveExit } = Promise.withResolvers<number | null>();
            const proc = {
                pid: 20001,
                stdout,
                stderr: null,
                exited,
                writeStdin: () => {},
                endStdin: () => {},
                kill: () => {
                    resolveExit(0);
                },
            } as unknown as PipeProcess;
            const executor = { runStreaming: (): PipeProcess => proc } as unknown as ProcessExecutor;
            const { bus } = createMockBus();
            const svc = new SupervisorService({
                processExecutor: executor,
                eventBus: bus,
                configDir: '/tmp',
                agentSpecs: [makeSpec({ id: 'alpha', command: ['echo'] })],
                ringBufferSize: 3,
            });

            await svc.start('alpha');

            for (let i = 0; i < 30; i++) {
                if (svc.getRingBuffer('alpha').length >= 3) break;
                await Promise.resolve();
            }

            const buffer = svc.getRingBuffer('alpha');
            expect(buffer).toHaveLength(3);
            expect(buffer.map((f) => f.line)).toEqual(['l2', 'l3', 'l4']);
        });

        test('catches stream read errors and records an error frame', async () => {
            const stdout = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.error(new Error('Boom!'));
                },
            });

            const { promise: exited, resolve: resolveExit } = Promise.withResolvers<number | null>();
            const proc = {
                pid: 20002,
                stdout,
                stderr: null,
                exited,
                writeStdin: () => {},
                endStdin: () => {},
                kill: () => {
                    resolveExit(0);
                },
            } as unknown as PipeProcess;
            const executor = { runStreaming: (): PipeProcess => proc } as unknown as ProcessExecutor;
            const { bus } = createMockBus();
            const svc = new SupervisorService({
                processExecutor: executor,
                eventBus: bus,
                configDir: '/tmp',
                agentSpecs: [makeSpec({ id: 'alpha', command: ['echo'] })],
            });

            await svc.start('alpha');

            // Pump microtasks until the error frame lands.
            for (let i = 0; i < 30; i++) {
                if (svc.getRingBuffer('alpha').length >= 1) break;
                await Promise.resolve();
            }

            const buffer = svc.getRingBuffer('alpha');
            expect(buffer).toHaveLength(1);
            expect(buffer[0]?.stream).toBe('stdout');
            expect(buffer[0]?.line).toBe('[stream error: Boom!]');
        });
    });

    describe('exit cleanup', () => {
        test('removes exited entry after cleanup delay', async () => {
            vi.useFakeTimers();

            const { executor, pipes } = createMockExecutor();
            const { bus, emits } = createMockBus();
            const svc = new SupervisorService({
                processExecutor: executor,
                eventBus: bus,
                configDir: '/tmp',
                agentSpecs: [makeSpec({ id: 'alpha', command: ['echo'] })],
            });

            await svc.start('alpha');
            expect(svc.get('alpha')).toBeDefined();

            // Simulate natural exit
            pipes[0]?.resolveExit(0);
            await Promise.resolve();
            await Promise.resolve();

            expect(svc.get('alpha')?.status).toBe('exited');
            expect(emits.some((e) => e.event === 'process.exited')).toBe(true);

            // Entry still present before cleanup delay
            expect(svc.get('alpha')).toBeDefined();

            vi.advanceTimersByTime(60_000);

            // Entry removed after cleanup
            expect(svc.get('alpha')).toBeUndefined();

            vi.useRealTimers();
        });

        test('does not remove re-started entry during cleanup window', async () => {
            vi.useFakeTimers();

            const { executor, pipes } = createMockExecutor();
            const { bus } = createMockBus();
            const svc = new SupervisorService({
                processExecutor: executor,
                eventBus: bus,
                configDir: '/tmp',
                agentSpecs: [makeSpec({ id: 'alpha', command: ['echo'] })],
            });

            await svc.start('alpha');
            pipes[0]?.resolveExit(0);
            await Promise.resolve();
            await Promise.resolve();

            // Re-start while cleanup timer is pending
            await svc.start('alpha');

            vi.advanceTimersByTime(60_000);

            // New entry survives — cleanup checked entry identity
            expect(svc.get('alpha')).toBeDefined();
            expect(svc.get('alpha')?.status).toBe('running');

            vi.useRealTimers();
        });
    });

    describe('stop with timeout', () => {
        test('sends SIGKILL when SIGTERM does not cause exit within timeout', async () => {
            vi.useFakeTimers();

            const killCalls: string[] = [];
            const { promise: exited, resolve: resolveExit } = Promise.withResolvers<number | null>();
            const proc = {
                pid: 30000,
                stdout: null,
                stderr: null,
                exited,
                writeStdin: () => {},
                endStdin: () => {},
                kill: (signal?: string) => {
                    killCalls.push(signal ?? 'default');
                    if (signal === 'SIGKILL') resolveExit(null);
                },
            } as unknown as PipeProcess;
            const executor = { runStreaming: (): PipeProcess => proc } as unknown as ProcessExecutor;
            const { bus, emits } = createMockBus();
            const svc = new SupervisorService({
                processExecutor: executor,
                eventBus: bus,
                configDir: '/tmp',
                agentSpecs: [makeSpec({ id: 'alpha', command: ['echo'] })],
            });

            await svc.start('alpha');

            const stopPromise = svc.stop('alpha');
            vi.advanceTimersByTime(3000);
            await stopPromise;

            expect(killCalls).toContain('SIGTERM');
            expect(killCalls).toContain('SIGKILL');
            expect(svc.get('alpha')?.status).toBe('stopped');
            expect(emits.some((e) => e.event === 'process.stopped')).toBe(true);

            vi.useRealTimers();
        });
    });
});
