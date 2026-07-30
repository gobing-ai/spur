import { existsSync } from 'node:fs';
import { basename } from 'node:path';
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

/** Options for starting a registered project serve instance. */
export interface ProjectStartOptions {
    /** Explicit bind port; otherwise allocate from the registry free-port band. */
    port?: number;
    /** Health-poll attempts (default 100 ≈ 10s at 100ms). */
    pollAttempts?: number;
    /** Delay between health polls in ms (default 100). */
    pollIntervalMs?: number;
}

/**
 * Resolve argv that can run `spur serve …`.
 *
 * Prefer the current process entry when it *is* the spur CLI (spur.js / apps/cli).
 * When the caller is `spur serve` (board hub), fall back to `spur` on PATH —
 * never reuse the server entry as argv[1] (that spawned the wrong program).
 */
export function resolveSpurServeCommand(): string[] {
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
    const child = Bun.spawn(
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
