import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countUnattributedInlineStages } from '../../src/services/inline-run-attribution';
import { runStoragePaths } from '../../src/services/run-storage';

/**
 * D65 1242: the inline driver is deleted, but the unattributed-stage counter survives because
 * `spur agent doctor` reports it. It reads the durable scratch plane's `-attribution.jsonl` rows;
 * a row whose `executor` is null is a stage no executor claimed.
 */
describe('countUnattributedInlineStages (survivor of the deleted inline driver)', () => {
    const withScratch = (fn: (root: string, scratch: string) => void): void => {
        const root = mkdtempSync(join(tmpdir(), 'spur-attribution-'));
        try {
            const scratch = runStoragePaths(root).scratchDir;
            mkdirSync(scratch, { recursive: true });
            fn(root, scratch);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    };

    test('a missing scratch plane reads as zero, not a thrown error', () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-attribution-none-'));
        try {
            expect(countUnattributedInlineStages(root)).toBe(0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('null-executor rows count, attributed rows and blank lines do not', () => {
        withScratch((root, scratch) => {
            writeFileSync(
                join(scratch, 'run-a-attribution.jsonl'),
                [
                    JSON.stringify({ stage: 'implement', executor: null }),
                    JSON.stringify({ stage: 'gate', executor: 'claude' }),
                    '',
                    JSON.stringify({ stage: 'review', executor: null }),
                ].join('\n'),
            );
            expect(countUnattributedInlineStages(root)).toBe(2);
        });
    });

    test('a malformed line is skipped without losing the rest of the file', () => {
        withScratch((root, scratch) => {
            writeFileSync(
                join(scratch, 'run-b-attribution.jsonl'),
                ['not json', JSON.stringify({ stage: 'review', executor: null })].join('\n'),
            );
            expect(countUnattributedInlineStages(root)).toBe(1);
        });
    });
});
