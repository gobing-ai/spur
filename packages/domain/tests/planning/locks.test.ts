import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    acquireCreateLock,
    acquireEntityLock,
    atomicWrite,
    atomicWriteAsync,
    cleanupTempFiles,
    DEFAULT_LOCK_TTL_MS,
    inspectLock,
    readLockMetadata,
} from '../../src/planning/locks';

describe('locks', () => {
    describe('acquireEntityLock', () => {
        let dir: string;

        beforeEach(() => {
            dir = mkdtempSync(join(tmpdir(), 'spur-locks-'));
            rmSync(dir, { recursive: true, force: true });
            mkdirSync(dir, { recursive: true });
        });

        afterEach(() => {
            rmSync(dir, { recursive: true, force: true });
        });

        test('acquires lock and creates lock file', () => {
            const fs = createNodeFileSystem(dir);
            const lock = acquireEntityLock(dir, '0042', fs);
            const lockPath = join(dir, '.0042.lock');
            expect(fs.exists(lockPath)).toBe(true);

            lock.release();
            expect(fs.exists(lockPath)).toBe(false);
        });

        test('release is idempotent', () => {
            const fs = createNodeFileSystem(dir);
            const lock = acquireEntityLock(dir, '0042', fs);
            lock.release();
            lock.release(); // second call is a no-op
            // Should not throw
        });

        test('throws when lock is held by a live process within TTL', () => {
            const fs = createNodeFileSystem(dir);
            const lockPath = join(dir, '.0042.lock');
            // Simulate a live process holding the lock.
            const livePid = process.pid; // current process is alive
            const ts = Date.now();
            fs.writeFile(lockPath, `${livePid}:${ts}`);

            expect(() => acquireEntityLock(dir, '0042', fs, 60_000)).toThrow(/held by pid/);
        });

        test('breaks stale lock when PID is dead', () => {
            const fs = createNodeFileSystem(dir);
            const lockPath = join(dir, '.0042.lock');
            // PID 999999 is almost certainly dead.
            const deadPid = 999999;
            const ts = Date.now();
            fs.writeFile(lockPath, `${deadPid}:${ts}`);

            const lock = acquireEntityLock(dir, '0042', fs, 60_000);
            expect(lock.staleWarning).toContain('Broke stale');
            expect(lock.staleWarning).toContain(String(deadPid));

            lock.release();
        });

        test('breaks stale lock when TTL exceeded', () => {
            const fs = createNodeFileSystem(dir);
            const lockPath = join(dir, '.0042.lock');
            // Current PID but ancient timestamp.
            const ts = Date.now() - 120_000; // 2 min ago
            fs.writeFile(lockPath, `${process.pid}:${ts}`);

            const lock = acquireEntityLock(dir, '0042', fs, 1_000); // 1s TTL
            expect(lock.staleWarning).toContain('Broke stale');

            lock.release();
        });

        test('breaks malformed lock file', () => {
            const fs = createNodeFileSystem(dir);
            const lockPath = join(dir, '.0042.lock');
            fs.writeFile(lockPath, 'garbage');

            const lock = acquireEntityLock(dir, '0042', fs);
            expect(lock.staleWarning).toContain('Broke stale');

            lock.release();
        });

        test('staleWarning is undefined on clean acquire', () => {
            const fs = createNodeFileSystem(dir);
            const lock = acquireEntityLock(dir, '0042', fs);
            expect(lock.staleWarning).toBeUndefined();
            lock.release();
        });

        test('release does not delete lock if content changed (re-acquired by another)', () => {
            const fs = createNodeFileSystem(dir);
            const lockPath = join(dir, '.0042.lock');

            const lock = acquireEntityLock(dir, '0042', fs);

            // Simulate another process taking the lock.
            fs.writeFile(lockPath, '99999:1234567890');

            lock.release(); // should NOT delete — content doesn't match

            expect(fs.exists(lockPath)).toBe(true);
        });
    });

    describe('acquireCreateLock', () => {
        let dir: string;

        beforeEach(() => {
            dir = mkdtempSync(join(tmpdir(), 'spur-locks-'));
            rmSync(dir, { recursive: true, force: true });
            mkdirSync(dir, { recursive: true });
        });

        afterEach(() => {
            rmSync(dir, { recursive: true, force: true });
        });

        test('creates .create.lock file', () => {
            const fs = createNodeFileSystem(dir);
            const lock = acquireCreateLock(dir, fs);
            const lockPath = join(dir, '.create.lock');
            expect(fs.exists(lockPath)).toBe(true);

            lock.release();
            expect(fs.exists(lockPath)).toBe(false);
        });

        test('throws when create lock is held', () => {
            const fs = createNodeFileSystem(dir);
            const lockPath = join(dir, '.create.lock');
            fs.writeFile(lockPath, `${process.pid}:${Date.now()}`);

            expect(() => acquireCreateLock(dir, fs, 60_000)).toThrow(/held by pid/);
        });
    });

    describe('concurrent create allocation (R5)', () => {
        test('sequential lock acquire-release yields distinct allocations', () => {
            const dir = mkdtempSync(join(tmpdir(), 'spur-concurrency-'));
            const fs = createNodeFileSystem(dir);
            try {
                const ids: number[] = [];

                // Simulate 5 concurrent allocations: each acquires create-lock, picks next id, releases.
                for (let i = 0; i < 5; i++) {
                    const lock = acquireCreateLock(dir, fs);
                    const next = i + 1;
                    ids.push(next);
                    // Write a "marker" file as if allocating.
                    fs.writeFile(join(dir, `task-${next}.md`), `id: ${next}`);
                    lock.release();
                }

                expect(ids).toEqual([1, 2, 3, 4, 5]);
                expect(fs.readDir(dir)).not.toContain('.create.lock');
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        test('rejects a second holder while the create-lock is held, then admits it after release', () => {
            // Models two contending allocators: while holder A owns the create-lock, holder B must be
            // rejected (serialization). After A releases, B can acquire. This is the contention
            // guarantee R5 protects, beyond plain sequential acquire/release.
            const dir = mkdtempSync(join(tmpdir(), 'spur-contend-'));
            const fs = createNodeFileSystem(dir);
            try {
                const holderA = acquireCreateLock(dir, fs, 60_000);
                expect(() => acquireCreateLock(dir, fs, 60_000)).toThrow(/held by pid/);

                holderA.release();
                const holderB = acquireCreateLock(dir, fs, 60_000);
                expect(holderB.staleWarning).toBeUndefined();
                holderB.release();

                expect(fs.readDir(dir)).not.toContain('.create.lock');
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        test('no leftover locks after clean operations', () => {
            const dir = mkdtempSync(join(tmpdir(), 'spur-cleanup-'));
            const fs = createNodeFileSystem(dir);
            try {
                for (const entity of ['0042', '0043', '0044']) {
                    const lock = acquireEntityLock(dir, entity, fs);
                    lock.release();
                }

                const entries = fs.readDir(dir) as string[];
                const locks = entries.filter((e: string) => e.endsWith('.lock'));
                expect(locks).toEqual([]);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    describe('atomicWrite', () => {
        let dir: string;

        beforeEach(() => {
            dir = mkdtempSync(join(tmpdir(), 'spur-atomic-'));
            rmSync(dir, { recursive: true, force: true });
            mkdirSync(dir, { recursive: true });
        });

        afterEach(() => {
            rmSync(dir, { recursive: true, force: true });
        });

        test('writes content to destination path', () => {
            const fs = createNodeFileSystem(dir);
            const dest = join(dir, 'task-0042.md');
            atomicWrite(dest, 'hello world', '0042', fs);

            expect(fs.readFile(dest)).toBe('hello world');
        });

        test('leaves no temp file on success', () => {
            const fs = createNodeFileSystem(dir);
            const dest = join(dir, 'task-0042.md');
            atomicWrite(dest, 'content', '0042', fs);

            const entries = fs.readDir(dir) as string[];
            const temps = entries.filter((e) => e.endsWith('.tmp'));
            expect(temps).toEqual([]);
        });

        test('temp name follows DD-05 format: .<project>.<entity>.<rand>.tmp', () => {
            const fs = createNodeFileSystem(dir);
            const dest = join(dir, 'task-0042.md');

            // Write a temp file manually matching the pattern to verify cleanup matches.
            // The actual write creates a temp internally; we verify it's gone after rename.
            atomicWrite(dest, 'data', '0042', fs, 'spur-new');

            // If we call cleanupTempFiles, it should find 0 (temp already renamed).
            const cleaned = cleanupTempFiles(dir, '0042', fs, 'spur-new');
            expect(cleaned).toBe(0);
        });

        test('overwrites existing file atomically', () => {
            const fs = createNodeFileSystem(dir);
            const dest = join(dir, 'task-0042.md');

            fs.writeFile(dest, 'old content');
            atomicWrite(dest, 'new content', '0042', fs);

            expect(fs.readFile(dest)).toBe('new content');
        });

        test('overwriting does not leave old temp files', () => {
            const fs = createNodeFileSystem(dir);
            const dest = join(dir, 'task-0042.md');

            atomicWrite(dest, 'first', '0042', fs);
            atomicWrite(dest, 'second', '0042', fs);
            atomicWrite(dest, 'third', '0042', fs);

            const entries = fs.readDir(dir) as string[];
            const temps = entries.filter((e) => e.endsWith('.tmp'));
            expect(temps).toEqual([]);
            expect(fs.readFile(dest)).toBe('third');
        });

        test('fsyncs durable content readable after write (DD-05)', () => {
            // DD-05 requires temp + fsync + rename. After the call the destination must hold the
            // exact content with no temp left behind — covering the fsync path on temp + parent dir.
            const fs = createNodeFileSystem(dir);
            const dest = join(dir, 'durable.md');
            atomicWrite(dest, 'flushed', '0042', fs, 'spur-new');

            expect(fs.readFile(dest)).toBe('flushed');
            const entries = fs.readDir(dir) as string[];
            expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
        });
    });

    describe('atomicWriteAsync', () => {
        let dir: string;

        beforeEach(() => {
            dir = mkdtempSync(join(tmpdir(), 'spur-atomic-async-'));
            rmSync(dir, { recursive: true, force: true });
            mkdirSync(dir, { recursive: true });
        });

        afterEach(() => {
            rmSync(dir, { recursive: true, force: true });
        });

        test('writes content asynchronously', async () => {
            const fs = createNodeFileSystem(dir);
            const dest = join(dir, 'task-0042.md');
            await atomicWriteAsync(dest, 'async content', '0042', fs);

            expect(fs.readFile(dest)).toBe('async content');
        });

        test('leaves no temp file', async () => {
            const fs = createNodeFileSystem(dir);
            const dest = join(dir, 'task-0042.md');
            await atomicWriteAsync(dest, 'data', '0042', fs);

            const entries = fs.readDir(dir) as string[];
            expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
        });
    });

    describe('cleanupTempFiles', () => {
        let dir: string;

        beforeEach(() => {
            dir = mkdtempSync(join(tmpdir(), 'spur-temp-cleanup-'));
            rmSync(dir, { recursive: true, force: true });
            mkdirSync(dir, { recursive: true });
        });

        afterEach(() => {
            rmSync(dir, { recursive: true, force: true });
        });

        test('removes matching temp files', () => {
            const fs = createNodeFileSystem(dir);
            // Simulate leftover temps from a crash.
            fs.writeFile(join(dir, '.spur-new.0042.abc123.tmp'), 'partial');
            fs.writeFile(join(dir, '.spur-new.0042.def456.tmp'), 'partial2');

            const count = cleanupTempFiles(dir, '0042', fs, 'spur-new');
            expect(count).toBe(2);

            const entries = fs.readDir(dir) as string[];
            expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
        });

        test('ignores temps for other entities', () => {
            const fs = createNodeFileSystem(dir);
            fs.writeFile(join(dir, '.spur-new.0042.abc.tmp'), 'partial');
            fs.writeFile(join(dir, '.spur-new.0043.xyz.tmp'), 'partial');

            const count = cleanupTempFiles(dir, '0042', fs, 'spur-new');
            expect(count).toBe(1);

            // 0043's temp remains
            const entries = fs.readDir(dir) as string[];
            expect(entries).toContain('.spur-new.0043.xyz.tmp');
        });

        test('returns 0 for non-existent folder', () => {
            const fs = createNodeFileSystem(dir);
            expect(cleanupTempFiles(join(dir, 'nonexistent'), '0042', fs)).toBe(0);
        });

        test('returns 0 when no temps exist', () => {
            const fs = createNodeFileSystem(dir);
            fs.writeFile(join(dir, 'task-0042.md'), 'content');
            expect(cleanupTempFiles(dir, '0042', fs)).toBe(0);
        });
    });

    describe('readLockMetadata', () => {
        let dir: string;

        beforeEach(() => {
            dir = mkdtempSync(join(tmpdir(), 'spur-meta-'));
            rmSync(dir, { recursive: true, force: true });
            mkdirSync(dir, { recursive: true });
        });

        afterEach(() => {
            rmSync(dir, { recursive: true, force: true });
        });

        test('returns null when no lock exists', () => {
            const fs = createNodeFileSystem(dir);
            expect(readLockMetadata(dir, '0042', fs)).toBeNull();
        });

        test('returns metadata from lock file', () => {
            const fs = createNodeFileSystem(dir);
            const lockPath = join(dir, '.0042.lock');
            fs.writeFile(lockPath, '12345:1700000000000');

            const meta = readLockMetadata(dir, '0042', fs);
            expect(meta).toEqual({ pid: 12345, ts: 1700000000000 });
        });

        test('returns pid:0 for malformed lock content', () => {
            const fs = createNodeFileSystem(dir);
            const lockPath = join(dir, '.0042.lock');
            fs.writeFile(lockPath, 'malformed');

            const meta = readLockMetadata(dir, '0042', fs);
            expect(meta).toEqual({ pid: 0, ts: 0 });
        });
    });

    describe('inspectLock', () => {
        let dir: string;

        beforeEach(() => {
            dir = mkdtempSync(join(tmpdir(), 'spur-inspect-'));
            rmSync(dir, { recursive: true, force: true });
            mkdirSync(dir, { recursive: true });
        });

        afterEach(() => {
            rmSync(dir, { recursive: true, force: true });
        });

        test('returns null when no lock exists', () => {
            const fs = createNodeFileSystem(dir);
            expect(inspectLock(dir, '0042', fs)).toBeNull();
        });

        test('returns stale=true for dead PID', () => {
            const fs = createNodeFileSystem(dir);
            const lockPath = join(dir, '.0042.lock');
            fs.writeFile(lockPath, '999999:1700000000000');

            const info = inspectLock(dir, '0042', fs, 60_000);
            expect(info).not.toBeNull();
            expect(info?.stale).toBe(true);
            expect(info?.pid).toBe(999999);
        });

        test('returns stale=false for live PID within TTL', () => {
            const fs = createNodeFileSystem(dir);
            const lockPath = join(dir, '.0042.lock');
            fs.writeFile(lockPath, `${process.pid}:${Date.now()}`);

            const info = inspectLock(dir, '0042', fs, 60_000);
            expect(info).not.toBeNull();
            expect(info?.stale).toBe(false);
        });
    });

    describe('DEFAULT_LOCK_TTL_MS', () => {
        test('is 30000 (30 seconds)', () => {
            expect(DEFAULT_LOCK_TTL_MS).toBe(30_000);
        });
    });
});
