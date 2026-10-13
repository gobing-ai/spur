import { existsSync, realpathSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { NodeProcessExecutor, type ProcessExecutor } from '@gobing-ai/ts-runtime';

// Process and port helpers shared by the project registry and project-stop. Extracted from
// `project-registry.ts` so project-stop no longer imports the registry that (dynamically)
// imports it back — a leaf module both sides depend on.

/** Information about a terminated process during registry refresh. */
export interface TerminatedProcessInfo {
    pid: number;
    port: number;
    signal: 'SIGTERM' | 'SIGKILL';
}

/** Test override function type for process killing. */
export type ProcessKiller = (pid: number, signal: NodeJS.Signals) => boolean;

/** Test override function type for listening PID resolution. */
export type PidFinder = (port: number) => Promise<number | undefined> | number | undefined;

let testPidFinder: PidFinder | undefined;
let testProcessKiller: ProcessKiller | undefined;

/** Install or clear test overrides for PID discovery and process killing (tests only). */
export function setProcessHelpersForTests(
    helpers:
        | {
              pidFinder?: PidFinder;
              processKiller?: ProcessKiller;
          }
        | undefined,
): void {
    testPidFinder = helpers?.pidFinder;
    testProcessKiller = helpers?.processKiller;
}

/**
 * Discover the PID listening on a local TCP port, filtering out self and parent PID.
 *
 * Windows has neither `lsof` nor `fuser`, so win32 reads the owner-PID column of
 * `netstat -ano` instead. Without that branch every stop on Windows fails closed
 * with "no listening PID found" (test-win/windows-serve-smoke).
 */
export async function findListeningPid(
    port: number,
    executor: ProcessExecutor = new NodeProcessExecutor(),
    platform: NodeJS.Platform = process.platform,
): Promise<number | undefined> {
    if (testPidFinder) {
        return testPidFinder(port);
    }
    if (port <= 0 || port > 65535) return undefined;

    if (platform === 'win32') {
        try {
            const res = await executor.run({
                command: 'netstat',
                args: ['-ano'],
                forceBuffered: true,
                rejectOnError: false,
            });
            if (res.exitCode === 0 && res.stdout) {
                // Rows: `Proto  Local Address  Foreign Address  State  PID`, with IPv6
                // locals bracketed (`[::]:3001`). UDP rows carry no State column.
                for (const line of res.stdout.split(/\r?\n/)) {
                    const [proto, local, , state, pidRaw] = line.trim().split(/\s+/);
                    if (proto !== 'TCP' || state !== 'LISTENING' || !local?.endsWith(`:${port}`)) continue;
                    const pid = parseInt(pidRaw ?? '', 10);
                    if (!Number.isNaN(pid) && pid > 0 && pid !== process.pid && pid !== process.ppid) {
                        return pid;
                    }
                }
            }
        } catch {
            // netstat unavailable — no further fallback on Windows
        }
        return undefined;
    }

    try {
        const res = await executor.run({
            command: 'lsof',
            args: ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'],
            forceBuffered: true,
            rejectOnError: false,
        });
        if (res.exitCode === 0 && res.stdout) {
            const lines = res.stdout.trim().split('\n');
            for (const line of lines) {
                const pid = parseInt(line.trim(), 10);
                if (!Number.isNaN(pid) && pid > 0 && pid !== process.pid && pid !== process.ppid) {
                    return pid;
                }
            }
        }
    } catch {
        // Fall back to fuser if lsof fails/unavailable
    }

    try {
        const res = await executor.run({
            command: 'fuser',
            args: [`${port}/tcp`],
            forceBuffered: true,
            rejectOnError: false,
        });
        if (res.exitCode === 0 && (res.stdout || res.stderr)) {
            const out = (res.stdout || res.stderr).trim();
            const pids = out
                .split(/\s+/)
                .map((s) => parseInt(s.trim(), 10))
                .filter((p) => !Number.isNaN(p) && p > 0);
            for (const pid of pids) {
                if (pid !== process.pid && pid !== process.ppid) {
                    return pid;
                }
            }
        }
    } catch {
        // Ignore fallback error
    }

    return undefined;
}

/** Send signal to a PID safely, using testProcessKiller if configured. */
export function sendSignalToPid(pid: number, signal: NodeJS.Signals): boolean {
    if (testProcessKiller) {
        return testProcessKiller(pid, signal);
    }
    try {
        process.kill(pid, signal);
        return true;
    } catch {
        return false;
    }
}

/**
 * Expand a leading ~ to user homedir and normalize path.
 * If the path exists on disk, resolve its realpath.
 */
export function normalizeProjectPath(pathInput: string): string {
    const trimmed = pathInput.trim();
    let expanded = trimmed;
    if (trimmed === '~') {
        expanded = homedir();
    } else if (trimmed.startsWith('~/')) {
        expanded = join(homedir(), trimmed.slice(2));
    } else {
        expanded = resolve(trimmed);
    }

    try {
        if (existsSync(expanded)) {
            return realpathSync(expanded);
        }
    } catch {
        // Fall back to expanded path if realpath throws
    }
    return expanded;
}

/** Result of probing whether a port can be bound by a server. */
export type PortProbeResult = 'available' | 'in-use' | 'denied';

/** Test override function type for port probing. */
export type PortProbe = (port: number) => Promise<PortProbeResult>;

let testPortProbe: PortProbe | undefined;

/** Install or clear the process-wide port probe override (tests only). */
export function setPortProbeForTests(probe: PortProbe | undefined): void {
    testPortProbe = probe;
}

/** Classify a net.Server bind error code into a PortProbeResult. */
export function classifyPortBindError(err: unknown): PortProbeResult {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : '';
    if (code === 'EADDRINUSE' || code === 'EADDRNOTAVAIL') {
        return 'in-use';
    }
    return 'denied';
}

/**
 * Probe one host/port for a live TCP listener.
 * Bun.serve({ hostname: 'localhost' }) often binds IPv6-only on macOS, so
 * callers of {@link isPortLive} must try both families.
 */
async function isPortLiveOnHost(port: number, host: string, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const socket = connect({ port, host, timeout: timeoutMs });
        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.on('error', () => {
            socket.destroy();
            resolve(false);
        });
    });
}

