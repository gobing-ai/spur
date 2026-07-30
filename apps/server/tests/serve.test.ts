import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { ApplicationRuntime, ApplicationStopReason } from '@gobing-ai/ts-infra/application';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { serverBootstrapConfig } from '../src/bootstrap';
import type { CreateServerContextOptions, ServerContext } from '../src/context';
import {
    createTaskActionAgentService,
    defaultDeps,
    parseTaskActionJob,
    registerSchedulerEntries,
    resolveWebDistPath,
    runTaskActionJob,
    type StartServerDeps,
    startServer,
    TASK_ACTION_JOB,
} from '../src/serve';

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
    resolve: (...segments: string[]) => segments.join('/'),
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
            logging: { enabled: false, level: 'info' as const, console: false },
            telemetry: { enabled: false },
            events: { enabled: true, diagnostic: false },
            jobqueue: { enabled: false },
            scheduler: { enabled: false },
            teamAutostart: [],
        }),
        runNodeApplication: (async (opts: {
            config: unknown;
            configLoader?: { configFile: string; bootstrapSection: string };
            start: (rt: ApplicationRuntime) => Promise<void>;
        }) => {
            const rt = fakeRuntime();
            await opts.start(rt);
            return rt;
        }) as unknown as StartServerDeps['runNodeApplication'],
        createApp: (() => fakeApp()) as unknown as StartServerDeps['createApp'],
        createNodeFileSystem: () => fakeFs,
        createServerContext: (() => ({}) as never) as unknown as StartServerDeps['createServerContext'],
        createScheduler: async () => ({ start: async () => {}, stop: async () => {}, register: () => {} }) as never,
        openUrl: async () => {},
        resolveConfigFile: () => undefined,
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

    test('opens the browser to /board when openBrowser is true and web dist exists', async () => {
        origServe = Bun.serve;
        Bun.serve = (() => ({ stop: () => {}, ref: () => {}, unref: () => {} })) as unknown as typeof Bun.serve;

        const webDistPath = mkdtempSync(join(tmpdir(), 'spur-web-dist-open-'));
        writeFileSync(join(webDistPath, 'index.html'), '<html>board</html>');

        let openedUrl: string | undefined;
        await startServer(
            { port: 4100, host: 'localhost', openBrowser: true, webDistPath, keepAlive: false },
            makeDeps({
                openUrl: async (url: string) => {
                    openedUrl = url;
                },
            }),
        );

        expect(openedUrl).toBe('http://localhost:4100/board');
    });

    test('opens /api/health when openBrowser is true but board assets are missing', async () => {
        origServe = Bun.serve;
        Bun.serve = (() => ({ stop: () => {}, ref: () => {}, unref: () => {} })) as unknown as typeof Bun.serve;

        let openedUrl: string | undefined;
        await startServer(
            {
                port: 4101,
                host: 'localhost',
                openBrowser: true,
                webDistPath: join(tmpdir(), 'spur-web-dist-absent-open'),
                keepAlive: false,
            },
            makeDeps({
                openUrl: async (url: string) => {
                    openedUrl = url;
                },
            }),
        );

        expect(openedUrl).toBe('http://localhost:4101/api/health');
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

    test('passes dbUrl into ServerContext and ensures its parent directory', async () => {
        origServe = Bun.serve;
        Bun.serve = (() => ({ stop: () => {}, ref: () => {}, unref: () => {} })) as unknown as typeof Bun.serve;

        const dbDir = mkdtempSync(join(tmpdir(), 'spur-server-db-'));
        const dbUrl = join(dbDir, 'nested', 'spur.db');
        const ensured: string[] = [];
        let capturedOptions: CreateServerContextOptions | undefined;

        await startServer(
            { port: 4302, host: 'localhost', openBrowser: false, dbUrl, keepAlive: false },
            makeDeps({
                createNodeFileSystem: () =>
                    ({
                        ...fakeFs,
                        ensureDir: async (path: string) => {
                            ensured.push(path);
                        },
                    }) as unknown as FileSystem,
                createServerContext: ((_rt: ApplicationRuntime, options: CreateServerContextOptions) => {
                    capturedOptions = options;
                    return {};
                }) as unknown as StartServerDeps['createServerContext'],
            }),
        );

        expect(ensured).toEqual([join(dbDir, 'nested')]);
        expect(capturedOptions?.dbUrl).toBe(dbUrl);
    });

    test('falls back to undefined webDistPath when configured static board path is missing', async () => {
        origServe = Bun.serve;
        Bun.serve = (() => ({ stop: () => {}, ref: () => {}, unref: () => {} })) as unknown as typeof Bun.serve;

        let capturedOptions: CreateServerContextOptions | undefined;
        await startServer(
            {
                port: 4301,
                host: 'localhost',
                openBrowser: false,
                webDistPath: join(tmpdir(), 'spur-web-dist-missing'),
                keepAlive: false,
            },
            makeDeps({
                createServerContext: ((_rt: ApplicationRuntime, options: CreateServerContextOptions) => {
                    capturedOptions = options;
                    return {};
                }) as unknown as StartServerDeps['createServerContext'],
            }),
        );

        expect(capturedOptions?.webDistPath).toBeUndefined();
    });

    test('resolveWebDistPath returns configured absolute path when index.html exists', async () => {
        const webDistPath = mkdtempSync(join(tmpdir(), 'spur-web-dist-resolve-'));
        writeFileSync(join(webDistPath, 'index.html'), '<html>board</html>');
        expect(await resolveWebDistPath(webDistPath)).toBe(webDistPath);
    });

    test('resolveWebDistPath returns undefined when configured path is missing', async () => {
        expect(await resolveWebDistPath(join(tmpdir(), 'spur-web-dist-nope'))).toBeUndefined();
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
                logging: { enabled: false, level: 'info' as const, console: false },
                telemetry: { enabled: false },
                events: { enabled: true, diagnostic: false },
                jobqueue: { enabled: false },
                scheduler: { enabled: true },
                teamAutostart: [],
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
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(serverStopped).toBe(true);

        expect(schedulerStopped).toBe(true);
        expect(logMessages.some((m) => m.msg === 'Shutting down server')).toBe(true);
        expect(logMessages.some((m) => m.msg === 'Scheduler started')).toBe(true);

        const sigterm = sigHandlers.SIGTERM;
        if (!sigterm) throw new Error('SIGTERM handler not registered');
        process.exit = ((_code: number) => {}) as typeof process.exit;
        await sigterm();
    });

    test('starts the queue worker when jobqueue is enabled and stops it before server close', async () => {
        origServe = Bun.serve;
        origExit = process.exit;
        origOn = process.on;

        const sigHandlers: Record<string, () => void> = {};
        const order: string[] = [];
        process.on = ((event: string, handler: () => void) => {
            sigHandlers[event] = handler;
            return process;
        }) as typeof process.on;

        Bun.serve = (() => ({
            stop: () => {
                order.push('server.stop');
            },
        })) as unknown as typeof Bun.serve;

        process.exit = ((code: number) => {
            expect(code).toBe(0);
        }) as typeof process.exit;

        const registeredHandlers: Record<string, (payload?: unknown) => Promise<void>> = {};
        let pruneCallCount: number | undefined;
        const queueConsumer = {
            register: (type: string, handler: (payload?: unknown) => Promise<void>) => {
                registeredHandlers[type] = handler;
            },
            start: async () => {
                order.push('worker.start');
            },
            stop: async () => {
                order.push('worker.stop');
            },
            stats: async () => ({ pending: 0, processing: 0, completed: 0, failed: 0 }),
            processOnce: async () => 0,
        };

        const deps = makeDeps({
            serverBootstrapConfig: () => ({
                logging: { enabled: false, level: 'info' as const, console: false },
                telemetry: { enabled: false },
                events: { enabled: false, diagnostic: false },
                jobqueue: { enabled: true },
                scheduler: { enabled: true },
                teamAutostart: [],
            }),
            createServerContext: (() =>
                ({
                    queueConsumer: async () => queueConsumer,
                    systemEventDao: async () => ({
                        pruneQuotas: async () => {
                            pruneCallCount = 10_000;
                        },
                    }),
                }) as unknown as ServerContext) as unknown as StartServerDeps['createServerContext'],
            createScheduler: async () =>
                ({
                    start: async () => {
                        order.push('scheduler.start');
                    },
                    stop: async () => {
                        order.push('scheduler.stop');
                    },
                    register: () => {},
                }) as never,
        });

        await startServer({ port: 5001, host: '127.0.0.1', openBrowser: false, keepAlive: false }, deps);

        expect(order).toEqual(['worker.start', 'scheduler.start']);
        await registeredHandlers['system-events-prune']?.();
        await registeredHandlers.smoke?.();
        expect(pruneCallCount).toBe(10_000);
        expect(registeredHandlers[TASK_ACTION_JOB]).toBeDefined();
        await expect(registeredHandlers[TASK_ACTION_JOB]?.({ wbs: '0001', action: 'run' })).rejects.toThrow(
            'Invalid task-action payload: missing command',
        );
        const sigint = sigHandlers.SIGINT;
        if (!sigint) throw new Error('SIGINT handler not registered');
        await sigint();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(order).toEqual(['worker.start', 'scheduler.start', 'scheduler.stop', 'worker.stop', 'server.stop']);
    });

    test('registerSchedulerEntries enqueues built-in prune and smoke jobs and emits scheduler events', async () => {
        const registered: Array<{ cron: string; action: () => Promise<void> }> = [];
        const enqueued: Array<{ type: string; payload: unknown }> = [];
        const emitted: Array<{ name: string; payload: unknown }> = [];
        const scheduler = {
            register: (cron: string, action: () => Promise<void>) => {
                registered.push({ cron, action });
            },
            start: async () => {},
            stop: async () => {},
        };
        const ctx = {
            jobQueue: async () => ({
                enqueue: async (type: string, payload: unknown) => {
                    enqueued.push({ type, payload });
                    return `${type}-id`;
                },
            }),
            eventBus: () => ({
                emit: (name: string, payload: unknown) => {
                    emitted.push({ name, payload });
                },
            }),
        } as unknown as ServerContext;

        registerSchedulerEntries(scheduler, ctx);
        expect(registered).toHaveLength(2);
        await registered[0]?.action();
        await registered[1]?.action();

        expect(enqueued.map((job) => job.type)).toEqual(['system-events-prune', 'smoke']);
        expect(emitted).toHaveLength(2);
        expect(emitted.every((e) => e.name === 'scheduler.job.executed')).toBe(true);
        // SchedulerJobExecutedDetail contract: { name, durationMs, error? }
        const successPayload = emitted[0]?.payload as Record<string, unknown>;
        expect(successPayload).toMatchObject({ name: 'system-events-prune' });
        expect(successPayload).not.toHaveProperty('kind');
        expect(successPayload).not.toHaveProperty('cron');
        expect(successPayload).not.toHaveProperty('error');
        expect(typeof successPayload.durationMs).toBe('number');
        const smokePayload = emitted[1]?.payload as Record<string, unknown>;
        expect(smokePayload).toMatchObject({ name: 'smoke' });
    });

    test('registerSchedulerEntries captures error on failure and re-throws after emitting', async () => {
        const emitted: Array<{ name: string; payload: unknown }> = [];
        const handlers: Array<() => Promise<void>> = [];
        const ctxFailing = {
            jobQueue: async () => ({
                enqueue: async () => {
                    throw new Error('timeout');
                },
            }),
            eventBus: () => ({
                emit: (name: string, payload: unknown) => {
                    emitted.push({ name, payload });
                },
            }),
        } as unknown as ServerContext;
        registerSchedulerEntries(
            {
                register: (_cron: string, action: () => Promise<void>) => handlers.push(action),
                start: async () => {},
                stop: async () => {},
            } as never,
            ctxFailing,
        );

        // The first registered handler is the prune job; it enqueues, which throws.
        await expect(handlers[0]?.()).rejects.toThrow('timeout');
        expect(emitted).toHaveLength(1);
        const failPayload = emitted[0]?.payload as Record<string, unknown>;
        expect(failPayload.name).toBe('system-events-prune');
        expect(failPayload.error).toContain('timeout');
        expect(typeof failPayload.durationMs).toBe('number');
    });

    test('parseTaskActionJob validates payload shape and preserves optional routing fields', () => {
        expect(() => parseTaskActionJob(null)).toThrow('Invalid task-action payload: expected object');
        expect(() => parseTaskActionJob({ wbs: '0001' })).toThrow('Invalid task-action payload: missing wbs/action');
        expect(() => parseTaskActionJob({ wbs: '0001', action: 'run', command: '   ' })).toThrow(
            'Invalid task-action payload: missing command',
        );

        expect(parseTaskActionJob({ wbs: '0001', action: 'run', command: '/sp:dev-run 0001 --auto' })).toEqual({
            wbs: '0001',
            action: 'run',
            command: '/sp:dev-run 0001 --auto',
            channel: undefined,
            skipDeps: undefined,
        });
        expect(
            parseTaskActionJob({
                wbs: '0001',
                action: 'run',
                command: '/sp:dev-run 0001 --auto',
                channel: 'codex',
                skipDeps: true,
            }),
        ).toEqual({
            wbs: '0001',
            action: 'run',
            command: '/sp:dev-run 0001 --auto',
            channel: 'codex',
            skipDeps: true,
        });
    });

    test('runTaskActionJob dispatches the mapped command through AgentService and reports nonzero exits', async () => {
        const calls: Array<{ prompt: string; flags: Record<string, string | boolean> }> = [];
        const outputCalls: string[] = [];
        const ctx = {
            cwd: '/tmp/spur-workspace',
            eventBus: () =>
                ({ emit: () => {}, on: () => {}, off: () => {} }) as unknown as ReturnType<ServerContext['eventBus']>,
        } as unknown as ServerContext;

        const createAgentService: Parameters<typeof runTaskActionJob>[3] = (options) => ({
            run: async (prompt: string, flags: Record<string, string | boolean>) => {
                options.output.write('stdout');
                options.output.error('stderr');
                outputCalls.push(`${options.cwd}:${options.env.SPUR_TEST ?? ''}`);
                calls.push({ prompt, flags });
                return 0;
            },
        });
        await runTaskActionJob(
            ctx,
            { SPUR_TEST: '1' },
            { wbs: '0001', action: 'run', command: '/sp:dev-run 0001 --auto', channel: 'codex' },
            createAgentService,
        );

        expect(calls).toEqual([
            {
                prompt: '/sp:dev-run 0001 --auto',
                flags: { cwd: '/tmp/spur-workspace', json: true, agent: 'codex' },
            },
        ]);
        expect(outputCalls).toEqual(['/tmp/spur-workspace:1']);

        const failingAgentService: Parameters<typeof runTaskActionJob>[3] = () => ({
            run: async () => 2,
        });
        await expect(
            runTaskActionJob(
                ctx,
                {},
                { wbs: '0001', action: 'verify', command: '/sp:dev-verify 0001 --auto' },
                failingAgentService,
            ),
        ).rejects.toThrow('Task action verify for 0001 failed with exit code 2');
    });

    test('registers listening port in ProjectRegistry and resets to 0 on SIGINT', async () => {
        origServe = Bun.serve;
        origExit = process.exit;
        origOn = process.on;

        const tempDir = mkdtempSync(join(tmpdir(), 'spur-serve-registry-'));
        const projectsFile = join(tempDir, 'projects.json');
        const prevProjectsFile = process.env.SPUR_PROJECTS_FILE;
        process.env.SPUR_PROJECTS_FILE = projectsFile;

        const sigHandlers: Record<string, () => void | Promise<void>> = {};
        process.on = ((event: string, handler: () => void | Promise<void>) => {
            sigHandlers[event] = handler;
            return process;
        }) as typeof process.on;

        const listenPort = 5555;
        Bun.serve = (() => ({
            port: listenPort,
            stop: () => {},
        })) as unknown as typeof Bun.serve;

        process.exit = ((_code: number) => {}) as typeof process.exit;

        try {
            await startServer(
                { port: listenPort, host: '127.0.0.1', openBrowser: false, keepAlive: false },
                makeDeps(),
            );

            // Allow the async upsert to settle if needed
            await new Promise((r) => setTimeout(r, 20));

            expect(existsSync(projectsFile)).toBe(true);
            const registered = JSON.parse(readFileSync(projectsFile, 'utf8')) as {
                projects: Array<{ path: string; port: number; name: string }>;
            };
            const cwdEntry = registered.projects.find((p) => p.name === basename(process.cwd()));
            expect(cwdEntry).toBeDefined();
            expect(cwdEntry?.port).toBe(listenPort);

            const sigint = sigHandlers.SIGINT;
            if (!sigint) throw new Error('SIGINT handler not registered');
            await sigint();
            await new Promise((r) => setTimeout(r, 20));

            const afterStop = JSON.parse(readFileSync(projectsFile, 'utf8')) as {
                projects: Array<{ path: string; port: number; name: string }>;
            };
            const stopped = afterStop.projects.find((p) => p.name === basename(process.cwd()));
            expect(stopped?.port).toBe(0);
        } finally {
            if (prevProjectsFile === undefined) {
                delete process.env.SPUR_PROJECTS_FILE;
            } else {
                process.env.SPUR_PROJECTS_FILE = prevProjectsFile;
            }
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('createTaskActionAgentService builds the real task action runner facade', () => {
        const service = createTaskActionAgentService({
            cwd: process.cwd(),
            env: {},
            output: { write: () => {}, error: () => {} },
        });
        expect(typeof service.run).toBe('function');
    });
});

describe('serverBootstrapConfig retention env parsing', () => {
    test('parses SPUR_EVENT_RETENTION_DEFAULT as the default quota', () => {
        const config = serverBootstrapConfig({ ...{}, NODE_ENV: 'test', SPUR_EVENT_RETENTION_DEFAULT: '5000' });
        expect(config.events.retention?.default).toBe(5000);
    });

    test('parses SPUR_EVENT_RETENTION_<PREFIX> overrides, lowercasing the suffix', () => {
        const config = serverBootstrapConfig({
            ...{},
            NODE_ENV: 'test',
            SPUR_EVENT_RETENTION_TASK: '2000',
            SPUR_EVENT_RETENTION_FEATURE: '3000',
        });
        expect(config.events.retention?.prefixes).toEqual({ task: 2000, feature: 3000 });
    });

    test('drops malformed retention values (non-integer, negative, empty)', () => {
        const config = serverBootstrapConfig({
            ...{},
            NODE_ENV: 'test',
            SPUR_EVENT_RETENTION_DEFAULT: 'abc',
            SPUR_EVENT_RETENTION_TASK: '-5',
            SPUR_EVENT_RETENTION_FEATURE: '',
        });
        expect(config.events.retention?.default).toBeUndefined();
        expect(config.events.retention?.prefixes).toBeUndefined();
    });

    test('omits retention fields entirely when no env vars are set', () => {
        const config = serverBootstrapConfig({ ...{}, NODE_ENV: 'test' });
        expect(config.events.retention).toEqual({});
    });
});
