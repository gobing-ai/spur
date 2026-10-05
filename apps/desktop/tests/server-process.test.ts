import { describe, expect, test } from 'bun:test';
import { getEventListeners } from 'node:events';
import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    realpathSync,
    rmdirSync,
    rmSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import type { DesktopLayout } from '../src/layout';
import {
    DesktopStartupAborted,
    findFreePort,
    findSharedServer,
    listenerOrigins,
    nodeSpawner,
    type SpawnedChild,
    startDesktopServer,
    stopChild,
    waitForHealth,
} from '../src/server-process';

const devLayout: DesktopLayout = {
    mode: 'dev',
    repoRoot: '/repo',
    projectRoot: '/work',
    resourcesDir: undefined,
};

interface FakeChild extends SpawnedChild {
    signals: NodeJS.Signals[];
    emitExit(code: number | null, signal: NodeJS.Signals | null): void;
    emitError(error: Error): void;
}

function fakeChild(options?: { exitOnKill?: boolean }): FakeChild {
    let exitCode: number | null = null;
    let signalCode: NodeJS.Signals | null = null;
    const exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
    const errorListeners: Array<(error: Error) => void> = [];
    const signals: NodeJS.Signals[] = [];
    const child: FakeChild = {
        pid: 4242,
        signals,
        get exitCode() {
            return exitCode;
        },
        get signalCode() {
            return signalCode;
        },
        kill(signal: NodeJS.Signals = 'SIGTERM') {
            signals.push(signal);
            if (options?.exitOnKill !== false) {
                queueMicrotask(() => child.emitExit(null, signal));
            }
            return true;
        },
        onExit(listener) {
            exitListeners.push(listener);
        },
        onError(listener) {
            errorListeners.push(listener);
        },
        emitExit(code, signal) {
            exitCode = code;
            signalCode = signal;
            for (const listener of exitListeners) listener(code, signal);
        },
        emitError(error) {
            for (const listener of errorListeners) listener(error);
        },
    };
    return child;
}

function listen(
    handler: (req: { url?: string }, res: { writeHead: (s: number) => void; end: (b?: string) => void }) => void,
): Promise<{ server: Server; url: string; port: number }> {
    const server = createServer((req, res) => handler(req, res));
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address() as AddressInfo;
            resolve({ server, port: address.port, url: `http://127.0.0.1:${address.port}/api/health` });
        });
    });
}

