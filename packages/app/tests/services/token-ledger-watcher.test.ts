import { describe, expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenLedgerWatcher } from '../../src/services/token-ledger-watcher';

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

describe('TokenLedgerWatcher', () => {
    test('emits newly appended events to subscribers', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-watch-'));
        try {
            const ctx = join(dir, '.spur', 'context');
            mkdirSync(ctx, { recursive: true });
            const path = join(ctx, 'token-ledger.jsonl');
            writeFileSync(path, '');

            const received: string[] = [];
            const watcher = new TokenLedgerWatcher({ ledgerPath: path, debounceMs: 10 });
            watcher.subscribe((e) => {
                received.push(e.type);
            });

            appendFileSync(
                path,
                `${JSON.stringify({ ts: '2026-07-12T12:00:00.000Z', session: 's', type: 'read', file: '/a.ts' })}\n`,
            );
            // Drive poll directly (reliable in tests without depending on fs.watch timing).
            watcher.pollNewBytes();
            await sleep(20);
            expect(received).toContain('read');

            watcher.stop();
            expect(watcher.subscriberCount).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('unsubscribe stops delivery', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-watch-'));
        try {
            const path = join(dir, 'ledger.jsonl');
            writeFileSync(path, '');
            const watcher = new TokenLedgerWatcher({ ledgerPath: path, debounceMs: 5 });
            let n = 0;
            const unsub = watcher.subscribe(() => {
                n += 1;
            });
            unsub();
            appendFileSync(
                path,
                `${JSON.stringify({ ts: '2026-07-12T12:00:00.000Z', session: 's', type: 'write', file: '/b.ts' })}\n`,
            );
            watcher.pollNewBytes();
            expect(n).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('start on missing file watches parent dir; poll is no-op until create', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-watch-miss-'));
        try {
            const path = join(dir, 'not-yet.jsonl');
            const watcher = new TokenLedgerWatcher({ ledgerPath: path, debounceMs: 5 });
            let n = 0;
            watcher.subscribe(() => {
                n += 1;
            });
            expect(watcher.subscriberCount).toBe(1);
            watcher.pollNewBytes();
            expect(n).toBe(0);
            writeFileSync(
                path,
                `${JSON.stringify({ ts: '2026-07-12T12:00:00.000Z', session: 's', type: 'bash', summary: 'ls' })}\n`,
            );
            watcher.pollNewBytes();
            expect(n).toBe(1);
            watcher.stop();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('isolates listener errors and re-reads after truncate to smaller file', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-watch-err-'));
        try {
            const path = join(dir, 'ledger.jsonl');
            writeFileSync(path, '');
            const watcher = new TokenLedgerWatcher({ ledgerPath: path, debounceMs: 5 });
            let ok = 0;
            watcher.subscribe(() => {
                throw new Error('listener boom');
            });
            watcher.subscribe(() => {
                ok += 1;
            });
            // Long first line so a later rewrite is strictly smaller (triggers offset reset).
            appendFileSync(
                path,
                `${JSON.stringify({ ts: '2026-07-12T12:00:00.000Z', session: 's', type: 'read', file: '/a'.repeat(40) })}\n`,
            );
            watcher.pollNewBytes();
            expect(ok).toBe(1);
            writeFileSync(
                path,
                `${JSON.stringify({ ts: '2026-07-12T13:00:00.000Z', session: 's', type: 'write', file: '/b' })}\n`,
            );
            watcher.pollNewBytes();
            expect(ok).toBe(2);
            watcher.stop();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
