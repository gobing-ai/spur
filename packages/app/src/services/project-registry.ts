import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { getProjectsFilePath, type ProjectEntry, type ProjectsFile, projectsFileSchema } from '@gobing-ai/spur-config';

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
    if (port <= 0) return false;
    if (await isPortLiveOnHost(port, '127.0.0.1', timeoutMs)) return true;
    if (await isPortLiveOnHost(port, '::1', timeoutMs)) return true;
    return false;
}

/** Check if a port can be bound by a new server on localhost. */
export async function isPortAvailable(port: number): Promise<boolean> {
    if (port <= 0 || port > 65535) return false;
    return new Promise<boolean>((resolve) => {
        const server = createServer();
        server.unref();
        server.on('error', () => resolve(false));
        server.listen({ port, host: '127.0.0.1' }, () => {
            server.close(() => resolve(true));
        });
    });
}

/**
 * Thread-safe multi-project registry service managing persisted project entries,
 * advisory file locks, port allocations, and state synchronization.
 */
export class ProjectRegistry {
    private readonly filePath: string;
    private readonly lockDir: string;

    constructor(customPath?: string) {
        this.filePath = customPath ?? getProjectsFilePath();
        this.lockDir = `${this.filePath}.lock`;
    }

    /** Acquire advisory lock around operations on projects.json. */
    async withLock<T>(fn: () => Promise<T>): Promise<T> {
        const lockParent = dirname(this.lockDir);
        if (!existsSync(lockParent)) {
            mkdirSync(lockParent, { recursive: true });
        }

        const maxTries = 50;
        let acquired = false;

        for (let i = 0; i < maxTries; i++) {
            try {
                mkdirSync(this.lockDir);
                acquired = true;
                break;
            } catch {
                await new Promise((r) => setTimeout(r, 50));
            }
        }

        if (!acquired) {
            // Force break stale lock if it's held too long
            try {
                rmSync(this.lockDir, { recursive: true, force: true });
                mkdirSync(this.lockDir);
                acquired = true;
            } catch {
                throw new Error(`Failed to acquire lock for project registry: ${this.lockDir}`);
            }
        }

        try {
            return await fn();
        } finally {
            if (acquired) {
                try {
                    rmSync(this.lockDir, { recursive: true, force: true });
                } catch {
                    // Ignore unlock failure
                }
            }
        }
    }

    /** Read registry contents from disk. */
    readRaw(): ProjectsFile {
        if (!existsSync(this.filePath)) {
            return { schema_version: 1, projects: [] };
        }
        try {
            const raw = readFileSync(this.filePath, 'utf-8');
            const json = JSON.parse(raw);
            return projectsFileSchema.parse(json);
        } catch {
            return { schema_version: 1, projects: [] };
        }
    }

