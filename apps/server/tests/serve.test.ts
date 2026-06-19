import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApplicationRuntime, ApplicationStopReason } from '@gobing-ai/ts-infra/application';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import type { CreateServerContextOptions } from '../src/context';
import { defaultDeps, type StartServerDeps, startServer } from '../src/serve';

/** Build a fake ApplicationRuntime; `log` collects logger.info calls when provided. */
function fakeRuntime(log?: { msg: string; data?: Record<string, unknown> }[]): ApplicationRuntime {
    return {
        config: {},
        logger: {
            info: (msg: string, data?: Record<string, unknown>) => log?.push({ msg, data }),
            warn: () => {},
            error: () => {},
            debug: () => {},
        },
        events: { emit: () => {}, on: () => {}, off: () => {} },
        db: undefined,
        stop: async (_reason: ApplicationStopReason) => {},
    } as unknown as ApplicationRuntime;
}

/** A no-op FileSystem fake — startServer threads it into the context only. */
const fakeFs = {
    exists: async () => false,
    readDir: async () => [],
    writeFile: async () => {},
    readFile: async () => '',
    stat: async () => null,
    ensureDir: async () => {},
} as unknown as FileSystem;

/** Healthy fetch handler standing in for a real Hono app. */
function fakeApp() {
    return {
        fetch: (_req: Request) =>
            new Response(JSON.stringify({ status: 'ok', uptime_seconds: 0, memory_rss_mb: 0, memory_heap_mb: 0 }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
    };
}

/** Build a StartServerDeps with sensible fakes; override per test. */
function makeDeps(overrides: Partial<StartServerDeps> = {}): StartServerDeps {
    return {
        serverBootstrapConfig: () => ({
            logging: { enabled: false, level: 'info' as const },
            telemetry: { enabled: false },
            events: { enabled: true },
            jobqueue: { enabled: false },
            scheduler: { enabled: false },
        }),
        runNodeApplication: (async (opts: { config: unknown; start: (rt: ApplicationRuntime) => Promise<void> }) => {
            const rt = fakeRuntime();
            await opts.start(rt);
            return rt;
        }) as unknown as StartServerDeps['runNodeApplication'],
        createApp: (() => fakeApp()) as unknown as StartServerDeps['createApp'],
        createNodeFileSystem: () => fakeFs,
        createServerContext: (() => ({}) as never) as unknown as StartServerDeps['createServerContext'],
        createScheduler: async () => ({ start: async () => {}, stop: async () => {}, register: () => {} }) as never,
        openUrl: async () => {},
        ...overrides,
    };
}

describe('startServer', () => {
    let origServe: typeof Bun.serve;
    let origExit: typeof process.exit;
    let origOn: typeof process.on;

    afterEach(() => {
        if (origServe) Bun.serve = origServe;
        if (origExit) process.exit = origExit;
        if (origOn) process.on = origOn;
    });

    test('exports as a function', () => {
        expect(typeof startServer).toBe('function');
    });

    test('StartServerOptions shape validates at type level', () => {
        const opts = { port: 3000, host: 'localhost', openBrowser: false, keepAlive: false } as const;
        expect(opts.port).toBe(3000);
    });

    test('defaultDeps.createScheduler lazily builds a real NodeSchedulerAdapter', async () => {
        const scheduler = await defaultDeps.createScheduler();
        expect(typeof scheduler.start).toBe('function');
        expect(typeof scheduler.stop).toBe('function');
        expect(typeof scheduler.register).toBe('function');
    });

    test('start callback wires Bun.serve and serves health', async () => {
        origServe = Bun.serve;

        let capturedFetch: ((req: Request) => Response | Promise<Response>) | undefined;
        Bun.serve = ((opts: { fetch: (req: Request) => Response | Promise<Response> }) => {
            capturedFetch = opts.fetch;
            return { stop: () => {}, ref: () => {}, unref: () => {} };
        }) as unknown as typeof Bun.serve;

        await startServer({ port: 4000, host: '0.0.0.0', openBrowser: false, keepAlive: false }, makeDeps());

        if (!capturedFetch) throw new Error('capturedFetch not set');
        const res = await capturedFetch(new Request('http://0.0.0.0:4000/api/health'));
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.status).toBe('ok');
    });

    test('opens the browser when openBrowser is true', async () => {
        origServe = Bun.serve;
        Bun.serve = (() => ({ stop: () => {}, ref: () => {}, unref: () => {} })) as unknown as typeof Bun.serve;

        let openedUrl: string | undefined;
        await startServer(
            { port: 4100, host: 'localhost', openBrowser: true, keepAlive: false },
            makeDeps({
                openUrl: async (url: string) => {
                    openedUrl = url;
                },
            }),
        );

        expect(openedUrl).toBe('http://localhost:4100/board');
    });

    test('passes resolved webDistPath into ServerContext for static board serving', async () => {
        origServe = Bun.serve;
        Bun.serve = (() => ({ stop: () => {}, ref: () => {}, unref: () => {} })) as unknown as typeof Bun.serve;

        const webDistPath = mkdtempSync(join(tmpdir(), 'spur-web-dist-'));
        writeFileSync(join(webDistPath, 'index.html'), '<html>board</html>');

        let capturedOptions: CreateServerContextOptions | undefined;
        await startServer(
            { port: 4300, host: 'localhost', openBrowser: false, webDistPath, keepAlive: false },
            makeDeps({
                createServerContext: ((_rt: ApplicationRuntime, options: CreateServerContextOptions) => {
                    capturedOptions = options;
                    return {};
                }) as unknown as StartServerDeps['createServerContext'],
            }),
        );

        expect(capturedOptions?.webDistPath).toBe(webDistPath);
    });

    test('does not open the browser when openBrowser is false (--no-open)', async () => {
        origServe = Bun.serve;
        Bun.serve = (() => ({ stop: () => {}, ref: () => {}, unref: () => {} })) as unknown as typeof Bun.serve;

        let opened = false;
        await startServer(
            { port: 4200, host: 'localhost', openBrowser: false, keepAlive: false },
            makeDeps({
                openUrl: async () => {
                    opened = true;
                },
            }),
        );

        expect(opened).toBe(false);
    });

    test('scheduler branch and signal handlers covered via injected deps', async () => {
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

        const deps = makeDeps({
            serverBootstrapConfig: () => ({
                logging: { enabled: false, level: 'info' as const },
                telemetry: { enabled: false },
                events: { enabled: true },
                jobqueue: { enabled: false },
                scheduler: { enabled: true },
            }),
            runNodeApplication: (async (opts: {
                config: unknown;
                start: (rt: ApplicationRuntime) => Promise<void>;
            }) => {
                const rt = fakeRuntime(logMessages);
                await opts.start(rt);
                return rt;
            }) as unknown as StartServerDeps['runNodeApplication'],
            createScheduler: async () =>
                ({
                    start: async () => {
                        schedulerStarted = true;
                    },
                    stop: async () => {
                        schedulerStopped = true;
                    },
                    register: () => {},
                }) as never,
        });

        await startServer({ port: 5000, host: '127.0.0.1', openBrowser: false, keepAlive: false }, deps);

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
