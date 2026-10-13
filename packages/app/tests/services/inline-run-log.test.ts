import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendInlineRunLogLine, inlineRunRecordLogPath } from '../../src/services/inline-run-log';
import { runStoragePaths } from '../../src/services/run-storage';

describe('inline run record log', () => {
    test('inlineRunRecordLogPath prefers the .md pair and keeps a legacy-only .log', () => {
        const dir = mkdtempSync(join(tmpdir(), 'inline-run-log-'));
        try {
            expect(inlineRunRecordLogPath(dir, 'r1')).toBe(join(dir, 'r1.md'));
            writeFileSync(join(dir, 'r1.log'), '');
            expect(inlineRunRecordLogPath(dir, 'r1')).toBe(join(dir, 'r1.log'));
            writeFileSync(join(dir, 'r1.md'), '');
            expect(inlineRunRecordLogPath(dir, 'r1')).toBe(join(dir, 'r1.md'));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('appendInlineRunLogLine stamps a line, sanitises the run id, and never throws', () => {
        const dir = mkdtempSync(join(tmpdir(), 'inline-run-log-'));
        try {
            mkdirSync(join(dir, '.spur'), { recursive: true });
            appendInlineRunLogLine('a/b', 'hello', dir);
            const recordsDir = runStoragePaths(dir).recordsDir;
            const text = readFileSync(join(recordsDir, 'a_b.md'), 'utf8');
            expect(text).toMatch(/^\[\d{4}-\d{2}-\d{2}T[^\]]+Z\] hello\n$/);
            // An unwritable target is swallowed (best-effort contract).
            writeFileSync(join(dir, 'file'), '');
            expect(() => appendInlineRunLogLine('x', 'y', join(dir, 'file'))).not.toThrow();
            expect(existsSync(join(dir, 'file', '.spur'))).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
