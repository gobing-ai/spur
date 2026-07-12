import { describe, expect, test } from 'bun:test';
import {
    DesktopNotifierHitlResponder,
    runOsascriptDefault,
} from '../../../src/workflow/hitl/desktop-notifier-responder';

// All respond() paths are tested on every platform via the injection seams:
// `platform` forces the branch, `runOsascript` fakes the dialog — no real dialogs, no skips.

function req(kind: 'confirm' | 'select' | 'input', options?: string[]) {
    return { kind, prompt: 'q', runId: 'r1', node: 's1', ...(options ? { options } : {}) } as const;
}

function darwin(
    runOsascript: (script: string) => string,
    config?: { confirmDefault?: string; selectDefaultIndex?: number; inputDefault?: string },
) {
    return new DesktopNotifierHitlResponder({ ...config, platform: 'darwin', runOsascript });
}

const cancelError = () => {
    throw new Error('execution error: User canceled. (-128)');
};
const genericError = () => {
    throw new Error('osascript: command failed');
};

describe('DesktopNotifierHitlResponder', () => {
    describe('structure', () => {
        test('constructs and implements HitlResponder + notify', () => {
            const r = new DesktopNotifierHitlResponder();
            expect(typeof r.respond).toBe('function');
            expect(typeof r.notify).toBe('function');
        });

        test('notify delegates to the injected sink', () => {
            const seen: string[] = [];
            const r = new DesktopNotifierHitlResponder({
                notify: (title, message) => seen.push(`${title}:${message}`),
            });
            r.notify('Test', 'Hello from test');
            expect(seen).toEqual(['Test:Hello from test']);
        });

        test('notify never throws even when the sink throws', () => {
            const r = new DesktopNotifierHitlResponder({
                notify: () => {
                    throw new Error('sink down');
                },
            });
            expect(() => r.notify('Test', 'boom')).not.toThrow();
        });

        test('default osascript runner executes a harmless script (or fails cleanly off-mac)', () => {
            // `osascript -e 'return "ok"'` is non-interactive — no dialog. On non-macOS the binary
            // is missing and the call throws; both outcomes are valid, neither blocks or skips.
            let outcome: string;
            try {
                outcome = runOsascriptDefault('return "ok"');
            } catch {
                outcome = 'unavailable';
            }
            expect(['ok', 'unavailable']).toContain(outcome);
        });
    });

    describe('non-macOS fallback (platform seam)', () => {
        const linux = (config?: Record<string, unknown>) =>
            new DesktopNotifierHitlResponder({ ...config, platform: 'linux' });

        test('confirm returns no by default (deny)', async () => {
            expect(await linux().respond(req('confirm'))).toEqual({ value: 'no' });
        });

        test('confirm returns the configured default when set', async () => {
            expect(await linux({ confirmDefault: 'yes' }).respond(req('confirm'))).toEqual({ value: 'yes' });
        });

        test('select returns the configured index', async () => {
            expect(await linux({ selectDefaultIndex: 1 }).respond(req('select', ['x', 'y']))).toEqual({ value: 'y' });
        });

        test('select clamps an out-of-range index', async () => {
            expect(await linux({ selectDefaultIndex: 99 }).respond(req('select', ['a']))).toEqual({ value: 'a' });
        });

        test('input returns the configured default', async () => {
            expect(await linux({ inputDefault: 'n/a' }).respond(req('input'))).toEqual({ value: 'n/a' });
        });
    });

    describe('macOS confirm (osascript seam)', () => {
        test('Yes button → yes', async () => {
            expect(await darwin(() => 'button returned:Yes').respond(req('confirm'))).toEqual({ value: 'yes' });
        });

        test('No button → no', async () => {
            expect(await darwin(() => 'button returned:No').respond(req('confirm'))).toEqual({ value: 'no' });
        });

        test('Cancel button (osascript -128 error) → cancelled, NOT the default', async () => {
            // Regression: cancel used to be swallowed by the catch and approved with the default.
            expect(await darwin(cancelError, { confirmDefault: 'yes' }).respond(req('confirm'))).toEqual({
                value: 'cancel',
                cancelled: true,
            });
        });

        test('non-cancel osascript failure → configured default', async () => {
            expect(await darwin(genericError, { confirmDefault: 'no' }).respond(req('confirm'))).toEqual({
                value: 'no',
            });
        });
    });

    describe('macOS select (osascript seam)', () => {
        test('chosen option is returned', async () => {
            expect(await darwin(() => 'beta').respond(req('select', ['alpha', 'beta']))).toEqual({ value: 'beta' });
        });

        test('AppleScript "false" (list cancel) → cancelled, not the literal string', async () => {
            // Regression: `choose from list` returns the string "false" on cancel; it used to be
            // matched by the result regex and returned as if the user picked "false".
            expect(await darwin(() => 'false').respond(req('select', ['alpha', 'beta']))).toEqual({
                value: '',
                cancelled: true,
            });
        });

        test('-128 error → cancelled', async () => {
            expect(await darwin(cancelError).respond(req('select', ['a', 'b']))).toEqual({
                value: '',
                cancelled: true,
            });
        });

        test('non-cancel failure → clamped configured default', async () => {
            expect(await darwin(genericError, { selectDefaultIndex: 99 }).respond(req('select', ['a', 'b']))).toEqual({
                value: 'b',
            });
        });

        test('empty options → cancelled without invoking osascript', async () => {
            let called = false;
            const answer = await darwin(() => {
                called = true;
                return '';
            }).respond(req('select', []));
            expect(answer).toEqual({ value: '', cancelled: true });
            expect(called).toBe(false);
        });

        test('options and prompt are AppleScript-escaped in the script', async () => {
            // Regression: options used to be interpolated unescaped — a quote broke the script.
            let script = '';
            await darwin((s) => {
                script = s;
                return 'ok';
            }).respond({ kind: 'select', prompt: 'say "hi"', runId: 'r1', node: 's1', options: ['a"b'] });
            expect(script).toContain('"a\\"b"');
            expect(script).toContain('say \\"hi\\"');
        });
    });

    describe('macOS input (osascript seam)', () => {
        test('typed text is extracted from the osascript output', async () => {
            expect(await darwin(() => 'button returned:OK, text returned:fix the bug').respond(req('input'))).toEqual({
                value: 'fix the bug',
            });
        });

        test('output without a text segment → empty value', async () => {
            expect(await darwin(() => 'button returned:OK').respond(req('input'))).toEqual({ value: '' });
        });

        test('-128 error → cancelled', async () => {
            expect(await darwin(cancelError).respond(req('input'))).toEqual({ value: '', cancelled: true });
        });

        test('non-cancel failure → configured default', async () => {
            expect(await darwin(genericError, { inputDefault: 'skip' }).respond(req('input'))).toEqual({
                value: 'skip',
            });
        });
    });
});