async function close(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

describe('server process', () => {
    test('findFreePort returns a loopback port', async () => {
        const port = await findFreePort();
        expect(port).toBeGreaterThan(0);
        expect(port).toBeLessThan(65_536);
    });

    test('waitForHealth accepts status ok and retries transport failures', async () => {
        let hits = 0;
        const { server, url } = await listen((req, res) => {
            hits += 1;
            if (!req.url?.startsWith('/api/health')) {
                res.writeHead(404);
                res.end();
                return;
            }
            if (hits === 1) {
                res.writeHead(503);
                res.end('{"status":"error"}');
                return;
            }
            if (hits === 2) {
                res.writeHead(200);
                res.end('not-json');
                return;
            }
            res.writeHead(200);
            res.end('{"status":"ok"}');
        });
        try {
            let fetches = 0;
            const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
                fetches += 1;
                if (fetches === 1) throw new Error('connection refused');
                return fetch(input, init);
            };
            await waitForHealth(url, { timeoutMs: 2_000, intervalMs: 10, fetchImpl });
            expect(hits).toBeGreaterThanOrEqual(3);
        } finally {
            await close(server);
        }
    });

    test('waitForHealth times out and reports an early process failure', async () => {
        await expect(
            waitForHealth('http://127.0.0.1:1/api/health', { timeoutMs: 30, intervalMs: 5, sleep: async () => {} }),
        ).rejects.toThrow(/Timed out/);
        await expect(
            waitForHealth('http://127.0.0.1:1/api/health', {
                timeoutMs: 1_000,
                intervalMs: 5,
                failure: () => 'server process exited before health',
            }),
        ).rejects.toThrow(/exited before health/);
    });

    test('waitForHealth rejects a 200 payload that is not ok', async () => {
        await expect(
            waitForHealth('http://127.0.0.1:1234/api/health', {
                timeoutMs: 40,
                intervalMs: 5,
                fetchImpl: async () => Response.json({ status: 'starting' }),
            }),
        ).rejects.toThrow(/not status ok/);
    });

    test('stopChild is a no-op once the child has exited and escalates to SIGKILL', async () => {
        const exited = fakeChild();
        exited.emitExit(0, null);
        await stopChild(exited, 10);
        expect(exited.signals).toEqual([]);

        const stuck = fakeChild({ exitOnKill: false });
        await stopChild(stuck, 15);
        expect(stuck.signals).toEqual(['SIGTERM', 'SIGKILL']);
    });

    test('nodeSpawner surfaces ENOENT and can kill a live process', async () => {
        const missing = nodeSpawner().spawn('spur-desktop-missing-bin', [], {
            cwd: tmpdir(),
            env: { PATH: '' },
            stdio: 'ignore',
        });
        const error = await new Promise<Error>((resolve) => missing.onError(resolve));
        expect((error as NodeJS.ErrnoException).code).toBe('ENOENT');

        const child = nodeSpawner().spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
            cwd: tmpdir(),
            env: { PATH: getEnvVars().PATH ?? '' },
            stdio: 'ignore',
        });
        expect(child.pid).toBeGreaterThan(0);
        await stopChild(child, 3_000);
        expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
        child.kill('SIGTERM');
    });

    test('start waits for health, strips the database url, and stop is idempotent', async () => {
        const { server, port } = await listen((req, res) => {
            if (req.url?.startsWith('/api/health')) {
                res.writeHead(200);
                res.end('{"status":"ok"}');
                return;
            }
            res.writeHead(404);
            res.end();
        });
        const child = fakeChild();
        let captured: { command: string; args: string[]; env: Record<string, string>; cwd: string } | undefined;
        try {
            const running = await startDesktopServer({
                layout: devLayout,
                port,
                bunPath: 'bun',
                parentEnv: { PATH: '/usr/bin', DATABASE_URL: '/tmp/other.db' },
                healthTimeoutMs: 2_000,
                healthIntervalMs: 10,
                killGraceMs: 20,
                spawn: {
                    spawn(command, args, options) {
                        captured = { command, args, env: options.env, cwd: options.cwd };
                        return child;
                    },
                },
            });
            expect(running.kind).toBe('dev-cli');
            expect(running.url).toBe(`http://127.0.0.1:${port}`);
            expect(running.pid).toBe(4242);
            expect(captured?.command).toBe('bun');
            expect(captured?.cwd).toBe('/repo');
            expect(captured?.args).toEqual([
                'apps/cli/src/index.ts',
                'serve',
                '--host',
                '127.0.0.1',
                '--port',
                String(port),
                '--no-open',
                '--cwd',
                '/work',
            ]);
            expect(captured?.env.DATABASE_URL).toBeUndefined();
            await running.stop();
            await running.stop();
            expect(child.signals).toEqual(['SIGTERM']);
        } finally {
            await close(server);
        }
    });

    test('start kills the child when health never arrives or the binary is missing', async () => {
        const exited = fakeChild({ exitOnKill: false });
        await expect(
            startDesktopServer({
                layout: devLayout,
                port: 9,
                healthTimeoutMs: 500,
                healthIntervalMs: 5,
                killGraceMs: 10,
                spawn: {
                    spawn: () => {
                        queueMicrotask(() => exited.emitExit(1, null));
                        return exited;
                    },
                },
            }),
        ).rejects.toThrow(/exited before/);
        expect(exited.exitCode).toBe(1);

        const missing = fakeChild({ exitOnKill: false });
        const error = Object.assign(new Error('spawn bun ENOENT'), { code: 'ENOENT' });
        await expect(
            startDesktopServer({
                layout: devLayout,
                port: 9,
                healthTimeoutMs: 500,
                healthIntervalMs: 5,
                killGraceMs: 10,
                spawn: {
                    spawn: () => {
                        queueMicrotask(() => missing.emitError(error));
                        return missing;
                    },
                },
            }),
        ).rejects.toThrow(/Install Bun/);

        const broken = fakeChild({ exitOnKill: false });
        await expect(
            startDesktopServer({
                layout: devLayout,
                port: 9,
                healthTimeoutMs: 500,
                healthIntervalMs: 5,
                killGraceMs: 10,
                spawn: {
                    spawn: () => {
                        queueMicrotask(() => broken.emitError(new Error('boom')));
                        return broken;
                    },
                },
            }),
        ).rejects.toThrow(/boom/);
    });

    test('rejects an invalid explicit port', async () => {
        await expect(
            startDesktopServer({ layout: devLayout, port: 70_000, spawn: { spawn: () => fakeChild() } }),
        ).rejects.toThrow(/Invalid port/);
    });

    test('abort during health stops the already spawned child', async () => {
        const child = fakeChild({ exitOnKill: false });
        const controller = new AbortController();
        let spawned = false;
        const pending = startDesktopServer({
            layout: devLayout,
            port: 9,
            healthTimeoutMs: 5_000,
            healthIntervalMs: 10,
            killGraceMs: 15,
            signal: controller.signal,
            spawn: {
                spawn() {
                    spawned = true;
                    return child;
                },
            },
            fetchImpl: (_input, init) =>
                new Promise((_resolve, reject) => {
                    const signal = init?.signal;
                    if (!signal) return;
                    if (signal.aborted) {
                        reject(new Error('aborted'));
                        return;
                    }
                    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
                }),
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(spawned).toBe(true);
        controller.abort();
        await expect(pending).rejects.toBeInstanceOf(DesktopStartupAborted);
        expect(child.signals[0]).toBe('SIGTERM');
    });
});

