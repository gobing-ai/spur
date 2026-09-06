import { describe, expect, test } from 'bun:test';
import { createMigratedDb } from '../src';
import { maintainDatabase } from '../src/maintenance';

describe('maintainDatabase', () => {
    test('default maintenance runs optimize and wal_checkpoint without vacuum', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        const result = await maintainDatabase(db);

        expect(result.optimized).toBe(true);
        expect(result.checkpointed).toBe(true);
        expect(result.vacuumed).toBe(false);
        expect(result.vacuumSkippedReason).toBeUndefined();
        expect(result.bytesBefore).toBeGreaterThan(0);
        expect(result.bytesAfter).toBeGreaterThan(0);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);

        await db.close();
    });

    test('vacuum maintenance runs vacuum, optimize, and checkpoint', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        const result = await maintainDatabase(db, { vacuum: true });

        expect(result.vacuumed).toBe(true);
        expect(result.optimized).toBe(true);
        expect(result.checkpointed).toBe(true);
        expect(result.bytesBefore).toBeGreaterThan(0);
        expect(result.bytesAfter).toBeGreaterThan(0);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);

        // Retention compaction metadata was recorded
        const meta = await db.queryFirst<{ kind: string; ran_at: number }>(
            "SELECT kind, ran_at FROM spur_retention_meta WHERE kind = 'compaction' ORDER BY ran_at DESC LIMIT 1",
        );
        expect(meta?.kind).toBe('compaction');
        expect(meta?.ran_at).toBeGreaterThan(0);

        await db.close();
    });

    test('vacuum with insufficient disk space skips vacuum safely', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        // Point dbPath to root or a path where we mock statfs or test fallback
        const result = await maintainDatabase(db, {
            vacuum: true,
            dbPath: '/dev/null', // statfs unavailable or error
        });

        // Even if statfs fails on /dev/null, it shouldn't crash, and vacuum proceeds or skips safely
        expect(result.optimized).toBe(true);
        expect(result.checkpointed).toBe(true);

        await db.close();
    });

    test('handles database exec errors gracefully', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        const originalExec = db.exec.bind(db);
        db.exec = async (sql: string) => {
            if (sql.includes('VACUUM')) throw new Error('vacuum failed');
            if (sql.includes('optimize')) throw new Error('optimize failed');
            if (sql.includes('wal_checkpoint')) throw new Error('checkpoint failed');
            return originalExec(sql);
        };

        const result = await maintainDatabase(db, { vacuum: true });
        expect(result.vacuumed).toBe(false);
        expect(result.vacuumSkippedReason).toBe('error');
        expect(result.optimized).toBe(false);
        expect(result.checkpointed).toBe(false);

        await db.close();
    });
});
