import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    clampToolUseLimit,
    parseLedgerLine,
    TOKEN_LEDGER_DEFAULT_LIMIT,
    TOKEN_LEDGER_MAX_LIMIT,
    TokenLedgerService,
    tailTokenLedgerFile,
} from '../../src/services/token-ledger-service';

function makeTempDir(): string {
    return mkdtempSync(join(tmpdir(), 'spur-token-ledger-'));
}

function writeLedger(dir: string, lines: string[]): string {
    const ctx = join(dir, '.spur', 'context');
    mkdirSync(ctx, { recursive: true });
    const path = join(ctx, 'token-ledger.jsonl');
    writeFileSync(path, `${lines.join('\n')}\n`);
    return path;
}

function line(
    type: string,
    session: string,
    extra: Record<string, unknown> = {},
    ts = '2026-07-12T12:00:00.000Z',
): string {
    return JSON.stringify({ ts, session, type, ...extra });
}

describe('clampToolUseLimit', () => {
    test('defaults and clamps', () => {
        expect(clampToolUseLimit(undefined)).toBe(TOKEN_LEDGER_DEFAULT_LIMIT);
        expect(clampToolUseLimit(0)).toBe(TOKEN_LEDGER_DEFAULT_LIMIT);
        expect(clampToolUseLimit(-1)).toBe(TOKEN_LEDGER_DEFAULT_LIMIT);
        expect(clampToolUseLimit(Number.NaN)).toBe(TOKEN_LEDGER_DEFAULT_LIMIT);
        expect(clampToolUseLimit(50)).toBe(50);
        expect(clampToolUseLimit(9999)).toBe(TOKEN_LEDGER_MAX_LIMIT);
    });
});

describe('parseLedgerLine', () => {
    test('parses full tool and session events', () => {
        const read = parseLedgerLine(line('read', 's1', { file: '/a.ts', tokens: 10 }));
        expect(read).toMatchObject({
            type: 'read',
            session: 's1',
            file: '/a.ts',
            tokens: 10,
        });

        const write = parseLedgerLine(line('write', 's1', { file: '/b.ts', tokens: 2, action: 'edit' }));
        expect(write?.action).toBe('edit');

        const end = parseLedgerLine(line('session_end', 's1', { totals: { reads: 1, writes: 2, tokens: 3 } }));
        expect(end?.totals).toEqual({ reads: 1, writes: 2, tokens: 3 });
    });

    test('parses optional agent/model/sessionId and omits missing tokens', () => {
        const e = parseLedgerLine(
            line('read', 's1', { file: '/a.ts', agent: 'claude', model: 'opus', sessionId: 'abc' }),
        );
        expect(e?.agent).toBe('claude');
        expect(e?.model).toBe('opus');
        expect(e?.sessionId).toBe('abc');
        expect(e?.tokens).toBeUndefined();
    });

    test('parses summary for bash/grep/glob events (task 0248)', () => {
        const bash = parseLedgerLine(line('bash', 's1', { summary: 'ls -la', tokens: 2 }));
        expect(bash?.summary).toBe('ls -la');
        expect(bash?.type).toBe('bash');
        const grep = parseLedgerLine(line('grep', 's1', { summary: '/TODO/ src' }));
        expect(grep?.summary).toBe('/TODO/ src');
    });

    test('returns null for malformed lines', () => {
        expect(parseLedgerLine('')).toBeNull();
        expect(parseLedgerLine('not json')).toBeNull();
        expect(parseLedgerLine('{"ts":"x"}')).toBeNull();
    });
});