function sharedFixture(): { root: string; directory: string; marker: string; cleanup: () => void } {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'spur-desktop-share-')));
    const directory = join(root, '.spur', 'server-owner.lock');
    mkdirSync(directory, { recursive: true });
    const marker = `${process.pid}-${crypto.randomUUID()}`;
    writeFileSync(join(directory, marker), '');
    return { root, directory, marker, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe('shared project server', () => {
    test('native listener parsing confines IPv4/IPv6 and wildcard probes to loopback and the owner PID', () => {
        expect(
            listenerOrigins(
                'p42\nf1\ntIPv6\nn[::1]:3000\nf2\ntIPv4\nn127.0.0.1:4000\nf3\ntIPv6\nn*:5000\nf4\ntIPv4\nn*:6000\nf5\nn*:7000\nn10.0.0.1:8000\nn*:99999',
                42,
                'darwin',
            ),
        ).toEqual(['http://[::1]:3000', 'http://127.0.0.1:4000', 'http://[::1]:5000', 'http://127.0.0.1:6000']);
        expect(
            listenerOrigins(
                'TCP [::]:3000 [::]:0 LISTENING 42\nTCP 127.0.0.1:3000 0.0.0.0:0 LISTENING 43\nTCP 0.0.0.0:4000 0.0.0.0:0 LISTENING 42',
                42,
                'win32',
            ),
        ).toEqual(['http://[::1]:3000', 'http://127.0.0.1:4000']);
    });

    test('IPv6 attachment through a symlink selects the same project and stop preserves the owner', async () => {
        const fixture = sharedFixture();
        const server = createServer((req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(
                JSON.stringify(req.url === '/api/health' ? { status: 'ok', service: 'spur' } : { path: fixture.root }),
            );
        });
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '::1', resolve);
        });
        const origin = `http://[::1]:${(server.address() as AddressInfo).port}`;
        const link = join(fixture.root, 'alias');
        symlinkSync(fixture.root, link, 'dir');
        try {
            const running = await startDesktopServer({
                layout: { ...devLayout, projectRoot: link },
                healthTimeoutMs: 1000,
                inspectOwner: async () => [origin],
                spawn: {
                    spawn: () => {
                        throw new Error('must not spawn');
                    },
                },
            });
            expect(running.ownership).toBe('shared');
            expect(running.url).toBe(origin);
            expect(running.pid).toBe(process.pid);
            await running.stop();
            await running.stop();
            expect(readdirSync(fixture.directory)).toEqual([fixture.marker]);
            expect((await fetch(`${origin}/api/health`)).status).toBe(200);
        } finally {
            await close(server);
            fixture.cleanup();
        }
    });

    test('wrong service, project, redirects and inspection failures never spawn a second owner', async () => {
        const fixture = sharedFixture();
        try {
            for (const problem of ['service', 'project', 'redirect', 'inspection', 'remote']) {
                let spawned = false;
                await expect(
                    startDesktopServer({
                        layout: { ...devLayout, projectRoot: fixture.root },
                        healthTimeoutMs: 10,
                        inspectOwner: async () => {
                            if (problem === 'inspection') throw new Error('cannot inspect');
                            return [problem === 'remote' ? 'http://example.com:3000' : 'http://127.0.0.1:3000'];
                        },
                        fetchImpl: async (url, init) => {
                            expect(init?.redirect).toBe('error');
                            if (problem === 'redirect') throw new TypeError('redirect rejected');
                            return Response.json(
                                String(url).endsWith('/api/health')
                                    ? { status: 'ok', service: problem === 'service' ? 'other' : 'spur' }
                                    : { path: problem === 'project' ? '/other' : fixture.root },
                            );
                        },
                        spawn: {
                            spawn: () => {
                                spawned = true;
                                return fakeChild();
                            },
                        },
                    }),
                ).rejects.toThrow();
                expect(spawned).toBe(false);
                expect(readdirSync(fixture.directory)).toEqual([fixture.marker]);
            }
        } finally {
            fixture.cleanup();
        }
    });

    test('owner claim changes during the identity handshake refuse attachment', async () => {
        const fixture = sharedFixture();
        try {
            await expect(
                findSharedServer({
                    projectRoot: fixture.root,
                    timeoutMs: 30,
                    inspect: async () => ['http://127.0.0.1:3000'],
                    fetchImpl: async (url) => {
                        if (String(url).endsWith('/api/health'))
                            return Response.json({ status: 'ok', service: 'spur' });
                        unlinkSync(join(fixture.directory, fixture.marker));
                        writeFileSync(join(fixture.directory, `${process.pid}-${crypto.randomUUID()}`), '');
                        return Response.json({ path: fixture.root });
                    },
                }),
            ).rejects.toThrow(/ownership changed/);
        } finally {
            fixture.cleanup();
        }
    });

    test('claim before bind retries discovery and cancellation preserves its claim', async () => {
        const fixture = sharedFixture();
        try {
            let attempts = 0;
            const found = await findSharedServer({
                projectRoot: fixture.root,
                timeoutMs: 1000,
                inspect: async () => (++attempts === 1 ? [] : ['http://127.0.0.1:3000']),
                fetchImpl: async (url) =>
                    Response.json(
                        String(url).endsWith('/api/health')
                            ? { status: 'ok', service: 'spur' }
                            : { path: fixture.root },
                    ),
            });
            expect(found?.pid).toBe(process.pid);
            expect(attempts).toBe(2);
            const controller = new AbortController();
            const pending = startDesktopServer({
                layout: { ...devLayout, projectRoot: fixture.root },
                signal: controller.signal,
                inspectOwner: async () => {
                    controller.abort();
                    return [];
                },
                spawn: {
                    spawn: () => {
                        throw new Error('must not spawn');
                    },
                },
            });
            await expect(pending).rejects.toBeInstanceOf(DesktopStartupAborted);
            expect(readdirSync(fixture.directory)).toEqual([fixture.marker]);
        } finally {
            fixture.cleanup();
        }
    });

    test('malformed claims fail closed; dead claims remain untouched for server-owned recovery', async () => {
        const fixture = sharedFixture();
        try {
            unlinkSync(join(fixture.directory, fixture.marker));
            writeFileSync(join(fixture.directory, 'unknown'), '');
            await expect(findSharedServer({ projectRoot: fixture.root, timeoutMs: 10 })).rejects.toThrow(/incomplete/);
            unlinkSync(join(fixture.directory, 'unknown'));
            const dead = `2147483647-${crypto.randomUUID()}`;
            writeFileSync(join(fixture.directory, dead), '');
            expect(await findSharedServer({ projectRoot: fixture.root, timeoutMs: 10 })).toBeUndefined();
            expect(readdirSync(fixture.directory)).toEqual([dead]);
        } finally {
            fixture.cleanup();
        }
    });

    test('a concurrent owner is attached only after the failed owned child is cleaned up', async () => {
        const fixture = sharedFixture();
        unlinkSync(join(fixture.directory, fixture.marker));
        rmdirSync(fixture.directory);
        const child = fakeChild();
        try {
            const running = await startDesktopServer({
                layout: { ...devLayout, projectRoot: fixture.root },
                port: 1234,
                healthTimeoutMs: 500,
                killGraceMs: 10,
                spawn: {
                    spawn: () => {
                        mkdirSync(fixture.directory);
                        writeFileSync(join(fixture.directory, fixture.marker), '');
                        queueMicrotask(() => child.emitError(new Error('another owner won')));
                        return child;
                    },
                },
                inspectOwner: async () => {
                    expect(child.signals).toEqual(['SIGTERM']);
                    return ['http://127.0.0.1:3000'];
                },
                fetchImpl: async (url) => {
                    if (String(url).includes(':1234')) throw new Error('not listening');
                    return Response.json(
                        String(url).endsWith('/api/health')
                            ? { status: 'ok', service: 'spur' }
                            : { path: fixture.root },
                    );
                },
            });
            expect(running.ownership).toBe('shared');
            await running.stop();
            expect(child.signals).toEqual(['SIGTERM']);
            expect(readdirSync(fixture.directory)).toEqual([fixture.marker]);
        } finally {
            fixture.cleanup();
        }
    });
});

