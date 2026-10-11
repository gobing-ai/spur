import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DbAdapter } from '@gobing-ai/ts-db';
import { createMigratedDb, createMigratedDbViaRuntime, SQLITE_BUSY_TIMEOUT_MS } from '../src/db';

describe('SQLite contention: WAL + busy_timeout (bug-245 lineage, dogfood 2026-08-31)', () => {
    test('both factories set PRAGMA busy_timeout to SQLITE_BUSY_TIMEOUT_MS', async () => {
        const a = await createMigratedDb({ url: ':memory:' });
        let b: DbAdapter | undefined;
        try {
            const rows = await a.queryAll<{ timeout: number }>('PRAGMA busy_timeout');
            expect(rows[0]?.timeout).toBe(SQLITE_BUSY_TIMEOUT_MS);
            b = await createMigratedDbViaRuntime({ url: ':memory:' });
            const rowsB = await b.queryAll<{ timeout: number }>('PRAGMA busy_timeout');
            expect(rowsB[0]?.timeout).toBe(SQLITE_BUSY_TIMEOUT_MS);
        } finally {
            a.close();
            b?.close();
        }
    });

    test('cross-process writer waits within SQLITE_BUSY_TIMEOUT_MS then commits', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-bug245-'));
        const url = join(dir, 'spur.db');
        const a = await createMigratedDb({ url });
        try {
            // WAL is a file-level property of the shared DB (adapter default pragma); the
            // adapter maps pragma result rows to {}, so read pragmas through raw bun:sqlite.
            // busy_timeout is per-connection: read it through the migrated adapter.
            const busyRows = await a.queryAll<{ timeout: number }>('PRAGMA busy_timeout');
            expect(busyRows[0]?.timeout).toBe(SQLITE_BUSY_TIMEOUT_MS);
            // journal_mode is file-level: read it through raw bun:sqlite (the adapter
            // maps that pragma's result rows to {}).
            const raw = new Database(url);
            try {
                expect(raw.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
            } finally {
                raw.close();
            }

            // An isolated child process takes the write lock, signals readiness on stdout,
            // holds it for 6s, then commits. The 6s hold is a real integration timer —
            // fake timers cannot drive the platform-level busy wait.
            const child = Bun.spawn(
                [
                    'bun',
                    '-e',
                    `const { Database } = require('bun:sqlite');
const db = new Database(${JSON.stringify(url)});
db.exec('BEGIN IMMEDIATE');
db.exec(\`INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at, next_retry_at)
VALUES ('child-holder', 'x', '{}', 'pending', 0, 0, 1, 1, NULL)\`);
process.stdout.write('locked\\n');
setTimeout(() => {
  db.exec('COMMIT');
  process.exit(0);
}, 6000);`,
                ],
                { stderr: 'inherit' },
            );
            // Wait for the child's readiness signal before timing the parent's write.
            await new Promise<void>((resolve) => {
                (child.stdout as ReadableStream<Uint8Array>)
                    .getReader()
                    .read()
                    .then(() => resolve());
            });

            const t0 = performance.now();
            await a.run(
                `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at, next_retry_at)
                 VALUES ('waited', 'x', '{}', 'pending', 0, 0, 2, 2, NULL)`,
            );
            const elapsedMs = performance.now() - t0;
            await child.exited;
            const rows = await a.queryAll<{ id: string }>("SELECT id FROM queue_jobs WHERE type = 'x' ORDER BY id");
            expect(rows.map((r) => r.id)).toEqual(['child-holder', 'waited']);
            // The parent's INSERT waited for the holder to commit (>= 4s), retried, and
            // succeeded — bounded by the 30s busy timeout, not an instant SQLITE_BUSY.
            expect(elapsedMs).toBeGreaterThanOrEqual(4000);
            expect(elapsedMs).toBeLessThan(SQLITE_BUSY_TIMEOUT_MS);
        } finally {
            a.close();
            rmSync(dir, { recursive: true, force: true });
        }
    }, 40_000); // the 6s lock hold plus child spawn needs more than the 5s default
});
