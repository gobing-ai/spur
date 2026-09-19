import { describe, expect, test } from 'bun:test';
import { createShellOutputRedactor, SHELL_OUTPUT_TAIL_BYTES, utf8SafeByteTail } from '../../src/workflow/actions/shell';

describe('utf8SafeByteTail (0901 R5)', () => {
    test('returns the tail within the byte budget, never splitting a code point', () => {
        expect(utf8SafeByteTail('hello', 5)).toEqual({ tail: 'hello', truncated: false });
        expect(utf8SafeByteTail('hello', 4)).toEqual({ tail: 'ello', truncated: true });
        expect(utf8SafeByteTail('hello', 0)).toEqual({ tail: '', truncated: true });
        expect(utf8SafeByteTail('', 100)).toEqual({ tail: '', truncated: false });
    });

    test('multi-byte boundary: the tail starts on a code-point start byte', () => {
        const value = 'あ'.repeat(30_000); // 3 bytes each — 90k > 65,536 budget
        const { tail, truncated } = utf8SafeByteTail(value, SHELL_OUTPUT_TAIL_BYTES);
        expect(truncated).toBe(true);
        expect(Buffer.byteLength(tail, 'utf8')).toBeLessThanOrEqual(SHELL_OUTPUT_TAIL_BYTES);
        // A split mid-code-point would surface U+FFFD replacement characters.
        expect(tail.includes('\uFFFD')).toBe(false);
    });
});

describe('createShellOutputRedactor (0901 R5)', () => {
    const shellPayload = (stdout: string, stderr = '') => ({ kind: 'shell', data: { stdout, stderr, exitCode: 0 } });

    test('shell results: redact secrets, keep a redacted byte tail, set truncation booleans', () => {
        const redact = createShellOutputRedactor(['hunter2']);
        const filler = 'x'.repeat(SHELL_OUTPUT_TAIL_BYTES + 5_000);
        const result = redact('shell', shellPayload(`${filler} secret=hunter2 end`, 'hunter2 leaked')) as {
            data: Record<string, unknown>;
        };
        expect(result.data.stdout).not.toContain('hunter2');
        expect(result.data.stdout).toContain('[REDACTED]');
        expect(Buffer.byteLength(String(result.data.stdout), 'utf8')).toBeLessThanOrEqual(SHELL_OUTPUT_TAIL_BYTES);
        expect(result.data.stdoutTruncated).toBe(true);
        expect(result.data.stderr).toContain('[REDACTED]');
        expect(result.data.stderrTruncated).toBe(false); // short stream, redacted but not truncated
    });

    test('short clean output passes through with booleans false', () => {
        const redact = createShellOutputRedactor(['hunter2']);
        const result = redact('shell', shellPayload('all good')) as { data: Record<string, unknown> };
        expect(result.data).toEqual({
            stdout: 'all good',
            stderr: '',
            exitCode: 0,
            stdoutTruncated: false,
            stderrTruncated: false,
        });
    });

    test('non-shell results pass through untouched', () => {
        const redact = createShellOutputRedactor(['hunter2']);
        const payload = { kind: 'agent', data: { agent: 'codex', exitCode: 0 } };
        expect(redact('agent', payload)).toBe(payload);
    });

    test('empty secret list still enforces the byte tail', () => {
        const redact = createShellOutputRedactor([]);
        const result = redact('shell', shellPayload('y'.repeat(SHELL_OUTPUT_TAIL_BYTES + 1))) as {
            data: Record<string, unknown>;
        };
        expect(Buffer.byteLength(String(result.data.stdout), 'utf8')).toBe(SHELL_OUTPUT_TAIL_BYTES);
        expect(result.data.stdoutTruncated).toBe(true);
    });
});