test('health probes dispose cancellation listeners on retries and success', async () => {
    const controller = new AbortController();
    let probes = 0;
    await waitForHealth('http://unused/api/health', {
        timeoutMs: 1000,
        signal: controller.signal,
        sleep: async () => {},
        fetchImpl: async () => {
            expect(getEventListeners(controller.signal, 'abort').length).toBe(1);
            probes += 1;
            if (probes < 30) throw new Error('not yet');
            return new Response('{"status":"ok"}');
        },
    });
    expect(probes).toBe(30);
    expect(getEventListeners(controller.signal, 'abort').length).toBe(0);
});

test('unexpected server exit after health is reported while normal stop is silent', async () => {
    for (const unexpected of [true, false]) {
        const child = fakeChild();
        const failures: Error[] = [];
        const server = await startDesktopServer({
            layout: devLayout,
            port: 1234,
            spawn: { spawn: () => child },
            fetchImpl: async () => new Response('{"status":"ok"}'),
            onUnexpectedExit: (error) => failures.push(error),
        });
        if (unexpected) child.emitExit(1, null);
        else await server.stop();
        expect(failures.length).toBe(unexpected ? 1 : 0);
        if (unexpected) expect(failures[0]?.message).toContain('Reopen Spur');
    }
});

test('Windows adapter requests graceful shutdown over Node/Bun JSON IPC', async () => {
    const child = nodeSpawner('win32').spawn(
        'bun',
        [
            '-e',
            "process.on('message', message => { if (message.type === 'spur.desktop.shutdown') process.exit(0); }); setTimeout(() => process.exit(9), 4000);",
        ],
        { cwd: tmpdir(), env: getEnvVars() as Record<string, string>, stdio: 'ignore' },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    await stopChild(child, 2000);
    expect(child.exitCode).toBe(0);
    expect(child.signalCode).toBeNull();
    expect(child.requestShutdown?.()).toBe(false);
});

test('graceful shutdown requests still escalate if an owned child ignores them', async () => {
    const child = fakeChild({ exitOnKill: false });
    let requested = false;
    child.requestShutdown = () => {
        requested = true;
        return true;
    };
    await stopChild(child, 10);
    expect(requested).toBe(true);
    expect(child.signals).toEqual(['SIGKILL']);
});

test('startup refusal reports the owned child message to the shell', async () => {
    const child = nodeSpawner().spawn(
        'bun',
        [
            '-e',
            "process.send(null); process.send({type:'other'}); process.send({type:'spur.desktop.startup-error',message:42}); process.send({type:'spur.desktop.startup-error',message:'already has a live server'}); process.exit(1);",
        ],
        { cwd: tmpdir(), env: getEnvVars() as Record<string, string>, stdio: 'ignore' },
    );
    const error = await new Promise<Error>((resolve) => child.onError(resolve));
    expect(error.message).toBe('already has a live server');
    await new Promise<void>((resolve) => {
        if (child.exitCode !== null) resolve();
        else child.onExit(() => resolve());
    });
    expect(child.exitCode).toBe(1);
});
