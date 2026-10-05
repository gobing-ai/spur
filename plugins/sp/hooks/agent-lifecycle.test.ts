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
import { join, resolve } from 'node:path';
import { getEnvVar, getEnvVars, removeEnvVar, setEnvVar } from '../lib/env';
import {
    lifecycleStateFor,
    parseHookPayload,
    type ReportDeps,
    reportLifecycleHook,
    reportSeq,
    runHookFromStdin,
    SPEC_ID_ENV,
} from './agent-lifecycle';

const HOOK = resolve(import.meta.dir, 'agent-lifecycle.ts');

/** Run the hook binary with a stdin payload; returns its exit code. */
async function runHook(payload: unknown, env: Record<string, string> = {}): Promise<number> {
    const proc = Bun.spawn(['bun', HOOK], {
        stdin: new TextEncoder().encode(JSON.stringify(payload)),
        env: { ...getEnvVars(), ...env } as Record<string, string>,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return await proc.exited;
}

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

    test('the binary exits 0 for a valid payload without a fleet, and for malformed stdin', async () => {
        expect(await runHook({ hook_event_name: 'Stop' })).toBe(0);
        const broken = Bun.spawn(['bun', HOOK], {
            stdin: new TextEncoder().encode('not json'),
            env: getEnvVars() as Record<string, string>,
            stdout: 'pipe',
            stderr: 'pipe',
        });
        expect(await broken.exited).toBe(0);
    });
});
