import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { isPortLive, normalizeProjectPath, type ProjectRegistry } from './project-registry';

/** Result of starting (or attaching to) a registered project serve instance. */
export interface ProjectStartResult {
    name: string;
    path: string;
    port: number;
    running: true;
    url: string;
    alreadyRunning: boolean;
}

/**
 * Minimal child handle required by start polling.
 *
 * Detached daemons are launched via ProcessExecutor + `nohup … &` (no direct
 * Bun.spawn). The shell exits immediately; `exitCode` on this handle stays
 * `null` and readiness is observed via port health polls.
 */
export interface DetachedServeChild {
    readonly exitCode: number | null;
    unref(): void;
}

/** Options accepted by the detached serve spawn seam. */
export interface DetachedServeSpawnOptions {
    cwd?: string;
    detached?: boolean;
    stdio?: ['ignore', 'ignore', 'ignore'];
    env?: NodeJS.ProcessEnv;
}

/**
 * Spawn function for detached `spur serve`.
 *
 * May be sync or async. Tests inject a fake — never reassign global `Bun.spawn`
 * (on Bun, execa/ProcessExecutor is Bun.spawn under the hood).
 */
export type DetachedServeSpawn = (
    cmd: string[],
    options: DetachedServeSpawnOptions,
) => DetachedServeChild | Promise<DetachedServeChild>;

/** Options for starting a registered project serve instance. */
export interface ProjectStartOptions {
    /** Explicit bind port; otherwise allocate from the registry free-port band. */
    port?: number;
    /** Health-poll attempts (default 100 ≈ 10s at 100ms). */
    pollAttempts?: number;
    /** Delay between health polls in ms (default 100). */
    pollIntervalMs?: number;
    /**
     * Injectable spawn for tests.
     * Defaults to ProcessExecutor-backed detached daemon launch.
     */
    spawn?: DetachedServeSpawn;
}

/** POSIX single-quote for embedding in `sh -c`. */
function shQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Flatten process env to string map for ProcessExecutor. */
function flattenEnv(env: NodeJS.ProcessEnv): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        if (value !== undefined) out[key] = value;
    }
    return out;
}

/**
 * Default production spawn: ProcessExecutor runs `nohup <cmd> &` so the serve
 * daemon outlives the CLI without a direct Bun.spawn / child_process call.
 */
export const defaultDetachedServeSpawn: DetachedServeSpawn = async (cmd, options) => {
    const executor = new NodeProcessExecutor();
    const line = cmd.map(shQuote).join(' ');
    // nohup + background: PE waits only for the shell, which exits immediately.
    // macOS and Linux both ship nohup; Windows uses start /b via cmd.
    const shell =
        process.platform === 'win32'
            ? {
                  command: 'cmd',
                  args: ['/c', `start /b "" ${cmd.map((c) => `"${c.replace(/"/g, '""')}"`).join(' ')}`],
              }
            : {
                  command: '/bin/sh',
                  args: ['-c', `nohup ${line} </dev/null >/dev/null 2>&1 &`],
              };
    await executor.run({
        command: shell.command,
        args: shell.args,
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        env: flattenEnv(options.env ?? process.env),
        forceBuffered: true,
        rejectOnError: false,
    });
    return { exitCode: null, unref: () => {} };
};

/**
 * Process-wide test override for the detached serve spawn.
 *
 * Prefer `options.spawn` when the caller can pass it. Use this only from tests
 * that go through CLI/HTTP entry points that cannot inject options.
 */
let testDetachedServeSpawn: DetachedServeSpawn | undefined;

/** Install or clear the process-wide detached-serve spawn override (tests only). */
export function setDetachedServeSpawnForTests(spawn: DetachedServeSpawn | undefined): void {
    testDetachedServeSpawn = spawn;
}

/**
 * Resolve argv that can run `spur serve …`.
 *
 * Prefer the current process entry when it *is* the spur CLI (spur.js / apps/cli).
 * When the caller is `spur serve` (board hub), fall back to `spur` on PATH —
 * never reuse the server entry as argv[1] (that spawned the wrong program).
 */