/**
 * Check if a TCP port is currently listening on localhost (IPv4 or IPv6).
 *
 * Important: probing only `127.0.0.1` misses servers bound to `::1` when the
 * bind host is `localhost` (common Bun/macOS dual-stack behavior). That made
 * project-start health polls fail even after `spur serve` was up.
 */
export async function isPortLive(port: number, timeoutMs = 200): Promise<boolean> {
    if (testPortProbe) {
        return (await testPortProbe(port)) === 'in-use';
    }
    if (port <= 0) return false;
    if (await isPortLiveOnHost(port, '127.0.0.1', timeoutMs)) return true;
    if (await isPortLiveOnHost(port, '::1', timeoutMs)) return true;
    return false;
}

/**
 * Probe whether a TCP port is available to bind, already in use, or denied by the environment.
 */
export async function probePort(port: number): Promise<PortProbeResult> {
    if (testPortProbe) {
        return testPortProbe(port);
    }
    if (port <= 0 || port > 65535) return 'denied';

    return new Promise<PortProbeResult>((resolve) => {
        const server = createServer();
        server.unref();
        server.on('error', (err: NodeJS.ErrnoException) => {
            resolve(classifyPortBindError(err));
        });
        server.listen({ port, host: '127.0.0.1' }, () => {
            server.close(() => resolve('available'));
        });
    });
}

/** Check if a port can be bound by a new server on localhost. */
export async function isPortAvailable(port: number): Promise<boolean> {
    const result = await probePort(port);
    return result === 'available';
}

/**
 * Check if the current environment permits binding a local TCP port (port 0).
 *
 * CI-load-bearing note: .github/workflows/ci.yml runs tests unsandboxed, so
 * real OS bind tests (Bucket A) execute on every push. If CI ever loses the
 * capability to bind TCP ports, those tests decay to green-by-absence.
 */
export async function portBindingAvailable(): Promise<boolean> {
    if (testPortProbe) {
        const result = await testPortProbe(0);
        return result === 'available';
    }
    return new Promise<boolean>((resolve) => {
        const server = createServer();
        server.unref();
        server.on('error', () => resolve(false));
        server.listen({ port: 0, host: '127.0.0.1' }, () => {
            server.close(() => resolve(true));
        });
    });
}
