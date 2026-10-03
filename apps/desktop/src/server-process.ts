import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { DESKTOP_HOST, resolveServeLaunch, type ServeLaunch, type ServeLaunchKind } from './launch';
import type { DesktopLayout } from './layout';

/** Minimal fetch used to poll `/api/health` (avoids Bun's extra `fetch.preconnect`). */
export type HealthFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Child process handle. Tests substitute this; production uses {@link nodeSpawner}. */
export interface SpawnedChild {
    readonly pid: number | undefined;
    readonly exitCode: number | null;
    readonly signalCode: NodeJS.Signals | null;
    kill(signal?: NodeJS.Signals): boolean;
    onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
    onError(listener: (error: Error) => void): void;
}

/** How the desktop shell starts the child server. */
export interface ProcessSpawner {
    spawn(
        command: string,
        args: string[],
        options: { cwd: string; env: Record<string, string>; stdio: 'inherit' | 'pipe' | 'ignore' },
    ): SpawnedChild;
}

/**
 * `node:child_process` spawner. Electron main is Node, so this is not `Bun.spawn`.
 * On POSIX the child is its own process group: `bun run` keeps a grandchild that
 * survives a signal sent only to the pid Node is watching.
 */
export function nodeSpawner(): ProcessSpawner {
    return {
        spawn(command, args, options) {
            const detached = process.platform !== 'win32';
            const child: ChildProcess = spawn(command, args, {
                cwd: options.cwd,
                env: options.env,
                stdio: options.stdio,
                windowsHide: true,
                detached,
            });
            return {
                pid: child.pid,
                get exitCode() {
                    return child.exitCode;
                },
                get signalCode() {
                    return child.signalCode;
                },
                kill(signal: NodeJS.Signals = 'SIGTERM') {
                    if (detached && child.pid) {
                        try {
                            process.kill(-child.pid, signal);
                            return true;
                        } catch {
                            // Group is already gone; signal the pid directly.
                        }
                    }
                    return child.kill(signal);
                },
                onExit(listener) {
                    child.once('exit', (code, signal) => listener(code, signal));
                },
                onError(listener) {
                    child.once('error', (error: Error) => listener(error));
                },
            };
        },
    };
}

/** Bind 127.0.0.1:0 and return the port the OS assigned. */
export function findFreePort(host: string = DESKTOP_HOST): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, host, () => {
            const address = server.address();
            if (address === null || typeof address === 'string') {
                server.close();
                reject(new Error('failed to allocate a TCP port'));
                return;
            }
            const { port } = address;
            server.close((error) => (error ? reject(error) : resolve(port)));
        });
    });
}

function isHealthOk(body: unknown): boolean {
    return typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok';
}

/** Poll `GET /api/health` until the payload is `{ status: 'ok' }` or the deadline passes. */
export async function waitForHealth(
    url: string,
    options: {
        timeoutMs: number;
        intervalMs?: number;
        fetchImpl?: HealthFetch;
        failure?: () => string | undefined;
        sleep?: (ms: number) => Promise<void>;
    },
): Promise<void> {
    const interval = options.intervalMs ?? 200;
    const fetchImpl = options.fetchImpl ?? fetch;
    const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const deadline = Date.now() + options.timeoutMs;
    let last = 'no response';
    while (Date.now() <= deadline) {
        const early = options.failure?.();
        if (early) throw new Error(early);
        try {
            const response = await fetchImpl(url, {
                signal: AbortSignal.timeout(Math.min(2_000, Math.max(1, options.timeoutMs))),
            });
            if (response.ok) {
                const body: unknown = await response.json();
                if (isHealthOk(body)) return;
                last = 'health payload was not status ok';
            } else {
                last = `HTTP ${response.status}`;
            }
        } catch (error) {
            last = error instanceof Error ? error.message : String(error);
        }
        if (Date.now() >= deadline) break;
        await sleep(interval);
    }
    const early = options.failure?.();
    throw new Error(early ?? `Timed out waiting for ${url} (${last})`);
}

/** SIGTERM, then SIGKILL after `graceMs` if the child is still alive. */
export async function stopChild(child: SpawnedChild, graceMs: number): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
            resolve();
        }, graceMs);
        child.onExit(() => {
            clearTimeout(timer);
            resolve();
        });
    });
}

/** Running child server. `stop` is idempotent and kills the process on quit. */
export interface RunningDesktopServer {
    port: number;
    url: string;
    kind: ServeLaunchKind;
    pid: number | undefined;
    stop: () => Promise<void>;
}

/** Options for {@link startDesktopServer}. */
export interface StartDesktopServerOptions {
    layout: DesktopLayout;
    port?: number;
    bunPath?: string;
    parentEnv?: Record<string, string | undefined>;
    healthTimeoutMs?: number;
    healthIntervalMs?: number;
    killGraceMs?: number;
    stdio?: 'inherit' | 'pipe' | 'ignore';
    exists?: (path: string) => boolean;
    spawn?: ProcessSpawner;
    fetchImpl?: HealthFetch;
    platform?: NodeJS.Platform;
    arch?: string;
}

function formatSpawnFailure(error: Error, launch: ServeLaunch): string {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
        return `Could not start "${launch.command}" (${launch.kind}). Install Bun or set BUN_PATH to the bun executable.`;
    }
    return error.message;
}

/**
 * Spawn the Spur server and wait until `/api/health` reports ok.
 * The Electron process never opens the database; the child does.
 */
export async function startDesktopServer(options: StartDesktopServerOptions): Promise<RunningDesktopServer> {
    const port = options.port ?? (await findFreePort());
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`Invalid port: ${String(port)}`);
    }
    const parentEnv = options.parentEnv ?? process.env;
    const launch = resolveServeLaunch({
        layout: options.layout,
        port,
        parentEnv,
        bunPath: options.bunPath ?? parentEnv.BUN_PATH ?? 'bun',
        exists: options.exists ?? existsSync,
        platform: options.platform,
        arch: options.arch,
    });
    const child = (options.spawn ?? nodeSpawner()).spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        env: launch.env,
        stdio: options.stdio ?? 'inherit',
    });

    let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    let spawnError: Error | undefined;
    child.onExit((code, signal) => {
        exit = { code, signal };
    });
    child.onError((error) => {
        spawnError = error;
    });

    const healthUrl = `http://${DESKTOP_HOST}:${port}/api/health`;
    const failure = (): string | undefined => {
        if (spawnError) return formatSpawnFailure(spawnError, launch);
        if (exit) {
            return `server process exited before ${healthUrl} responded (code ${String(exit.code)}, signal ${String(exit.signal)})`;
        }
        return undefined;
    };

    try {
        await waitForHealth(healthUrl, {
            timeoutMs: options.healthTimeoutMs ?? 60_000,
            intervalMs: options.healthIntervalMs ?? 200,
            fetchImpl: options.fetchImpl,
            failure,
        });
    } catch (error) {
        await stopChild(child, options.killGraceMs ?? 2_000);
        throw error;
    }

    let stopped = false;
    return {
        port,
        url: `http://${DESKTOP_HOST}:${port}`,
        kind: launch.kind,
        pid: child.pid,
        stop: async () => {
            if (stopped) return;
            stopped = true;
            await stopChild(child, options.killGraceMs ?? 5_000);
        },
    };
}
