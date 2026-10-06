import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { isPortLive, normalizeProjectPath, ProjectRegistry } from './project-registry';

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
    /**
     * Injectable owner-adoption probe for tests: the port the project's live owner-claim holder
     * actually serves, or null when no live serving owner exists. Defaults to
     * {@link defaultResolveOwnerPort} (owner-claim read + lsof + health probe).
     */
    resolveOwnerPort?: (projectRoot: string) => Promise<number | null>;
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
 * The daemon is created with PowerShell `Start-Process`, not `cmd /c start /b`: `start` forwards
 * cmd's whole inheritable handle table, so the daemon keeps a duplicate of the stdout pipe belonging
 * to whoever piped `spur projects start`. cmd exits, but that pipe never reaches EOF, so a buffered
 * caller (execa under the CLI, pwsh `| Out-String` above it) waits on it forever — measured on
 * windows-latest: `start /b` closed the caller stream only when the child died (14.2s for a 12s
 * child), Start-Process closed it in 0.42s while the daemon kept running. Start-Process hands the
 * daemon none of our std handles, and no shell parses its argv.
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
            throw new Error(`detached serve launch: argument ${i} contains '"', which the launch spec cannot carry`);
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
    // POSIX daemons log to the project's `.spur/run/serve-spawn.log` (append) so a boot failure
    // (e.g. an owner-claim refusal) is diagnosable — the launch's caller reads the fresh tail
    // into its error. Windows keeps the /dev/null-equivalent isolation (no log capture there).
    const logFile = options.cwd !== undefined ? join(options.cwd, '.spur', 'run', 'serve-spawn.log') : undefined;
    const shell = windowsLaunch ?? {
        command: '/bin/sh',
        args: [
            '-c',
            // `;`, never `&&`: `a && b &` backgrounds the whole list in a subshell that keeps our
            // stdout pipe open for the daemon's lifetime, so this run (and /api/projects/start) hangs.
            logFile !== undefined
                ? `mkdir -p ${shQuote(join(options.cwd ?? '', '.spur', 'run'))}; nohup ${cmd.map(shQuote).join(' ')} </dev/null >>${shQuote(logFile)} 2>&1 &`
                : `nohup ${cmd.map(shQuote).join(' ')} </dev/null >/dev/null 2>&1 &`,
        ],
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

/** Signal-0 existence probe; unknown failures (EPERM) fail closed as alive. */
function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH';
    }
}

/**
 * The live pid holding this project's `.spur/server-owner.lock` claim, or null when the claim is
 * absent, ambiguous (a transition in flight — never guess), malformed, or held by a dead process
 * (the boot path's own stale reaper owns that case). Read-only: a wrong null here only means the
 * caller spawns and the daemon's own acquire arbitrates.
 */
function readOwnerClaimPid(projectRoot: string): number | null {
    try {
        const directory = join(realpathSync(projectRoot), '.spur', 'server-owner.lock');
        const owners = readdirSync(directory);
        if (owners.length !== 1) return null;
        const pid = owners[0]?.match(/^(\d+)-[a-f0-9-]+$/)?.[1];
        if (pid === undefined) return null;
        const n = Number(pid);
        return isPidAlive(n) ? n : null;
    } catch {
        return null;
    }
}

/** First TCP port this pid listens on (lsof; null when lsof fails or there is no listener). */
async function findPidListenPort(pid: number): Promise<number | null> {
    try {
        const res = await new NodeProcessExecutor().run({
            command: 'lsof',
            args: ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN'],
            forceBuffered: true,
            rejectOnError: false,
        });
        if (res.exitCode !== 0) return null;
        const port = res.stdout.match(/TCP [^ ]*:(\d+) \(LISTEN\)/)?.[1];
        return port === undefined ? null : Number(port);
    } catch {
        return null;
    }
}

