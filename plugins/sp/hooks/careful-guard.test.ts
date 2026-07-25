/**
 * careful-guard — decision matrix tests (task 0215, R3).
 *
 * Spawn-only, mirroring `task-write-guard.test.ts`: the guard is exercised as a subprocess (never
 * imported in-process) so its decision matrix is covered end-to-end without the file entering the
 * per-file coverage gate — hooks are portable scripts run via `superskill hook run`, not modules.
 *
 * Tested here:
 *  1. **Pattern matrix** — destructive commands yield `ask`; safe build-cache removals and benign
 *     commands yield `allow`. The safe-exception list (node_modules/dist/.next/coverage/build) and
 *     the force-with-lease exemption are exercised explicitly.
 *  2. **Fail-open + escape-hatch contract** — non-Bash tool, malformed payload, empty command all
 *     yield `allow`; `SPUR_CAREFUL=off` short-circuits even a destructive command to `allow`.
 */

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const HOOK = join(import.meta.dir, 'careful-guard.ts');

interface Decision {
    permissionDecision: 'allow' | 'ask' | 'deny';
    systemMessage?: string;
}

async function runGuard(payload: unknown, env: Record<string, string> = {}, stdinText?: string): Promise<Decision> {
    const proc = Bun.spawn([process.execPath, HOOK], {
        stdin: new TextEncoder().encode(stdinText ?? JSON.stringify(payload)),
        stdout: 'pipe',
        stderr: 'pipe',
        env: { PATH: process.env.PATH ?? '', ...env },
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    const parsed = JSON.parse(out) as {
        hookSpecificOutput: { permissionDecision: 'allow' | 'ask' | 'deny' };
        systemMessage?: string;
    };
    return { permissionDecision: parsed.hookSpecificOutput.permissionDecision, systemMessage: parsed.systemMessage };
}

const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });

describe('careful-guard — destructive-command pattern matrix', () => {
    test.each([
        'rm -rf /',
        'rm -rf ~/important',
        'sudo rm -fr /var/data',
        'rm -r -f ./src',
        'DROP TABLE users;',
        'drop database analytics',
        'TRUNCATE TABLE events',
        'git push --force origin main',
        'git push -f',
        'git reset --hard HEAD~3',
        'git checkout .',
        'git restore .',
        'kubectl delete pod web-0',
        'docker system prune -a',
        'rm -rf node_modules /etc/nginx',
        // `man rm`: "-r  Equivalent to -R". The uppercase spelling is standard POSIX,
        // not obfuscation, and previously slipped past the guard entirely.
        'rm -Rf /important',
        'rm -R -f /important',
        'rm -fR ~/data',
        'rm -R --force /var/data',
        // A `+` refspec force-pushes without any --force flag.
        'git push origin +main',
        'git push origin +refs/heads/main',
    ])('asks before destructive command: %j', async (cmd) => {
        const d = await runGuard(bash(cmd));
        expect(d.permissionDecision).toBe('ask');
    });

    test.each([
        'rm -rf node_modules',
        'rm -rf dist',
        'rm -rf ./coverage .next',
        'rm -rf build/',
        'rm -rf packages/app/dist',
        'rm -f config.json',
        'git push --force-with-lease',
        'git checkout my-branch',
        'git commit -m "wip"',
        'ls -la && echo done',
        // -R without -f is not a forced remove; neither is -f without recursion.
        'rm -R ./tmpdir',
        // A bare `+` in a message must not read as a refspec.
        'git commit -m "a + b"',
        'git push origin main',
    ])('allows safe/benign command: %j', async (cmd) => {
        const d = await runGuard(bash(cmd));
        expect(d.permissionDecision).toBe('allow');
    });
});

// Flag-spelling coverage stays in the spawn matrix above (`rm -Rf`, `-R -f`, `-fR`,
// `-R --force`). The guard is deliberately never imported in-process — see the header:
// doing so would pull this portable script into the per-file coverage gate it is
// excluded from.

describe('careful-guard — fail-open + escape-hatch contract', () => {
    test('fails open (allow) for a non-Bash tool', async () => {
        const d = await runGuard({ tool_name: 'Read', tool_input: { command: 'rm -rf /' } });
        expect(d.permissionDecision).toBe('allow');
    });

    test('fails open (allow) on a malformed payload', async () => {
        const d = await runGuard({}, {}, 'not json');
        expect(d.permissionDecision).toBe('allow');
    });

    test('fails open (allow) when the command is empty', async () => {
        const d = await runGuard(bash('   '));
        expect(d.permissionDecision).toBe('allow');
    });

    test('SPUR_CAREFUL=off is the escape hatch — even a destructive command is allowed', async () => {
        const d = await runGuard(bash('rm -rf /'), { SPUR_CAREFUL: 'off' });
        expect(d.permissionDecision).toBe('allow');
    });

    test('the ask message names the SPUR_CAREFUL=off override', async () => {
        const d = await runGuard(bash('git push --force origin main'));
        expect(d.permissionDecision).toBe('ask');
        expect(d.systemMessage).toContain('SPUR_CAREFUL=off');
    });
});
