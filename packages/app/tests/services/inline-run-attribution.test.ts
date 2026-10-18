import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openInlineRunProjectDb } from '../../src/services/inline-run-attribution';

describe('openInlineRunProjectDb', () => {
    test('creates and migrates the canonical .spur/spur.db under a fresh workdir', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-inline-db-'));
        try {
            const db = await openInlineRunProjectDb(root);
            expect(existsSync(join(root, '.spur', 'spur.db'))).toBe(true);
            db.close();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
