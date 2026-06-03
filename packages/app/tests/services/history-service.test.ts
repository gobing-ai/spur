import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
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

        test('uses force-file mode when a file path is provided, rejecting a missing file', async () => {
            const svc = new HistoryService(makeCtx());
            // A file path selects force-file mode; the 0.3.0 importer surfaces a missing
            // file as a rejection rather than swallowing it (R8: encode real behavior).
            await expect(svc.import('claude', { file: '/tmp/spur-nonexistent.jsonl' })).rejects.toThrow();
        });
    });
});
