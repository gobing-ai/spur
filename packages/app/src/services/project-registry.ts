import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmdirSync,
    rmSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { getProjectsFilePath, type ProjectEntry, type ProjectsFile, projectsFileSchema } from '@gobing-ai/spur-config';
import { NodeProcessExecutor, type ProcessExecutor } from '@gobing-ai/ts-runtime';
import {
    isLocalHost,
    isPidAlive,
    isPortAvailable,
    isPortLive,
    normalizeProjectPath,
    probePort,
    type TerminatedProcessInfo,
} from './project-process';

export * from './project-process';

/** Resolve the effective host recorded for an entry (default: 'localhost'). */
function entryHost(entry: { host?: string | null }): string {
    const host = entry.host?.trim();
    return host && host !== '' ? host : 'localhost';
}

/**
 * Index of the entry identified by path + host — the identity `upsert` writes on.
 *
 * Matching is host-scoped: the same path can be registered for a remote host AND for
 * localhost, so a path-only match let a local write land on the remote entry (a local
 * `spur serve` shutdown cleared knowledge-kit's live 192.168.87.27:3003 to 0).
 */
function findProjectIndex(projects: ProjectEntry[], pathInput: string, hostInput?: string): number {
    const host = hostInput?.trim() ?? '';
    const isLocal = isLocalHost(host);
    const normalized = normalizeProjectPath(pathInput);
    return projects.findIndex((p) => {
        if (isLocal) {
            return isLocalHost(p.host) && normalizeProjectPath(p.path) === normalized;
        }
        return entryHost(p).toLowerCase() === host.toLowerCase() && p.path === pathInput;
    });
}

/** Result of refreshing project entries. */
export interface RefreshProjectsResult {
    /** Project entries removed because their directory does not exist. */
    removed: ProjectEntry[];
    /** Processes terminated on occupied ports of removed projects. */
    terminated: TerminatedProcessInfo[];
    /** Alias for removed. */
    purgedProjects: ProjectEntry[];
    /** Alias for terminated. */
    terminatedProcesses: TerminatedProcessInfo[];
    /** Project entries whose closed ports were reset to 0 during sweeping. */
    resetPorts: ProjectEntry[];
}

