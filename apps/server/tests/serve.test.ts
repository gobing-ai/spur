import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { ApplicationRuntime, ApplicationStopReason } from '@gobing-ai/ts-infra/application';

describe('startServer', () => {
    let origServe: typeof Bun.serve;
    let origExit: typeof process.exit;
    let origOn: typeof process.on;

    afterEach(() => {
        mock.restore();
        if (origServe) Bun.serve = origServe;
        if (origExit) process.exit = origExit;
        if (origOn) process.on = origOn;
    });

    test('exports as a function', async () => {
        const { startServer } = await import('../src/serve');
        expect(typeof startServer).toBe('function');
    });

    test('StartServerOptions shape validates at type level', () => {
        const opts = { port: 3000, host: 'localhost', openBrowser: false } as const;
        expect(opts.port).toBe(3000);
    });

    test('start callback wires Bun.serve and serves health', async () => {
        origServe = Bun.serve;

        let capturedFetch: ((req: Request) => Response | Promise<Response>) | undefined;

        Bun.serve = ((opts: {
            fetch: (req: Request) => Response | Promise<Response>;
            port?: number;
            hostname?: string;
        }) => {
            capturedFetch = opts.fetch;
            return { stop: () => {}, ref: () => {}, unref: () => {} };
        }) as unknown as typeof Bun.serve;

        mock.module('@gobing-ai/ts-infra/application-node', () => ({
            runNodeApplication: async (opts: { config: unknown; start: (rt: ApplicationRuntime) => Promise<void> }) => {
                const mockRt = {
                    config: {},
                    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
                    events: { emit: () => {}, on: () => {}, off: () => {} },
                    db: undefined,
                    stop: async (_reason: ApplicationStopReason) => {},
                } as unknown as ApplicationRuntime;
                await opts.start(mockRt);
            },
        }));

        const { startServer } = await import('../src/serve');
        await startServer({ port: 4000, host: '0.0.0.0', openBrowser: false });

        if (!capturedFetch) throw new Error('capturedFetch not set');
        const res = await capturedFetch(new Request('http://0.0.0.0:4000/api/health'));
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.status).toBe('ok');
    });

    test('scheduler branch and signal handlers covered via mock', async () => {
        origServe = Bun.serve;
        origExit = process.exit;
        origOn = process.on;

        const sigHandlers: Record<string, () => void> = {};
        process.on = ((event: string, handler: () => void) => {
            sigHandlers[event] = handler;
            return process;
        }) as typeof process.on;

        let serverStopped = false;
        let schedulerStopped = false;
        let schedulerStarted = false;
        const logMessages: { msg: string; data?: Record<string, unknown> }[] = [];

        Bun.serve = (() => ({
            stop: (drain: boolean) => {
                expect(drain).toBe(true);
                serverStopped = true;
            },
        })) as unknown as typeof Bun.serve;

        process.exit = ((code: number) => {
            expect(code).toBe(0);
        }) as typeof process.exit;

        mock.module('../src/bootstrap', () => ({
            createApp: (_rt: unknown, _opts?: { fs?: unknown; ctx?: unknown }) => ({
                fetch: (_req: Request) =>
                    new Response(
                        JSON.stringify({ status: 'ok', uptime_seconds: 0, memory_rss_mb: 0, memory_heap_mb: 0 }),
                        { status: 200, headers: { 'content-type': 'application/json' } },
                    ),
            }),
            serverBootstrapConfig: () => ({
                logging: { enabled: false, level: 'info' as const },
                telemetry: { enabled: false },
                events: { enabled: true },
                jobqueue: { enabled: false },
                scheduler: { enabled: true },
            }),
        }));

        mock.module('@gobing-ai/ts-infra/scheduler-node', () => ({
            NodeSchedulerAdapter: class {
                async start() {
                    schedulerStarted = true;
                }
                async stop() {
                    schedulerStopped = true;
                }
                register() {}
            },
        }));

        mock.module('@gobing-ai/ts-infra/application-node', () => ({
            runNodeApplication: async (opts: { config: unknown; start: (rt: ApplicationRuntime) => Promise<void> }) => {
                const mockRt = {
                    config: {},
                    logger: {
                        info: (msg: string, data?: Record<string, unknown>) => logMessages.push({ msg, data }),
                        warn: () => {},
                        error: () => {},
                        debug: () => {},
                    },
                    events: { emit: () => {}, on: () => {}, off: () => {} },
                    db: undefined,
                    stop: async (_reason: ApplicationStopReason) => {},
                } as unknown as ApplicationRuntime;
                await opts.start(mockRt);
            },
        }));

        mock.module('@gobing-ai/ts-runtime', () => ({
            createNodeFileSystem: (_cwd: string) => ({
                exists: async () => false,
                readDir: async () => [],
                writeFile: async () => {},
                readFile: async () => '',
                stat: async () => null,
                mkdir: async () => {},
            }),
            loadRuntimeFactory: async () => ({}),
        }));

        const { startServer } = await import('../src/serve');
        await startServer({ port: 5000, host: '127.0.0.1', openBrowser: false });

        expect(schedulerStarted).toBe(true);

        const sigint = sigHandlers.SIGINT;
        if (!sigint) throw new Error('SIGINT handler not registered');
        await sigint();
        expect(serverStopped).toBe(true);
        expect(schedulerStopped).toBe(true);
        expect(logMessages.some((m) => m.msg === 'Shutting down server')).toBe(true);
        expect(logMessages.some((m) => m.msg === 'Scheduler started')).toBe(true);

        const sigterm = sigHandlers.SIGTERM;
        if (!sigterm) throw new Error('SIGTERM handler not registered');
        process.exit = ((_code: number) => {}) as typeof process.exit;
        await sigterm();
    });
});