    /** Write registry contents to disk atomically. */
    writeRaw(data: ProjectsFile): void {
        const parentDir = dirname(this.filePath);
        if (!existsSync(parentDir)) {
            mkdirSync(parentDir, { recursive: true });
        }
        const tmpFile = `${this.filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
        const content = JSON.stringify(data, null, 2);
        writeFileSync(tmpFile, content, 'utf-8');
        renameSync(tmpFile, this.filePath);
    }

    /**
     * Rewrite hand-edited `~/…` (or other non-canonical) paths to absolute
     * normalized form. Spawning with `cwd: "~/xprojects/foo"` fails with a
     * misleading ENOENT on the bun binary — tilde is not expanded by posix_spawn.
     */
    async healTildePaths(): Promise<void> {
        return this.withLock(async () => {
            const data = this.readRaw();
            let changed = false;
            for (const project of data.projects) {
                const normalized = normalizeProjectPath(project.path);
                if (normalized !== project.path) {
                    project.path = normalized;
                    changed = true;
                }
            }
            if (changed) {
                this.writeRaw(data);
            }
        });
    }

    /** List all registered projects, healing paths + stale ports first. */
    async list(): Promise<ProjectEntry[]> {
        await this.healTildePaths();
        await this.healStale();
        return this.readRaw().projects;
    }

    /** Get a project entry by name or normalized path. */
    async getByPath(pathInput: string): Promise<ProjectEntry | undefined> {
        const normalized = normalizeProjectPath(pathInput);
        const projects = await this.list();
        return projects.find((p) => normalizeProjectPath(p.path) === normalized);
    }

    /** Get a project entry by exact or case-insensitive display name. */
    async getByName(nameInput: string): Promise<ProjectEntry | undefined> {
        const trimmed = nameInput.trim();
        const projects = await this.list();
        return (
            projects.find((p) => p.name === trimmed) ??
            projects.find((p) => p.name.toLowerCase() === trimmed.toLowerCase())
        );
    }

    /** Upsert a project entry by path. */
    async upsert(entry: { name: string; path: string; port?: number }): Promise<ProjectEntry> {
        return this.withLock(async () => {
            const currentData = this.readRaw();
            const normalizedPath = normalizeProjectPath(entry.path);
            const index = currentData.projects.findIndex((p) => normalizeProjectPath(p.path) === normalizedPath);

            const newEntry: ProjectEntry = {
                name: entry.name,
                path: normalizedPath,
                port: entry.port ?? 0,
            };

            if (index >= 0 && currentData.projects[index]) {
                const existing = currentData.projects[index];
                currentData.projects[index] = {
                    ...existing,
                    name: entry.name,
                    port: entry.port ?? existing.port,
                };
            } else {
                currentData.projects.push(newEntry);
            }

            this.writeRaw(currentData);
            const res = currentData.projects.find((p) => normalizeProjectPath(p.path) === normalizedPath);
            if (!res) {
                throw new Error(`Failed to upsert project: ${normalizedPath}`);
            }
            return res;
        });
    }

    /** Remove a project entry by display name or path. */
    async remove(nameOrPath: string): Promise<boolean> {
        return this.withLock(async () => {
            const currentData = this.readRaw();
            const normalized = normalizeProjectPath(nameOrPath);
            const initialLen = currentData.projects.length;

            currentData.projects = currentData.projects.filter((p) => {
                const pNorm = normalizeProjectPath(p.path);
                const nameMatch = p.name.toLowerCase() === nameOrPath.trim().toLowerCase();
                return pNorm !== normalized && !nameMatch;
            });

            if (currentData.projects.length !== initialLen) {
                this.writeRaw(currentData);
                return true;
            }
            return false;
        });
    }

    /** Update port for a project by path. */
    async setPort(pathInput: string, port: number): Promise<boolean> {
        return this.withLock(async () => {
            const currentData = this.readRaw();
            const normalized = normalizeProjectPath(pathInput);
            const project = currentData.projects.find((p) => normalizeProjectPath(p.path) === normalized);

            if (project) {
                project.port = port;
                this.writeRaw(currentData);
                return true;
            }
            return false;
        });
    }

    /** Find an available free port in 3000–3999 band. */
    async allocatePort(preferredPort?: number): Promise<number> {
        if (preferredPort && preferredPort > 0 && (await isPortAvailable(preferredPort))) {
            return preferredPort;
        }

        const data = this.readRaw();
        const claimedPorts = new Set(data.projects.map((p) => p.port).filter((p) => p > 0));

        for (let port = 3000; port <= 3999; port++) {
            if (claimedPorts.has(port)) continue;
            if (await isPortAvailable(port)) {
                return port;
            }
        }

        throw new Error('No available ports in range 3000–3999');
    }

    /** Stale-heal: check any project with port > 0; if port is not live, reset to 0. */
    async healStale(): Promise<void> {
        return this.withLock(async () => {
            const data = this.readRaw();
            let changed = false;

            for (const project of data.projects) {
                if (project.port > 0) {
                    const live = await isPortLive(project.port);
                    if (!live) {
                        project.port = 0;
                        changed = true;
                    }
                }
            }

            if (changed) {
                this.writeRaw(data);
            }
        });
    }
}