describe('tailTokenLedgerFile', () => {
    test('missing file → empty non-truncated', () => {
        const r = tailTokenLedgerFile(join(tmpdir(), 'no-such-ledger.jsonl'), 10);
        expect(r.events).toEqual([]);
        expect(r.truncated).toBe(false);
    });

    test('returns newest first and skips malformed lines', () => {
        const dir = makeTempDir();
        try {
            const path = writeLedger(dir, [
                line('session_start', 's1', {}, '2026-07-12T10:00:00.000Z'),
                'NOT_JSON',
                line('read', 's1', { file: '/a.ts', tokens: 1 }, '2026-07-12T10:01:00.000Z'),
                line('write', 's1', { file: '/b.ts', action: 'create' }, '2026-07-12T10:02:00.000Z'),
                line('session_end', 's1', {}, '2026-07-12T10:03:00.000Z'),
            ]);
            const { events, truncated } = tailTokenLedgerFile(path, 10);
            expect(truncated).toBe(false);
            expect(events.map((e) => e.type)).toEqual(['session_end', 'write', 'read', 'session_start']);
            expect(events[0]?.ts).toBe('2026-07-12T10:03:00.000Z');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('limit window + truncated without loading whole logical history', () => {
        const dir = makeTempDir();
        try {
            const lines: string[] = [];
            for (let i = 0; i < 50; i++) {
                lines.push(
                    line(
                        'read',
                        's1',
                        { file: `/f${i}.ts`, tokens: i },
                        `2026-07-12T10:00:${String(i).padStart(2, '0')}.000Z`,
                    ),
                );
            }
            const path = writeLedger(dir, lines);
            // Tiny chunk forces multi-chunk reverse walk on a larger-than-window file.
            const { events, truncated } = tailTokenLedgerFile(path, 5, 64);
            expect(truncated).toBe(true);
            expect(events).toHaveLength(5);
            // Newest is last written line (i=49)
            expect(events[0]?.file).toBe('/f49.ts');
            expect(events[4]?.file).toBe('/f45.ts');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('handles file without trailing newline', () => {
        const dir = makeTempDir();
        try {
            const ctx = join(dir, '.spur', 'context');
            mkdirSync(ctx, { recursive: true });
            const path = join(ctx, 'token-ledger.jsonl');
            writeFileSync(
                path,
                `${line('read', 's1', { file: '/a.ts' }, '2026-07-12T10:00:00.000Z')}\n${line('write', 's1', { file: '/b.ts', action: 'edit' }, '2026-07-12T10:01:00.000Z')}`,
            );
            const { events } = tailTokenLedgerFile(path, 10);
            expect(events).toHaveLength(2);
            expect(events[0]?.type).toBe('write');
            expect(events[1]?.type).toBe('read');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('TokenLedgerService', () => {
    test('exposes path getter and ignores empty before string', () => {
        const dir = makeTempDir();
        try {
            writeLedger(dir, [line('read', 's1', { file: '/a.ts', tokens: 1 })]);
            const svc = new TokenLedgerService({ cwd: dir });
            expect(svc.path).toContain('token-ledger.jsonl');
            const snap = svc.snapshot({ limit: 10, before: '' });
            expect(snap.events).toHaveLength(1);
            // two-arg form
            const snap2 = svc.snapshot(5, '2099-01-01T00:00:00.000Z');
            expect(snap2.events).toHaveLength(1);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('resolves default path under cwd and snapshots with stable seq', () => {
        const dir = makeTempDir();
        try {
            writeLedger(dir, [line('session_start', 's9'), line('read', 's9', { file: '/x.ts', tokens: 4 })]);
            const svc = new TokenLedgerService({ cwd: dir });
            const snap = svc.snapshot(10);
            expect(snap.count).toBe(2);
            expect(snap.limit).toBe(10);
            expect(snap.truncated).toBe(false);
            expect(snap.path).toBe(join(dir, '.spur', 'context', 'token-ledger.jsonl'));
            expect(snap.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(snap.events[0]?.type).toBe('read');
            expect(snap.events[0]?.seq).toBe(0);
            expect(snap.events[1]?.seq).toBe(1);
            expect(snap.sparseToolActivity).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('assigns unique seq even when ts/file collide', () => {
        const dir = makeTempDir();
        try {
            const ts = '2026-07-12T12:00:00.000Z';
            writeLedger(dir, [
                line('read', 's1', { file: '/same.ts', tokens: 1 }, ts),
                line('read', 's1', { file: '/same.ts', tokens: 1 }, ts),
            ]);
            const snap = new TokenLedgerService({ cwd: dir }).snapshot(10);
            expect(snap.events).toHaveLength(2);
            expect(snap.events.map((e) => e.seq)).toEqual([0, 1]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('marks sparseToolActivity false when bash/grep rows present (task 0248)', () => {
        const dir = makeTempDir();
        try {
            writeLedger(dir, [line('session_start', 's1'), line('bash', 's1', { summary: 'ls' })]);
            const snap = new TokenLedgerService({ cwd: dir }).snapshot(10);
            expect(snap.sparseToolActivity).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('marks sparseToolActivity when only session markers', () => {
        const dir = makeTempDir();
        try {
            writeLedger(dir, [line('session_start', 's1'), line('session_end', 's1')]);
            const snap = new TokenLedgerService({ cwd: dir }).snapshot(10);
            expect(snap.sparseToolActivity).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('missing ledger → empty success', () => {
        const dir = makeTempDir();
        try {
            const svc = new TokenLedgerService({ cwd: dir });
            const snap = svc.snapshot();
            expect(snap.events).toEqual([]);
            expect(snap.count).toBe(0);
            expect(snap.limit).toBe(TOKEN_LEDGER_DEFAULT_LIMIT);
            expect(snap.truncated).toBe(false);
            expect(snap.sparseToolActivity).toBe(true);
            expect(snap.nextBefore).toBeNull();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('before cursor returns older page without overlapping newest page', () => {
        const dir = makeTempDir();
        try {
            const lines: string[] = [];
            for (let i = 0; i < 10; i++) {
                lines.push(
                    line(
                        'read',
                        's1',
                        { file: `/f${i}.ts`, tokens: i },
                        `2026-07-12T10:00:${String(i).padStart(2, '0')}.000Z`,
                    ),
                );
            }
            writeLedger(dir, lines);
            const svc = new TokenLedgerService({ cwd: dir });
            const page1 = svc.snapshot({ limit: 3 });
            expect(page1.events.map((e) => e.file)).toEqual(['/f9.ts', '/f8.ts', '/f7.ts']);
            expect(page1.nextBefore).toBe('2026-07-12T10:00:07.000Z');
            expect(page1.truncated).toBe(true);
            const cursor = page1.nextBefore;
            expect(cursor).toBeTruthy();

            const page2 = svc.snapshot({ limit: 3, before: cursor ?? undefined });
            expect(page2.events.map((e) => e.file)).toEqual(['/f6.ts', '/f5.ts', '/f4.ts']);
            // No overlap with page1
            const p1 = new Set(page1.events.map((e) => e.file));
            for (const e of page2.events) {
                expect(p1.has(e.file)).toBe(false);
                if (cursor) expect(e.ts < cursor).toBe(true);
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
