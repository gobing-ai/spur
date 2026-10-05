import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { getEnvVars } from '@gobing-ai/spur-config';
import type { DesktopServerControlMessage } from '@gobing-ai/spur-contracts';
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
    /** Ask an owned Windows server to drain and close before forced termination. */
    requestShutdown?(): boolean;
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
 * On POSIX the child is its own process group so startup cancellation also stops descendants.
 */
export function nodeSpawner(platform: NodeJS.Platform = process.platform): ProcessSpawner {
    return {
        spawn(command, args, options) {
            const detached = platform !== 'win32';
            const child: ChildProcess = spawn(command, args, {
                cwd: options.cwd,
                env: options.env,
                stdio: [options.stdio, options.stdio, options.stdio, 'ipc'],
                serialization: 'json',
                windowsHide: true,
                detached,
            });
            child.on('message', (message: unknown) => {
                if (
                    typeof message === 'object' &&
                    message !== null &&
                    'type' in message &&
                    message.type === 'spur.desktop.startup-error' &&
                    'message' in message &&
                    typeof message.message === 'string'
                ) {
                    child.emit('error', new Error(message.message));
                }
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
                ...(!detached
                    ? {
                          requestShutdown(): boolean {
                              if (!child.connected) return false;
                              const message: DesktopServerControlMessage = { type: 'spur.desktop.shutdown' };
                              child.send(message, () => {});
                              return true;
                          },
                      }
                    : {}),
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

/** Thrown when desktop startup is cancelled (quit) before `/api/health` succeeds. */
export class DesktopStartupAborted extends Error {
    constructor() {
        super('desktop startup aborted');
        this.name = 'DesktopStartupAborted';
    }
}

function healthSignal(timeoutMs: number, cancel?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    const timer = setTimeout(abort, timeoutMs);
    if (cancel?.aborted) abort();
    else cancel?.addEventListener('abort', abort, { once: true });
    return {
        signal: controller.signal,
        dispose: () => {
            clearTimeout(timer);
            cancel?.removeEventListener('abort', abort);
        },
    };
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
        signal?: AbortSignal;
    },
): Promise<void> {
    const interval = options.intervalMs ?? 200;
    const fetchImpl = options.fetchImpl ?? fetch;
    const sleep =
        options.sleep ??
        ((ms: number) =>
            new Promise<void>((resolve) => {
                const onAbort = (): void => {
                    clearTimeout(timer);
                    resolve();
                };
                const timer = setTimeout(() => {
                    options.signal?.removeEventListener('abort', onAbort);
                    resolve();
                }, ms);
                options.signal?.addEventListener('abort', onAbort, { once: true });
            }));
    const deadline = Date.now() + options.timeoutMs;
    let last = 'no response';
    while (Date.now() <= deadline) {
        if (options.signal?.aborted) throw new DesktopStartupAborted();
        const early = options.failure?.();
        if (early) throw new Error(early);
        const probe = healthSignal(Math.min(2_000, Math.max(1, deadline - Date.now())), options.signal);
        try {
            const response = await fetchImpl(url, { signal: probe.signal });
            if (response.ok) {
                const body: unknown = await response.json();
                if (isHealthOk(body)) return;
                last = 'health payload was not status ok';
            } else {
                last = `HTTP ${response.status}`;
            }
        } catch (error) {
            last = error instanceof Error ? error.message : String(error);
        } finally {
            probe.dispose();
        }
        if (Date.now() >= deadline) break;
        await sleep(interval);
    }
    if (options.signal?.aborted) throw new DesktopStartupAborted();
    const early = options.failure?.();
    throw new Error(early ?? `Timed out waiting for ${url} (${last})`);
}

/** Request graceful shutdown (parent IPC on Windows, SIGTERM on POSIX), then force after `graceMs`. */
export async function stopChild(child: SpawnedChild, graceMs: number): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (!child.requestShutdown?.()) child.kill('SIGTERM');
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

/** Shared servers remain alive on quit; owned children have idempotent cleanup. */
export interface RunningDesktopServer {
    port: number;
    url: string;
    kind: ServeLaunchKind | 'shared';
    ownership: 'owned' | 'shared';
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
    /** Aborted by quit so an in-progress child is killed before health resolves. */
    signal?: AbortSignal;
    /** Directory Electron was launched from. Forwarded to {@link resolveServeLaunch}. */
    launchCwd?: string;
    /** Report unexpected exits after the health handshake. Normal stop does not notify. */
    onUnexpectedExit?: (error: Error) => void;
    /** Native listener inspection; injectable for lifecycle tests. */
    inspectOwner?: SharedServerOptions['inspect'];
}

function formatSpawnFailure(error: Error, launch: ServeLaunch): string {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
        return `Could not start "${launch.command}" (${launch.kind}). Install Bun or set BUN_PATH to the bun executable.`;
    }
    return error.message;
}

/**
 * Reuse a verified live project server, or spawn and wait for an owned child.
 * The Electron process never opens the database; the selected server does.
 */
export async function startDesktopServer(options: StartDesktopServerOptions): Promise<RunningDesktopServer> {
    if (options.signal?.aborted) throw new DesktopStartupAborted();
    const attach = async (): Promise<RunningDesktopServer | undefined> => {
        try {
            const shared = await findSharedServer({
                projectRoot: options.layout.projectRoot,
                timeoutMs: options.healthTimeoutMs ?? 60_000,
                signal: options.signal,
                fetchImpl: options.fetchImpl,
                inspect: options.inspectOwner,
            });
            return shared ? { ...shared, kind: 'shared', ownership: 'shared', stop: async () => {} } : undefined;
        } catch (error) {
            if (options.signal?.aborted) throw new DesktopStartupAborted();
            throw error;
        }
    };
    const shared = await attach();
    if (shared) return shared;
    const port = options.port ?? (await findFreePort());
    if (options.signal?.aborted) throw new DesktopStartupAborted();
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`Invalid port: ${String(port)}`);
    }
    const parentEnv = options.parentEnv ?? getEnvVars();
    const launch = resolveServeLaunch({
        layout: options.layout,
        port,
        parentEnv,
        bunPath: options.bunPath ?? parentEnv.BUN_PATH ?? 'bun',
        exists: options.exists ?? existsSync,
        platform: options.platform,
        arch: options.arch,
        launchCwd: options.launchCwd,
    });
    if (options.signal?.aborted) throw new DesktopStartupAborted();
    const child = (options.spawn ?? nodeSpawner(options.platform)).spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        env: launch.env,
        stdio: options.stdio ?? 'inherit',
    });

    let ready = false;
    let stopping: Promise<void> | undefined;
    let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    let spawnError: Error | undefined;
    child.onExit((code, signal) => {
        exit = { code, signal };
        if (ready && !stopping) {
            options.onUnexpectedExit?.(
                new Error(
                    `Spur server exited (code ${String(code)}, signal ${String(signal)}). Reopen Spur to restart it.`,
                ),
            );
        }
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

    const startupGrace = options.killGraceMs ?? 2_000;
    const stopSpawned = (graceMs: number): Promise<void> => {
        if (!stopping) {
            ready = false;
            stopping = stopChild(child, graceMs);
        }
        return stopping;
    };
    const onAbort = (): void => {
        void stopSpawned(startupGrace);
    };
    if (options.signal?.aborted) {
        await stopSpawned(startupGrace);
        throw new DesktopStartupAborted();
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
        await waitForHealth(healthUrl, {
            timeoutMs: options.healthTimeoutMs ?? 60_000,
            intervalMs: options.healthIntervalMs ?? 200,
            fetchImpl: options.fetchImpl,
            failure: () => (options.signal?.aborted ? 'desktop startup aborted' : failure()),
            signal: options.signal,
        });
        if (options.signal?.aborted) throw new DesktopStartupAborted();
    } catch (error) {
        await stopSpawned(startupGrace);
        options.signal?.removeEventListener('abort', onAbort);
        if (options.signal?.aborted || error instanceof DesktopStartupAborted) throw new DesktopStartupAborted();
        const concurrent = await attach();
        if (concurrent) return concurrent;
        throw error;
    }
    options.signal?.removeEventListener('abort', onAbort);
    const lateFailure = failure();
    if (lateFailure) {
        await stopSpawned(startupGrace);
        throw new Error(lateFailure);
    }
    ready = true;

    return {
        port,
        url: `http://${DESKTOP_HOST}:${port}`,
        kind: launch.kind,
        ownership: 'owned',
        pid: child.pid,
        stop: () => stopSpawned(options.killGraceMs ?? 5_000),
    };
}

/** Translate native listener output into literal loopback origins only. */
export function listenerOrigins(output: string, pid: number, platform: NodeJS.Platform): string[] {
    let family: string | undefined;
    const addresses =
        platform === 'win32'
            ? output.split(/\r?\n/).flatMap((line) => {
                  const fields = line.trim().split(/\s+/);
                  return fields[0] === 'TCP' && fields[3] === 'LISTENING' && fields[4] === String(pid)
                      ? [fields[1] ?? '']
                      : [];
              })
            : output.split(/\r?\n/).flatMap((line) => {
                  if (line.startsWith('f') || line.startsWith('p')) family = undefined;
                  if (line.startsWith('t')) family = line.slice(1);
                  if (!line.startsWith('n')) return [];
                  const address = line.slice(1);
                  if (!address.startsWith('*:')) return [address];
                  if (family === 'IPv4') return [address.replace('*', '0.0.0.0')];
                  if (family === 'IPv6') return [address.replace('*', '[::]')];
                  return []; // Unknown wildcard family cannot identify the owner's loopback listener.
              });
    const origins = new Set<string>();
    for (const address of addresses) {
        const match = address.match(/^(127\.0\.0\.1|\[::1\]|0\.0\.0\.0|\[::\]):(\d+)$/);
        if (!match) continue;
        const port = Number(match[2]);
        if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
        const host = match[1] === '127.0.0.1' || match[1] === '0.0.0.0' ? '127.0.0.1' : '[::1]';
        origins.add(`http://${host}:${port}`);
    }
    return [...origins];
}

/** Read OS listeners without a shell, registry writes or signals to the owner. */
export async function inspectOwnerListeners(pid: number, signal?: AbortSignal): Promise<string[]> {
    const platform = process.platform;
    const command = platform === 'win32' ? 'netstat' : platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof';
    const args =
        platform === 'win32'
            ? ['-ano', '-p', 'tcp']
            : ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-F', 'ftn'];
    const output = await new Promise<string>((resolve, reject) => {
        execFile(
            command,
            args,
            { timeout: 2000, maxBuffer: 1024 * 1024, signal, windowsHide: true },
            (error, stdout, stderr) => {
                // lsof reports no matching sockets as exit 1 with empty output.
                if (error && !(platform !== 'win32' && error.code === 1 && !stdout && !stderr)) reject(error);
                else resolve(stdout);
            },
        );
    });
    return listenerOrigins(output, pid, platform);
}

function ownerMarker(directory: string): string | undefined {
    let entries: string[];
    try {
        entries = readdirSync(directory);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    }
    const marker = entries.length === 1 ? entries[0] : undefined;
    if (!marker || !/^\d+-[a-f0-9-]+$/.test(marker)) {
        throw new Error(`Project server ownership claim is incomplete at ${directory}`);
    }
    const pid = Number(marker.split('-')[0]);
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid project server owner pid');
    try {
        process.kill(pid, 0);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return undefined;
        throw error;
    }
    return marker;
}

/** Read-only owner discovery inputs within the desktop Node adapter. */
interface SharedServerOptions {
    projectRoot: string;
    timeoutMs: number;
    signal?: AbortSignal;
    fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
    inspect?: (pid: number, signal?: AbortSignal) => Promise<string[]>;
}

/** Attach only after verifying service, canonical project and the unchanged live claim. */
export async function findSharedServer(
    options: SharedServerOptions,
): Promise<{ url: string; port: number; pid: number } | undefined> {
    const directory = join(options.projectRoot, '.spur', 'server-owner.lock');
    const marker = ownerMarker(directory);
    if (!marker) return undefined;
    const canonicalRoot = realpathSync(options.projectRoot);
    const pid = Number(marker.split('-')[0]);
    const deadline = Date.now() + options.timeoutMs;
    const fetchImpl = options.fetchImpl ?? fetch;
    do {
        options.signal?.throwIfAborted();
        const origins = await (options.inspect ?? inspectOwnerListeners)(pid, options.signal);
        options.signal?.throwIfAborted();
        for (const origin of origins) {
            const url = new URL(origin);
            if (
                url.protocol !== 'http:' ||
                !['127.0.0.1', '[::1]'].includes(url.hostname) ||
                url.username ||
                url.password ||
                url.pathname !== '/' ||
                url.search ||
                url.hash
            ) {
                throw new Error('Owner inspection returned a non-loopback origin');
            }
            const probe = new AbortController();
            const abort = (): void => probe.abort();
            const timer = setTimeout(abort, Math.min(2000, Math.max(1, deadline - Date.now())));
            options.signal?.addEventListener('abort', abort, { once: true });
            try {
                const init: RequestInit = { signal: probe.signal, redirect: 'error' };
                const health = await fetchImpl(`${origin}/api/health`, init);
                if (!health.ok) continue;
                const body: unknown = await health.json();
                if (
                    typeof body !== 'object' ||
                    body === null ||
                    !('status' in body) ||
                    body.status !== 'ok' ||
                    !('service' in body) ||
                    body.service !== 'spur'
                )
                    continue;
                const project = await fetchImpl(`${origin}/api/project`, init);
                if (!project.ok) continue;
                const identity: unknown = await project.json();
                if (
                    typeof identity !== 'object' ||
                    identity === null ||
                    !('path' in identity) ||
                    identity.path !== canonicalRoot
                )
                    continue;
                options.signal?.throwIfAborted();
                if (ownerMarker(directory) !== marker)
                    throw new Error('Project server ownership changed during attachment');
                return { url: origin, port: Number(url.port || 80), pid };
            } catch (error) {
                options.signal?.throwIfAborted();
                if (ownerMarker(directory) !== marker) throw error;
                // Refused, redirected or mismatched endpoints never become a trusted renderer origin.
            } finally {
                clearTimeout(timer);
                options.signal?.removeEventListener('abort', abort);
            }
        }
        if (ownerMarker(directory) !== marker) throw new Error('Project server ownership changed during attachment');
        if (Date.now() >= deadline) break;
        await delay(Math.min(200, Math.max(1, deadline - Date.now())), undefined, { signal: options.signal });
    } while (Date.now() <= deadline);
    throw new Error(
        `Could not verify the existing Spur server for ${canonicalRoot} (pid ${pid}). The server was left running.`,
    );
}
