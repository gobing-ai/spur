/**
 * Ported from `plugins/sp/tests/hooks/agent-lifecycle.test.ts` for the `@gobing-ai/spur-app` hook adapters
 * (script-absorption plan PR-2a). Spawned plugin-hook entrypoints are replaced by in-process
 * `runSpurHook` calls, so the same cases exercise the code `spur self hook` runs.
 */

/**
 * Task 1080 R4 — the host lifecycle hook.
 *
 * The failure list this test pins (task 1080 Plan step 1):
 *   - a hook runs `spur` outside a fleet  → no CLI call at all
 *   - a hook blocks on a slow CLI         → the report child is detached/unref'd
 *   - an unrelated Notification type      → never reported as `blocked`
 * plus the event→state mapping itself, which is the whole contract.
 *
 * The binary path is exercised too: the hook must exit 0 with a stdin payload and
 * make no CLI call without `SPUR_SPEC_ID`.
 */
import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar, removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import {
    lifecycleStateFor,
    parseHookPayload,
    type ReportDeps,
    reportLifecycleHook,
    reportSeq,
    runHookFromStdin,
    SPEC_ID_ENV,
} from '../../src/hooks/agent-lifecycle';
import { runSpurHook } from '../../src/hooks/run-hook';

describe('agent lifecycle hook (1080 R4)', () => {
    test('maps the host events to states, and reports nothing for an unknown event', () => {
        expect(lifecycleStateFor('SessionStart')).toBe('idle');
        expect(lifecycleStateFor('UserPromptSubmit')).toBe('working');
        expect(lifecycleStateFor('Notification', 'permission_prompt')).toBe('blocked');
        expect(lifecycleStateFor('Stop')).toBe('idle');
        // Pi (ADR-129)
        expect(lifecycleStateFor('agent_start')).toBe('working');
        expect(lifecycleStateFor('agent_settled')).toBe('idle');
        expect(lifecycleStateFor('PreToolUse')).toBeNull();
        expect(lifecycleStateFor(undefined)).toBeNull();
    });

    test('a non-permission Notification never reports blocked', () => {
        expect(lifecycleStateFor('Notification', 'idle_prompt')).toBeNull();
        expect(lifecycleStateFor('Notification', 'auth_success')).toBeNull();
        expect(lifecycleStateFor('Notification', 'elicitation_dialog')).toBeNull();
        // A host that omits the type still reports: the registered matcher already filtered.
        expect(lifecycleStateFor('Notification')).toBe('blocked');
    });

    test('outside a fleet no CLI call is made', () => {
        const spawned: string[][] = [];
        const outcome = reportLifecycleHook(
            { hook_event_name: 'UserPromptSubmit' },
            { env: {}, spawnDetached: (argv) => spawned.push([...argv]) },
        );
        expect(outcome).toEqual({ reported: false, reason: 'outside a fleet (no SPUR_SPEC_ID)' });
        expect(spawned).toEqual([]);
    });

    test('inside a fleet the report carries the state and a monotonic sequence', () => {
        const spawned: string[][] = [];
        const outcome = reportLifecycleHook(
            { hook_event_name: 'Notification', notification_type: 'permission_prompt' },
            { env: { [SPEC_ID_ENV]: 'proj-worker' }, spawnDetached: (argv) => spawned.push([...argv]), seq: '123' },
        );
        expect(outcome).toEqual({ reported: true, state: 'blocked' });
        expect(spawned).toEqual([['spur', 'agent', 'report', '--state', 'blocked', '--seq', '123']]);
    });

    test('the sequence increases across calls and stays integral (nanosecond string)', () => {
        const a = reportSeq(1_000, 1n);
        const b = reportSeq(1_000, 2n);
        expect(a).toBe('1000000001'); // 1000 ms → 1e9 ns, plus the 1 ns sub-ms part
        expect(b).toBe('1000000002');
        expect(BigInt(b) > BigInt(a)).toBe(true);
    });

    test('a spawn failure is swallowed (fail-open, never a thrown hook)', () => {
        const outcome = reportLifecycleHook(
            { hook_event_name: 'Stop' },
            {
                env: { [SPEC_ID_ENV]: 'proj-worker' },
                spawnDetached: () => {
                    throw new Error('ENOENT');
                },
            },
        );
        expect(outcome).toEqual({ reported: false, state: 'idle', reason: 'ENOENT' });
    });

    test('an event with no lifecycle meaning reports nothing even inside a fleet', () => {
        const spawned: string[][] = [];
        const outcome = reportLifecycleHook(
            { hook_event_name: 'PreToolUse' },
            { env: { [SPEC_ID_ENV]: 'proj-worker' }, spawnDetached: (argv) => spawned.push([...argv]) },
        );
        expect(outcome).toEqual({ reported: false, reason: 'event reports no lifecycle state' });
        expect(spawned).toEqual([]);
    });

    test('the default dispatch really spawns `spur agent report`, detached, without blocking', async () => {
        // The default seam is the production path (detached + unref'd), so it is exercised
        // against a shim on PATH rather than a real CLI: the shim records its argv, which is
        // exactly the contract (command, subcommand, flags) the fleet CLI must receive.
        const dir = mkdtempSync(join(tmpdir(), 'spur-lifecycle-hook-'));
        const shim = join(dir, 'spur');
        const record = join(dir, 'argv.txt');
        writeFileSync(shim, `#!/bin/sh\nprintf '%s ' "$@" > ${record}\n`);
        chmodSync(shim, 0o755);
        const previousPath = getEnvVar('PATH');
        const previousSpec = getEnvVar(SPEC_ID_ENV);
        setEnvVar('PATH', `${dir}:${previousPath ?? ''}`);
        setEnvVar(SPEC_ID_ENV, 'proj-worker-1');
        try {
            const outcome = reportLifecycleHook({ hook_event_name: 'UserPromptSubmit' }, { seq: '42' });
            // The call returning at all is the unref/no-await property; the shim lands shortly after.
            expect(outcome).toEqual({ reported: true, state: 'working' });
            for (let i = 0; i < 40 && !existsSync(record); i++) await new Promise((r) => setTimeout(r, 50));
            expect(readFileSync(record, 'utf-8')).toBe('agent report --state working --seq 42 ');
        } finally {
            if (previousPath === undefined) removeEnvVar('PATH');
            else setEnvVar('PATH', previousPath);
            if (previousSpec === undefined) removeEnvVar(SPEC_ID_ENV);
            else setEnvVar(SPEC_ID_ENV, previousSpec);
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('the entrypoint behavior parses stdin, reports, and swallows malformed input', () => {
        const spawned: string[][] = [];
        const deps: ReportDeps = {
            env: { [SPEC_ID_ENV]: 'proj-worker' },
            spawnDetached: (argv: readonly string[]) => spawned.push([...argv]),
        };

        expect(parseHookPayload('')).toEqual({});
        expect(parseHookPayload('{"hook_event_name":"Stop"}')).toEqual({ hook_event_name: 'Stop' });
        expect(expect(() => parseHookPayload('not json')).toThrow()).toBeUndefined();

        expect(runHookFromStdin('{"hook_event_name":"Stop"}', { ...deps, seq: '5' })).toEqual({
            reported: true,
            state: 'idle',
        });
        expect(spawned).toEqual([['spur', 'agent', 'report', '--state', 'idle', '--seq', '5']]);
        expect(runHookFromStdin('not json', deps)).toEqual({
            reported: false,
            reason: 'fail-open: unreadable payload',
        });
        expect(runHookFromStdin('', deps)).toEqual({ reported: false, reason: 'event reports no lifecycle state' });
    });

    test('runSpurHook exits 0 silently for a payload without a fleet, and for malformed stdin', () => {
        const spawned: string[][] = [];
        const base = {
            host: 'claude' as const,
            env: {},
            cwd: tmpdir(),
            spawnDetached: (argv: readonly string[]) => spawned.push([...argv]),
        };
        expect(runSpurHook('agent-lifecycle', { ...base, stdin: '{"hook_event_name":"Stop"}' })).toMatchObject({
            stdout: '',
            exitCode: 0,
        });
        expect(runSpurHook('agent-lifecycle', { ...base, stdin: 'not json' })).toMatchObject({
            stdout: '',
            exitCode: 0,
        });
        expect(spawned).toEqual([]);
    });

    test('runSpurHook reports through SPUR_BIN, else the running spur, for both host shapes', () => {
        const spawned: string[][] = [];
        const spawnDetached = (argv: readonly string[]) => spawned.push([...argv]);
        runSpurHook('agent-lifecycle', {
            host: 'claude',
            stdin: '{"hook_event_name":"UserPromptSubmit"}',
            env: { [SPEC_ID_ENV]: 'proj-w', SPUR_BIN: 'bun /x/spur.ts' },
            cwd: tmpdir(),
            spawnDetached,
        });
        runSpurHook('agent-lifecycle', {
            host: 'pi',
            stdin: '{"event":"agent_settled"}',
            env: { [SPEC_ID_ENV]: 'proj-w' },
            cwd: tmpdir(),
            selfArgv: ['/opt/spur'],
            spawnDetached,
        });
        expect(spawned.map((argv) => argv.slice(0, 6))).toEqual([
            ['bun', '/x/spur.ts', 'agent', 'report', '--state', 'working'],
            ['/opt/spur', 'agent', 'report', '--state', 'idle', '--seq'],
        ]);
    });
});
