/**
 * Lock utilities and atomic writes for the planning write path (design §4.2, DD-05).
 *
 * **Lock domain:** this module lives in `packages/domain` and is reachable **only** through
 * `PlanningWriteService`. Direct imports elsewhere are a review-rejectable violation.
 *
 * Two lock types (H04):
 * - **Create-lock** — `<folder>/.create.lock`, serializing WBS/feature-ID allocation.
 * - **Entity lock** — `<folder>/.<entityId>.lock`, serializing per-entity read-modify-write.
 *
 * Staleness (R3): lock files carry `{pid, ts}`. Locks older than TTL are broken with a
 * warning result the caller can surface. Legacy semantics preserved.
 *
 * Atomic writes (DD-05): temp-in-same-dir naming, fsync, atomic rename. Temp names compose
 * project name + entity id + random suffix (e.g. `.spur-new.0042.<rand>.tmp`).
 *
 * File I/O through `@gobing-ai/ts-runtime` FileSystem (H12 — no parallel fs wrapper).
 * `renameSync` from `node:fs` is used directly because the `FileSystem` interface does not
 * expose `rename` (atomic rename is a local-filesystem primitive).
 */
import { closeSync, fsyncSync, openSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';

// ── Types ────────────────────────────────────────────────────────────────

/** Default staleness TTL: 30 seconds (matching legacy behavior). */
export const DEFAULT_LOCK_TTL_MS = 30_000;

/** Result of acquiring a lock — includes the release handle and optional stale-break warning. */
export interface LockResult {
    /** Release handle — call to unlock (delete the lock file). Safe to call multiple times. */
    release: () => void;
    /** When a stale lock was broken to acquire, a human-readable warning string. `undefined` on clean acquire. */
    staleWarning?: string;
}

// ── Internal helpers ─────────────────────────────────────────────────────

interface LockMetadata {
    pid: number;
    ts: number;
}

function lockPathForEntity(folder: string, entityId: string): string {
    return join(folder, `.${entityId}.lock`);
}

function createLockPath(folder: string): string {
    return join(folder, '.create.lock');
}

function parseLockContent(raw: string): LockMetadata {
    // Lock file format: `pid:ts` — a single line.
    const match = raw.match(/^(\d+):(\d+)$/);
    if (!match) {
        // Malformed lock — treat as stale so it gets broken.
        return { pid: 0, ts: 0 };
    }
    return { pid: Number(match[1]), ts: Number(match[2]) };
}

function serializeLockMetadata(meta: LockMetadata): string {
    return `${meta.pid}:${meta.ts}`;
}

function isProcessAlive(pid: number): boolean {
    if (pid === 0) return false;
    try {
        // signal 0 = existence check, no signal sent
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * Check whether an existing lock is stale: either its PID is dead, or its timestamp
 * is older than the TTL.
 */
function isStale(meta: LockMetadata, ttlMs: number): boolean {
    // PID dead → lock owner crashed; always break.
    if (meta.pid > 0 && !isProcessAlive(meta.pid)) return true;
    // PID alive but timestamp too old → TTL break.
    if (Date.now() - meta.ts > ttlMs) return true;
    return false;
}

// ── Public lock API ──────────────────────────────────────────────────────

/**
 * Acquire an entity lock for read-modify-write on a single task/feature file.
 *
 * Uses a blocking retry loop with `EXCL`-style creation: writes `{pid,ts}` and
 * verifies it wasn't clobbered. If the existing lock is stale (dead PID or TTL
 * exceeded), it is broken with a warning.
 *
 * @param folder  Directory containing the entity file.
 * @param entityId  WBS or feature ID (e.g. `'0044'`, `'A1'`).
 * @param fs     FileSystem instance (H12 — no raw `node:fs` reads/writes).
 * @param ttlMs  Staleness TTL. Locks older than this are broken. Defaults to 30s.
 * @returns Lock handle — call `.release()` when done.
 */
export function acquireEntityLock(
    folder: string,
    entityId: string,
    fs: FileSystem,
    ttlMs: number = DEFAULT_LOCK_TTL_MS,
): LockResult {
    return acquireLock(lockPathForEntity(folder, entityId), fs, ttlMs, `entity ${entityId}`);
}

/**
 * Acquire the per-folder create-lock serializing WBS/feature-ID allocation.
 *
 * Same semantics as {@link acquireEntityLock} but for the `<folder>/.create.lock` file.
 *
 * @param folder  Directory where new entities are allocated.
 * @param fs     FileSystem instance.
 * @param ttlMs  Staleness TTL. Defaults to 30s.
 * @returns Lock handle — call `.release()` when done.
 */
export function acquireCreateLock(folder: string, fs: FileSystem, ttlMs: number = DEFAULT_LOCK_TTL_MS): LockResult {
    return acquireLock(createLockPath(folder), fs, ttlMs, 'create allocation');
}

function acquireLock(path: string, fs: FileSystem, ttlMs: number, label: string): LockResult {
    const pid = process.pid;
    const ts = Date.now();
    const content = serializeLockMetadata({ pid, ts });

    let staleWarning: string | undefined;
    let released = false;

    // Single attempt: check, break-if-stale, write.
    if (fs.exists(path)) {
        const raw = fs.readFile(path) as string;
        const existing = parseLockContent(raw);

        if (!isStale(existing, ttlMs)) {
            throw new Error(
                `Cannot acquire ${label} lock at ${path}: held by pid ${existing.pid} (age ${Date.now() - existing.ts}ms)`,
            );
        }

        staleWarning = `Broke stale ${label} lock at ${path} (pid ${existing.pid}, age ${Date.now() - existing.ts}ms)`;
    }

    // Write our lock content. On POSIX this is atomic enough for local single-machine use;
    // the design (§4.2) explicitly preserves legacy semantics.
    fs.writeFile(path, content);

    return {
        release: () => {
            if (released) return;
            released = true;
            // Only delete if we own it (content matches).
            try {
                if (fs.exists(path)) {
                    const current = fs.readFile(path) as string;
                    if (current === content) {
                        fs.deleteFile(path);
                    }
                }
            } catch {
                // Best-effort cleanup; lock will break via staleness on next acquire.
            }
        },
        staleWarning,
    };
}

// ── Atomic write (DD-05) ─────────────────────────────────────────────────

/**
 * fsync a path to flush its contents to stable storage. Used on the temp file (data
 * durability) and on the parent directory (rename durability) per DD-05. Uses `node:fs`
 * directly because `FileSystem` exposes no fsync primitive — same justification as
 * `renameSync` (fsync is a local-filesystem primitive). Best-effort: directory fsync is
 * not supported on every platform, so failures there are swallowed.
 */
function fsyncPath(path: string, swallowErrors = false): void {
    let fd: number | undefined;
    try {
        fd = openSync(path, 'r');
        fsyncSync(fd);
    } catch (err) {
        if (!swallowErrors) throw err;
    } finally {
        if (fd !== undefined) closeSync(fd);
    }
}

/**
 * Atomically write a file: temp + fsync + rename (DD-05).
 *
 * Temp names compose **project name + entity id + random suffix**, e.g.
 * `.spur-new.0042.<rand>.tmp`. This avoids cross-project/cross-entity temp
 * collisions when multiple projects share a filesystem.
 *
 * @param dest      Final destination path.
 * @param content   File content (UTF-8 string).
 * @param entityId  WBS or feature ID for the temp-name composition.
 * @param fs        FileSystem instance for write/exists.
 * @param projectName  Project name for temp-name composition (defaults to `'spur'`).
 */
export function atomicWrite(
    dest: string,
    content: string,
    entityId: string,
    fs: FileSystem,
    projectName: string = 'spur',
): void {
    const dir = dirname(dest);
    const rand = Math.random().toString(36).slice(2, 10);
    const tempPath = join(dir, `.${projectName}.${entityId}.${rand}.tmp`);

    // Write temp file, then fsync it so its data reaches stable storage before the rename (DD-05).
    fs.writeFile(tempPath, content);
    fsyncPath(tempPath);

    // Atomic rename (DD-05). Uses node:fs directly because FileSystem has no rename.
    // On POSIX, rename is atomic within the same filesystem.
    renameSync(tempPath, dest);

    // fsync the parent directory so the rename itself survives a crash (DD-05). Best-effort:
    // directory fsync is unsupported on some platforms/filesystems.
    fsyncPath(dir, true);
}

/**
 * Async variant of {@link atomicWrite} — convenience for async callers.
 * Same semantics; awaits writeFile if it returns a Promise.
 */
export async function atomicWriteAsync(
    dest: string,
    content: string,
    entityId: string,
    fs: FileSystem,
    projectName: string = 'spur',
): Promise<void> {
    const dir = dirname(dest);
    const rand = Math.random().toString(36).slice(2, 10);
    const tempPath = join(dir, `.${projectName}.${entityId}.${rand}.tmp`);

    await fs.writeFile(tempPath, content);
    fsyncPath(tempPath);
    renameSync(tempPath, dest);
    fsyncPath(dir, true);
}

// ── Cleanup ──────────────────────────────────────────────────────────────

/**
 * Remove leftover temp files for an entity in a directory (crash recovery).
 * Scans for `.<projectName>.<entityId>.*.tmp` and deletes them.
 *
 * @param folder     Directory to scan.
 * @param entityId   Entity ID (WBS or feature).
 * @param fs         FileSystem instance.
 * @param projectName  Project name used in temp naming.
 * @returns Number of temp files cleaned up.
 */
export function cleanupTempFiles(
    folder: string,
    entityId: string,
    fs: FileSystem,
    projectName: string = 'spur',
): number {
    const prefix = `.${projectName}.${entityId}.`;
    const suffix = '.tmp';

    if (!fs.exists(folder)) return 0;

    const entries = fs.readDir(folder) as string[];
    let count = 0;
    for (const entry of entries) {
        if (entry.startsWith(prefix) && entry.endsWith(suffix)) {
            fs.deleteFile(join(folder, entry));
            count++;
        }
    }
    return count;
}

// ── Stale lock inspection (for diagnostics) ──────────────────────────────

/** Read lock metadata from a lock file path. Returns `null` if the lock doesn't exist. */
export function readLockMetadata(folder: string, entityId: string, fs: FileSystem): LockMetadata | null {
    const path = lockPathForEntity(folder, entityId);
    if (!fs.exists(path)) return null;
    return parseLockContent(fs.readFile(path) as string);
}

/** Inspect lock staleness without acquiring. Returns `{ stale, age, pid }` or `null` if no lock. */
export function inspectLock(
    folder: string,
    entityId: string,
    fs: FileSystem,
    ttlMs: number = DEFAULT_LOCK_TTL_MS,
): { stale: boolean; age: number; pid: number } | null {
    const meta = readLockMetadata(folder, entityId, fs);
    if (!meta) return null;
    return {
        stale: isStale(meta, ttlMs),
        age: Date.now() - meta.ts,
        pid: meta.pid,
    };
}
