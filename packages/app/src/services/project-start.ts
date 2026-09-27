import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';
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
 * Windows detached-launch spec.
 *
 * argv never appears on a command line here: cmd.exe expands %VAR% (and !VAR! under
 * delayed expansion) and the argv escaping child_process.spawn applies on win32 rewrites
 * embedded `"` to `\"`, which cmd.exe does not honor. Each element is handed to the
 * daemon as SPUR_SERVE_ARG_<i> and referenced from PowerShell, which performs no %
 * expansion.
 *
 * The daemon is created with PowerShell `Start-Process`, not `cmd /c start /b`: cmd's
 * `start` forwards every inheritable handle of its own handle table, so the daemon keeps
 * a duplicate of the stdout pipe belonging to whoever piped `spur projects start`. cmd
 * exits, but that pipe never reaches EOF, so a buffered caller (execa under the CLI, pwsh
 * `| Out-String` above it) waits on it forever. Start-Process goes through
 * CreateProcess with an explicit handle list, so the daemon inherits nothing of ours, and
 * no shell parses the daemon's argv.
 *
 * @throws if a value cannot survive the handoff: a .cmd/.bat launcher (a batch
 * interpreter re-expands %) or `"` in any argument (the spec keeps argv quote-free).
 */
export function buildWindowsDetachedServeLaunch(cmd: readonly string[]): {
    command: string;
    args: string[];
    env: Record<string, string>;
} {
    const launcher = cmd[0];
    if (launcher === undefined) {
        throw new Error('detached serve launch: command must not be empty');
    }
    if (/\.(cmd|bat)$/i.test(launcher)) {
        throw new Error(`detached serve launch: batch launcher ${launcher} re-expands %; use the bun executable`);
    }
    const env: Record<string, string> = {};
    for (const [i, arg] of cmd.entries()) {
        if (arg.includes('"')) {
            throw new Error(
                `detached serve launch: argument ${i} contains '"', which cannot be passed through cmd.exe`,
            );
        }
        env[`SPUR_SERVE_ARG_${i}`] = arg;
    }
    const runArgs = cmd
        .slice(1)
        .map((_, i) => `$env:SPUR_SERVE_ARG_${i + 1}`)
        .join(',');
    return {
        command: 'powershell.exe',
        args: [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            `Start-Process -FilePath $env:SPUR_SERVE_ARG_0 -ArgumentList @(${runArgs}) -WindowStyle Hidden`,
        ],
        env,
    };
}

/**
 * Default production spawn: ProcessExecutor runs `nohup <cmd> &` so the serve
 * daemon outlives the CLI without a direct Bun.spawn / child_process call.
 * On Windows, argv reaches the daemon via SPUR_SERVE_ARG_<i> env vars read by
 * PowerShell Start-Process (see the builder above for why).
 *
 * The daemon must also inherit none of the caller's stdio on win32: POSIX
 * redirects to /dev/null, and Start-Process creates the daemon with a fresh
 * handle table. Without that isolation a daemon keeps a duplicate of the
 * stdout pipe of any caller that piped `projects start` (pwsh `| Out-String`,
 * execa's buffered run inside the CLI), so the pipe never reaches EOF and the
 * caller waits forever — the CLI appears to hang with zero output.
 */
export const defaultDetachedServeSpawn: DetachedServeSpawn = async (cmd, options) => {
    const executor = new NodeProcessExecutor();
    // nohup + background: PE waits only for the shell, which exits immediately.
    // macOS and Linux both ship nohup; Windows uses Start-Process (env handoff above).
    const windowsLaunch = process.platform === 'win32' ? buildWindowsDetachedServeLaunch(cmd) : undefined;
    const shell = windowsLaunch ?? {
        command: '/bin/sh',
        args: ['-c', `nohup ${cmd.map(shQuote).join(' ')} </dev/null >/dev/null 2>&1 &`],
    };
    await executor.run({
        command: shell.command,
        args: shell.args,
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        env: { ...flattenEnv(options.env ?? getEnvVars()), ...windowsLaunch?.env },
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
    const cliPath = getEnvVar('SPUR_CLI_PATH');
    if (cliPath !== undefined && existsSync(cliPath)) {
        return [process.execPath, cliPath];
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
                env: getEnvVars(),
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
