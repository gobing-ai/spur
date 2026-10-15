/**
 * `spur self hook <id>` / `spur self hook list` — the thin CLI transport over
 * `@gobing-ai/spur-app/hooks` (script-absorption plan PR-2a, owner decision Q1).
 *
 * Covers the early dispatch through `main()` (no DB, no config boot), byte-exact raw output,
 * the banner exemption, `--host` parsing, `list` in both formats and the stdin failure path.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from '@commander-js/extra-typings';
import { HOOK_IDS } from '@gobing-ai/spur-app/hooks';
import { getEnvVar } from '@gobing-ai/spur-config';
import { main, shouldRenderBanner } from '../src/index';
import { isSelfHookInvocation, registerSelfHookCommand, type SelfHookDeps } from '../src/self-hook';

interface Captured {
    lines: string[];
    errors: string[];
    raw: string[];
    rawErr: string[];
}

function capture(): { captured: Captured; output: { write(m: string): void; error(m: string): void } } {
    const captured: Captured = { lines: [], errors: [], raw: [], rawErr: [] };
    return {
        captured,
        output: {
            write: (m) => captured.lines.push(m),
            error: (m) => captured.errors.push(m),
        },
    };
}

async function runMain(argv: string[], stdin: string, cwd: string, extra: Partial<SelfHookDeps> = {}) {
    const { captured, output } = capture();
    const code = await main(argv, {
        cwd,
        env: { PATH: getEnvVar('PATH') },
        output,
        selfHook: {
            readStdin: async () => stdin,
            writeRaw: (text) => captured.raw.push(text),
            writeRawError: (text) => captured.rawErr.push(text),
            ...extra,
        },
    });
    return { code, captured };
}

describe('spur self hook — early dispatch through main()', () => {
    test('a guard prints its decision byte-for-byte and never creates a database', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-self-hook-'));
        try {
            const { code, captured } = await runMain(
                ['self', 'hook', 'careful-guard'],
                '{"tool_name":"Bash","tool_input":{"command":"ls"}}',
                cwd,
            );
            expect(code).toBe(0);
            expect(captured.raw).toEqual([
                '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}',
            ]);
            expect(captured.lines).toEqual([]);
            expect(existsSync(join(cwd, '.spur'))).toBe(false);
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('--host pi shapes the reply for the Pi wrapper; global flags are tolerated', async () => {
        const { code, captured } = await runMain(
            ['--no-logo', 'self', 'hook', 'careful-guard', '--host', 'pi'],
            '{"toolName":"bash","input":{"command":"git reset --hard"}}',
            tmpdir(),
        );
        expect(code).toBe(0);
        expect(JSON.parse(captured.raw.join(''))).toMatchObject({ action: 'ask' });
    });

    test('an unknown id writes its stderr line raw and still exits 0', async () => {
        const { code, captured } = await runMain(['self', 'hook', 'not-a-hook'], '', tmpdir());
        expect(code).toBe(0);
        expect(captured.raw).toEqual([]);
        expect(captured.rawErr.join('')).toContain("unknown hook id 'not-a-hook'");
    });

    test('an unreadable stdin is treated as an empty payload (fail-open allow)', async () => {
        const { code, captured } = await runMain(['self', 'hook', 'task-write-guard'], '', tmpdir(), {
            readStdin: async () => {
                throw new Error('EPIPE');
            },
        });
        expect(code).toBe(0);
        expect(captured.raw.join('')).toContain('"permissionDecision":"allow"');
    });

    test('an invalid --host is a usage error (non-zero), not a silent default', async () => {
        const { code, captured } = await runMain(['self', 'hook', 'careful-guard', '--host', 'vim'], '{}', tmpdir());
        expect(code).not.toBe(0);
        expect(captured.errors.join('')).toContain('--host must be one of claude, codex, pi, auto');
    });

    test('list prints every id in text and JSON', async () => {
        const text = await runMain(['self', 'hook', 'list'], '', tmpdir());
        for (const id of HOOK_IDS) expect(text.captured.lines.join('\n')).toContain(id);
        const json = await runMain(['self', 'hook', 'list', '--json'], '', tmpdir());
        const parsed = JSON.parse(json.captured.lines.join('')) as Array<{ id: string }>;
        expect(parsed.map((row) => row.id)).toEqual([...HOOK_IDS]);
    });
});

describe('spur self hook — wiring', () => {
    test('isSelfHookInvocation matches `self hook` only, ignoring global flags', () => {
        expect(isSelfHookInvocation(['self', 'hook', 'x'])).toBe(true);
        expect(isSelfHookInvocation(['-v', '--no-logo', 'self', 'hook'])).toBe(true);
        expect(isSelfHookInvocation(['self', 'status'])).toBe(false);
        expect(isSelfHookInvocation(['hook', 'self'])).toBe(false);
    });

    test('the startup banner is suppressed for hook invocations only', () => {
        expect(shouldRenderBanner(['self', 'hook', 'careful-guard'])).toBe(false);
        expect(shouldRenderBanner(['self', 'status'])).toBe(true);
    });

    test('the default runner, writers and self argv are used when no seam is injected', async () => {
        const program = new Command().exitOverride();
        let exitCode = -1;
        const writes: string[] = [];
        const originalWrite = process.stdout.write.bind(process.stdout);
        const originalErr = process.stderr.write.bind(process.stderr);
        registerSelfHookCommand(
            program.command('self'),
            {
                cwd: tmpdir(),
                env: {},
                output: { write: () => {}, error: () => {} },
                setExitCode: (code) => {
                    exitCode = code;
                },
            },
            { readStdin: async () => '{"tool_name":"Read"}' },
        );
        process.stdout.write = ((chunk: string) => {
            writes.push(String(chunk));
            return true;
        }) as typeof process.stdout.write;
        process.stderr.write = ((chunk: string) => {
            writes.push(`ERR:${String(chunk)}`);
            return true;
        }) as typeof process.stderr.write;
        try {
            await program.parseAsync(['self', 'hook', 'careful-guard'], { from: 'user' });
            await program.parseAsync(['self', 'hook', 'bogus'], { from: 'user' });
        } finally {
            process.stdout.write = originalWrite;
            process.stderr.write = originalErr;
        }
        expect(exitCode).toBe(0);
        expect(writes[0]).toBe('{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}');
        expect(writes[1]).toStartWith("ERR:spur self hook: unknown hook id 'bogus'");
    });
});
