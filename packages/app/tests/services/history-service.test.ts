import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { HistoryService } from '../../src/services/history-service';

/** An empty directory so incremental scans find no real on-disk history (hermetic). */
function emptyRoot(): string {
    return mkdtempSync(join(tmpdir(), 'spur-hist-empty-'));
}

function makeCtx() {
    let db: ReturnType<typeof createMigratedDb> | undefined;
    return {
        getDb: async () => {
            db ??= createMigratedDb({ url: ':memory:' });
            return db;
        },
    };
}

describe('HistoryService', () => {
    describe('analyze', () => {
        test('returns a summary with zero costs when no records exist', async () => {
            const svc = new HistoryService(makeCtx());
            const summary = await svc.analyze();
            expect(summary).toBeDefined();
            expect(typeof summary).toBe('object');
        });

        test('accepts an optional since filter without throwing', async () => {
            const svc = new HistoryService(makeCtx());
            await expect(svc.analyze('2025-01-01')).resolves.toBeDefined();
        });

        test('treats empty string since as no filter', async () => {
            const svc = new HistoryService(makeCtx());
            await expect(svc.analyze('')).resolves.toBeDefined();
        });

        test('prices and aggregates a seeded ETL record through analyze', async () => {
            const ctx = makeCtx();
            const db = await ctx.getDb();
            await db.run(
                `INSERT INTO history_etl_claude (record_hash, source_file, source_line, split_index, payload_json, imported_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                'hash-1',
                'test.jsonl',
                1,
                0,
                JSON.stringify({
                    source_record_id: 'r1',
                    created_at: '2025-01-01T00:00:00Z',
                    content: 'hello world',
                    model: 'claude-sonnet-4-20250514',
                }),
                '2025-01-01T00:00:00Z',
            );
            const svc = new HistoryService(ctx);
            const summary = await svc.analyze();
            expect(summary.totals.records).toBe(1);
        });
    });

    describe('import', () => {
        test('throws for invalid source name', async () => {
            const svc = new HistoryService(makeCtx());
            await expect(svc.import('not-a-source')).rejects.toThrow('Invalid history source');
        });

        test('throws for invalid mode', async () => {
            const svc = new HistoryService(makeCtx());
            await expect(svc.import('claude', { mode: 'bad-mode' })).rejects.toThrow('Invalid history import mode');
        });

        test('runs incremental import for a known source with no files', async () => {
            const svc = new HistoryService(makeCtx());
            // Empty root → scannedFiles = 0, no error (hermetic: does not touch real ~/.claude history)
            const result = await svc.import('claude', { mode: 'incremental', root: emptyRoot() });
            expect(result.source).toBe('claude');
            expect(result.mode).toBe('incremental');
            expect(result.scannedFiles).toBe(0);
        });

        test('defaults mode to incremental when no file is provided', async () => {
            const svc = new HistoryService(makeCtx());
            const result = await svc.import('pi', { root: emptyRoot() });
            expect(result.mode).toBe('incremental');
        });

        test('accepts explicit full import mode for a known source', async () => {
            const svc = new HistoryService(makeCtx());
            const result = await svc.import('codex', { mode: 'full', root: emptyRoot() });
            expect(result.source).toBe('codex');
            expect(result.mode).toBe('full');
        });

        test('uses force-file mode when a file path is provided, rejecting a missing file', async () => {
            const svc = new HistoryService(makeCtx());
            // A file path selects force-file mode; the 0.3.0 importer surfaces a missing
            // file as a rejection rather than swallowing it (R8: encode real behavior).
            await expect(svc.import('claude', { file: '/tmp/spur-nonexistent.jsonl' })).rejects.toThrow();
        });
        test('passes dryRun true through to the importer without error', async () => {
            const svc = new HistoryService(makeCtx());
            const result = await svc.import('claude', { mode: 'incremental', root: emptyRoot(), dryRun: true });
            expect(result.source).toBe('claude');
            expect(result.mode).toBe('incremental');
            expect(result.scannedFiles).toBe(0);
        });

        test('treats empty string file as absent, defaulting to force-file mode without a files list', async () => {
            const svc = new HistoryService(makeCtx());
            const result = await svc.import('claude', { file: '', root: emptyRoot() });
            expect(result.mode).toBe('force-file');
            expect(result.scannedFiles).toBe(0);
        });

        test('treats empty string root as absent, scanning the provided file instead', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'spur-hist-file-'));
            const file = join(dir, 'empty.jsonl');
            writeFileSync(file, '');
            const svc = new HistoryService(makeCtx());
            const result = await svc.import('claude', { root: '', file });
            expect(result.mode).toBe('force-file');
            expect(result.scannedFiles).toBe(1);
            expect(result.processedLines).toBe(0);
        });
    });
});
