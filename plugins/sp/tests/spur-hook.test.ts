/**
 * spur-hook — the plugin → `spur self hook` transport: argv resolution order and the fail-open
 * contract of both the sync (superskill-import shims) and async (Pi extension) runners.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '../lib/env';
import { runSpurHook, runSpurHookAsync, spurCommandAttempts, spurInstallCandidates } from '../lib/spur-hook';

const root = mkdtempSync(join(tmpdir(), 'spur-hook-lib-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function script(name: string, body: string): string {
    const path = join(root, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
}

/** Echoes its argv, then its stdin, and exits with $FAKE_EXIT (default 0). */
const ECHO = script('echo-spur', 'printf "%s|" "$*"; cat; exit "$FAKE_EXIT"');
const env = (extra: Record<string, string>) => ({ ...getEnvVars(), FAKE_EXIT: '0', ...extra });

describe('spurCommandAttempts', () => {
    test('SPUR_BIN wins outright and is split into command + prefix args', () => {
        expect(spurCommandAttempts({ SPUR_BIN: '  bun /x/spur.ts ' }, ['/nope'], '/nope')).toEqual([
            ['bun', '/x/spur.ts'],
        ]);
    });

    test('without SPUR_BIN: local checkout CLI, PATH spur, existing candidates, then their .js targets', () => {
        const dir = join(root, 'candidates');
        mkdirSync(dir);
        const js = join(dir, 'spur.js');
        writeFileSync(js, '');
        const linked = join(dir, 'linked-spur');
        symlinkSync(js, linked);
        const plain = script('plain-spur', 'exit 0');
        const local = join(dir, 'index.ts');
        writeFileSync(local, '');
        expect(spurCommandAttempts({}, [linked, join(dir, 'missing'), plain], local)).toEqual([
            ['bun', local],
            ['spur'],
            [linked],
            [plain],
            [process.execPath, js],
        ]);
        expect(spurCommandAttempts({ SPUR_BIN: '  ' }, [], join(dir, 'absent.ts'))).toEqual([['spur']]);
    });

    test('install candidates cover ~/.bun/bin, Homebrew and /usr/local', () => {
        expect(spurInstallCandidates('/h')).toEqual([
            '/h/.bun/bin/spur',
            '/opt/homebrew/bin/spur',
            '/usr/local/bin/spur',
        ]);
        expect(spurInstallCandidates()[0]).toEndWith(join('.bun', 'bin', 'spur'));
    });
});

describe('runSpurHook (sync)', () => {
    test('passes `self hook <id> --host <host>`, the payload on stdin, and the exit code', () => {
        expect(runSpurHook('careful-guard', '{"a":1}', { host: 'pi', env: env({ SPUR_BIN: ECHO }) })).toEqual({
            stdout: 'self hook careful-guard --host pi|{"a":1}',
            exitCode: 0,
        });
        expect(runSpurHook('x', '', { host: 'claude', env: env({ SPUR_BIN: ECHO, FAKE_EXIT: '3' }) })?.exitCode).toBe(
            3,
        );
    });

    test('runs in the requested cwd', () => {
        const pwd = script('pwd-spur', 'pwd');
        expect(runSpurHook('x', '', { host: 'auto', cwd: root, env: env({ SPUR_BIN: pwd }) })?.stdout.trim()).toBe(
            root,
        );
    });

    test('fails open: missing binary, unusable interpreter (127) and timeout all yield null', () => {
        expect(runSpurHook('x', '', { host: 'auto', env: env({ SPUR_BIN: join(root, 'absent') }) })).toBeNull();
        expect(runSpurHook('x', '', { host: 'auto', env: env({ SPUR_BIN: ECHO, FAKE_EXIT: '127' }) })).toBeNull();
        const slow = script('slow-spur', 'sleep 5');
        expect(runSpurHook('x', '', { host: 'auto', timeoutMs: 200, env: env({ SPUR_BIN: slow }) })).toBeNull();
    });

    test('defaults to this process env and, in a checkout, the local CLI', () => {
        const res = runSpurHook('careful-guard', JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }), {
            host: 'codex',
            env: Object.fromEntries(Object.entries(getEnvVars()).filter(([key]) => key !== 'SPUR_BIN')),
        });
        expect(res?.stdout).toBe('{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}');
    });
});

describe('runSpurHookAsync', () => {
    test('resolves with stdout and exit code', async () => {
        expect(
            await runSpurHookAsync('context-post-tool', 'payload', { host: 'pi', env: env({ SPUR_BIN: ECHO }) }),
        ).toEqual({
            stdout: 'self hook context-post-tool --host pi|payload',
            exitCode: 0,
        });
    });

    test('fails open: missing binary, 127 and timeout resolve null', async () => {
        expect(
            await runSpurHookAsync('x', '', { host: 'pi', env: env({ SPUR_BIN: join(root, 'absent') }) }),
        ).toBeNull();
        expect(
            await runSpurHookAsync('x', '', { host: 'pi', env: env({ SPUR_BIN: ECHO, FAKE_EXIT: '127' }) }),
        ).toBeNull();
        const slow = script('slow-async-spur', 'sleep 5');
        expect(
            await runSpurHookAsync('x', '', { host: 'pi', timeoutMs: 200, env: env({ SPUR_BIN: slow }) }),
        ).toBeNull();
    });

    test('uses this process env by default', async () => {
        const res = await runSpurHookAsync('unknown-id', '', { host: 'pi' });
        expect(res === null || res.exitCode === 0).toBe(true);
    });
});
