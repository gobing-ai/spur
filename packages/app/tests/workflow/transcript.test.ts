import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTranscriptRows, resolveTranscript, sniffTranscriptFormat } from '../../src/workflow/transcript';

/** 1138 R1: the host-transcript adapter the close-step summary reads (script-absorption PR-4). */

const user = (ts: string) => ({ type: 'user', timestamp: ts, message: { role: 'user', content: 'go' } });

function withDir(prefix: string, body: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    try {
        body(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('transcript adapter (1138 R1)', () => {
    test('sniffTranscriptFormat: pi message rows, Claude rows, or unknown', () => {
        expect(sniffTranscriptFormat([{ type: 'message', message: { role: 'toolResult' } } as never])).toBe('pi');
        expect(sniffTranscriptFormat([{ type: 'summary' } as never, { type: 'assistant' } as never])).toBe('claude');
        expect(sniffTranscriptFormat([{ type: 'message', message: { role: 'system' } } as never])).toBe('unknown');
        expect(sniffTranscriptFormat([])).toBe('unknown');
    });

    test('parseTranscriptRows counts malformed lines and drops timestamp-less rows', () => {
        const parsed = parseTranscriptRows([
            '',
            '{ nope',
            JSON.stringify({ type: 'user' }),
            JSON.stringify(user('2026-10-09T00:00:00Z')),
        ]);
        expect(parsed.skippedLines).toBe(1);
        expect(parsed.rows).toHaveLength(1);
        expect(parsed.format).toBe('claude');
    });

    test('resolveTranscript: override, pi file, claude id, and every refusal', () => {
        withDir('transcript-resolve-', (dir) => {
            const file = join(dir, 'x.jsonl');
            writeFileSync(file, '');
            expect(resolveTranscript({}, dir, file)).toEqual({ ok: true, path: file });
            expect(resolveTranscript({}, dir, join(dir, 'missing'))).toEqual({ ok: false, reason: 'no transcript' });
            expect(resolveTranscript({ PI_SESSION_FILE: file }, dir)).toEqual({ ok: true, path: file });
            expect(resolveTranscript({ PI_SESSION_FILE: join(dir, 'gone') }, dir)).toEqual({
                ok: false,
                reason: `PI_SESSION_FILE ${join(dir, 'gone')} does not exist`,
            });
            expect(resolveTranscript({ CLAUDE_CODE_SESSION_ID: '../etc' }, dir)).toEqual({
                ok: false,
                reason: 'refusing a session id with path characters',
            });
            expect(resolveTranscript({ CLAUDE_CODE_SESSION_ID: 'a' }, join(dir, 'none'))).toEqual({
                ok: false,
                reason: `no transcript root ${join(dir, 'none')}`,
            });
            expect(resolveTranscript({ CLAUDE_CODE_SESSION_ID: 'a' }, dir)).toEqual({
                ok: false,
                reason: 'no transcript for session a',
            });
            expect(resolveTranscript({ CLAUDE_CODE_SESSION_ID: 'a', HOME: dir }).ok).toBe(false);
        });
    });
});