/**
 * The port the project's live owner-claim holder actually serves, health-verified — or null.
 *
 * A live pid that listens nowhere is a serve hung mid-boot (the claim is taken before listen):
 * null lets the caller spawn, and the daemon's own acquire + handoff wait arbitrates with the
 * reason landing in the daemon log. A port that stops answering between lsof and the health
 * probe (owner exited mid-adoption) is likewise null — never adopt an unverified port.
 */
export async function defaultResolveOwnerPort(projectRoot: string): Promise<number | null> {
    const pid = readOwnerClaimPid(projectRoot);
    if (pid === null) return null;
    const port = await findPidListenPort(pid);
    if (port === null || !(await isPortLive(port))) return null;
    return port;
}

/** Current size of the daemon spawn log (0 when absent) — the byte offset fresh output starts at. */
function daemonLogSize(projectRoot: string): number {
    try {
        return statSync(join(projectRoot, '.spur', 'run', 'serve-spawn.log')).size;
    } catch {
        return 0;
    }
}

/**
 * Error suffix carrying the daemon log lines written since `offset` (bounded, one line). Only
 * fresh output is reported — a stale refusal from last week is not this launch's cause.
 */
function daemonLogSuffix(projectRoot: string, offset: number): string {
    try {
        const content = readFileSync(join(projectRoot, '.spur', 'run', 'serve-spawn.log'), 'utf8');
        const tail = content.slice(offset).trim().slice(-2000).replace(/\n+/g, ' | ');
        return tail === '' ? '' : ` Daemon log tail: ${tail}`;
    } catch {
        return '';
    }
}

/** Refuse a second project server before opening its database or changing its registry entry. */
export async function assertProjectServerAvailable(
    projectRoot: string,
    options: { registry?: Pick<ProjectRegistry, 'readRaw'>; isLive?: typeof isPortLive } = {},
): Promise<void> {
    const registry = options.registry ?? new ProjectRegistry();
    const path = normalizeProjectPath(projectRoot);
    const existing = registry.readRaw().projects.find((entry) => normalizeProjectPath(entry.path) === path);
    if (existing && existing.port > 0 && (await (options.isLive ?? isPortLive)(existing.port))) {
        throw new Error(
            `Project already has a live server at http://127.0.0.1:${existing.port}. Close that server before starting another one.`,
        );
    }
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

    // The registry can forget a live serve: a `healStale` liveness probe that misses under load
    // rewrites the entry's port to 0 while the owner keeps listening (observed 2026-10-05 — the
    // switcher could not launch ts-libs / knowledge-kit while forgotten serves held 3004/3005;
    // every spawn was then refused by the owner claim, with the reason lost in the daemon's
    // voided stderr). Adopt the claim's live serve instead of spawning a duplicate that must be
    // refused, and heal the entry to the port the owner actually serves.
    const ownerPort = await (options.resolveOwnerPort ?? defaultResolveOwnerPort)(projectPath);
    if (ownerPort !== null) {
        await registry.setPort(projectPath, ownerPort);
        return {
            name: entry.name,
            path: projectPath,
            port: ownerPort,
            running: true,
            url: `http://127.0.0.1:${ownerPort}`,
            alreadyRunning: true,
        };
    }

    const allocatedPort = options.port && options.port > 0 ? options.port : await registry.allocatePort();
    const invocation = resolveSpurServeCommand();
    const spawn = options.spawn ?? testDetachedServeSpawn ?? defaultDetachedServeSpawn;
    // Fresh-output offset for the failure suffix — captured before the daemon can write.
    const logOffset = daemonLogSize(projectPath);
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
                `Project "${entry.name}" serve process exited with code ${child.exitCode} before port ${allocatedPort} became ready (path: ${projectPath}).${daemonLogSuffix(projectPath, logOffset)}`,
            );
        }
    }
    child.unref();

    if (!live) {
        throw new Error(
            `Project "${entry.name}" failed to start on port ${allocatedPort} within ${(pollAttempts * pollIntervalMs) / 1000}s (path: ${projectPath}).${daemonLogSuffix(projectPath, logOffset)}`,
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