/** Options for refreshing project entries. */
export interface RefreshProjectsOptions {
    /** Whether to terminate lingering processes on occupied ports (default: true). */
    terminateProcesses?: boolean;
    /** Maximum wait time in milliseconds before escalating SIGTERM to SIGKILL (default: 2000). */
    killTimeoutMs?: number;
    /** Optional ProcessExecutor to use for process inspection (default: NodeProcessExecutor). */
    processExecutor?: ProcessExecutor;
    /** Injectable fetch implementation for ownership probes (tests, 1156). */
    fetchImpl?: typeof fetch;
    /** Per-request timeout in milliseconds for the ownership probes (default: 1000, 1156). */
    requestTimeoutMs?: number;
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
            try {
                mkdirSync(lockParent, { recursive: true });
            } catch (err) {
                const code = (err as NodeJS.ErrnoException | null)?.code;
                if (code === 'EPERM' || code === 'EACCES') {
                    throw new Error(
                        `Cannot create the project registry directory ${lockParent}: permission denied (${code}).`,
                    );
                }
                throw err;
            }
        }

        const maxTries = 50;
        let acquired = false;
        let markerPath: string | undefined;

        for (let i = 0; i < maxTries; i++) {
            try {
                mkdirSync(this.lockDir);
                acquired = true;
                break;
            } catch (err) {
                // Retry only CONTENTION (the lock dir already exists — another writer
                // holds it and will release). A permission failure is permanent: no
                // number of retries makes an EPERM mkdir succeed, so backing off 50×50 ms
                // just burns 2.5 s before the same failure. Measured 2026-08-18: that
                // backoff was the whole cost of three `startServer` tests blowing the 5 s
                // default in a home-write-denied sandbox. Same distinction `probePort`
                // draws between `in-use` and `denied` (task 0585 R1/R2).
                const code = (err as NodeJS.ErrnoException | null)?.code;
                if (code === 'EPERM' || code === 'EACCES') {
                    throw new Error(
                        `Cannot lock the project registry at ${this.lockDir}: permission denied (${code}). ` +
                            'The process is not permitted to write there — this is not lock contention.',
                    );
                }
                if (code !== 'EEXIST') {
                    throw err;
                }
                if (this.reclaimDeadOwnerLock()) continue;
                await new Promise((r) => setTimeout(r, 50));
            }
        }

        if (!acquired) {
            throw new Error(`Failed to acquire lock for project registry: ${this.lockDir}`);
        }

        const marker = `${process.pid}-${crypto.randomUUID()}`;
        markerPath = join(this.lockDir, marker);
        try {
            writeFileSync(markerPath, '', { flag: 'wx' });
        } catch (err) {
            try {
                rmdirSync(this.lockDir);
            } catch {
                // Best-effort cleanup of owned empty directory
            }
            throw err;
        }

        try {
            return await fn();
        } finally {
            if (markerPath) {
                try {
                    unlinkSync(markerPath);
                    try {
                        rmdirSync(this.lockDir);
                    } catch {
                        // Directory removal is best-effort (e.g. ENOENT or ENOTEMPTY)
                    }
                } catch {
                    // If own marker is missing, leave the directory alone
                }
            }
        }
    }

    /**
     * Reclaim a lock abandoned by a killed holder: every `<pid>-<uuid>` marker names a process
     * that no longer exists. A marker-less dir is a holder between mkdir and marker write, so it
     * stays contention. The lock is moved aside with an atomic rename, so only one reclaimer wins.
     * ponytail: check-then-rename race if a live writer re-acquires between the check and the rename; needs flock-style locking to close.
     */
    private reclaimDeadOwnerLock(): boolean {
        let markers: string[];
        try {
            markers = readdirSync(this.lockDir);
        } catch {
            return false;
        }
        if (markers.length === 0 || markers.some((marker) => isPidAlive(Number.parseInt(marker, 10)))) return false;
        const tombstone = `${this.lockDir}.stale-${crypto.randomUUID()}`;
        try {
            renameSync(this.lockDir, tombstone);
        } catch {
            return false;
        }
        rmSync(tombstone, { recursive: true, force: true });
        return true;
    }

    /** Read registry contents from disk. */
    readRaw(): ProjectsFile {
        return this.readRawWithStatus().data;
    }

    /**
     * The same read, plus whether the file exists yet could not be parsed (1088 follow-up).
     * `readRaw` collapses both failure modes into an empty list, which is right for callers that
     * only need the roster — but an unreadable registry silently became "no entry", so a
     * resolver fell through to the port-3000 default with no diagnostic.
     */
    private readRawWithStatus(): { data: ProjectsFile; unreadable: boolean } {
        if (!existsSync(this.filePath)) {
            return { data: { schema_version: 1, projects: [] }, unreadable: false };
        }
        try {
            const raw = readFileSync(this.filePath, 'utf-8');
            const json = JSON.parse(raw);
            return { data: projectsFileSchema.parse(json), unreadable: false };
        } catch {
            return { data: { schema_version: 1, projects: [] }, unreadable: true };
        }
    }

    /**
     * Read-only snapshot for callers that must not mutate the registry (1088 follow-up).
     *
     * `list()` deliberately heals tilde paths, purges deleted project directories (SIGTERM/SIGKILL
     * on a purged entry's listener) and clears `port > 0` when a probe misses. That is the right
     * behaviour for `projects list`, and the wrong one for resolving a *read* like the default
     * `--server`: a transient connect miss there cleared a live serve's port and silently pointed
     * the CLI at the 3000 default (possibly another project's serve). This snapshot never writes.
     * Stale entries stay in place; the caller decides liveness and reports its own diagnostic.
     */
    peek(): { projects: ProjectEntry[]; unreadable: boolean } {
        const { data, unreadable } = this.readRawWithStatus();
        return { projects: data.projects, unreadable };
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
                if (isLocalHost(project.host)) {
                    const normalized = normalizeProjectPath(project.path);
                    if (normalized !== project.path) {
                        project.path = normalized;
                        changed = true;
                    }
                }
            }
            if (changed) {
                this.writeRaw(data);
            }
        });
    }

    /** List all registered projects, healing paths, refreshing missing directories, and clearing stale ports first. */
    async list(): Promise<ProjectEntry[]> {
        await this.healTildePaths();
        await this.refreshProjects();
        return this.readRaw().projects;
    }

    /** Get a project entry by name or normalized path. */
    async getByPath(pathInput: string): Promise<ProjectEntry | undefined> {
        const normalized = normalizeProjectPath(pathInput);
        const projects = await this.list();
        return projects.find((p) => {
            if (isLocalHost(p.host)) {
                return normalizeProjectPath(p.path) === normalized;
            }
            return p.path === pathInput || p.path === normalized;
        });
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

    /** Upsert a project entry by path and optional host. */
    async upsert(entry: { name: string; path: string; port?: number; host?: string }): Promise<ProjectEntry> {
        return this.withLock(async () => {
            const currentData = this.readRaw();
            const host = entry.host && entry.host.trim() !== '' ? entry.host.trim() : 'localhost';
            const isLocal = isLocalHost(host);
            const normalizedPath = isLocal ? normalizeProjectPath(entry.path) : entry.path;
            const index = findProjectIndex(currentData.projects, normalizedPath, host);

            const newEntry: ProjectEntry = {
                name: entry.name,
                path: normalizedPath,
                host,
                port: entry.port ?? 0,
            };

            if (index >= 0 && currentData.projects[index]) {
                const existing = currentData.projects[index];
                currentData.projects[index] = {
                    ...existing,
                    name: entry.name,
                    host: entry.host ?? existing.host ?? 'localhost',
                    port: entry.port ?? existing.port,
                };
            } else {
                currentData.projects.push(newEntry);
            }

            this.writeRaw(currentData);
            const res = currentData.projects[findProjectIndex(currentData.projects, normalizedPath, host)];
            if (!res) {
                throw new Error(`Failed to upsert project: ${normalizedPath}`);
            }
            return res;
        });
    }

    /**
     * Remove a project entry by display name or path.
     *
     * `host` scopes the removal to one host's entry, so a duplicate registration of the
     * same name/path (e.g. a stale localhost row next to the remote one) can be dropped
     * without deleting the entry that still holds a live port.
     */
    async remove(nameOrPath: string, host?: string): Promise<boolean> {
        return this.withLock(async () => {
            const currentData = this.readRaw();
            const normalized = normalizeProjectPath(nameOrPath);
            const hostScope = host?.trim() ?? '';
            const scoped = hostScope !== '';
            const initialLen = currentData.projects.length;

            currentData.projects = currentData.projects.filter((p) => {
                if (scoped) {
                    const hostMatches = isLocalHost(hostScope)
                        ? isLocalHost(p.host)
                        : entryHost(p).toLowerCase() === hostScope.toLowerCase();
                    if (!hostMatches) return true;
                }
                const pNorm = isLocalHost(p.host) ? normalizeProjectPath(p.path) : p.path;
                const pathMatch = pNorm === normalized || p.path === nameOrPath;
                const nameMatch = p.name.toLowerCase() === nameOrPath.trim().toLowerCase();
                return !pathMatch && !nameMatch;
            });

            if (currentData.projects.length !== initialLen) {
                this.writeRaw(currentData);
                return true;
            }
            return false;
        });
    }

    /**
     * Update port for a project by path.
     *
     * Host-scoped like {@link upsert} (default: localhost): a path-only match let a local
     * serve deregistering itself (`setPort(path, 0)`) clear the live *remote* entry that
     * happens to share the path, leaving the remote port 0 while its serve kept listening.
     */
    async setPort(pathInput: string, port: number, host?: string): Promise<boolean> {
        return this.withLock(async () => {
            const currentData = this.readRaw();
            const project = currentData.projects[findProjectIndex(currentData.projects, pathInput, host)];

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

        // A port claimed in the registry is NOT evidence that binding works — it only
        // says the port is spoken for. Only an actual probe result can tell "in use"
        // from "not permitted", so the two are tracked separately: folding the claimed
        // set into `sawInUse` made a single registered project in the band mask a fully
        // denied environment, restoring the exact misleading message this classification
        // exists to remove (task 0585 R2).
        let sawInUse = false;
        let probedAny = false;

        for (let port = 3000; port <= 3999; port++) {
            if (claimedPorts.has(port)) continue;
            const probe = await probePort(port);
            probedAny = true;
            if (probe === 'available') {
                return port;
            }
            if (probe === 'in-use') {
                sawInUse = true;
            }
        }

        // Probed at least one port and never once saw a real conflict ⇒ the environment
        // denied every bind. With no probe at all (every port claimed), the cause really
        // is exhaustion.
        if (probedAny && !sawInUse) {
            throw new Error('Port binding denied: permission denied');
        }

        throw new Error('No available ports in range 3000–3999');
    }

    /**
     * Stale-heal: check any **local** project with port > 0; if the port is closed, reset to 0.
     * Returns entries whose port was reset.
     *
     * Remote entries are never reset here: a probe of another machine cannot separate
     * "serve is gone" from "host asleep / network hiccup", and zeroing it destroys the only
     * record of where that serve runs — knowledge-kit's live 192.168.87.27:3003 was reset to 0
     * this way while the serve kept answering. `list()`/`/api/projects` report remote liveness
     * from a live per-request probe, so the stored port stays a routing hint, not a liveness claim.
     */
    async healStale(): Promise<ProjectEntry[]> {
        return this.withLock(async () => {
            const data = this.readRaw();
            let changed = false;
            const resetProjects: ProjectEntry[] = [];

            for (const project of data.projects) {
                if (project.port > 0 && isLocalHost(project.host)) {
                    const live = await isPortLive(project.port, 200);
                    if (!live) {
                        resetProjects.push({ ...project });
                        project.port = 0;
                        changed = true;
                    }
                }
            }

            if (changed) {
                this.writeRaw(data);
            }
            return resetProjects;
        });
    }

    /**
     * Verify all registered project folders exist on disk; purge missing ones.
     * Skips folder existence check for remote projects.
     * For purged local entries with port > 0 and a live port, route the listener through
     * the shared ownership-verified stop (1156): only a proven Spur server serving
     * this exact project path is signaled, and a terminated record is reported
     * only after the original listener is observed gone.
     * Closed ports on remaining local projects are reset to 0; remote ports are kept.
     *
     * Lock scope (1167): the registry lock covers only the purge decision and the
     * write. HTTP identity probes (up to 4×requestTimeoutMs) and kill waits
     * (2×killTimeoutMs) per stale entry run unlocked below — they operate on the
     * port/process, not the registry — so list()/board callers are not blocked
     * behind stale-entry teardown. stopRegisteredProject is fail-closed (returns
     * refusals, never throws), so an unlocked stop cannot strand the purge.
     */
    async refreshProjects(options?: RefreshProjectsOptions): Promise<RefreshProjectsResult> {
        const terminate = options?.terminateProcesses ?? true;
        const killTimeoutMs = options?.killTimeoutMs ?? 2000;
        const executor = options?.processExecutor ?? new NodeProcessExecutor();
        // Dynamic import: project-stop depends on this module's process helpers, so a
        // static import would create a cycle. Resolved once per refresh, cached after.
        const { stopRegisteredProject } = await import('./project-stop');

        const removed = await this.withLock(async () => {
            const data = this.readRaw();
            const purged = data.projects.filter((p) => {
                if (isLocalHost(p.host)) {
                    return !existsSync(normalizeProjectPath(p.path));
                }
                // Remote project: skip folder existence checking
                return false;
            });
            if (purged.length > 0) {
                const purgedPaths = new Set(
                    purged.map((p) => `${p.host ?? 'localhost'}:${normalizeProjectPath(p.path)}`),
                );
                data.projects = data.projects.filter(
                    (p) => !purgedPaths.has(`${p.host ?? 'localhost'}:${normalizeProjectPath(p.path)}`),
                );
                this.writeRaw(data);
            }
            return purged;
        });

        const terminated: TerminatedProcessInfo[] = [];
        if (terminate) {
            for (const project of removed) {
                if (project.port > 0 && isLocalHost(project.host)) {
                    const stop = await stopRegisteredProject(project, {
                        processExecutor: executor,
                        killTimeoutMs,
                        fetchImpl: options?.fetchImpl,
                        requestTimeoutMs: options?.requestTimeoutMs,
                    });
                    if (stop.stopped && stop.terminated) {
                        terminated.push(stop.terminated);
                    }
                }
            }
        }

        // Port sweep: reset closed local ports to 0 (remote ports are hints, never healed — see healStale)
        const resetPorts = await this.healStale();

        return {
            removed,
            terminated,
            purgedProjects: removed,
            terminatedProcesses: terminated,
            resetPorts,
        };
    }
}