export function resolveSpurServeCommand(): string[] {
    if (process.env.SPUR_CLI_PATH && existsSync(process.env.SPUR_CLI_PATH)) {
        return [process.execPath, process.env.SPUR_CLI_PATH];
    }

    const argv1 = process.argv[1];
    if (typeof argv1 === 'string' && argv1.length > 0) {
        const base = argv1.replace(/\\/g, '/');
        if (
            base.endsWith('/spur.js') ||
            base.endsWith('/spur') ||
            base.includes('/apps/cli/src/index') ||
            base.endsWith('apps/cli/src/index.ts')
        ) {
            return [process.execPath, argv1];
        }
    }

    const monorepoCli = resolve(process.cwd(), 'apps/cli/src/index.ts');
    if (existsSync(monorepoCli)) {
        return [process.execPath, monorepoCli];
    }

    const fromPath = typeof Bun !== 'undefined' && typeof Bun.which === 'function' ? Bun.which('spur') : null;
    if (fromPath) {
        return [fromPath];
    }

    throw new Error(
        'Could not resolve the spur CLI to spawn `spur serve`. Ensure `spur` is on PATH (or invoke start via the monorepo CLI).',
    );
}

/**
 * Start a registered project via detached `spur serve`, or return immediately
 * if it is already listening.
 *
 * Hardening vs the first ship:
 * - Always expand `~/…` paths before spawn/cwd (posix_spawn does not expand tilde).
 * - Bind spawned serves to `127.0.0.1` so IPv4 health checks match.
 * - Resolve the spur CLI correctly when the hub is already a serve process.
 * - Longer default poll window for cold starts.
 */
export async function startRegisteredProject(
    registry: ProjectRegistry,
    target: string,
    options: ProjectStartOptions = {},
): Promise<ProjectStartResult> {
    let entry = (await registry.getByName(target)) ?? (await registry.getByPath(target));

    if (!entry) {
        const absPath = normalizeProjectPath(target);
        if (existsSync(absPath)) {
            entry = await registry.upsert({ path: absPath, name: basename(absPath), port: 0 });
        } else {
            throw new Error(`Project not found in registry: "${target}"`);
        }
    }

    const projectPath = normalizeProjectPath(entry.path);
    if (!existsSync(projectPath)) {
        throw new Error(
            `Project path does not exist: "${entry.path}" (resolved to ${projectPath}). Update ~/.config/spur/projects.json.`,
        );
    }

    // Persist healed path when the registry still has a tilde/relative form.
    if (projectPath !== entry.path) {
        await registry.upsert({ name: entry.name, path: projectPath, port: entry.port });
        entry = { ...entry, path: projectPath };
    }

    if (entry.port > 0 && (await isPortLive(entry.port))) {
        return {
            name: entry.name,
            path: projectPath,
            port: entry.port,
            running: true,
            url: `http://127.0.0.1:${entry.port}`,
            alreadyRunning: true,
        };
    }

    const allocatedPort = options.port && options.port > 0 ? options.port : await registry.allocatePort();
    const invocation = resolveSpurServeCommand();
    const spawn = options.spawn ?? testDetachedServeSpawn ?? defaultDetachedServeSpawn;
    const child = await Promise.resolve(
        spawn(
            [
                ...invocation,
                'serve',
                '--cwd',
                projectPath,
                '--port',
                String(allocatedPort),
                '--host',
                '127.0.0.1',
                '--no-open',
            ],
            {
                cwd: projectPath,
                detached: true,
                stdio: ['ignore', 'ignore', 'ignore'],
                env: process.env,
            },
        ),
    );

    const pollAttempts = options.pollAttempts ?? 100;
    const pollIntervalMs = options.pollIntervalMs ?? 100;
    let live = false;
    for (let i = 0; i < pollAttempts; i++) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        if (await isPortLive(allocatedPort)) {
            live = true;
            break;
        }
        // If the child exited before listen, fail fast with a clearer message.
        if (child.exitCode !== null) {
            child.unref();
            throw new Error(
                `Project "${entry.name}" serve process exited with code ${child.exitCode} before port ${allocatedPort} became ready (path: ${projectPath}).`,
            );
        }
    }
    child.unref();

    if (!live) {
        throw new Error(
            `Project "${entry.name}" failed to start on port ${allocatedPort} within ${(pollAttempts * pollIntervalMs) / 1000}s (path: ${projectPath}).`,
        );
    }

    await registry.setPort(projectPath, allocatedPort);
    return {
        name: entry.name,
        path: projectPath,
        port: allocatedPort,
        running: true,
        url: `http://127.0.0.1:${allocatedPort}`,
        alreadyRunning: false,
    };
}
