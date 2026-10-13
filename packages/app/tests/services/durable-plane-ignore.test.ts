import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDurablePlaneIgnored } from '../../src/services/durable-plane-ignore';

function tempDir(): string {
    return mkdtempSync(join(tmpdir(), 'durable-plane-'));
}

describe('ensureDurablePlaneIgnored', () => {
    test('no-op outside a git checkout', () => {
        const dir = tempDir();
        try {
            ensureDurablePlaneIgnored(dir);
            expect(() => readFileSync(join(dir, '.git', 'info', 'exclude'))).toThrow();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('appends the exclude once (idempotent) and keeps prior content', () => {
        const dir = tempDir();
        try {
            mkdirSync(join(dir, '.git', 'info'), { recursive: true });
            writeFileSync(join(dir, '.git', 'info', 'exclude'), 'node_modules');
            ensureDurablePlaneIgnored(dir);
            ensureDurablePlaneIgnored(dir);
            const text = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8');
            expect(text.startsWith('node_modules\n')).toBe(true);
            expect(text.split('.spur/memory/').length - 1).toBe(1);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a linked worktree pointer writes the common repository exclude', () => {
        const dir = tempDir();
        try {
            const common = join(dir, 'main', '.git');
            mkdirSync(join(common, 'worktrees', 'wt'), { recursive: true });
            mkdirSync(join(dir, 'wt'), { recursive: true });
            writeFileSync(join(dir, 'wt', '.git'), `gitdir: ${join(common, 'worktrees', 'wt')}\n`);
            ensureDurablePlaneIgnored(join(dir, 'wt'));
            expect(readFileSync(join(common, 'info', 'exclude'), 'utf8')).toContain('.spur/memory/');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
