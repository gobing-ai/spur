import { describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import type { DesktopLayout } from '../src/layout';
import {
    DesktopStartupAborted,
    findFreePort,
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
        const { server, url } = await listen((_req, res) => {
            res.writeHead(200);
            res.end('{"status":"starting"}');
        });
        try {
            await expect(waitForHealth(url, { timeoutMs: 40, intervalMs: 5 })).rejects.toThrow(/not status ok/);
        } finally {
            await close(server);
        }
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
            env: { PATH: process.env.PATH ?? '' },
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
                'run',
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
        queueMicrotask(() => exited.emitExit(1, null));
        await expect(
            startDesktopServer({
                layout: devLayout,
                port: 9,
                healthTimeoutMs: 500,
                healthIntervalMs: 5,
                killGraceMs: 10,
                spawn: { spawn: () => exited },
            }),
        ).rejects.toThrow(/exited before/);
        expect(exited.exitCode).toBe(1);

        const missing = fakeChild({ exitOnKill: false });
        const error = Object.assign(new Error('spawn bun ENOENT'), { code: 'ENOENT' });
        queueMicrotask(() => missing.emitError(error));
        await expect(
            startDesktopServer({
                layout: devLayout,
                port: 9,
                healthTimeoutMs: 500,
                healthIntervalMs: 5,
                killGraceMs: 10,
                spawn: { spawn: () => missing },
            }),
        ).rejects.toThrow(/Install Bun/);

        const broken = fakeChild({ exitOnKill: false });
        queueMicrotask(() => broken.emitError(new Error('boom')));
        await expect(
            startDesktopServer({
                layout: devLayout,
                port: 9,
                healthTimeoutMs: 500,
                healthIntervalMs: 5,
                killGraceMs: 10,
                spawn: { spawn: () => broken },
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
